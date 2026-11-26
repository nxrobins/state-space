/** Two committed 250-tick turns to get the heavy unit onto the far bank. */
import { createCrossingSession, standingOn } from '../../scripts/commanded_crossing_turn.mjs';
import { ticks, twoUnitCrossingScene } from '../../scripts/moving_crossing_scene.mjs';

const turnLimit = 2;
const schema = 'crossing-mission-1';
const orders = {
  'move-engineer': { engineer: 'move-into-range', unit: 'wait' },
  'advance-together': { engineer: 'move-into-range', unit: 'cross-to-far-bank' },
  'reinforce-and-cross': { engineer: 'reinforce-deck', unit: 'cross-to-far-bank' },
  cross: { engineer: 'wait', unit: 'cross-to-far-bank' },
  hold: 'wait',
};
export const briefing = Object.freeze({
  objective: 'Get the heavy unit safely onto the far bank in two turns.',
  turnLimit,
  orders: Object.freeze(Object.keys(orders)),
});

export function crossingMissionScene(api, profiles) {
  return twoUnitCrossingScene(api, profiles, -1.93);
}

function outcome(api, world) {
  const turnsUsed = world.tick / ticks;
  const heavy = world.parcels.find((p) => p.id === 'unit');
  const landed = standingOn(api, world, 'far-bank') && Math.hypot(...heavy.velocity) < 1e-4;
  const intact = world.bonds.some((b) => b.a === 'abutment' && b.b === 'deck');
  const reason = landed
    ? 'far-bank'
    : !intact
      ? 'deck-fractured'
      : turnsUsed === turnLimit
        ? 'deadline'
        : null;
  return {
    status: landed ? 'won' : reason ? 'lost' : 'active',
    reason,
    turnsUsed,
    turnsRemaining: turnLimit - turnsUsed,
  };
}

export function createCrossingMission(api, profiles, save) {
  let world;
  if (save === undefined) world = crossingMissionScene(api, profiles);
  else {
    if (
      save?.schema !== schema ||
      save.world?.rules !== 'multiphysics-world-2' ||
      ![0, ticks, turnLimit * ticks].includes(save.world.tick)
    )
      throw Error('Expected a crossing mission save at a committed turn boundary.');
    world = save.world;
  }
  const session = createCrossingSession(api, profiles, world);
  const initial = session.snapshot();
  for (const id of ['unit', 'engineer', 'abutment', 'deck', 'far-bank']) {
    if (!initial.parcels.some((p) => p.id === id))
      throw Error('Mission save is missing ' + id + '.');
  }
  const handles = new WeakMap();
  const report = (order, turn) => ({ order, mission: outcome(api, turn.snapshot), turn });
  return Object.freeze({
    state: () => outcome(api, session.snapshot()),
    save: () => ({ schema, world: session.snapshot() }),
    prepare(order) {
      if (outcome(api, session.snapshot()).status !== 'active') throw Error('Mission is over.');
      if (typeof order !== 'string' || !Object.hasOwn(orders, order))
        throw Error('Unknown mission order.');
      const commands = orders[order];
      const turn = commands === 'wait' ? session.prepare('wait') : session.prepareTeam(commands);
      const plan = Object.freeze({
        status: turn.status,
        advance: turn.advance,
        cancel: turn.cancel,
        result: () => report(order, turn.result()),
      });
      handles.set(plan, { order, turn });
      return plan;
    },
    commit(plan) {
      const entry = handles.get(plan);
      if (!entry) throw Error('Foreign or consumed mission preview.');
      const turn = session.commit(entry.turn);
      handles.delete(plan);
      return report(entry.order, turn);
    },
  });
}
