// Synthetic tooling tests only: no engine bridge, material profile or MuJoCo import.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  captureExact,
  compareExact,
  decodeExact,
} from '../scripts/collision-reference/exact-state.mjs';
import { checkWorldReplay, drivePreview } from '../scripts/collision-reference/replay.mjs';
import {
  PROTOCOL,
  fixtures,
  ticksFor,
  statistics,
  evaluate,
} from '../scripts/collision-reference/protocol.mjs';
import { assembleReport, endDifference } from '../scripts/collision-reference/report.mjs';
import {
  ROOT,
  preparePacket,
  readPacket,
  holdRecord,
  hash,
} from '../scripts/collision-reference/packet.mjs';

function factory(defect = '') {
  return (input) => {
    let state = structuredClone(input),
      revision = 0;
    const previews = new Map();
    const world = {
      snapshot: () => structuredClone(state),
      revision: () => revision,
      prepare(edits = [], count = 1) {
        let status = 'running',
          work = 0,
          last = 0;
        const candidate = structuredClone(state),
          ticks = [];
        candidate.counter += edits.length;
        const progress = () => ({
          status,
          work,
          lastAdvanceWork: last,
          completedTicks: ticks.length,
        });
        const job = {
          progress,
          advance(budget) {
            last = 0;
            if (defect === 'stall') return progress();
            while (ticks.length < count && last < budget) {
              candidate.tick++;
              candidate.counter += 2;
              work++;
              last++;
              ticks.push({ tick: candidate.tick, work: 1 });
            }
            if (defect === 'isolation') state.counter++;
            if (ticks.length === count) status = 'ready';
            return progress();
          },
          cancel() {
            status = 'cancelled';
            if (defect === 'cleanup') throw Error('cleanup broke');
            return true;
          },
          result() {
            if (status !== 'ready') throw Error('not ready');
            return structuredClone({ snapshot: candidate, edits: { count: edits.length }, ticks });
          },
        };
        previews.set(job, revision);
        return job;
      },
      commit(job) {
        if (previews.get(job) !== revision) throw Error('stale/foreign');
        const result = job.result();
        state = structuredClone(result.snapshot);
        if (defect === 'commit') state.counter++;
        previews.delete(job);
        job.cancel();
        revision++;
        return { revision, result };
      },
      restore(save) {
        state = structuredClone(save);
        revision++;
        if (defect === 'restore') state.counter++;
      },
    };
    return world;
  };
}

test('full synthetic preview/commit, both restarts and all work budgets agree', () => {
  const initial = { tick: 0, counter: 0, store: '9007199254740993', spin: [0, 1, 0] };
  const results = PROTOCOL.budgets.map((budget) => checkWorldReplay(factory(), initial, budget));
  for (const result of results) assert.ok(compareExact(results[0], result).equal);
  assert.equal(results[0].continuation.result.snapshot.tick, 3);
  assert.equal(initial.tick, 0);
});

for (const defect of ['stall', 'isolation', 'commit', 'restore', 'cleanup'])
  test(`negative control detects ${defect}`, () => {
    assert.throws(() => checkWorldReplay(factory(defect), { tick: 0, counter: 0 }, 7));
  });

test('Float64 bits, signed zero, key order and large integer strings survive only lossless encoding', () => {
  const source = { minus: -0, precise: 1 + Number.EPSILON, large: '9007199254740993' };
  const capture = captureExact(source);
  assert.ok(compareExact(decodeExact(capture.encoding, capture.sha256), source).equal);
  assert.equal(compareExact(source, { ...source, minus: 0 }).equal, false);
  assert.equal(compareExact(source, { ...source, precise: 1 }).equal, false);
  assert.equal(compareExact({ a: 1, b: 2 }, { b: 2, a: 1 }).equal, false);
  assert.throws(() => decodeExact(capture.encoding, 'bad'));
  assert.throws(
    () => checkWorldReplay(factory(), { tick: 0, counter: 0, minus: -0 }, 7),
    /JSON restore/,
  );
});

test('hostile portable data is rejected without reading accessors', () => {
  let invoked = false;
  const value = Object.defineProperty({}, 'danger', {
    enumerable: true,
    get() {
      invoked = true;
      return 1;
    },
  });
  assert.throws(() => captureExact(value));
  assert.equal(invoked, false);
  for (const invalid of [new Proxy({}, {}), [, 1], { n: Infinity }, { n: NaN }])
    assert.throws(() => captureExact(invalid));
});

test('failed or wrong-horizon jobs cannot appear ready', () => {
  assert.throws(() => drivePreview({ progress: () => ({ status: 'failed' }) }, 7, 2));
  assert.throws(() =>
    drivePreview({ progress: () => ({ status: 'ready', completedTicks: 1 }) }, 7, 2),
  );
});

test('equal-duration refinements remain bounded and cannot widen the horizon', () => {
  for (const dt of PROTOCOL.timesteps) assert.equal(ticksFor(dt) * dt, PROTOCOL.duration);
  assert.throws(() => ticksFor(1));
  assert.equal(PROTOCOL.acceptance.r1, false);
  assert.equal(PROTOCOL.acceptance.performance, false);
});

test('incomplete, zero and nonfinite timings reject rather than drop samples', () => {
  const samples = [1, 2, 3, 4, 5, 6, 7];
  assert.equal(statistics(samples).p95Ms, 7);
  for (const bad of [samples.slice(1), [0, ...samples.slice(1)], [NaN, ...samples.slice(1)]])
    assert.throws(() => statistics(bad));
});

function frame(scene, time, offset = 0, contacts = 0) {
  return {
    time,
    contacts,
    bodies: scene.bodies.map((b) => ({
      ...b,
      center: b.center.map((v, i) => v + b.velocity[i] * time + (i === 0 ? offset : 0)),
    })),
  };
}
test('physical diagnostics reject tunneling, false contact and no-op motion', () => {
  const all = fixtures(),
    drift = all.find((f) => f.id === 'free-drift');
  assert.equal(evaluate(drift, [frame(drift, PROTOCOL.duration)]).passed, true);
  const stopped = frame(drift, 0);
  stopped.time = PROTOCOL.duration;
  assert.equal(evaluate(drift, [stopped]).passed, false);
  const thin = all.find((f) => f.id === 'thin-wall');
  assert.equal(evaluate(thin, [frame(thin, PROTOCOL.duration)]).passed, false);
  const grazing = all.find((f) => f.id === 'grazing-clearance');
  assert.equal(evaluate(grazing, [frame(grazing, PROTOCOL.duration, 0.01, 1)]).passed, false);
  assert.equal(evaluate(grazing, [frame(grazing, PROTOCOL.duration, 0, 1)]).passed, false);
});

test('comparison separates missing/failed rows and never asserts cross-engine exactness', () => {
  const packet = { fixtures: fixtures() };
  const report = assembleReport(packet, [], [], { status: 'completed' });
  assert.equal(report.status, 'incomplete');
  assert.equal(report.missing.length, packet.fixtures.length * PROTOCOL.timesteps.length * 3);
  assert.equal(report.acceptance.runtime, false);
  const scene = packet.fixtures[0],
    a = { trajectory: [frame(scene, PROTOCOL.duration)] };
  const b = { trajectory: [frame(scene, PROTOCOL.duration, 0.1)] };
  assert.ok(Math.abs(endDifference(a, b)[0].positionL2 - 0.1) < 1e-14);
  b.trajectory[0].time = 1;
  assert.throws(() => endDifference(a, b));
});

test('complete synthetic comparison keeps diagnostics separate and rejects truncated rows', () => {
  const packet = { fixtures: fixtures() },
    rows = [];
  for (const scene of packet.fixtures)
    for (const dt of PROTOCOL.timesteps)
      for (const backend of ['state-space-rigid', 'mujoco-discrete', 'mujoco-speculative']) {
        rows.push({
          status: 'completed',
          scene: scene.id,
          dt,
          backend,
          duration: PROTOCOL.duration,
          ticks: ticksFor(dt),
          samplesMs: [1, 2, 3, 4, 5, 6, 7],
          trajectory: Array.from({ length: ticksFor(dt) }, (_, i) => ({
            ...frame(scene, (i + 1) * dt),
            mechanicalEnergy: 0,
          })),
        });
      }
  const report = assembleReport(packet, rows, [], { status: 'completed' });
  assert.equal(report.status, 'diagnostic-complete');
  assert.equal(report.comparisons.length, 21);
  assert.equal(report.refinement.length, 42);
  assert.ok(report.rows.some((row) => row.diagnostic.passed === false));
  assert.equal(report.acceptance.performance, false);
  assert.throws(
    () => assembleReport(packet, [...rows, rows[0]], [], { status: 'completed' }),
    /Duplicate/,
  );
  const partial = structuredClone(rows);
  partial[0].trajectory.pop();
  assert.throws(() => assembleReport(packet, partial, [], { status: 'completed' }), /Incomplete/);
  const staleTiming = structuredClone(rows);
  staleTiming[0].samplesMs[0] = -1;
  assert.throws(() => assembleReport(packet, staleTiming, [], { status: 'completed' }), /timing/);
});

test('static packet binds the actual source graph, refuses overwrite and detects tampering', async () => {
  const parent = mkdtempSync(join(ROOT, 'dist/verification/collision-static-check-'));
  const path = join(parent, 'packet'),
    before = holdRecord();
  const prepared = await preparePacket(path);
  assert.ok(prepared.files.some((r) => r.path === 'engine/experimental/multiphysics/rigid.ts'));
  assert.ok(prepared.files.some((r) => r.path === 'engine/experimental/multiphysics/world.ts'));
  assert.equal(prepared.state, 'prepared-unexecuted');
  assert.equal(readPacket(path).packet.bundleSha256, prepared.bundleSha256);
  await assert.rejects(() => preparePacket(path), /exist/i);
  const packetPath = join(path, 'packet.json'),
    original = readFileSync(packetPath);
  writeFileSync(packetPath, '{}');
  assert.throws(() => readPacket(path), /digest/);
  writeFileSync(packetPath, original);
  const bundlePath = join(path, 'engine.mjs'),
    bundle = readFileSync(bundlePath);
  writeFileSync(bundlePath, 'throw Error("should never be evaluated");');
  assert.throws(() => readPacket(path), /Bundle drift/);
  writeFileSync(bundlePath, bundle);
  // Even a re-sealed metadata change cannot widen the fixed horizon or omit a harness source.
  const reseal = (packet) => {
    writeFileSync(packetPath, JSON.stringify(packet));
    writeFileSync(join(path, 'packet.sha256'), hash(readFileSync(packetPath)));
  };
  const changed = JSON.parse(original);
  changed.protocol.maxTicks++;
  reseal(changed);
  assert.throws(() => readPacket(path), /protocol/);
  const omitted = JSON.parse(original);
  omitted.files = omitted.files.filter((r) => !r.path.endsWith('/replay.mjs'));
  reseal(omitted);
  assert.throws(() => readPacket(path), /Missing source/);
  writeFileSync(packetPath, original);
  writeFileSync(join(path, 'packet.sha256'), hash(original));
  readPacket(path);
  assert.deepEqual(holdRecord(), before);
});

test('active hard hold rejects execution before packet access or physics import', (context) => {
  const hold = holdRecord();
  if (!hold.present) return context.skip('No incident hold on this host');
  if (JSON.parse(readFileSync(hold.path, 'utf8')).blockRecovery !== true)
    return context.skip('This check targets the hard block only');
  const directory = mkdtempSync(join(ROOT, 'dist/verification/collision-held-check-'));
  const child = spawnSync(
    process.execPath,
    [
      'scripts/benchmark_collision_reference.mjs',
      'run',
      '--packet',
      directory,
      '--python',
      'nonexistent-python',
    ],
    { cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 10000 },
  );
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /Runtime verification remains blocked/);
  assert.deepEqual(readdirSync(directory), []);
  assert.deepEqual(holdRecord(), hold);
});
