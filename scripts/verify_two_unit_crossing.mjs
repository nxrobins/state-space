/** Supervised CPU reference for a cooperative crossing choice from a single save. */
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
import { at, crossingSolid } from './crossing_reference.mjs';
import { deckTop, movingCrossingScene, ticks } from './moving_crossing_scene.mjs';
import { createCrossingSession, standingOn } from './commanded_crossing_turn.mjs';
import { complete, impulsesMatch, logReplay } from './crossing_order_replay.mjs';

const copy = (x) => JSON.parse(JSON.stringify(x));
const actions = ['reinforce-deck', 'wait'];
const orders = (engineer) => ({ engineer, unit: 'cross-to-far-bank' });
const launch = { kind: 'impulse', id: 'unit', impulse: [50, 0, 0] };
const joint = { a: 'abutment', b: 'deck' };
const upgrade = [
  { kind: 'cut', ...joint },
  { kind: 'bond', ...joint, strength: 500 },
];
function scene(api, profiles, x = -1.57) {
  const crew =
    x === null
      ? []
      : [
          crossingSolid(
            api,
            profiles,
            'engineer',
            [x, deckTop + 0.075, 0.28],
            [0.075, 0.075, 0.075],
            1,
          ),
        ];
  return movingCrossingScene(api, profiles, { mass: 10, strength: 135 }, 0, crew);
}
function checkAdmission(api, profiles, initial) {
  const session = (s) => createCrossingSession(api, profiles, s);
  assert.throws(
    () => session(scene(api, profiles, null)).prepareTeam(orders('reinforce-deck')),
    /missing parcel engineer/,
  );
  const distant = scene(api, profiles, -1.93);
  assert(standingOn(api, distant, 'abutment', 'engineer'));
  assert.throws(() => session(distant).prepareTeam(orders('reinforce-deck')), /within reach/);
  const live = session(initial);
  for (const bad of [
    orders('repair'),
    { unit: 'cross-to-far-bank' },
    { engineer: 'cross-to-far-bank', unit: 'reinforce-deck' },
  ])
    assert.throws(() => live.prepareTeam(bad), /Expected/);
  const discarded = live.prepareTeam(orders('reinforce-deck'));
  discarded.advance(1);
  assert.throws(() => live.commit(discarded), /not ready/);
  assert(discarded.cancel());
  assert.throws(() => live.commit(discarded));
  assert.deepEqual(live.snapshot(), initial);

  const world = api.createMultiphysicsWorld3D(profiles, initial);
  const peek = (edits) => {
    const plan = world.prepare(edits, 0);
    plan.advance(1);
    return plan.result();
  };
  const stronger = peek(upgrade);
  const expected = structuredClone(initial);
  expected.bonds[0].strength = 500;
  assert.deepEqual(stronger.snapshot, expected, 'only the strength of the existing joint changes');
  assert.deepEqual(
    stronger.edits,
    peek([]).edits,
    'reinforcement supplies no external impulse or energy',
  );
  for (const unavailable of [stronger.snapshot, peek([upgrade[0]]).snapshot])
    assert.throws(
      () => session(unavailable).prepareTeam(orders('reinforce-deck')),
      /intact weaker joint/,
    );
  assert.deepEqual(world.snapshot(), initial);
}
function qualify(api, initial, action, frames, final) {
  const aided = action === 'reinforce-deck';
  assert.deepEqual(final.order, orders(action));
  assert.equal(frames.length, ticks);
  assert.deepEqual(frames[0].edits, aided ? [...upgrade, launch] : [launch]);
  assert.equal(frames[0].result.edits.mechanicalEnergy, 125);
  assert(standingOn(api, initial, 'abutment', 'engineer'));
  assert(standingOn(api, initial, 'abutment'));
  assert(
    frames.some((f) => standingOn(api, f.result.snapshot, 'deck')),
    'heavy unit traverses the deck',
  );
  let previous = initial;
  const impulses = [],
    breaks = [];
  for (const [i, { edits, result }] of frames.entries()) {
    const state = result.snapshot;
    assert.equal(state.tick, previous.tick + 1);
    assert(standingOn(api, state, 'abutment', 'engineer'), 'engineer stays on near bank');
    const movement = i === 0 && aided ? edits.slice(2) : edits;
    assert(movement.every((e) => e.kind === 'impulse' && e.id === 'unit'));
    impulsesMatch(previous, { edits: movement, result });
    if (movement.length)
      impulses.push({ tick: state.tick, input: movement[0], receipt: result.edits });
    const broken = result.ticks[0].brokenBonds;
    if (broken.length) {
      assert.deepEqual(broken, initial.bonds);
      assert(standingOn(api, state, 'deck'), 'deck must fracture underfoot');
      breaks.push(state.tick);
    }
    const bonds = breaks.length ? [] : [{ ...initial.bonds[0], strength: aided ? 500 : 135 }];
    assert.deepEqual(state.bonds, bonds);
    previous = state;
  }
  assert.deepEqual(final.snapshot, previous);
  const water = initial.parcels.filter((p) => p.material === 'water');
  assert.equal(water.length, 4);
  const outward = water.map(
    (p) => Math.sign(p.center[2]) * (at(previous, p.id).center[2] - p.center[2]),
  );
  const u = at(previous, 'unit');
  if (aided) {
    assert.deepEqual(breaks, []);
    assert.equal(final.fracture, null);
    const arrival = frames.find((f) => standingOn(api, f.result.snapshot, 'far-bank'))?.result
      .snapshot.tick;
    assert(Number.isInteger(arrival) && arrival < previous.tick);
    assert.equal(final.arrival, arrival);
    assert.equal(final.braked, arrival + 1);
    assert.deepEqual(
      impulses.map((p) => p.tick),
      [1, arrival + 1],
    );
    assert(impulses[1].receipt.mechanicalEnergy < 0);
    assert(frames.slice(arrival - 1).every((f) => standingOn(api, f.result.snapshot, 'far-bank')));
    assert(Math.hypot(u.velocity[0], u.velocity[2]) < 1e-4);
    assert(outward.every((d) => Math.abs(d) < 0.001));
  } else {
    assert.equal(breaks.length, 1);
    assert.equal(final.fracture, breaks[0]);
    assert.equal(final.arrival, null);
    assert.equal(final.braked, null);
    assert.equal(impulses.length, 1);
    assert(api.cuboidBounds(u).max[1] < api.cuboidBounds(at(previous, 'far-bank')).min[1]);
    assert(Math.min(...outward) > 0.25);
  }
  return {
    fracture: final.fracture,
    arrival: final.arrival,
    braked: final.braked,
    unitCenter: u.center,
    outward,
    impulses,
  };
}
function exercise(api, profiles, initial, digest, folder, summary) {
  checkAdmission(api, profiles, initial);
  const records = new Map();
  // Choose each branch once, after viewing both alternatives on the same live world.
  for (const [run, selected] of actions.entries()) {
    const session = createCrossingSession(api, profiles, copy(initial));
    const plans = new Map();
    for (const action of run ? [...actions].reverse() : actions) {
      console.log('Preview', action, 'selecting', selected);
      const input = copy(orders(action));
      const plan = session.prepareTeam(input);
      input.engineer = 'mutated after submission';
      plans.set(action, plan);
      const frames = run ? records.get(action).frames : [];
      let count = 0;
      const final = complete(plan, run ? 1 : 256, (frame) => {
        if (run)
          assert.deepEqual(frame, frames[count], 'serialized order replay tick ' + (count + 1));
        else frames.push(frame);
        count++;
        if (count === 1 || frame.result.ticks[0].brokenBonds.length)
          assert.deepEqual(session.snapshot(), initial);
      });
      assert.equal(count, ticks);
      assert.deepEqual(session.snapshot(), initial);
      if (run) {
        assert.deepEqual(final, records.get(action).final);
        continue;
      }
      const observed = qualify(api, initial, action, frames, final);
      const boundaries = [
        ...new Set([
          0,
          ticks / 2,
          ...[1, final.fracture, final.arrival, final.braked]
            .filter((v) => v !== null)
            .flatMap((v) => [v - 1, v]),
        ]),
      ].sort((a, b) => a - b);
      logReplay(api, profiles, initial, frames, boundaries);
      const packet = gzipSync(serialize({ initial, orders: orders(action), frames, final }));
      writeFileSync(resolve(folder, action + '.ticks.v8.gz'), packet);
      const frameHashes = frames.map((f) => digest(f));
      summary.cases[action] = {
        ...observed,
        restoredAt: boundaries,
        frameHashes,
        historySHA256: digest(frameHashes),
        finalSHA256: digest(final),
        packetSHA256: hash(packet),
      };
      records.set(action, { frames, final });
    }
    const chosen = plans.get(selected);
    chosen.result().snapshot.bonds.length = 0;
    assert.deepEqual(session.commit(chosen), records.get(selected).final);
    const committed = session.snapshot();
    assert.deepEqual(committed, records.get(selected).final.snapshot);
    for (const plan of plans.values()) assert.throws(() => session.commit(plan), /stale/);
    assert.deepEqual(session.snapshot(), committed);
  }
  // The brace raises capacity without changing either unit's motion before failure.
  const safe = records.get('reinforce-deck'),
    failed = records.get('wait');
  for (let i = 0; i < failed.final.fracture - 1; i++) {
    assert.deepEqual(
      safe.frames[i].result.snapshot.parcels,
      failed.frames[i].result.snapshot.parcels,
    );
    assert.deepEqual(safe.frames[i].result.ticks, failed.frames[i].result.ticks);
  }
}
await guardNode('cpu', 600);
const folder = resolve('dist/verification/two-unit-crossing', randomUUID());
mkdirSync(folder, { recursive: true });
const summary = {
  schema: 'two-unit-crossing-1',
  status: 'started',
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  node: process.version,
  v8: process.versions.v8,
  platform: process.platform,
  arch: process.arch,
  ticks,
  cases: {},
};
try {
  const freeze = JSON.parse(
    readFileSync('engine/experimental/multiphysics/liquid-contact-freeze.json', 'utf8'),
  );
  assert.equal(summary.v8, freeze.runtime.v8);
  const catalogue = await loadCatalogue(folder);
  const bundle = await bundleEngine(process.cwd(), folder, 'public', catalogue);
  const api = await import(pathToFileURL(bundle.path).href);
  const profiles = await api.createMultiphysicsProfiles3D();
  const initial = scene(api, profiles);
  assert.equal(initial.rules, 'multiphysics-world-2');
  summary.rules = initial.rules;
  summary.initialSHA256 = catalogue.digestFrozen3D(initial);
  summary.engineSHA256 = bundle.sourceSha256;
  exercise(api, profiles, initial, catalogue.digestFrozen3D, folder, summary);
  summary.status = 'complete';
  console.log('Replayed both two-unit choices');
} catch (e) {
  summary.status = 'failed';
  summary.error = String(e);
  throw e;
} finally {
  writeFileSync(resolve(folder, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
}
