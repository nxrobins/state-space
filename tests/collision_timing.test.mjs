// Synthetic clocks/generators and static source reads only; no engine execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  timeRigidSteps,
  benchmarkLayout,
  overlapMs,
  annotateTiming,
} from '../scripts/collision-reference/timing-data.mjs';
import { PROTOCOL, ticksFor } from '../scripts/collision-reference/protocol.mjs';

test('timing wrapper preserves receiver, argument and return identities while exposing off-CPU time', () => {
  const args = [{ value: 'owned by fake' }],
    output = { done: true, value: { report: { work: 0 } } };
  const close = { done: true, value: 'closed' },
    calls = [];
  const job = {
    next(value) {
      assert.equal(this, job);
      calls.push(value);
      return output;
    },
    return(value) {
      assert.equal(this, job);
      calls.push(value);
      return close;
    },
  };
  const api = {
    createRigidStep3D(...received) {
      assert.equal(this, api);
      assert.equal(received[0], args[0]);
      return job;
    },
  };
  let clock = 0,
    thread = 0,
    process = 0;
  const measured = timeRigidSteps(api, 1, {
    now: () => (clock++ ? 250 : 0),
    thread: () => ({ user: thread++ ? 10000 : 0, system: 0 }),
    process: () => ({ user: process++ ? 16000 : 0, system: 0 }),
  });
  const wrapped = measured.api.createRigidStep3D(...args);
  assert.equal(wrapped[Symbol.iterator](), wrapped);
  assert.equal(wrapped.next(args[0]), output);
  assert.equal(wrapped.return(args[0]), close);
  assert.deepEqual(calls, [args[0], args[0]]);
  assert.equal(measured.records.length, 1);
  assert.equal(measured.records[0].wallMs, 250);
  assert.equal(measured.records[0].threadCpuMs, 10);
  assert.equal(measured.records[0].processCpuMs, 16);
  assert.throws(() => measured.api.createRigidStep3D(), /budget/);
});

test('timing wrapper preserves thrown errors and cancellation without inventing completion', () => {
  const failure = Error('fake engine failure');
  const api = {
    createRigidStep3D() {
      return {
        next() {
          throw failure;
        },
        return() {
          return { done: true };
        },
        throw() {
          throw failure;
        },
      };
    },
  };
  let t = 0;
  const measured = timeRigidSteps(api, 2, {
    now: () => t++,
    thread: () => ({ user: 0, system: 0 }),
    process: () => ({ user: 0, system: 0 }),
  });
  const job = measured.api.createRigidStep3D();
  assert.throws(
    () => job.next(),
    (error) => error === failure,
  );
  assert.throws(
    () => job.throw(),
    (error) => error === failure,
  );
  job.return();
  job.return();
  assert.equal(measured.records.length, 1);
  assert.equal(measured.records[0].completedWork, null);
  const creation = timeRigidSteps(
    {
      createRigidStep3D() {
        throw failure;
      },
    },
    1,
    {
      now: () => t++,
      thread: () => ({ user: 0, system: 0 }),
      process: () => ({ user: 0, system: 0 }),
    },
  );
  assert.throws(
    () => creation.api.createRigidStep3D(),
    (error) => error === failure,
  );
  assert.equal(creation.records.length, 1);
});

test('GC overlap is clipped and unioned instead of double counting nested intervals', () => {
  assert.equal(
    overlapMs(10, 20, [
      { startMs: 5, endMs: 12 },
      { startMs: 11, endMs: 16 },
      { startMs: 14, endMs: 30 },
    ]),
    10,
  );
  assert.equal(
    overlapMs(10, 20, [
      { startMs: 0, endMs: 10 },
      { startMs: 20, endMs: 25 },
    ]),
    0,
  );
});

test('frozen benchmark layout keeps all budgets, restarts, cancellation, warmups and seven samples', () => {
  for (const dt of PROTOCOL.timesteps) {
    const layout = benchmarkLayout(dt),
      n = ticksFor(dt);
    assert.equal(layout.length, 15 * n - 3);
    assert.equal(layout.filter((v) => v.phase === 'budget').length, 3 * n);
    assert.equal(layout.filter((v) => v.phase.startsWith('restart')).length, 2 * (n - 2));
    assert.equal(layout.filter((v) => v.phase === 'cancellation').length, 1);
    assert.equal(layout.filter((v) => v.phase === 'warmup').length, 2 * n);
    assert.equal(layout.filter((v) => v.phase === 'measured').length, 7 * n);
  }
});

test('attribution fails on work/count drift, keeps coarse-clock negative gaps and checks timing boundaries', () => {
  const dt = 0.002,
    n = ticksFor(dt),
    layout = benchmarkLayout(dt);
  const row = {
    dt,
    exact: {
      value: { frames: Array.from({ length: n }, () => ({ result: { report: { work: 1 } } })) },
    },
    timing: { samplesMs: Array(7).fill(2 * n) },
  };
  const records = layout.map((label, i) => ({
    startMs: i * 3,
    endMs: i * 3 + 1,
    wallMs: 1,
    threadCpuMs: 16,
    processCpuMs: 16,
    yielded: 1,
    completedWork: label.phase === 'cancellation' ? null : 1,
  }));
  const measured = annotateTiming(records, row, []);
  assert.equal(measured.steps[0].wallMinusThreadCpuMs, -15);
  assert.equal(measured.samples.length, 7);
  assert.equal(measured.samples[0].work, n);
  assert.throws(() => annotateTiming(records.slice(1), row, []), /count/);
  assert.throws(
    () => annotateTiming([{ ...records[0], completedWork: 2 }, ...records.slice(1)], row, []),
    /work receipt/,
  );
  assert.throws(
    () => annotateTiming(records, { ...row, timing: { samplesMs: Array(7).fill(1) } }, []),
    /boundary/,
  );
});

test('engine graph and existing benchmark/replay code match the completed optimized packet', () => {
  const packet = JSON.parse(
    readFileSync(
      new URL(
        '../dist/verification/collision-reference-owned-20261108/packet.json',
        import.meta.url,
      ),
    ),
  );
  // Data-only SHA checks enforce an unchanged measured engine and harness.
  return import('node:crypto').then(({ createHash }) => {
    const fixed = [
      'scripts/collision-reference/state-space.mjs',
      'scripts/collision-reference/protocol.mjs',
      'scripts/collision-reference/replay.mjs',
      'scripts/collision-reference/exact-state.mjs',
    ];
    for (const file of packet.files.filter(
      (f) => f.path.startsWith('engine/') || fixed.includes(f.path),
    )) {
      // Historical timing ran before the separately verified normal cache.
      const source =
        file.path === 'engine/experimental/multiphysics/rigid.ts'
          ? 'dist/verification/collision-normal-cache-review-20261109/rigid.ts.before'
          : file.path;
      const bytes = readFileSync(new URL('../' + source, import.meta.url));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, file.path);
    }
  });
});
