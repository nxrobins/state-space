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
  const budget = { turnsUsed, turnsRemaining: turnLimit - turnsUsed };
  if (standingOn(api, world, 'far-bank') && Math.hypot(...heavy.velocity) < 1e-4)
    return { status: 'won', reason: 'far-bank', ...budget };
  if (!world.bonds.some((b) => b.a === 'abutment' && b.b === 'deck'))
    return { status: 'lost', reason: 'deck-fractured', ...budget };
  if (turnsUsed === turnLimit) return { status: 'lost', reason: 'deadline', ...budget };
  return { status: 'active', reason: null, ...budget };
}

export function createCrossingMission(api, profiles, save) {
  let world;
  let history = [];
  if (save === undefined) world = crossingMissionScene(api, profiles);
  else {
    if (
      save?.schema !== schema ||
      save.world?.rules !== 'multiphysics-world-2' ||
      !Array.isArray(save.orders) ||
      save.orders.length > turnLimit ||
      save.world.tick !== save.orders.length * ticks ||
      !Array.from(save.orders).every(
        (order) => typeof order === 'string' && Object.hasOwn(orders, order),
      )
    )
      throw Error('Expected a crossing mission save at a committed turn boundary.');
    world = save.world;
    history = [...save.orders];
  }
  const session = createCrossingSession(api, profiles, world);
  const initial = session.snapshot();
  for (const id of ['unit', 'engineer', 'abutment', 'deck', 'far-bank']) {
    if (!initial.parcels.some((p) => p.id === id))
      throw Error('Mission save is missing ' + id + '.');
  }
  const handles = new WeakMap();
  let current = outcome(api, initial);
  const report = (order, turn) => ({ order, mission: outcome(api, turn.snapshot), turn });
  return Object.freeze({
    state: () => ({ ...current }),
    save: () => ({ schema, orders: [...history], world: session.snapshot() }),
    prepare(order) {
      if (current.status !== 'active') throw Error('Mission is over.');
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
      const result = report(entry.order, turn);
      history.push(entry.order);
      current = { ...result.mission };
      return result;
    },
  });
}
