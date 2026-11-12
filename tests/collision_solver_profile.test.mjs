// Synthetic data only: no engine, inspector or benchmark execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  analyzeSolverProfile,
  decodeSolverCoverage,
  bundleLocations,
} from '../scripts/collision-reference/solver-profile-data.mjs';
const rigid = 'engine/experimental/multiphysics/rigid.ts';
const bundle =
  '// ' +
  rigid +
  '\nfunction run() {}\nfunction solve3() {}\nfunction effective() {}\nfunction relative() {}\n// engine/experimental/multiphysics/other.ts\nfunction solve4() {}\n';
function profile(wrapper = false) {
  const node = (id, functionName, lineNumber, children = [], url = 'file:///engine.mjs') => ({
    id,
    callFrame: { functionName, url, lineNumber, columnNumber: 0 },
    children,
  });
  return {
    startTime: 0,
    endTime: 250000,
    samples: [4, 5, 3, 6, 7, 8],
    timeDeltas: [1000, 1000, 200000, 1000, 1000, 1000],
    nodes: [
      node(1, '(root)', -1, wrapper ? [9, 6, 7, 8] : [2, 6, 7, 8], ''),
      node(2, 'run', 1, [3]),
      node(3, 'solve3', 2, [4, 5]),
      node(4, 'effective', 3),
      node(5, 'relative', 4),
      node(6, '(garbage collector)', -1, [], ''),
      node(7, 'captureExact', 0, [], 'file:///exact-state.mjs'),
      node(8, 'solve4', 6),
      ...(wrapper ? [node(9, 'profileKernelNext', 0, [2], 'file:///profile-data.mjs')] : []),
    ],
  };
}
test('wrapper omission preserves source-scoped kernel/solver attribution', () => {
  const a = analyzeSolverProfile(profile(), bundle),
    b = analyzeSolverProfile(profile(true), bundle);
  assert.deepEqual(a.all, b.all);
  assert.deepEqual(a.functions, b.functions);
  assert.equal(a.all.kernelSamples, 3);
  assert.equal(a.all.solverSamples, 3);
  assert.equal(a.wrapperOmittedKernelSamples, 3);
  assert.equal(b.wrapperOmittedKernelSamples, 0);
  assert.equal(a.all.buckets['engine-outside-recognized-step'], 1);
});
test('exclusive solver branches sum while inclusive categories overlap', () => {
  const a = analyzeSolverProfile(profile(), bundle).all;
  assert.deepEqual(a.solverBreakdown, {
    effectiveResponse: 1,
    relativeMotion: 1,
    'solver-other-or-inlined': 1,
  });
  assert.equal(a.inclusive.solver, 3);
  assert.equal(a.inclusive.effectiveResponse, 1);
  assert.equal(a.buckets.gc, 1);
  assert.equal(a.buckets['harness-exact-state'], 1);
});
test('long sampling intervals never inflate counts and remain in full evidence', () => {
  const a = analyzeSolverProfile(profile(), bundle);
  assert.equal(a.all.samples, 6);
  assert.equal(a.shortIntervals.samples, 5);
  assert.equal(a.all.solverSamples, 3);
  assert.equal(a.shortIntervals.solverSamples, 2);
  assert.equal(a.intervals.over10ms, 1);
  assert.equal(a.intervals.maximumMicros, 200000);
});
test('malformed profile ancestry and sample references fail closed', () => {
  const a = profile();
  a.nodes[3].children = [2];
  assert.throws(() => analyzeSolverProfile(a, bundle));
  const b = profile();
  b.samples[0] = 100;
  assert.throws(() => analyzeSolverProfile(b, bundle));
});
test('source positions preserve inlined source rather than relabel the function', () => {
  const p = profile();
  p.nodes[2].positionTicks = [{ line: 7, ticks: 2 }];
  const a = analyzeSolverProfile(p, bundle);
  assert.equal(a.positions[0].declaredSource, rigid);
  assert.equal(a.positions[0].source, 'engine/experimental/multiphysics/other.ts');
  p.nodes[2].positionTicks[0].ticks = -1;
  assert.throws(() => analyzeSolverProfile(p, bundle));
});
function coverage() {
  return {
    timestamp: 1,
    result: [
      {
        url: 'file:///engine.mjs',
        functions: [
          {
            functionName: 'effective',
            isBlockCoverage: true,
            ranges: [
              {
                startOffset: bundle.indexOf('function effective'),
                endOffset: bundle.indexOf('function relative') - 1,
                count: 40,
              },
            ],
          },
        ],
      },
    ],
  };
}
test('coverage counts map exact source offsets without executing the bundle', () => {
  const c = decodeSolverCoverage(coverage(), bundle, 'file:///engine.mjs');
  assert.equal(c.length, 1);
  assert.equal(c[0].callCount, 40);
  assert.equal(c[0].generatedLine, 4);
  assert.equal(c[0].source, rigid);
  assert.equal(bundleLocations(bundle).at(bundle.indexOf('function solve4')).generatedLine, 7);
});
test('coverage rejects wrong script identity, invalid and escaping ranges', () => {
  assert.throws(() => decodeSolverCoverage(coverage(), bundle, 'file:///different.mjs'));
  const c = coverage();
  c.result.push(c.result[0]);
  assert.throws(() => decodeSolverCoverage(c, bundle, 'file:///engine.mjs'));
  for (const range of [
    { startOffset: 0, endOffset: bundle.length + 1, count: 1 },
    { startOffset: 0, endOffset: 1, count: 1 },
    { startOffset: 1, endOffset: 2, count: -1 },
  ]) {
    const d = coverage();
    d.result[0].functions[0].ranges.push(range);
    assert.throws(() => decodeSolverCoverage(d, bundle, 'file:///engine.mjs'));
  }
});
test('historical profiling preserves its frozen engine and replay harness source', () => {
  const digest = (path) =>
    createHash('sha256')
      .update(readFileSync(new URL(path, import.meta.url)))
      .digest('hex');
  assert.equal(
    digest('../dist/verification/collision-normal-cache-review-20261109/rigid.ts.before'),
    '2a9f951f01bb4b61d22dc5ccf416f7ef734f3072c6e1a936db52e5edb626dd7a',
  );
  assert.equal(
    digest('../scripts/collision-reference/state-space.mjs'),
    'e4b91ce305a019eabe82953c6ecdf77251d8d9ee740300e713f76811e0f3096f',
  );
});
