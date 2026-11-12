// Raw-data attribution tests only. No profiler or engine execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeProfile } from '../scripts/analyze_collision_profile.mjs';

const bundle =
  '// engine/experimental/multiphysics/rigid.ts\nfunction run() {}\n// engine/portable-data.ts\nfunction copy() {}';
function example(withWrapper) {
  const f = (name, url, lineNumber) => ({ functionName: name, url, lineNumber, columnNumber: 0 });
  return {
    startTime: 0,
    endTime: 2000,
    samples: [3, 4],
    timeDeltas: [1000, 1000],
    nodes: [
      { id: 1, callFrame: f('(root)', '', -1), children: withWrapper ? [5, 4] : [2, 4] },
      { id: 2, callFrame: f('run', 'file:///engine.mjs', 1), children: [3] },
      { id: 3, callFrame: f('copy', 'file:///engine.mjs', 3) },
      { id: 4, callFrame: f('captureExact', 'file:///exact-state.mjs', 0) },
      ...(withWrapper
        ? [
            {
              id: 5,
              callFrame: f('profileKernelNext', 'file:///profile-data.mjs', 0),
              children: [2],
            },
          ]
        : []),
    ],
  };
}
test('optimized and wrapper-bearing stacks produce the same kernel and copy attribution', () => {
  const a = analyzeProfile(example(true), bundle),
    b = analyzeProfile(example(false), bundle);
  assert.deepEqual(a.buckets, b.buckets);
  assert.deepEqual(a.kernelFunctions, b.kernelFunctions);
  assert.deepEqual(a.inclusive, b.inclusive);
  assert.equal(a.buckets['kernel-next'], 1);
  assert.equal(a.buckets['harness-exact-state'], 1);
  assert.equal(a.inclusive.portableCopy, 1);
  assert.equal(a.wrapperOmittedKernelSamples, 0);
  assert.equal(b.wrapperOmittedKernelSamples, 1);
});
test('unrecognized engine work is not silently attributed to stepping', () => {
  const p = example(false);
  p.nodes[1].callFrame.functionName = 'initialSetup';
  const result = analyzeProfile(p, bundle);
  assert.equal(result.buckets['engine-outside-recognized-step'], 1);
  assert.equal(result.buckets['kernel-next'], undefined);
  assert.equal(result.inclusive.portableCopy, 0);
});
