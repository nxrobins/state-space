/** Supervised CPU regression for two successive crossing decisions. */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { serialize } from 'node:v8';
import { gzipSync } from 'node:zlib';
import { runCrossingCheckpoint } from './crossing_checkpoint.mjs';
import { at } from './crossing_reference.mjs';
import { complete, logReplay } from './crossing_order_replay.mjs';
import { createCrossingSession, standingOn } from './commanded_crossing_turn.mjs';
import { ticks, twoUnitCrossingScene } from './moving_crossing_scene.mjs';
import { hash } from './liquid_contact_engine.mjs';

const orders = {
  setup: { engineer: 'move-into-range', unit: 'wait' },
  early: { engineer: 'move-into-range', unit: 'cross-to-far-bank' },
  reinforced: { engineer: 'reinforce-deck', unit: 'cross-to-far-bank' },
};
const copy = (x) => JSON.parse(JSON.stringify(x));
const impulse = (id, vector) => ({ kind: 'impulse', id, impulse: vector });
const heavyLaunch = impulse('unit', [50, 0, 0]);
const joint = { a: 'abutment', b: 'deck' };
const upgrade = [
  { kind: 'cut', ...joint },
  { kind: 'bond', ...joint, strength: 500 },
];

function qualify(api, id, start, frames, final) {
  const approach = id !== 'reinforced';
  // The work station is fixed at the original seam, including after the deck separates.
  const bank = api.cuboidBounds(at(start, 'abutment')),
    deck = api.cuboidBounds(at(start, 'deck'));
  const station = [(bank.max[0] + deck.min[0]) / 2, bank.max[1], at(start, 'abutment').center[2]];
  const distance = (s) => Math.hypot(...at(s, 'engineer').center.map((x, i) => x - station[i]));
  assert.equal(distance(start) > 0.75, approach);
  assert(standingOn(api, start, 'abutment'));
  assert.equal(start.bonds.length, 1);
  assert.equal(start.bonds[0].strength, 135);
  const brakes = (s, actor) => {
    const p = at(s, actor);
    return impulse(actor, [-p.mass * p.velocity[0], 0, -p.mass * p.velocity[2]]);
  };
  let inRange = null,
    fracture = null,
    arrival = null,
    onDeck = false,
    previous = start;
  const applied = [];
  for (const [i, frame] of frames.entries()) {
    const { edits, result } = frame,
      s = result.snapshot;
    assert.equal(s.tick, start.tick + i + 1);
    const want = [];
    if (!i) {
      want.push(...(approach ? [impulse('engineer', [1, 0, 0])] : upgrade));
      if (id !== 'setup') want.push(heavyLaunch);
    }
    if (arrival !== null && s.tick === arrival + 1) want.push(brakes(previous, 'unit'));
    if (approach && inRange !== null && s.tick === inRange + 1)
      want.push(brakes(previous, 'engineer'));
    assert.deepEqual(edits, want, 'public edit batch at tick ' + s.tick);
    if (edits.length) applied.push({ tick: s.tick, edits, receipt: result.edits });
    assert(standingOn(api, s, 'abutment', 'engineer'), 'engineer stays supported');
    if (distance(s) <= 0.75 && inRange === null) inRange = s.tick;
    if (standingOn(api, s, 'deck')) onDeck = true;
    if (standingOn(api, s, 'far-bank') && arrival === null) arrival = s.tick;
    if (arrival !== null) assert(standingOn(api, s, 'far-bank'), 'heavy stays on far bank');
    if (id === 'setup') assert(standingOn(api, s, 'abutment'), 'waiting heavy stays on near bank');
    if (result.ticks[0].brokenBonds.length) {
      assert.equal(fracture, null);
      assert.deepEqual(result.ticks[0].brokenBonds, start.bonds);
      assert(standingOn(api, s, 'deck'), 'fracture under the heavy unit');
      fracture = s.tick;
    }
    assert.deepEqual(
      s.bonds,
      fracture === null ? [{ ...start.bonds[0], strength: approach ? 135 : 500 }] : [],
    );
    previous = s;
  }
  assert.equal(frames.length, ticks);
  assert.deepEqual(final.order, orders[id]);
  assert.deepEqual(final.snapshot, previous);
  assert.equal(final.arrival, arrival);
  assert.equal(final.fracture, fracture);
  assert.equal(final.braked, arrival === null ? null : arrival + 1);
  const engineer = at(previous, 'engineer'),
    heavy = at(previous, 'unit');
  assert(Math.hypot(engineer.velocity[0], engineer.velocity[2]) < 1e-5);
  assert(distance(previous) <= 0.75);
  assert.equal(onDeck, id !== 'setup');
  if (approach) {
    assert(inRange > start.tick + 1 && inRange < previous.tick);
    assert.equal(final.inRange, inRange);
    assert.equal(final.engineerBraked, inRange + 1);
    assert(engineer.center[0] - at(start, 'engineer').center[0] > 0.2);
  }
  const outward = start.parcels
    .filter((p) => p.material === 'water')
    .map((p) => Math.sign(p.center[2]) * (at(previous, p.id).center[2] - p.center[2]));
  assert.equal(outward.length, 4);
  if (id === 'early') {
    assert(fracture !== null && fracture < inRange, 'support breaks before engineer reaches it');
    assert.equal(arrival, null);
    assert(api.cuboidBounds(heavy).max[1] < api.cuboidBounds(at(previous, 'far-bank')).min[1]);
    assert(Math.min(...outward) > 0.25);
  } else {
    assert.equal(fracture, null);
    assert(outward.every((v) => Math.abs(v) < 0.001));
    if (id === 'setup') assert.equal(arrival, null);
    else {
      assert(arrival > start.tick && arrival < previous.tick);
      assert(Math.hypot(heavy.velocity[0], heavy.velocity[2]) < 1e-4);
    }
  }
  return {
    startTick: start.tick,
    endTick: previous.tick,
    inRange: approach ? inRange : null,
    engineerBraked: final.engineerBraked ?? null,
    fracture,
    arrival,
    braked: final.braked,
    engineerStartDistance: distance(start),
    engineerEndDistance: distance(previous),
    applied,
    outward,
  };
}

function exercise(api, profiles, initial, digest, folder, summary) {
  const restore = (state) => createCrossingSession(api, profiles, copy(state));
  const savedOrders = copy(orders);
  const records = {};
  function preview(session, id, budget, recorded = savedOrders[id]) {
    const before = session.snapshot(),
      input = copy(recorded);
    const plan = session.prepareTeam(input);
    input.engineer = 'changed after submission';
    const known = records[id],
      frames = known?.frames ?? [];
    if (known) assert.deepEqual(before, known.start);
    summary.progress = { id, startTick: before.tick, lastCompleted: before.tick, budget };
    console.log('Preview', id, 'from tick', before.tick, 'budget', budget);
    let i = 0;
    const final = complete(plan, budget, (frame) => {
      if (known)
        assert.deepEqual(
          frame,
          frames[i],
          'order replay at absolute tick ' + frame.result.snapshot.tick,
        );
      else frames.push(frame);
      i++;
      summary.progress.lastCompleted = frame.result.snapshot.tick;
      assert.deepEqual(
        session.snapshot(),
        before,
        'preview escaped at tick ' + frame.result.snapshot.tick,
      );
    });
    assert.equal(i, ticks);
    assert.deepEqual(session.snapshot(), before);
    if (known) assert.deepEqual(final, known.final);
    else {
      const measured = qualify(api, id, before, frames, final);
      const frameHashes = frames.map((f) => digest(f));
      const packet = gzipSync(
        serialize({ initial: before, order: savedOrders[id], frames, final }),
      );
      writeFileSync(resolve(folder, id + '.ticks.v8.gz'), packet);
      summary.cases[id] = {
        ...measured,
        initialSHA256: digest(before),
        frameHashes,
        historySHA256: digest(frameHashes),
        finalSHA256: digest(final),
        packetSHA256: hash(packet),
      };
      records[id] = { start: before, frames, final };
    }
    delete summary.progress;
    return plan;
  }
  function publish(session, id, plan) {
    assert.deepEqual(session.commit(plan), records[id].final);
    assert.deepEqual(session.snapshot(), records[id].final.snapshot);
    assert.throws(() => session.commit(plan), /stale/);
  }
  for (const actor of ['engineer', 'unit']) {
    const world = api.createMultiphysicsWorld3D(profiles, initial);
    const edit = world.prepare([impulse(actor, [0.5, 0, 0])], 0);
    edit.advance(1);
    const moving = restore(edit.result().snapshot);
    assert.throws(() => moving.prepareTeam(savedOrders.early), /from rest/);
  }
  const live = restore(initial);
  const rejectPremature = (s) =>
    assert.throws(() => s.prepareTeam(orders.reinforced), /within reach/);
  rejectPremature(live);
  const partial = live.prepareTeam(orders.setup);
  partial.advance(1);
  assert.throws(() => live.commit(partial), /not ready/);
  assert(partial.cancel());
  assert.deepEqual(live.snapshot(), initial);
  const early = preview(live, 'early', 256),
    setup = preview(live, 'setup', 256);
  rejectPremature(live);
  publish(live, 'setup', setup);
  assert.throws(() => live.commit(early), /stale/);
  const boundary = live.snapshot();
  assert.throws(() => live.prepareTeam(orders.setup), /outside joint reach/);
  // Same second-turn launch without reinforcement isolates the effect of the deck edit.
  const unsupported = live.prepareTeam({ engineer: 'wait', unit: 'cross-to-far-bank' });
  let collapse;
  while (!collapse && unsupported.status() === 'running') {
    const frame = unsupported.advance(256);
    if (frame?.result.ticks[0].brokenBonds.length) collapse = frame;
  }
  assert(collapse, 'delaying launch alone must still break the weak joint');
  assert.deepEqual(collapse.result.ticks[0].brokenBonds, boundary.bonds);
  assert(standingOn(api, collapse.result.snapshot, 'deck'));
  summary.delayedUnreinforcedFracture = collapse.result.snapshot.tick;
  assert(unsupported.cancel());
  assert.deepEqual(live.snapshot(), boundary);
  const armed = preview(live, 'reinforced', 256);
  assert.deepEqual(live.snapshot(), boundary);
  publish(live, 'reinforced', armed);

  // Select the opposite branch after inspecting the same two alternatives in reverse order.
  const rushed = restore(initial);
  const setupAgain = preview(rushed, 'setup', 1),
    earlyAgain = preview(rushed, 'early', 1);
  publish(rushed, 'early', earlyAgain);
  assert.throws(() => rushed.commit(setupAgain), /stale/);
  assert.throws(() => rushed.prepareTeam(orders.reinforced), /intact weaker joint/);
  assert.throws(() => rushed.prepareTeam(orders.setup), /intact joint/);
  assert.deepEqual(rushed.snapshot(), records.early.final.snapshot);

  // Play back the recorded winning orders from the original save. Discard the
  // controller at the turn boundary and resume from this replay's own JSON save.
  const tape = copy({
    initial,
    setup: records.setup.final.order,
    reinforced: records.reinforced.final.order,
  });
  const playback = restore(tape.initial);
  publish(playback, 'setup', preview(playback, 'setup', 1, tape.setup));
  assert.deepEqual(playback.snapshot(), boundary);
  const resumed = restore(playback.snapshot());
  assert.throws(() => resumed.commit(armed), /stale/);
  publish(resumed, 'reinforced', preview(resumed, 'reinforced', 1, tape.reinforced));
  assert.deepEqual(resumed.snapshot(), live.snapshot());

  summary.paths = { prepared: ['setup', 'reinforced'], early: ['early'] };
  summary.restoredAt = {};
  for (const [path, ids] of Object.entries(summary.paths)) {
    const frames = ids.flatMap((id) => records[id].frames);
    const boundaries = new Set([0]);
    for (const id of ids) {
      const c = summary.cases[id];
      for (const t of [
        c.startTick + 1,
        c.inRange,
        c.engineerBraked,
        c.fracture,
        c.arrival,
        c.braked,
        c.endTick,
      ])
        if (t !== null) for (const i of [t - 1, t]) if (i < frames.length) boundaries.add(i);
    }
    summary.restoredAt[path] = [...boundaries].sort((a, b) => a - b);
    console.log('Replay edits', path, frames.length);
    logReplay(api, profiles, initial, frames, summary.restoredAt[path]);
  }
}
await runCrossingCheckpoint(
  'multi-turn-crossing',
  (api, profiles) => twoUnitCrossingScene(api, profiles, -1.93),
  exercise,
);
