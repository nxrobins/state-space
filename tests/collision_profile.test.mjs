// Synthetic profiling tests: no engine, inspector session, browser or GPU execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  instrumentRigidApi,
  assertBaseline,
  summarizeCpuProfile,
} from '../scripts/collision-reference/profile-data.mjs';
import { captureExact } from '../scripts/collision-reference/exact-state.mjs';

test('observation preserves generator results, this binding, input and cancellation', () => {
  const value = { done: false, value: { phase: 'sweep', work: 1 } };
  const final = { done: true, value: { amount: -0 } };
  let closed = 0,
    time = 0;
  const source = { exact: -0 };
  const api = {
    createRigidStep3D(input) {
      assert.equal(this, api);
      assert.equal(input, source);
      return {
        next() {
          assert.equal(this.next, next);
          return value;
        },
        return(v) {
          assert.equal(v, final);
          closed++;
          return v;
        },
      };
    },
  };
  // Keep a concrete job so the original method's receiver can be verified.
  const job = api.createRigidStep3D(source),
    next = job.next;
  api.createRigidStep3D = function (input) {
    assert.equal(this, api);
    assert.equal(input, source);
    return job;
  };
  const measured = instrumentRigidApi(api, () => time++);
  const proxy = measured.api.createRigidStep3D(source);
  assert.equal(proxy.next(), value);
  assert.equal(proxy.return(final), final);
  assert.equal(closed, 1);
  assert(Object.is(source.exact, -0));
  assert.deepEqual(measured.metrics.yielded, { assembly: 0, sweep: 1, contact: 0, fracture: 0 });
  for (const key of ['create', 'next', 'close'])
    assert.deepEqual(measured.metrics[key], { calls: 1, wallMs: 1 });
});

test('errors are rethrown unchanged and generator cleanup remains available', () => {
  const failure = new Error('kernel failure');
  let closed = false,
    t = 0;
  const { api, metrics } = instrumentRigidApi(
    {
      createRigidStep3D() {
        return {
          next() {
            throw failure;
          },
          return() {
            closed = true;
            return { done: true };
          },
        };
      },
    },
    () => t++,
  );
  const job = api.createRigidStep3D();
  assert.throws(
    () => job.next(),
    (error) => error === failure,
  );
  job.return();
  assert(closed);
  assert.equal(metrics.next.calls, 1);
  assert.equal(metrics.next.wallMs, 1);
  assert.equal(metrics.completed, 0);
});

const frame = (functionName, url = '', lineNumber = 0) => ({
  functionName,
  url,
  lineNumber,
  columnNumber: 0,
});
function syntheticProfile() {
  return {
    startTime: 0,
    endTime: 22000,
    nodes: [
      { id: 1, callFrame: frame('(root)'), children: [2, 5, 7] },
      { id: 2, callFrame: frame('profileKernelNext', 'file:///profile-data.mjs'), children: [3] },
      { id: 3, callFrame: frame('solve', 'file:///packet/engine.mjs', 2), children: [4] },
      { id: 4, callFrame: frame('contact', 'file:///packet/engine.mjs', 4) },
      { id: 5, callFrame: frame('captureExact', 'file:///exact-state.mjs'), children: [6] },
      { id: 6, callFrame: frame('stringify') },
      { id: 7, callFrame: frame('(garbage collector)') },
    ],
    samples: [4, 4, 3, 6, 7],
    timeDeltas: [1000, 1000, 1000, 18000, 1000],
  };
}
const bundle =
  '// engine/rigid.ts\n\nfunction solve() {}\n// engine/collision.ts\nfunction contact() {}';
test('sample attribution separates kernel, exact evidence and GC without charging long gaps as CPU time', () => {
  const summary = summarizeCpuProfile(syntheticProfile(), bundle);
  assert.deepEqual(summary.buckets, {
    'kernel-next': 3,
    'harness-exact-state': 1,
    'garbage-collection': 1,
  });
  assert.equal(summary.intervals.maximumMicros, 18000);
  assert.equal(summary.intervals.over10ms, 1);
  const solve = summary.kernelFunctions.find((f) => f.function === 'solve');
  const contact = summary.kernelFunctions.find((f) => f.function === 'contact');
  assert.equal(solve.source, 'engine/rigid.ts');
  assert.equal(solve.inclusiveSamples, 3);
  assert.equal(solve.selfSamples, 1);
  assert.equal(contact.source, 'engine/collision.ts');
  assert.equal(contact.selfSamples, 2);
});
test('malformed, missing and cyclic profiles cannot produce a successful summary', () => {
  for (const mutate of [
    (p) => p.samples.push(999),
    (p) => (p.samples[0] = 999),
    (p) => (p.timeDeltas[0] = -1),
    (p) => (p.nodes[3].children = [2]),
    (p) => p.nodes[4].children.push(4),
    (p) => p.nodes.push(p.nodes[0]),
    (p) => (p.samples = []),
  ]) {
    const profile = syntheticProfile();
    mutate(profile);
    assert.throws(() => summarizeCpuProfile(profile, bundle));
  }
});
function baselineRow() {
  return {
    status: 'completed',
    backend: 'state-space-rigid',
    scene: 'synthetic',
    dt: 0.016,
    ticks: 3,
    duration: 0.048,
    exact: captureExact({ angular: [-0, 1, 2], receipt: { work: 3 } }),
    phaseWork: { assembly: 3 },
    replay: { budgets: [1, 7, 256], lossless: true, json: true, cancellation: true },
    trajectory: [{ time: 0.048, center: [1, 2, 3] }],
    diagnostic: { status: 'passed' },
    timing: { samplesMs: Array(7).fill(1) },
  };
}
test('baseline gate rejects any exact state, work, trajectory, replay or sample-count change', () => {
  const baseline = baselineRow();
  assertBaseline(baselineRow(), baseline);
  assertBaseline(baselineRow(), JSON.parse(JSON.stringify(baseline)));
  for (const mutate of [
    (r) => (r.exact = { ...r.exact, value: { ...r.exact.value, angular: [0, 1, 2] } }),
    (r) => (r.exact = captureExact({ angular: [0, 1, 2], receipt: { work: 3 } })),
    (r) => r.phaseWork.assembly++,
    (r) => (r.replay.json = false),
    (r) => r.trajectory[0].center[0]++,
    (r) => r.timing.samplesMs.pop(),
    (r) => (r.status = 'failed'),
  ]) {
    const row = baselineRow();
    mutate(row);
    assert.throws(() => assertBaseline(row, baseline));
  }
  assert.throws(() => assertBaseline(baselineRow(), null));
});
