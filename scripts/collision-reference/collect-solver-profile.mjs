/** Data-only collection of the fixed solver profiling recipe. Never imports the engine. */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, readPacket, hash, json, holdRecord } from './packet.mjs';
import { decodeExact } from './exact-state.mjs';
import { assertBaseline } from './profile-data.mjs';
import { analyzeSolverProfile, decodeSolverCoverage } from './solver-profile-data.mjs';
import { same } from './replay.mjs';
if (process.argv.length !== 3) throw Error('Usage: collect-solver-profile.mjs CPU_PACKET');
const directory = resolve(process.argv[2]),
  read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const artifact = (p) => ({
  path: relative(ROOT, p).replaceAll('\\', '/'),
  sha256: hash(readFileSync(p)),
});
const review = read(join(directory, 'review.json')),
  reviewArtifact = artifact(join(directory, 'review.json'));
assert.equal(review.solver?.kind, 'rigid-stack-solver-profile-v1');
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
for (const key of ['baseline', 'baselinePacket', 'regressionBaseline'])
  assert.equal(hash(readFileSync(join(ROOT, review.solver[key]))), review.solver[key + 'Sha256']);
const { packet, sha256 } = readPacket(review.benchmark.directory);
assert.equal(sha256, review.benchmark.packetSha256);
assert.equal(packet.bundleSha256, review.solver.bundleSha256);
const baseline = read(join(ROOT, review.solver.baseline)),
  bundlePath = join(review.benchmark.directory, 'engine.mjs'),
  bundle = readFileSync(bundlePath, 'utf8');
const cases = [
  'startup-close',
  'stalled-cpu',
  'supervisor-loss',
  'ss-owned-regression',
  'world-reference',
  'ss-stack-solver-profile-1',
  'ss-stack-solver-profile-2',
  'ss-stack-solver-profile-3',
  'ss-stack-solver-counts',
];
same(review.cases, cases, 'fixed solver sequence');
const stages = [],
  rows = [];
let regression = null,
  world = null,
  coverage = null;
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
  assert.equal(receipt.reviewSha256, reviewArtifact.sha256);
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
  const resultPath = join(stage, 'result.json');
  if (!receipt.passed || !existsSync(resultPath)) continue;
  const result = read(resultPath);
  assert.equal(result.status, 'completed');
  assert.equal(result.packetSha256, sha256);
  same(result.acceptance, packet.protocol.acceptance, 'solver qualification');
  if (name === 'ss-owned-regression') {
    assert.equal(result.regression.count, 71);
    regression = artifact(resultPath);
    continue;
  }
  if (name === 'world-reference') {
    same(result.world.exact, baseline.worldReplay.exact, 'solver world exact');
    world = artifact(resultPath);
    continue;
  }
  const counts = name === 'ss-stack-solver-counts',
    dts = counts ? [review.solver.coverageDt] : packet.protocol.timesteps;
  same(
    result.rows.map((r) => r.dt),
    dts,
    'fixed row order',
  );
  for (const stored of result.rows) {
    const rowPath = join(stage, 'row-' + stored.dt + '.json'),
      row = read(rowPath);
    same(row, stored, 'stored solver row');
    row.exact.value = decodeExact(row.exact.encoding, row.exact.sha256);
    assertBaseline(
      row,
      baseline.rows.find(
        (r) => r.backend === 'state-space-rigid' && r.scene === 'resting-stack' && r.dt === row.dt,
      ),
    );
    assert.equal(row.profiling.mode, counts ? 'precise-coverage' : 'sampling');
    assert.equal(
      row.profiling.artifact,
      (counts ? 'coverage-' : 'profile-') + row.dt + (counts ? '.json' : '.cpuprofile'),
    );
    const clocks = row.profiling.clocks,
      ticks = Math.round(0.048 / row.dt);
    for (const key of [
      'wallMs',
      'kernelWallMs',
      'threadUserMs',
      'threadSystemMs',
      'processUserMs',
      'processSystemMs',
    ])
      assert(Number.isFinite(clocks[key]) && clocks[key] >= 0);
    same(clocks.metrics.create.calls, 15 * ticks - 3, 'solver creates');
    same(clocks.metrics.completed, 15 * ticks - 4, 'solver completions');
    same(clocks.metrics.close.calls, 15 * ticks - 3, 'solver closes');
    const rawPath = join(stage, row.profiling.artifact),
      raw = read(rawPath);
    let analysis = null;
    if (counts) {
      const functions = decodeSolverCoverage(raw, bundle, pathToFileURL(bundlePath).href);
      const create = functions.filter(
        (f) =>
          f.source === 'engine/experimental/multiphysics/rigid.ts' &&
          f.function === 'createRigidStep3D',
      );
      assert.equal(create.length, 1);
      assert.equal(create[0].callCount, 15 * ticks - 3);
      coverage = {
        artifact: artifact(rawPath),
        functions,
        interpretation:
          'Exact instrumented execution counts for the full 2 ms replay/warmup/measurement workload. Precise coverage disables optimization; its timings are not performance evidence. Generator entry counts are not automatically solver/contact iteration counts.',
      };
    } else analysis = analyzeSolverProfile(raw, bundle);
    rows.push({
      case: name,
      dt: row.dt,
      mode: row.profiling.mode,
      row: artifact(rowPath),
      artifact: artifact(rawPath),
      exactSha256: row.exact.sha256,
      phaseWork: row.phaseWork,
      work: row.work,
      timing: row.timing,
      clocks,
      analysis,
    });
  }
}
function sumCounts(items) {
  const out = {
    samples: 0,
    kernelSamples: 0,
    solverSamples: 0,
    buckets: {},
    inclusive: {},
    solverBreakdown: {},
  };
  for (const item of items) {
    for (const key of ['samples', 'kernelSamples', 'solverSamples']) out[key] += item[key];
    for (const key of ['buckets', 'inclusive', 'solverBreakdown'])
      for (const [name, n] of Object.entries(item[key])) out[key][name] = (out[key][name] ?? 0) + n;
  }
  return out;
}
const sampled = rows.filter((r) => r.mode === 'sampling');
const summary = {
  schema: 'collision-stack-solver-profile-results-v1',
  status:
    stages.every((s) => s.passed) && sampled.length === 9 && coverage && regression && world
      ? 'diagnostic-complete'
      : 'incomplete',
  review: reviewArtifact,
  benchmark: artifact(join(review.benchmark.directory, 'packet.json')),
  engineBundleSha256: packet.bundleSha256,
  historicalComparison: artifact(join(ROOT, review.solver.baseline)),
  regression,
  world,
  stages,
  rows,
  coverage,
  aggregate: {
    all: sumCounts(sampled.map((r) => r.analysis.all)),
    shortIntervals: sumCounts(sampled.map((r) => r.analysis.shortIntervals)),
  },
  byDt: packet.protocol.timesteps.map((dt) => ({
    dt,
    all: sumCounts(sampled.filter((r) => r.dt === dt).map((r) => r.analysis.all)),
    shortIntervals: sumCounts(
      sampled.filter((r) => r.dt === dt).map((r) => r.analysis.shortIntervals),
    ),
  })),
  counts: {
    passedStages: stages.filter((s) => s.passed).length,
    rows: rows.length,
    profiles: sampled.length,
    measuredSamples: rows.reduce((n, r) => n + r.timing.samplesMs.length, 0),
  },
  hold: review.hold,
  limits: review.limits,
  qualification: packet.protocol.acceptance,
  interpretation: [
    'Samples are counts, not CPU percentages or benchmark speedups; long elapsed gaps are never charged to the sampled function.',
    'Inclusive categories overlap. Source positions may refer to inlined helpers; unresolved solver samples remain explicit.',
    'Three fixed sampling jobs cover 16/8/2 ms; a separate fixed 2 ms coverage job measures calls with optimization disabled.',
    'No engine, TOI, replay, deterministic work or qualification change. No GPU/browser workload or inspector listener.',
  ],
};
json(join(directory, 'solver-profile-summary.json'), summary);
console.log(
  JSON.stringify({
    status: summary.status,
    counts: summary.counts,
    aggregate: summary.aggregate,
    byDt: summary.byDt,
  }),
);
