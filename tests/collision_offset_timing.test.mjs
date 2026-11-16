// Static source identity and synthetic clock data only. No engine execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { summarizeTimingRows } from '../scripts/collision-reference/offset-timing-data.mjs';
import { verifyHistoricalSources } from './helpers/collision-history.mjs';

test('historical offset timing engine, replay, differential suites and clock wrapper match their packet', () => {
  const fixed = [
    'engine/',
    ...[
      'engine-entry.ts',
      'state-space.mjs',
      'protocol.mjs',
      'replay.mjs',
      'exact-state.mjs',
      'profile-data.mjs',
      'owned-regression.mjs',
      'normal-cache-regression.mjs',
      'timing-data.mjs',
      'cache-timing-data.mjs',
    ].map((p) => 'scripts/collision-reference/' + p),
  ];
  const packet = verifyHistoricalSources('offset', fixed);
  assert.equal(
    packet.bundleSha256,
    'f64bf7fd75f878a3a82d3a9fabe50daa384087efcc12f1285a6e70972466efa8',
  );
});

test('offset timing runner changes only fixed recipe identity from the prior transparent runner', () => {
  const read = (name) =>
    readFileSync(new URL('../scripts/collision-reference/' + name, import.meta.url), 'utf8');
  const expected = read('cache-timing-runner.mjs')
    .replaceAll('cacheTiming', 'offsetTiming')
    .replaceAll('rigid-stack-cache-timing-v1', 'rigid-stack-offset-timing-v1')
    .replaceAll('cached-stack', 'offset-cache stack')
    .replaceAll('cache timing recipe', 'offset timing recipe');
  assert.equal(read('offset-timing-runner.mjs'), expected);
});

test('cohort summary retains all tails and overlapping wall, CPU and GC measurements', () => {
  const row = (version) => ({
    case: 'test',
    dt: 0.008,
    version,
    order: ['baseline', 'optimized'],
    instrumented: true,
    timing: { samplesMs: [10, 10, 10, 10, 10, 10, 181], medianMs: 10 },
    samples: [10, 10, 10, 10, 10, 10, 181].map((wallMs, sample) => ({
      sample,
      wallMs,
      wrappedWallMs: wallMs,
      threadCpuMs: 15,
      processCpuMs: 30,
      gcOverlapMs: sample === 6 ? 170 : 0,
      work: 2208,
    })),
  });
  const baseline = row('baseline'),
    optimized = row('optimized');
  const [summary] = summarizeTimingRows([baseline, optimized]);
  assert.equal(summary.offsetCache.wallMaximumMs, 181);
  assert.equal(summary.offsetCache.wallMeanMs, 241 / 7);
  assert.equal(summary.offsetCache.meanThreadCpuMs, 15);
  assert.equal(summary.offsetCache.meanProcessCpuMs, 30);
  assert.equal(summary.offsetCache.meanGcOverlapMs, 170 / 7);
  assert.deepEqual(summary.offsetCache.distinctWorkCounts, [2208]);
  assert.equal(summary.medianChangeFraction, 0);
  assert.throws(() => summarizeTimingRows([baseline]));
  assert.throws(() => summarizeTimingRows([baseline, { ...optimized, samples: [] }]));
  assert.throws(() =>
    summarizeTimingRows([
      baseline,
      { ...optimized, timing: { ...optimized.timing, medianMs: 11 } },
    ]),
  );
});
