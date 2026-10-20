import { holdPhysics, STRUCTURAL_CALLS } from '../../test-support/hold-physics.js';
/** Air application rules on inert material ticks; actual actor geometry resolution. */
import { describe, expect, test, vi } from 'vitest';
import { createSlabInitial, createSlabPolicy, createSlabSession, prepareSlabCommand, readSlabCommand, readSlabRequest,
  SLAB_RULES, SLAB_AIR_IMPULSES, type SlabAirCommand } from '../../../examples/tactical-slab/scenario.js';
import { createSlabController } from '../../../examples/tactical-slab/controller.js';
import { createTacticalSessionCore3D, type TacticalSimulationFactory3D } from './tactical-session-core.js';
import { CpuStructuralWorld3D } from '../structural-world-core.js';

import { observe } from '../terrain/terrain-motion.fixtures.js';
import { MAT } from '../3d.js';
holdPhysics('solveStructure3D', ...STRUCTURAL_CALLS);
const Q = 1024, air: SlabAirCommand = {kind: 'air', unit: 'scout', direction: 'up'};
function fixture(initial = createSlabInitial(), options: {pause?: Promise<void>; failTick?: number} = {}) {
  let steps = 0, made = 0, closed = 0;
  const factory: TacticalSimulationFactory3D = input => {
    made++; let s = structuredClone(input), result: ReturnType<typeof observe>;
    return {load(next) {s = structuredClone(next);}, async step() {steps++; await options.pause; if (steps === options.failTick) throw Error('inert tick failed'); result = observe(s, {after: s}); s = result.after;},
      snapshot: () => s, motion: () => result.motion, paths: () => result.paths, close() {closed++;}};
  };
  const session = createTacticalSessionCore3D(initial, factory, createSlabPolicy(), async () => {}), controller = createSlabController(session);
  return {session, controller, counts: () => ({steps, made, closed}), async close() {await controller.close(); expect(closed).toBe(made);}};
}
async function ready(f: ReturnType<typeof fixture>, command: unknown = air, horizon = 1) {
  const ticket = f.controller.request(command, horizon), result = await ticket.result;
  if (result.status !== 'ready') throw Error('Expected ready air preview: ' + result.status + ' ' + result.error); return {ticket, preview: result.preview};
}
const deferred = () => {let resolve!: () => void; const promise = new Promise<void>(r => {resolve = r;}); return {promise, resolve};};
async function until(check: () => boolean) {for (let i = 0; i < 400; i++) {if (check()) return; await Promise.resolve();} throw Error('Expected inert boundary.');}
function obstacle(x: number, y: number, z: number) {
  const initial = createSlabInitial(), w = new CpuStructuralWorld3D({width: 8, height: 8, depth: 8, chunkSize: 4});
  w.restore(initial.terrain); w.setCell(x, y, z, MAT.STONE); initial.terrain = w.snapshot(); return initial;
}
describe('worker-ready air assistance application', () => {
  test('game v4 retains five immutable fixed impulses and owned normalized commands', () => {
    expect(SLAB_RULES).toBe('hot-slab-game-4'); expect(Object.keys(SLAB_AIR_IMPULSES)).toEqual(['up', 'west', 'east', 'north', 'south']);
    for (const unit of ['rider', 'scout'] as const) for (const direction of Object.keys(SLAB_AIR_IMPULSES) as SlabAirCommand['direction'][]) {
      const raw = {kind: 'air', unit, direction} as const; expect(readSlabCommand(raw)).toEqual(raw); expect(readSlabCommand(raw)).not.toBe(raw); expect(Object.isFrozen(SLAB_AIR_IMPULSES[direction])).toBe(true);
    }
  });
  test('malformed units directions fields and accessors reject without invoking getters', () => {
    const get = vi.fn();
    for (const raw of [{...air, unit: 'unknown'}, {...air, direction: 'down'}, {...air, direction: '__proto__'}, {...air, cost: 0},
      Object.defineProperty({...air}, 'direction', {get, enumerable: true}), {kind: 'air'}, {...air, impulseQ: [1, 2, 3]}]) expect(() => readSlabCommand(raw)).toThrow(); expect(get).not.toHaveBeenCalled();
  });
  test('air accepts one through eight ticks while zero and invalid horizons reject', () => {
    for (let ticks = 1; ticks <= 8; ticks++) expect(readSlabRequest(air, ticks)).toEqual({command: air, horizonTicks: ticks});
    for (const ticks of [0, -1, 9, 0.5, NaN, Infinity]) expect(() => readSlabRequest(air, ticks)).toThrow(); expect(readSlabRequest({kind: 'wait'}, 0).horizonTicks).toBe(0);
  });
  test('invalid local air input preserves a ready prior candidate and committed state', async () => {
    const f = fixture(), before = f.session.snapshot(), previous = await ready(f, {kind: 'lift'}, 0);
    expect(() => f.controller.request(air, 0)).toThrow(/at least one/); expect(f.controller.state.readyId).toBe(previous.ticket.id); expect(f.session.snapshot()).toEqual(before);
    f.controller.commit(previous.ticket); await f.close();
  });
  test('worker preparation independently rejects zero ticks before spending resources', async () => {
    const f = fixture(), b = f.session.branch({horizonTicks: 0}), before = b.inspect(); expect(() => prepareSlabCommand(b, air)).toThrow(/at least one/); expect(b.inspect()).toEqual(before); expect(f.counts().made).toBe(0); b.discard(); await f.close();
  });
  test('preparation stages AP and one intent without moving or publishing actors', async () => {
    const f = fixture(), before = f.session.snapshot(), b = f.session.branch({horizonTicks: 2}); prepareSlabCommand(b, air);
    const staged = b.inspect(); expect(staged.game.pendingAir).toEqual(air); expect(staged.game.ap).toBe(2); expect(staged.game.turn).toBe(1); expect(staged.game.units).toEqual(before.game.units); expect(staged.terrain).toEqual(before.terrain);
    expect(f.session.snapshot()).toEqual(before); expect(() => f.session.commit(b)).toThrow(/horizon/); b.discard(); await f.close();
  });
  test('the impulse applies once at the first complete tick then saved gravity continues', async () => {
    const f = fixture(), before = f.session.snapshot(), b = f.session.branch({horizonTicks: 3}); prepareSlabCommand(b, air);
    for (const [velocity, position] of [[-448, 3904], [-384, 3520], [-320, 3200]]) {
      await b.advance(1); const game = b.inspect().game; expect(game.pendingAir).toBeNull(); expect(game.units[1].body.velocityQ[1]).toBe(velocity); expect(game.units[1].body.minQ[1]).toBe(position); expect(game.ap).toBe(2);
    }
    expect(f.session.snapshot()).toEqual(before); const saved = f.session.commit(b).snapshot; expect(saved.game.units.every(u => u.body.step === 3)).toBe(true); expect(saved.accounting).toEqual(before.accounting); await f.close();
  });
  test('both units and every direction use the same bounded command with one AP cost', async () => {
    for (const unit of ['rider', 'scout'] as const) for (const direction of Object.keys(SLAB_AIR_IMPULSES) as SlabAirCommand['direction'][]) {
      const f = fixture(), before = f.session.snapshot(), {ticket, preview} = await ready(f, {kind: 'air', unit, direction}), index = unit === 'rider' ? 0 : 1;
      const delta = preview.game.units[index].body.minQ.map((v, a) => v - before.game.units[index].body.minQ[a]);
      expect(delta).toEqual(direction === 'up' ? [0, -448, 0] : [...SLAB_AIR_IMPULSES[direction]]); expect(preview.game.ap).toBe(2); expect(preview.game.pendingAir).toBeNull(); expect(preview.game.heatBudgetQ).toBe(512); expect(preview.game.rng).toBe(before.game.rng);
      f.controller.commit(ticket); await f.close();
    }
  });
  test('new ceiling geometry clips the first air impulse and clears its vertical velocity', async () => {
    const f = fixture(obstacle(5, 3, 2)), {preview} = await ready(f); expect(preview.game.units[1].body.minQ[1]).toBe(4 * Q); expect(preview.game.units[1].body.velocityQ[1]).toBe(0); await f.close();
  });
  test('new wall geometry clips horizontal air assistance before the desired endpoint', async () => {
    const f = fixture(obstacle(6, 4, 2)), before = f.session.snapshot(), {preview} = await ready(f, {...air, direction: 'east'});
    expect(preview.game.units[1].body.minQ[0]).toBe(before.game.units[1].body.minQ[0] + 256); expect(preview.game.units[1].body.velocityQ[0]).toBe(0); await f.close();
  });
  test('air assistance stops at a teammate without overlapping or moving the teammate', async () => {
    const initial = createSlabInitial(); initial.game.units[1].body.minQ[0] = 3 * Q; const f = fixture(initial), {preview} = await ready(f, {...air, direction: 'west'});
    expect(preview.game.units[1].body.minQ[0]).toBe(2816); expect(preview.game.units[1].body.velocityQ[0]).toBe(0); expect(preview.game.units[0].body.minQ).toEqual(initial.game.units[0].body.minQ); await f.close();
  });
  test('insufficient AP fails before acquiring a driver or changing live state', async () => {
    const initial = createSlabInitial(); initial.game.ap = 0; const f = fixture(initial), before = f.session.snapshot();
    const result = await f.controller.request(air, 1).result; expect(result.status).toBe('failed'); expect(f.counts().made).toBe(0); expect(f.session.snapshot()).toEqual(before); await f.close();
  });
  test('unit range is enforced while self assistance does not require the slab in range', async () => {
    const initial = createSlabInitial(); initial.game.units[0].body.minQ = [0, 6 * Q + 256, 7 * Q]; const f = fixture(initial), before = f.session.snapshot();
    expect((await f.controller.request({...air, unit: 'rider'}, 1).result).status).toBe('failed'); expect(f.session.snapshot()).toEqual(before); expect(f.counts().made).toBe(0); await f.close();
    const far = createSlabInitial(); far.game.units[1].body.minQ = [7 * Q, 6 * Q + 256, 7 * Q]; const g = fixture(far); const {preview} = await ready(g); expect(preview.game.ap).toBe(2); await g.close();
  });
  test('pending intents cannot be saved committed or overwritten by another prepared action', async () => {
    const f = fixture(), before = f.session.snapshot(), b = f.session.branch({horizonTicks: 0}); b.setGame({...before.game, pendingAir: air});
    expect(() => f.session.commit(b)).toThrow(/pending/); expect(f.session.snapshot()).toEqual(before);
    const pending = f.session.branch({horizonTicks: 2}); prepareSlabCommand(pending, air); const staged = pending.inspect(); expect(() => prepareSlabCommand(pending, {kind: 'wait'})).toThrow(/pending/); expect(pending.inspect()).toEqual(staged); pending.discard();
    expect(() => createSlabSession({...before, game: {...before.game, pendingAir: air}})).toThrow(/pending/); await f.close();
  });
  test('v1 and malformed v2 saves reject atomically without replacing the ready candidate', async () => {
    const f = fixture(), before = f.session.snapshot(), {ticket} = await ready(f);
    const old = {...before, gameRulesVersion: 'hot-slab-game-1', game: {...before.game, rulesVersion: 'hot-slab-game-1'}};
    for (const saved of [old, {...before, game: {...before.game, pendingAir: {...air, direction: 'down'}}}, {...before, game: {...before.game, pendingAir: {kind: 'wait'}}}]) expect(() => f.controller.restore(saved as never)).toThrow();
    expect(f.session.snapshot()).toEqual(before); expect(f.controller.state.readyId).toBe(ticket.id); f.controller.commit(ticket); await f.close();
  });
  test('a malformed staged intent cannot be laundered by clearing it during advancement', async () => {
    const f = fixture(), before = f.session.snapshot(), b = f.session.branch({horizonTicks: 1}); b.setGame({...before.game, pendingAir: {...air, unit: 'unknown'} as never});
    await expect(b.advance(1)).rejects.toThrow(/air/); expect(f.session.snapshot()).toEqual(before); await f.close();
  });
  test('second-tick failure discards private actor motion and staged AP together', async () => {
    const f = fixture(createSlabInitial(), {failTick: 2}), before = f.session.snapshot(), outcome = await f.controller.request(air, 2).result;
    expect(outcome.status).toBe('failed'); expect(f.counts()).toEqual({steps: 2, made: 1, closed: 1}); expect(f.session.snapshot()).toEqual(before); await f.close();
  });
  test('cancellation during advancement cannot publish the pending air cost or unit state', async () => {
    const gate = deferred(), f = fixture(createSlabInitial(), {pause: gate.promise}), before = f.session.snapshot(), ticket = f.controller.request(air, 2);
    await until(() => f.counts().steps === 1); ticket.cancel(); gate.resolve(); const outcome = await ticket.result; expect(outcome.status).toBe('cancelled'); expect(f.session.snapshot()).toEqual(before); await f.close();
  });
  test('a changed revision invalidates an otherwise complete air preview', async () => {
    const f = fixture(), before = f.session.snapshot(), {ticket} = await ready(f); f.controller.restore(before); const latest = f.session.snapshot();
    expect(() => f.controller.commit(ticket)).toThrow(/revision/); expect(f.session.snapshot()).toEqual(latest); await f.close();
  });
  test('complete midair saves preserve velocity and exact subsequent continuation', async () => {
    const a = fixture(), first = await ready(a); const save = a.controller.commit(first.ticket).snapshot, b = fixture(); b.controller.restore(JSON.parse(JSON.stringify(save)));
    const left = await ready(a, {kind: 'wait'}, 2), right = await ready(b, {kind: 'wait'}, 2); expect(a.controller.commit(left.ticket).snapshot).toEqual(b.controller.commit(right.ticket).snapshot); await a.close(); await b.close();
  });
  test('independent multi-tick previews and commits are exactly identical', async () => {
    const a = fixture(), b = fixture(), left = await ready(a, air, 4), right = await ready(b, air, 4); expect(left.preview).toEqual(right.preview); expect(a.controller.commit(left.ticket).snapshot).toEqual(b.controller.commit(right.ticket).snapshot); await a.close(); await b.close();
  });
  test('air adds to existing velocity rather than resetting movement history', async () => {
    const initial = createSlabInitial(); initial.game.units[1].body.velocityQ = [73, -100, 11]; const f = fixture(initial), {preview} = await ready(f);
    expect(preview.game.units[1].body.velocityQ).toEqual([73, -548, 11]); expect(preview.game.units[1].body.minQ).toEqual([5449, 3804, 2315]); await f.close();
  });
});
