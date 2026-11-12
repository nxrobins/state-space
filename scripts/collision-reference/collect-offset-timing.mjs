/** Data-only verification/summary of the fixed resting-stack timing investigation. */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { ROOT, readPacket, hash, json, holdRecord } from './packet.mjs';
import { decodeExact } from './exact-state.mjs';
import { assertBaseline } from './profile-data.mjs';
import { annotateTiming } from './timing-data.mjs';
import { same } from './replay.mjs';
import { verifyClockRecords } from './cache-timing-data.mjs';
import { summarizeTimingRows } from './offset-timing-data.mjs';
if (process.argv.length !== 3) throw Error('Usage: collect-offset-timing.mjs CPU_PACKET');
const directory = resolve(process.argv[2]),
  read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const artifact = (path) => ({
  path: relative(ROOT, path).replaceAll('\\', '/'),
  sha256: hash(readFileSync(path)),
});
const review = read(join(directory, 'review.json')),
  reviewSha256 = hash(readFileSync(join(directory, 'review.json')));
assert.equal(review.offsetTiming?.kind, 'rigid-stack-offset-timing-v1');
assert(!existsSync(join(directory, 'execution.lock')));
assert.equal(holdRecord().sha256, review.hold.sha256);
assert.equal(
  hash(
    readFileSync(
      join(
        ROOT,
        'dist/verification/browser-containment/d40b35fb88374a749ef87c71add94948/supervisor-loss/report.json',
      ),
    ),
  ),
  review.originalFailureSha256,
);
for (const [path, digest] of Object.entries(review.sources))
  assert.equal(hash(readFileSync(join(ROOT, path))), digest, path);
for (const key of ['baseline', 'baselinePacket', 'originalBundle', 'regressionBaseline'])
  assert.equal(
    hash(readFileSync(join(ROOT, review.offsetTiming[key]))),
    review.offsetTiming[key + 'Sha256'],
  );
const { packet, sha256 } = readPacket(review.benchmark.directory);
assert.equal(sha256, review.benchmark.packetSha256);
assert.equal(packet.bundleSha256, review.offsetTiming.bundleSha256);
const baseline = read(join(ROOT, review.offsetTiming.baseline));
const cases = [
  'startup-close',
  'stalled-cpu',
  'supervisor-loss',
  'ss-owned-regression',
  'ss-normal-cache-regression',
  'world-reference',
  'ss-stack-plain',
  'ss-stack-clock-ab-1',
  'ss-stack-clock-ba-1',
  'ss-stack-clock-ab-2',
  'ss-stack-clock-ba-2',
];
same(review.cases, cases, 'fixed timing sequence');
const stages = [],
  rows = [],
  longSteps = [];
let regression = null,
  contactRegression = null,
  world = null;
for (const name of cases) {
  const stage = join(directory, name),
    receiptPath = join(stage, 'report.json');
  if (!existsSync(receiptPath)) {
    stages.push({ case: name, passed: false, status: 'not-run' });
    continue;
  }
  const receipt = read(receiptPath),
    quietPath = join(directory, 'quiet-' + name + '.json'),
    quiet = read(quietPath);
  assert.equal(receipt.reviewSha256, reviewSha256);
  for (const key of [
    'namedJobAbsent',
    'holdUnchanged',
    'sourcesUnchanged',
    'protectedWorktreeUnchanged',
    'originalFailureUnchanged',
  ])
    assert.equal(receipt[key], true, name + '/' + key);
  assert.equal(receipt.cleanupActiveProcesses, 0);
  assert(!receipt.cleanupError && !receipt.cleanupErrors?.length);
  for (const key of [
    'runtimeAcceptance',
    'performanceAcceptance',
    'gpuAcceptance',
    'workerAcceptance',
    'r1Acceptance',
  ])
    assert.equal(receipt[key], false);
  assert(
    quiet.passed &&
      quiet.samples.length >= 30 &&
      quiet.elapsedSeconds >= 30 &&
      quiet.observationElapsedSeconds <= 90,
  );
  assert(
    quiet.samples.every(
      (s) =>
        s.hostCpuPercent >= 0 &&
        s.hostCpuPercent <= 30 &&
        s.freeMemoryMiB >= 8192 &&
        s.gpu === null,
    ),
  );
  stages.push({
    case: name,
    passed: receipt.passed,
    report: artifact(receiptPath),
    quiet: artifact(quietPath),
    error: receipt.error ?? null,
    faultToEmptyJobSeconds: receipt.faultToEmptyJobSeconds ?? null,
    maximumHostCpuPercent: Math.max(
      0,
      ...(receipt.healthSamples ?? []).map((s) => s.host.hostCpuPercent),
    ),
  });
  const path = join(stage, 'result.json');
  if (!existsSync(path) || !receipt.passed) continue;
  const result = read(path);
  assert.equal(result.packetSha256, sha256);
  assert.equal(result.status, 'completed');
  same(result.acceptance, packet.protocol.acceptance, 'timing acceptance unchanged');
  if (name === 'ss-owned-regression') {
    assert.equal(result.regression.count, 71);
    regression = artifact(path);
    continue;
  }
  if (name === 'world-reference') {
    same(result.world.exact, baseline.worldReplay.exact, 'timing world exact');
    world = artifact(path);
    continue;
  }
  if (name === 'ss-normal-cache-regression') {
    assert.equal(result.contactRegression.status, 'completed');
    assert.equal(result.contactRegression.count, 37);
    contactRegression = artifact(path);
    continue;
  }
  same(
    result.recipe,
    {
      clocks: name !== 'ss-stack-plain',
      reverse: name.startsWith('ss-stack-clock-ba-'),
    },
    'fixed clock recipe',
  );
  assert.equal(result.rows.length, 6);
  assert.equal(result.totalSteps, result.recipe.clocks ? 972 : 0);
  assert(result.gc.length <= review.offsetTiming.maxGcEvents && !result.gcOverflow);
  assert(
    result.gc.every(
      (g) =>
        [g.startMs, g.endMs, g.durationMs, g.kind, g.flags].every(Number.isFinite) &&
        g.endMs >= g.startMs &&
        g.durationMs >= 0,
    ),
  );
  const keys = new Set();
  for (const item of result.rows) {
    const key = item.version + '/' + item.dt;
    assert(!keys.has(key));
    keys.add(key);
    assert(
      ['baseline', 'optimized'].includes(item.version) &&
        packet.protocol.timesteps.includes(item.dt),
    );
    const rowPath = join(stage, item.rowFile);
    assert.equal(hash(readFileSync(rowPath)), item.rowSha256);
    const row = read(rowPath);
    assert.equal(row.dt, item.dt);
    assert.equal(row.scene, 'resting-stack');
    assert.equal(row.backend, 'state-space-rigid');
    assert.equal(item.rowFile, item.version + '-row-' + item.dt + '.json');
    row.exact.value = decodeExact(row.exact.encoding, row.exact.sha256);
    assertBaseline(
      row,
      baseline.rows.find(
        (r) => r.backend === 'state-space-rigid' && r.scene === 'resting-stack' && r.dt === row.dt,
      ),
    );
    same(item.timing, row.timing, 'stored diagnostic samples');
    assert.equal(item.exactSha256, row.exact.sha256);
    if (result.recipe.clocks) {
      verifyClockRecords(item.measurements.steps, result.gc);
      same(
        annotateTiming(item.measurements.steps, row, result.gc),
        item.measurements,
        'timing attribution',
      );
      for (const step of item.measurements.steps.filter((s) => s.wallMs >= 50))
        longSteps.push({
          case: name,
          version: item.version,
          dt: item.dt,
          ...step,
          epochStartMs: result.timeOriginMs + step.startMs,
          largeWallCpuGap:
            step.wallMinusThreadCpuMs >= 50 && step.threadCpuMs <= step.wallMs * 0.25,
        });
    }
    rows.push({
      case: name,
      version: item.version,
      dt: item.dt,
      order: item.order,
      instrumented: result.recipe.clocks,
      timing: item.timing,
      samples: item.measurements?.samples ?? null,
      result: artifact(path),
      row: artifact(rowPath),
    });
  }
}
const median = (values) => {
  const v = [...values].sort((a, b) => a - b);
  return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
};
const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;
const summary = {
  schema: 'collision-stack-offset-timing-results-v1',
  status:
    stages.every((s) => s.passed) && rows.length === 30 && regression && contactRegression && world
      ? 'diagnostic-complete'
      : 'incomplete',
  review: artifact(join(directory, 'review.json')),
  benchmark: artifact(join(review.benchmark.directory, 'packet.json')),
  engineBundleSha256: packet.bundleSha256,
  originalBundleSha256: review.offsetTiming.originalBundleSha256,
  historicalComparison: artifact(join(ROOT, review.offsetTiming.baseline)),
  regression,
  contactRegression,
  world,
  stages,
  rows,
  cohorts: summarizeTimingRows(rows),
  longSteps,
  counts: {
    passedStages: stages.filter((s) => s.passed).length,
    rows: rows.length,
    measuredSamples: rows.reduce((n, r) => n + r.timing.samplesMs.length, 0),
    observedSteps: rows.reduce(
      (n, r) => n + (r.instrumented ? 15 * Math.round(0.048 / r.dt) - 3 : 0),
      0,
    ),
  },
  twoMillisecondCohorts: rows
    .filter((r) => r.dt === 0.002)
    .map((r) => ({
      case: r.case,
      version: r.version,
      instrumented: r.instrumented,
      medianWallMs: r.timing.medianMs,
      meanWallMs: mean(r.timing.samplesMs),
      maximumWallMs: Math.max(...r.timing.samplesMs),
      medianThreadCpuMs: r.samples ? median(r.samples.map((s) => s.threadCpuMs)) : null,
      medianProcessCpuMs: r.samples ? median(r.samples.map((s) => s.processCpuMs)) : null,
    })),
  measuredLongSteps: longSteps.filter((s) => s.phase === 'measured'),
  hold: review.hold,
  limits: review.limits,
  qualification: packet.protocol.acceptance,
  interpretation: [
    'Original 181.1903 ms sample has no per-sample CPU/GC clocks; its exact cause cannot be retrospectively assigned.',
    'The original 8 ms median regression is retained. New same-order and reverse-order cohorts test whether it repeats; short coarsely accounted CPU intervals do not establish precise engine CPU savings or regressions.',
    'Instrumented clocks identify elapsed time versus accounted current-main-thread/process CPU. They do not identify a particular scheduler, quota event or wait reason.',
    'Per-step CPU deltas are coarsely accounted by the OS. Raw negative wall-minus-CPU differences remain; small intervals do not support precise CPU fractions.',
    'GC overlap is elapsed time, may include off-CPU delay, and cannot be treated as exclusive GC CPU cost.',
    'Thread CPU includes engine, wrapper and runtime work, including GC/JIT. CPU and GC elapsed intervals are overlapping measures and must not be added or subtracted as disjoint costs.',
    'One plain cohort and four fixed alternating-order instrumented cohorts; no forced GC, inspector, priority/affinity/quota change or sample replacement.',
    'Exact states and per-step deterministic work remain pinned. These diagnostics do not grant performance, runtime, Worker, GPU or R1 acceptance.',
  ],
};
json(join(directory, 'timing-summary.json'), summary);
console.log(
  JSON.stringify({
    ...summary,
    rows: undefined,
    cohorts: undefined,
    longSteps: undefined,
    stages: undefined,
    measuredLongSteps: undefined,
  }),
);
