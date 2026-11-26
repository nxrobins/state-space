/** Supervised hosted CPU qualification of a complete player order. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { serialize } from 'node:v8';
import { gzipSync } from 'node:zlib';
import { guardNode } from './verification_guard.mjs';
import { bundleEngine, hash, loadCatalogue } from './liquid_contact_engine.mjs';
import { at } from './crossing_reference.mjs';
import { cases, movingCrossingScene, speed, startX, ticks } from './moving_crossing_scene.mjs';
import { createCrossingSession, standingOn } from './commanded_crossing_turn.mjs';

const jsonCopy = (x) => JSON.parse(JSON.stringify(x));
function near(a, b, tol = 1e-8) {
  assert(Math.abs(a - b) < tol, `expected ${b}, got ${a}`);
}
function complete(plan, budget, visit) {
  while (plan.status() === 'running') {
    const frame = plan.advance(budget);
    if (frame) visit(frame);
  }
  return plan.result();
}
function impulsesMatch(before, frame) {
  const { edits, result } = frame,
    receipt = result.edits;
  if (!edits.length) {
    assert.equal(receipt.mechanicalEnergy, 0);
    assert(receipt.linearMomentum.every((v) => v === 0));
    return;
  }
  const u = at(before, 'unit'),
    [x, y, z] = u.center,
    [a, b, c] = edits[0].impulse;
  assert.equal(edits.length, 1);
  assert.equal(edits[0].id, u.id);
  const torque = [y * c - z * b, z * a - x * c, x * b - y * a];
  [a, b, c].forEach((j, k) => {
    near(receipt.linearMomentum[k], j);
    near(receipt.angularMomentum[k], torque[k]);
  });
  near(
    receipt.mechanicalEnergy,
    a * u.velocity[0] +
      b * u.velocity[1] +
      c * u.velocity[2] +
      (a * a + b * b + c * c) / (2 * u.mass),
  );
  assert.equal(receipt.storedSubQ, '0');
  assert.equal(receipt.mass, 0);
  assert.equal(receipt.conversionRemainderSubQ, 0);
}
function qualify(api, spec, order, initial, frames, final) {
  const edits = frames.filter((f) => f.edits.length);
  assert(at(initial, 'unit').velocity.every((v) => v === 0));
  assert(at(initial, 'unit').intrinsicAngularMomentum.every((v) => v === 0));
  assert(standingOn(api, initial, 'abutment'));
  let previous = initial;
  for (const f of frames) {
    assert.equal(f.result.snapshot.tick, previous.tick + 1);
    impulsesMatch(previous, f);
    previous = f.result.snapshot;
  }
  assert.equal(frames.length, ticks);
  const water = initial.parcels.filter((p) => p.material === 'water');
  const outward = water.map(
    (p) => Math.sign(p.center[2]) * (at(final.snapshot, p.id).center[2] - p.center[2]),
  );
  const fractureFrames = frames.filter((f) => f.result.ticks[0].brokenBonds.length);
  if (order === 'wait') {
    assert(
      !edits.length && !fractureFrames.length && final.arrival === null && final.braked === null,
    );
    assert(frames.every((f) => standingOn(api, f.result.snapshot, 'abutment')));
    near(at(final.snapshot, 'unit').center[0], startX, 1e-6);
  } else {
    const launch = edits[0];
    assert.equal(launch.result.snapshot.tick, 1);
    assert.deepEqual(launch.edits, [
      { kind: 'impulse', id: 'unit', impulse: [spec.mass * speed, 0, 0] },
    ]);
    assert(
      frames.some((f) => standingOn(api, f.result.snapshot, 'deck')),
      'unit must actually traverse deck',
    );
    if (spec.id === 'heavy') {
      assert.equal(fractureFrames.length, 1);
      const br = fractureFrames[0];
      assert(standingOn(api, br.result.snapshot, 'deck'), 'fracture underfoot');
      assert.deepEqual(
        br.result.ticks[0].brokenBonds.map((b) => [b.a, b.b]),
        [['abutment', 'deck']],
      );
      assert.equal(final.fracture, 95);
      assert.equal(final.arrival, null);
      assert.equal(final.braked, null);
      assert.equal(edits.length, 1);
      assert(Math.min(...outward) > 0.25);
      assert(
        api.cuboidBounds(at(final.snapshot, 'unit')).max[1] <
          api.cuboidBounds(at(initial, 'far-bank')).min[1],
      );
    } else {
      assert.equal(fractureFrames.length, 0);
      assert.equal(final.fracture, null);
      assert.equal(final.arrival, 241);
      assert.equal(final.braked, 242);
      assert.equal(edits.length, 2);
      assert.equal(edits[1].result.snapshot.tick, final.braked);
      assert(edits[1].result.edits.mechanicalEnergy < 0);
      assert(
        frames
          .slice(final.arrival - 1)
          .every((f) => standingOn(api, f.result.snapshot, 'far-bank')),
      );
      const v = at(final.snapshot, 'unit').velocity;
      assert(Math.hypot(v[0], v[2]) < 1e-4, 'arrived unit must stop');
    }
  }
  return {
    edits: edits.map((f) => ({
      tick: f.result.snapshot.tick,
      input: f.edits[0],
      receipt: f.result.edits,
    })),
    arrival: final.arrival,
    braked: final.braked,
    fracture: final.fracture,
    unit: at(final.snapshot, 'unit').center,
    velocity: at(final.snapshot, 'unit').velocity,
    outward,
  };
}
function logReplay(api, profiles, initial, frames, boundaries) {
  let world = api.createMultiphysicsWorld3D(profiles, jsonCopy(initial));
  for (const [i, expected] of frames.entries()) {
    if (boundaries.includes(i))
      world = api.createMultiphysicsWorld3D(profiles, jsonCopy(world.snapshot()));
    const plan = world.prepare(jsonCopy(expected.edits), 1);
    while (plan.progress().status === 'running') plan.advance(64);
    assert.deepEqual(plan.result(), expected.result, 'log preview tick ' + (i + 1));
    assert.deepEqual(world.commit(plan).result, expected.result, 'log commit tick ' + (i + 1));
    assert.deepEqual(world.snapshot(), expected.result.snapshot);
  }
}
function exercise(api, profiles, spec, order, digest, folder, id) {
  const initial = movingCrossingScene(api, profiles, spec, 0);
  const session = createCrossingSession(api, profiles, initial);
  assert.throws(() => session.prepare('invalid'), /Unknown/);
  const failed = session.prepare(order);
  assert.throws(() => failed.advance(0), /budget/);
  assert.equal(failed.status(), 'failed');
  assert.throws(() => session.commit(failed), /not ready/);
  const stale = session.prepare(order);
  const cancelled = session.prepare(order);
  cancelled.advance(1);
  assert.throws(() => session.commit(cancelled), /not ready/);
  assert(cancelled.cancel());
  assert.throws(() => session.commit(cancelled));
  assert.deepEqual(session.snapshot(), initial);
  const plan = session.prepare(order),
    frames = [];
  const final = complete(plan, 256, (frame) => {
    frames.push(frame);
    if (frame.result.snapshot.tick === 1 || frame.result.ticks[0].brokenBonds.length)
      assert.deepEqual(session.snapshot(), initial, 'partial turn escaped preview');
  });
  assert.deepEqual(session.snapshot(), initial, 'ready turn must stay private');
  const measured = qualify(api, spec, order, initial, frames, final);
  const packet = jsonCopy({ initial, order });
  const again = createCrossingSession(api, profiles, packet.initial),
    retry = again.prepare(packet.order);
  assert.throws(() => again.commit(plan));
  let i = 0;
  const rerun = complete(retry, 1, (frame) =>
    assert.deepEqual(frame, frames[i++], 'order replay at tick ' + i),
  );
  assert.equal(i, frames.length);
  assert.deepEqual(rerun, final);
  // A returned snapshot is detached from the private candidate that can be committed.
  plan.result().snapshot.parcels.length = 0;
  assert.deepEqual(session.commit(plan), final);
  assert.deepEqual(session.snapshot(), final.snapshot);
  if (spec.id === 'heavy' && order === 'cross-to-far-bank') {
    // Both possible outcomes are ready against the same original state. Select
    // waiting after seeing collapse; the discarded prediction cannot publish.
    const wait = again.prepare('wait');
    const safe = complete(wait, 256, () => {});
    assert.equal(safe.fracture, null);
    assert(standingOn(api, safe.snapshot, 'abutment'));
    assert.deepEqual(again.snapshot(), initial);
    assert.deepEqual(again.commit(wait), safe);
    assert.throws(() => again.commit(retry), /stale/);
    assert.deepEqual(again.snapshot(), safe.snapshot);
    measured.selectedWaitSHA256 = digest(safe);
  } else assert.deepEqual(again.commit(retry), final);
  assert.throws(() => session.commit(plan));
  assert.throws(() => session.commit(stale), /stale/);
  stale.cancel();
  if (order === 'wait') {
    // Support jitter after a whole wait must still admit the next movement order.
    const next = session.prepare('cross-to-far-bank');
    let step;
    while (!step) step = next.advance(256);
    assert.equal(step.edits[0].kind, 'impulse');
    assert.equal(step.result.snapshot.tick, final.snapshot.tick + 1);
    assert(next.cancel());
    assert.deepEqual(session.snapshot(), final.snapshot);
  }
  const boundaries = [
    ...new Set([
      0,
      ticks / 2,
      ...[1, final.fracture, final.arrival, final.braked]
        .filter((n) => n !== null)
        .flatMap((n) => [n - 1, n]),
    ]),
  ].sort((a, b) => a - b);
  logReplay(api, profiles, initial, frames, boundaries);
  const file = gzipSync(serialize({ initial, order, frames, final }));
  writeFileSync(resolve(folder, id + '.ticks.v8.gz'), file);
  const frameHashes = frames.map((f) => digest(f));
  return {
    ...measured,
    order,
    initialSHA256: digest(initial),
    frameHashes,
    historySHA256: digest(frameHashes),
    finalSHA256: digest(final),
    packetSHA256: hash(file),
    restoredAt: boundaries,
  };
}

await guardNode('cpu', 600);
const folder = resolve('dist/verification/commanded-crossing', randomUUID());
mkdirSync(folder, { recursive: true });
const summary = {
  schema: 'commanded-crossing-1',
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  runtime: {
    node: process.version,
    v8: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
  },
  status: 'started',
  ticks,
  cases: {},
};
const save = () =>
  writeFileSync(resolve(folder, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
try {
  const freeze = JSON.parse(
    readFileSync('engine/experimental/multiphysics/liquid-contact-freeze.json'),
  );
  assert.equal(summary.runtime.v8, freeze.runtime.v8);
  const catalogue = await loadCatalogue(folder),
    bundle = await bundleEngine(process.cwd(), folder, 'public', catalogue);
  const api = await import(pathToFileURL(bundle.path).href),
    profiles = await api.createMultiphysicsProfiles3D();
  summary.engineSHA256 = bundle.sourceSha256;
  for (const spec of cases.filter((c) => c.mass)) {
    for (const order of spec.id === 'reinforced'
      ? ['cross-to-far-bank']
      : ['cross-to-far-bank', 'wait']) {
      const id = spec.id + '-' + order;
      console.log('Starting', id);
      summary.cases[id] = exercise(
        api,
        profiles,
        spec,
        order,
        catalogue.digestFrozen3D,
        folder,
        id,
      );
      save();
      console.log('Replayed', id, ticks, summary.cases[id].historySHA256);
    }
  }
  assert.equal(
    summary.cases['heavy-cross-to-far-bank'].selectedWaitSHA256,
    summary.cases['heavy-wait'].finalSHA256,
  );
  const frozen = JSON.parse(
    readFileSync('engine/test-support/fixtures/commanded-crossing-v2.json', 'utf8'),
  );
  assert.equal(frozen.rules, 'multiphysics-world-2');
  assert.equal(frozen.v8, summary.runtime.v8);
  const measured = Object.fromEntries(
    Object.entries(summary.cases).map(([id, c]) => [
      id,
      {
        initialSHA256: c.initialSHA256,
        historySHA256: c.historySHA256,
        finalSHA256: c.finalSHA256,
      },
    ]),
  );
  assert.deepEqual(
    measured,
    frozen.cases,
    'commanded crossing initial state, history or outcome changed',
  );
  summary.status = 'complete';
} catch (e) {
  summary.status = 'failed';
  summary.error = String(e);
  throw e;
} finally {
  save();
}
