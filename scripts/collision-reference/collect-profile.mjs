/** Data-only aggregation of the fixed CPU profile recipe. Never imports physics. */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { ROOT, readPacket, hash, json, holdRecord } from './packet.mjs';
import { summarizeCpuProfile } from './profile-data.mjs';
import { same } from './replay.mjs';
import { decodeExact } from './exact-state.mjs';

if (process.argv.length !== 3) throw Error('Usage: collect-profile.mjs CPU_PACKET');
const directory = resolve(process.argv[2]);
const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const sha = (path) => hash(readFileSync(path));
const review = read(join(directory, 'review.json')),
  reviewSha256 = sha(join(directory, 'review.json'));
if (
  review.profile?.kind !== 'state-space-cpu-profile-v1' ||
  existsSync(join(directory, 'execution.lock'))
)
  throw Error('Unreviewed or still locked profile packet');
const { packet, sha256 } = readPacket(review.benchmark.directory);
if (
  sha256 !== review.benchmark.packetSha256 ||
  holdRecord().sha256 !== review.hold.sha256 ||
  sha(join(ROOT, review.profile.baseline)) !== review.profile.baselineSha256
)
  throw Error('Changed profiling provenance');
const expectedCases = [
  'startup-close',
  'stalled-cpu',
  'supervisor-loss',
  'world-reference',
  ...packet.fixtures.map((scene) => 'ss-' + scene.id),
];
same(review.cases, expectedCases, 'fixed profile cases');
for (const [path, expected] of Object.entries(review.sources))
  if (sha(join(ROOT, path)) !== expected) throw Error('Profile scope source drift');
const baseline = read(join(ROOT, review.profile.baseline));
const bundle = readFileSync(join(review.benchmark.directory, 'engine.mjs'), 'utf8');
const rows = [],
  stages = [];
let world;
for (const name of expectedCases) {
  const reportPath = join(directory, name, 'report.json');
  if (!existsSync(reportPath)) {
    stages.push({ case: name, status: 'not-run' });
    continue;
  }
  const receipt = read(reportPath);
  if (receipt.reviewSha256 !== reviewSha256) throw Error('Unbound profile stage');
  const passed =
    [
      'passed',
      'namedJobAbsent',
      'holdUnchanged',
      'sourcesUnchanged',
      'protectedWorktreeUnchanged',
      'originalFailureUnchanged',
    ].every((key) => receipt[key] === true) &&
    receipt.cleanupActiveProcesses === 0 &&
    !receipt.cleanupError;
  const stage = {
    case: name,
    passed,
    reportSha256: sha(reportPath),
    faultToEmptyJobSeconds: receipt.faultToEmptyJobSeconds ?? null,
  };
  stages.push(stage);
  const resultPath = join(directory, name, 'result.json');
  if (!existsSync(resultPath)) continue;
  const result = read(resultPath);
  stage.resultSha256 = sha(resultPath);
  if (name === 'world-reference') {
    world = result;
    if (world.status === 'completed')
      same(world.exact, baseline.worldReplay.exact, 'stored world baseline');
  } else {
    if (result.kind !== review.profile.kind || result.packetSha256 !== sha256)
      throw Error('Unbound profiling rows');
    for (const row of result.rows) {
      if (row.status !== 'completed') {
        rows.push(row);
        continue;
      }
      const previous = baseline.rows.find(
        (r) => r.backend === row.backend && r.scene === row.scene && r.dt === row.dt,
      );
      if (
        !previous ||
        row.backend !== 'state-space-rigid' ||
        name !== 'ss-' + row.scene ||
        row.profiling.baselineExactMatched !== true ||
        row.profiling.baselineSha256 !== review.profile.baselineSha256 ||
        row.timing.samplesMs.length !== 7
      )
        throw Error('Incomplete profiling replay row');
      same(
        decodeExact(row.exact.encoding, row.exact.sha256),
        decodeExact(previous.exact.encoding, previous.exact.sha256),
        'complete profile baseline',
      );
      for (const key of ['phaseWork', 'replay', 'trajectory', 'diagnostic', 'ticks', 'duration'])
        same(row[key], previous[key], 'stored profile baseline ' + key);
      const profilePath = join(directory, name, 'profile-' + row.dt + '.cpuprofile');
      same(
        summarizeCpuProfile(read(profilePath), bundle),
        row.profiling.sampling,
        'raw profile summary',
      );
      rows.push({
        scene: row.scene,
        dt: row.dt,
        status: row.status,
        exactSha256: row.exact.sha256,
        phaseWork: row.phaseWork,
        profiling: row.profiling,
        instrumentedTiming: row.timing,
        profileSha256: sha(profilePath),
        profilePath,
      });
    }
  }
}
const expected = packet.fixtures.flatMap((scene) =>
  packet.protocol.timesteps.map((dt) => scene.id + '/' + dt),
);
const actual = rows.map((row) => row.scene + '/' + row.dt);
if (new Set(actual).size !== actual.length || actual.some((key) => !expected.includes(key)))
  throw Error('Duplicate or unregistered profile rows');
const completed = rows.filter((row) => row.status === 'completed');
const totals = {
  wallMs: 0,
  processUserMs: 0,
  processSystemMs: 0,
  kernelWallMs: 0,
  outsideKernelWallMs: 0,
  createWallMs: 0,
  nextWallMs: 0,
  closeWallMs: 0,
  createCalls: 0,
  nextCalls: 0,
  samples: 0,
  buckets: {},
  kernelFunctions: [],
};
const functions = new Map();
for (const row of completed) {
  const p = row.profiling;
  for (const key of [
    'wallMs',
    'processUserMs',
    'processSystemMs',
    'kernelWallMs',
    'outsideKernelWallMs',
  ])
    totals[key] += p[key];
  for (const key of ['create', 'next', 'close']) totals[key + 'WallMs'] += p.metrics[key].wallMs;
  totals.createCalls += p.metrics.create.calls;
  totals.nextCalls += p.metrics.next.calls;
  totals.samples += p.sampling.samples;
  for (const [bucket, count] of Object.entries(p.sampling.buckets))
    totals.buckets[bucket] = (totals.buckets[bucket] ?? 0) + count;
  for (const f of p.sampling.kernelFunctions) {
    const key = JSON.stringify([f.function, f.source, f.generatedLine, f.column]);
    if (!functions.has(key)) functions.set(key, { ...f, selfSamples: 0, inclusiveSamples: 0 });
    const current = functions.get(key);
    current.selfSamples += f.selfSamples;
    current.inclusiveSamples += f.inclusiveSamples;
  }
}
totals.kernelFunctions = [...functions.values()].sort(
  (a, b) => b.inclusiveSamples - a.inclusiveSamples,
);
const summary = {
  schema: 'collision-profile-summary-v1',
  status:
    stages.every((stage) => stage.passed) &&
    world?.status === 'completed' &&
    completed.length === expected.length
      ? 'diagnostic-complete'
      : 'incomplete',
  reviewSha256,
  packetSha256: sha256,
  baselineSha256: review.profile.baselineSha256,
  bundleSha256: packet.bundleSha256,
  acceptance: packet.protocol.acceptance,
  limits: review.limits,
  stages,
  worldExactSha256: world?.exact?.sha256 ?? null,
  rows,
  totals,
  notes: [
    'Full benchmark orchestration is profiled, including exact replay, evidence capture and all two warmups/seven samples.',
    'Time spent outside the kernel is not part of the original inner stepping benchmark timing.',
    'Kernel API clocks include scheduling/throttling and instrumentation overhead; they are not pure CPU costs.',
    'Sample counts are not CPU-time percentages; inclusive function stacks overlap. All sample intervals are retained.',
    'Function source attribution uses esbuild module boundaries; generated lines refer to the frozen bundle.',
    'No change to engine code, fixtures, physics tolerance, time-of-impact handling, replay or qualification gates.',
  ],
};
json(join(directory, 'profile-summary.json'), summary);
console.log(
  JSON.stringify({
    directory,
    status: summary.status,
    rows: rows.length,
    passedStages: stages.filter((s) => s.passed).length,
    totals: { ...totals, kernelFunctions: totals.kernelFunctions.slice(0, 15) },
  }),
);
