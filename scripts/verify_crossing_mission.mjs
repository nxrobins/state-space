/** Supervised hosted CPU acceptance for a two-turn mission on the v2 crossing. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { serialize } from 'node:v8';
import { gzipSync } from 'node:zlib';
import {
  briefing,
  createCrossingMission,
  crossingMissionScene,
} from '../examples/crossing-mission/mission.mjs';
import { runCrossingCheckpoint } from './crossing_checkpoint.mjs';
import { complete, logReplay } from './crossing_order_replay.mjs';
import { hash } from './liquid_contact_engine.mjs';
import { standingOn } from './commanded_crossing_turn.mjs';

const copy = (x) => JSON.parse(JSON.stringify(x));
const orders = {
  setup: 'move-engineer',
  early: 'advance-together',
  win: 'reinforce-and-cross',
  unsupported: 'cross',
  timeout: 'hold',
};
const outcomes = {
  start: ['active', null, 0, 2],
  setup: ['active', null, 1, 1],
  early: ['lost', 'deck-fractured', 1, 1],
  win: ['won', 'far-bank', 2, 0],
  unsupported: ['lost', 'deck-fractured', 2, 0],
  timeout: ['lost', 'deadline', 2, 0],
};
const paths = {
  victory: ['setup', 'win'],
  earlyCollapse: ['early'],
  delayedCollapse: ['setup', 'unsupported'],
  deadline: ['setup', 'timeout'],
};
function checkState(state, id) {
  const [status, reason, turnsUsed, turnsRemaining] = outcomes[id];
  assert.deepEqual(state, { status, reason, turnsUsed, turnsRemaining });
}

function exercise(api, profiles, initial, digest, folder, summary) {
  const original = JSON.parse(
    readFileSync('engine/test-support/fixtures/multi-turn-crossing-v2.json', 'utf8'),
  ).expected;
  assert.equal(digest(initial), original.initialSHA256);
  const create = (save) => createCrossingMission(api, profiles, save);
  const live = create(),
    start = live.save(),
    turns = new Map();
  assert.deepEqual(start.world, initial);
  checkState(live.state(), 'start');
  for (const invalid of [
    null,
    { ...start, schema: 'invalid' },
    { ...start, world: { ...initial, tick: 1 } },
    { ...start, world: { ...initial, tick: 750 } },
  ])
    assert.throws(() => create(invalid), /mission save/);

  function preview(session, id, budget, order = orders[id]) {
    const before = session.save(),
      state = session.state(),
      known = turns.get(id);
    if (known) assert.deepEqual(before, known.before);
    const plan = session.prepare(order);
    const frames = known?.frames ?? [];
    let i = 0;
    console.log('Preview mission', id, 'at', before.world.tick, 'budget', budget);
    summary.progress = { id, budget, tick: before.world.tick };
    const result = complete(plan, budget, (frame) => {
      if (known)
        assert.deepEqual(frame, frames[i], 'mission order replay at ' + frame.result.snapshot.tick);
      else frames.push(frame);
      i++;
      summary.progress.tick = frame.result.snapshot.tick;
      assert.deepEqual(session.save(), before, 'preview modified the live save');
    });
    assert.equal(i, 250);
    assert.deepEqual(session.state(), state);
    assert.deepEqual(result.order, order);
    checkState(result.mission, id);
    assert.equal(result.turn.snapshot.tick, before.world.tick + 250);
    if (known) assert.deepEqual(result, known.result);
    else {
      const frameHashes = frames.map((f) => digest(f));
      const historySHA256 = digest(frameHashes),
        turnSHA256 = digest(result.turn);
      const inherited = { setup: 'setup', early: 'early', win: 'reinforced' }[id];
      if (inherited)
        assert.deepEqual(
          { historySHA256, finalSHA256: turnSHA256 },
          original.cases[inherited],
          'underlying crossing history changed',
        );
      if (id === 'timeout') {
        assert(
          frames.every((f) => !f.edits.length && standingOn(api, f.result.snapshot, 'abutment')),
        );
        assert.equal(result.turn.fracture, null);
        assert.equal(result.turn.arrival, null);
      }
      if (id === 'unsupported' || id === 'early') {
        const broken = frames.filter((f) => f.result.ticks[0].brokenBonds.length);
        assert.equal(broken.length, 1);
        assert(standingOn(api, broken[0].result.snapshot, 'deck'));
        assert.equal(result.turn.fracture, broken[0].result.snapshot.tick);
        assert.equal(result.turn.arrival, null);
      }
      if (id === 'win') assert(standingOn(api, result.turn.snapshot, 'far-bank'));
      const packet = gzipSync(serialize({ before, order, frames, result }));
      writeFileSync(resolve(folder, id + '.ticks.v8.gz'), packet);
      summary.turns[id] = {
        order,
        from: before.world.tick,
        to: result.turn.snapshot.tick,
        outcome: result.mission,
        arrival: result.turn.arrival,
        fracture: result.turn.fracture,
        braked: result.turn.braked,
        frameHashes,
        historySHA256,
        turnSHA256,
        packetSHA256: hash(packet),
      };
      turns.set(id, { before, frames, result });
    }
    delete summary.progress;
    return plan;
  }
  function publish(session, id, plan) {
    const expected = turns.get(id).result;
    const receipt = session.commit(plan);
    assert.deepEqual(receipt, expected);
    assert.deepEqual(session.save(), { schema: start.schema, world: expected.turn.snapshot });
    assert.deepEqual(session.state(), expected.mission);
    assert.throws(() => session.commit(plan), /consumed/);
    return receipt;
  }
  function terminal(session, id) {
    const before = session.save();
    checkState(session.state(), id);
    for (const order of briefing.orders)
      assert.throws(() => session.prepare(order), /Mission is over/);
    assert.deepEqual(session.save(), before);
  }

  assert.throws(() => live.prepare('reinforce-and-cross'), /within reach/);
  assert.throws(() => live.prepare('unknown'), /Unknown mission order/);
  for (const fault of ['cancel', 'bad-budget']) {
    const p = live.prepare('move-engineer');
    assert.throws(() => live.commit(p), /not ready/);
    if (fault === 'cancel') {
      p.advance(1);
      assert(p.cancel());
    } else assert.throws(() => p.advance(0), /budget/);
    assert.throws(() => live.commit(p));
    assert.deepEqual(live.save(), start);
  }
  summary.turns = {};
  const early = preview(live, 'early', 256),
    setup = preview(live, 'setup', 256);
  assert.throws(() => live.prepare('reinforce-and-cross'), /within reach/);
  publish(live, 'setup', setup);
  assert.throws(() => live.commit(early), /stale/);
  const boundary = live.save();
  const loss = preview(live, 'unsupported', 256),
    timedOut = preview(live, 'timeout', 256),
    win = preview(live, 'win', 256);
  assert.deepEqual(live.save(), boundary);
  const external = win.result();
  external.mission.status = 'lost';
  external.turn.snapshot.tick = 0;
  publish(live, 'win', win);
  for (const stale of [loss, timedOut]) assert.throws(() => live.commit(stale), /stale/);
  terminal(live, 'win');

  // Replay only committed orders from the original save. Every turn opens in
  // a new controller and restores the preceding commit's JSON state.
  for (const [name, ids] of Object.entries(paths)) {
    const tape = copy(ids.map((id) => turns.get(id).result.order));
    let session = create(copy(start));
    const missionReceipts = [];
    const boundaries = new Set([0]),
      frames = [];
    for (const [index, id] of ids.entries()) {
      const snapshot = session.save();
      const fresh = create(copy(snapshot));
      assert.deepEqual(fresh.state(), session.state());
      assert.throws(() => fresh.commit(early), /Foreign/);
      session = fresh;
      const p = preview(session, id, 1, tape[index]);
      const receipt = publish(session, id, p);
      missionReceipts.push({
        order: receipt.order,
        mission: receipt.mission,
        turnSHA256: digest(receipt.turn),
        historySHA256: summary.turns[id].historySHA256,
      });
      frames.push(...turns.get(id).frames);
      const t = receipt.turn;
      for (const tick of [
        snapshot.world.tick + 1,
        t.arrival,
        t.fracture,
        t.braked,
        t.inRange,
        t.engineerBraked,
        t.snapshot.tick,
      ])
        if (Number.isInteger(tick)) {
          boundaries.add(tick - 1);
          boundaries.add(tick);
        }
    }
    const last = ids.at(-1);
    terminal(session, last);
    const save = session.save(),
      reopened = create(copy(save));
    assert.deepEqual(reopened.save(), save);
    terminal(reopened, last);
    const restoredAt = [...boundaries].filter((t) => t < frames.length).sort((a, b) => a - b);
    console.log('Replay mission edit log', name, frames.length);
    logReplay(api, profiles, initial, frames, restoredAt);
    summary.cases[name] = {
      tape,
      ticks: frames.length,
      mission: session.state(),
      restoredAt,
      historySHA256: digest(missionReceipts),
      finalSHA256: digest({ save, mission: session.state() }),
    };
  }
}
await runCrossingCheckpoint('crossing-mission', crossingMissionScene, exercise);
