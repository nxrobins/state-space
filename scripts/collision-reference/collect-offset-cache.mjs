/** Data-only collection of the fixed optimization recipe and its fresh controls. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { ROOT, readPacket, hash, json, holdRecord } from './packet.mjs';
import { assembleReport, markdownReport } from './report.mjs';
import { decodeExact } from './exact-state.mjs';
import { same } from './replay.mjs';
import { evaluate } from './protocol.mjs';
if (process.argv.length !== 3) throw Error('Usage: collect-offset-cache.mjs CPU_PACKET');
const directory = resolve(process.argv[2]),
  read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const sha = (path) => hash(readFileSync(path));
const review = read(join(directory, 'review.json')),
  reviewSha256 = sha(join(directory, 'review.json'));
const config = review.offsetCache ?? review.optimization,
  offsetCache = config?.kind === 'rigid-offset-cache-v1';
if (
  (!offsetCache && config?.kind !== 'rigid-owned-optimization-v1') ||
  existsSync(join(directory, 'execution.lock'))
)
  throw Error('Unreviewed or locked optimization packet');
const { packet, sha256 } = readPacket(review.benchmark.directory);
if (
  sha256 !== review.benchmark.packetSha256 ||
  holdRecord().sha256 !== review.hold.sha256 ||
  sha(join(ROOT, config.baseline)) !== config.baselineSha256
)
  throw Error('Changed optimization provenance');
for (const [path, digest] of Object.entries(review.sources))
  if (sha(join(ROOT, path)) !== digest) throw Error('Scope source drift');
for (const key of [
  'baselinePacket',
  'baselineBundle',
  'regressionBaseline',
  'regressionManifest',
  ...(offsetCache ? ['sourceBaseline', 'coverageBaseline'] : []),
])
  if (sha(join(ROOT, config[key])) !== config[key + 'Sha256'])
    throw Error('Frozen baseline drift: ' + key);
if (
  sha(
    join(
      ROOT,
      'dist/verification/browser-containment/d40b35fb88374a749ef87c71add94948/supervisor-loss/report.json',
    ),
  ) !== review.originalFailureSha256
)
  throw Error('Original failure changed');
const baseline = read(join(ROOT, config.baseline));
const expectedCases = [
  'startup-close',
  'stalled-cpu',
  'supervisor-loss',
  'ss-owned-regression',
  ...(offsetCache ? ['ss-normal-cache-regression'] : []),
  'world-reference',
  ...packet.fixtures.flatMap((s) => ['ss-' + s.id, 'mj-' + s.id]),
  ...(offsetCache ? ['ss-offset-cache-counts'] : []),
];
same(review.cases, expectedCases, 'fixed optimization sequence');
const stateRows = [],
  mujocoRows = [],
  containment = [],
  controls = [];
let world = { status: 'not-run' },
  regression = { status: 'not-run' };
let contactRegression = { status: 'not-run' },
  callCounts = { status: 'not-run' };
for (const name of review.cases) {
  const path = join(directory, name),
    reportPath = join(path, 'report.json');
  if (!existsSync(reportPath)) {
    containment.push({ case: name, status: 'not-run' });
    continue;
  }
  const receipt = read(reportPath);
  if (receipt.reviewSha256 !== reviewSha256) throw Error('Unbound containment receipt');
  for (const key of [
    'runtimeAcceptance',
    'performanceAcceptance',
    'gpuAcceptance',
    'workerAcceptance',
    'r1Acceptance',
  ])
    if (receipt[key] !== false) throw Error('Qualification changed');
  const quiet = read(join(directory, 'quiet-' + name + '.json'));
  if (
    !quiet.passed ||
    quiet.samples.length < 30 ||
    quiet.elapsedSeconds < 30 ||
    quiet.observationElapsedSeconds > 90 ||
    !quiet.samples.every(
      (s) =>
        s.hostCpuPercent >= 0 &&
        s.hostCpuPercent <= 30 &&
        s.freeMemoryMiB >= 8192 &&
        s.gpu === null,
    )
  )
    throw Error('Invalid quiet receipt');
  containment.push({
    case: name,
    passed:
      [
        'passed',
        'namedJobAbsent',
        'holdUnchanged',
        'sourcesUnchanged',
        'protectedWorktreeUnchanged',
        'originalFailureUnchanged',
      ].every((k) => receipt[k] === true) &&
      receipt.cleanupActiveProcesses === 0 &&
      !receipt.cleanupError,
    reportSha256: sha(reportPath),
    namedJobAbsent: receipt.namedJobAbsent,
    faultToEmptyJobSeconds: receipt.faultToEmptyJobSeconds ?? null,
  });
  const resultPath = join(path, 'result.json');
  if (!existsSync(resultPath)) continue;
  const result = read(resultPath);
  if (name === 'world-reference') world = result;
  else if (name === 'ss-owned-regression') regression = result;
  else if (name === 'ss-normal-cache-regression') contactRegression = result;
  else if (name === 'ss-offset-cache-counts') {
    callCounts = result;
    if (result.status === 'completed') {
      if (
        result.packetSha256 !== sha256 ||
        result.before !== 491280 ||
        result.after !== 17088 ||
        result.totalSubtractBefore - result.totalSubtractAfter !== 474192 ||
        result.coverageSha256 !== sha(join(path, 'coverage.json')) ||
        result.rowSha256 !== sha(join(path, 'row.json'))
      )
        throw Error('Unbound call-count evidence');
      const row = read(join(path, 'row.json')),
        previous = baseline.rows.find(
          (r) => r.backend === row.backend && r.scene === row.scene && r.dt === row.dt,
        );
      same(
        decodeExact(row.exact.encoding, row.exact.sha256),
        decodeExact(previous.exact.encoding, previous.exact.sha256),
        'coverage exact state',
      );
      for (const key of ['phaseWork', 'replay', 'trajectory', 'diagnostic'])
        same(row[key], previous[key], 'coverage baseline ' + key);
    }
  } else {
    if (result.packetSha256 !== sha256) throw Error('Unbound backend result');
    (name.startsWith('ss-') ? stateRows : mujocoRows).push(...result.rows);
    if (offsetCache && name.startsWith('mj-'))
      for (const row of result.rows.filter((r) => r.status === 'completed')) {
        const original = baseline.rows.find(
          (r) => r.backend === row.backend && r.scene === row.scene && r.dt === row.dt,
        );
        if (!original) throw Error('Missing MuJoCo baseline');
        for (const key of ['integrationState', 'replay', 'trajectory', 'modelXmlSha256'])
          same(row[key], original[key], 'MuJoCo baseline ' + key);
        same(
          evaluate(
            packet.fixtures.find((s) => s.id === row.scene),
            row.trajectory,
          ),
          original.diagnostic,
          'MuJoCo baseline diagnostic',
        );
      }
    if (name.startsWith('ss-'))
      for (const row of result.rows.filter((r) => r.status === 'completed')) {
        const original = baseline.rows.find(
          (r) => r.backend === row.backend && r.scene === row.scene && r.dt === row.dt,
        );
        const controlPath = join(path, 'control-row-' + row.dt + '.json'),
          control = read(controlPath);
        if (
          !original ||
          row.baselineControl?.exactMatch !== true ||
          row.baselineControl.rowSha256 !== sha(controlPath) ||
          control.status !== 'completed'
        )
          throw Error('Missing exact baseline control');
        for (const previous of [original, control]) {
          same(
            decodeExact(row.exact.encoding, row.exact.sha256),
            decodeExact(previous.exact.encoding, previous.exact.sha256),
            'optimized exact baseline',
          );
          for (const key of ['phaseWork', 'replay', 'trajectory', 'diagnostic'])
            same(row[key], previous[key], 'optimized baseline ' + key);
        }
        if (row.timing.samplesMs.length !== 7 || control.timing.samplesMs.length !== 7)
          throw Error('Sample count changed');
        controls.push({
          scene: row.scene,
          dt: row.dt,
          order: row.baselineControl.order,
          exactSha256: row.exact.sha256,
          baseline: control.timing,
          optimized: row.timing,
          baselineOverOptimizedMedian: control.timing.medianMs / row.timing.medianMs,
          controlSha256: sha(controlPath),
        });
      }
  }
}
const report = {
  ...assembleReport(packet, stateRows, mujocoRows, world),
  optimization: {
    regression,
    controls,
    baselineSha256: config.baselineSha256,
    baselineBundleSha256: config.baselineBundleSha256,
    timingPurpose:
      'Unprofiled diagnostic A/B controls under unchanged Job limits; no performance qualification.',
  },
  ...(offsetCache
    ? { offsetCache: { contactRegression, callCounts: { ...callCounts, functions: undefined } } }
    : {}),
  cpuScope: {
    reviewSha256,
    packetSha256: sha256,
    limits: review.limits,
    containment,
    hold: review.hold,
  },
};
if (
  containment.some((r) => !r.passed) ||
  regression.status !== 'completed' ||
  controls.length !== 21 ||
  (offsetCache &&
    (regression.count !== 71 ||
      contactRegression.status !== 'completed' ||
      contactRegression.count !== 37 ||
      callCounts.status !== 'completed'))
)
  report.status = 'incomplete';
if (world.status === 'completed')
  same(world.exact, baseline.worldReplay.exact, 'stored complete world baseline');
json(join(directory, 'comparison.json'), report);
writeFileSync(join(directory, 'comparison.md'), markdownReport(report), { flag: 'wx' });
const geometricMean = (values) =>
  Math.exp(values.reduce((sum, v) => sum + Math.log(v), 0) / values.length);
const summary = {
  status: report.status,
  rows: report.rows.length,
  regressionChecks: regression.count ?? 0,
  ...(offsetCache
    ? {
        contactRegressionChecks: contactRegression.count ?? 0,
        callCounts: { ...callCounts, functions: undefined },
      }
    : {}),
  passedStages: containment.filter((r) => r.passed).length,
  acceptance: report.acceptance,
  comparisonSha256: sha(join(directory, 'comparison.json')),
  reviewSha256,
  controls,
  geometricMeanMedianRatio: controls.length
    ? geometricMean(controls.map((c) => c.baselineOverOptimizedMedian))
    : null,
  scenes: packet.fixtures.map((scene) => {
    const rows = controls.filter((c) => c.scene === scene.id);
    return {
      scene: scene.id,
      rows: rows.length,
      geometricMeanMedianRatio: rows.length
        ? geometricMean(rows.map((c) => c.baselineOverOptimizedMedian))
        : null,
    };
  }),
  interpretation:
    'Ratios summarize per-row medians from fresh baseline and optimized cohorts. Alternating order is fixed. Retain all raw samples; this single capped cohort is not a qualified throughput or speedup claim.',
};
json(join(directory, 'optimization-summary.json'), summary);
console.log(JSON.stringify({ ...summary, controls: undefined }));
