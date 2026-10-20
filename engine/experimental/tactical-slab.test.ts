import { holdPhysics, STRUCTURAL_CALLS } from '../test-support/hold-physics.js';
/** SDK reference integration: real edits, inert tick fixtures, no native worker. */
import { describe, expect, test, vi } from 'vitest';
import { createSlabController } from '../../examples/tactical-slab/controller.js';
import { createSlabInitial, createSlabPolicy, createSlabSession, inspectSlab, readSlabCommand, SLAB_HOLD, SLAB_LIMITS, type SlabGame, type SlabSnapshot } from '../../examples/tactical-slab/scenario.js';
import { installSlabWorker } from '../../examples/tactical-slab/worker.js';
import { MAT } from './3d.js';
import * as mechanics from './structural-mechanics.js';
import { CpuStructuralWorld3D, type StructuralSnapshot3D } from './structural-world-core.js';
import { createTacticalSessionCore3D, type TacticalSimulationFactory3D } from './tactical-session-core.js';
import { createTacticalWorkerClient3D } from './tactical-worker-client.js';
import { observe } from './terrain-motion.fixtures.js';

holdPhysics('solveStructure3D', ...STRUCTURAL_CALLS);
const index = (x: number, y: number, z: number) => x + 8 * (y + 8 * z);
function fixture(initial = createSlabInitial(), tick?: (s: StructuralSnapshot3D) => StructuralSnapshot3D) {
  let steps = 0, made = 0, closed = 0;
  const factory: TacticalSimulationFactory3D = input => {
    let s = structuredClone(input), result: ReturnType<typeof observe>; made++;
    return {load(next) {s = structuredClone(next);}, step() {steps++; result = observe(s, {after: tick ? tick(s) : s}); s = structuredClone(result.after);},
      snapshot: () => s, motion: () => result.motion, paths: () => result.paths, close() {closed++;}};
  };
  const session = createTacticalSessionCore3D(initial, factory, createSlabPolicy(), async () => {});
  return {session, controller: createSlabController(session), counts: () => ({steps, made, closed})};
}
async function candidate(f: ReturnType<typeof fixture>, command: unknown = {kind: 'lift'}, horizon = 0) {
  const ticket = f.controller.request(command, horizon), outcome = await ticket.result;
  expect(outcome.status).toBe('ready'); if (outcome.status !== 'ready') throw Error(outcome.error ?? outcome.status);
  return {ticket, outcome};
}
async function finish(f: ReturnType<typeof fixture>) {await f.controller.close(); expect(f.counts().closed).toBe(f.counts().made);}
function editInitial(edit: (w: CpuStructuralWorld3D) => void) {
  const initial = createSlabInitial(), w = new CpuStructuralWorld3D({width: 8, height: 8, depth: 8, chunkSize: 4});
  w.restore(initial.terrain); edit(w); initial.terrain = w.snapshot(); return initial;
}
function connectedToAnchor(s: StructuralSnapshot3D, start: number) {
  const seen = new Set([start]), pending = [start];
  for (let k = 0; k < pending.length; k++) {const i = pending[k]; if (s.structure[i] & mechanics.ANCHOR_3D) return true;
    for (let d = 0; d < 6; d++) if (s.structure[i] & mechanics.BONDS_3D[d]) {
      const n = mechanics.structuralNeighbor(i, d, s); if (!seen.has(n)) {seen.add(n); pending.push(n);}
    }
  } return false;
}

describe('public-SDK hot slab reference', () => {
  test('seed is deterministic hot damaged bonded and contains two grounded units', () => {
    const a = createSlabInitial(); expect(createSlabInitial()).toEqual(a);
    expect(a.game.units.map(u => [u.id, u.body.grounded])).toEqual([['rider', true], ['scout', true]]);
    for (const i of a.game.slab) {expect(a.terrain.structure[i] & 255).toBe(96); expect(a.terrain.packedCells[i] & 255).toBe(MAT.STONE);}
    expect(connectedToAnchor(a.terrain, index(5, 5, 2))).toBe(true);
  });
  test('lift preserves hot damaged internal history and exact volume while carrying its rider', async () => {
    const f = fixture(), before = f.controller.snapshot(), {ticket, outcome} = await candidate(f), after = outcome.preview;
    expect(f.controller.snapshot()).toEqual(before);
    before.game.slab.forEach((from, k) => {
      const to = after.game.slab[k]; expect(to).toBe(from - 16); expect(after.terrain.packedCells[to]).toBe(before.terrain.packedCells[from]);
      expect(after.terrain.energyQ[to]).toBe(before.terrain.energyQ[from]); expect(after.terrain.structure[to] & 255).toBe(96);
      const internal = before.game.slab.filter(j => j !== from);
      for (let d = 0; d < 6; d++) if (internal.includes(mechanics.structuralNeighbor(from, d, before.terrain))) expect(after.terrain.structure[to] & mechanics.BONDS_3D[d]).toBe(before.terrain.structure[from] & mechanics.BONDS_3D[d]);
    });
    expect(after.terrain.packedCells.map(c => c & 255).sort((a, b) => a - b)).toEqual(before.terrain.packedCells.map(c => c & 255).sort((a, b) => a - b));
    expect(after.accounting).toEqual(before.accounting); expect(after.game.units[0].body.minQ[1]).toBe(before.game.units[0].body.minQ[1] - 2048);
    expect(after.game.units[1]).toEqual(before.game.units[1]); expect(after.game).toMatchObject({ap: 2, heatBudgetQ: 512, turn: 1, rng: before.game.rng});
    expect(after.holds).toEqual([{id: SLAB_HOLD, cells: after.game.slab, expiresAtTick: 4}]);
    const c = f.controller.commit(ticket); expect(c.snapshot.terrain).toEqual(after.terrain); expect(c.snapshot.game).toEqual(after.game); await finish(f);
  });
  test('candidate line of fire closes while committed rendering remains at the previous revision', async () => {
    const f = fixture(), old = f.controller.inspect(), {ticket} = await candidate(f), next = await f.controller.inspectPreview(ticket);
    expect(old.firingLine).toBe('open'); expect(next.firingLine).toBe('blocked'); expect(next.obstruction!.cell!.index).toBe(index(2, 3, 2));
    expect(next.stamp.kind).toBe('preview'); expect(f.controller.inspect()).toEqual(old); f.controller.commit(ticket);
    expect(f.controller.inspect().stamp).toMatchObject({kind: 'committed', revision: {revision: 1}}); await finish(f);
  });
  test('cut slab disconnects the distant walkway bond graph without pretending to solve its strength', async () => {
    const f = fixture(), {outcome} = await candidate(f); expect(connectedToAnchor(f.controller.snapshot().terrain, index(5, 5, 2))).toBe(true);
    expect(connectedToAnchor(outcome.preview.terrain, index(5, 5, 2))).toBe(false); expect(outcome.preview.terrain.structure[index(1, 5, 2)] & mechanics.ANCHOR_3D).not.toBe(0); await finish(f);
  });
  test('cancelled previews preserve terrain AP actors RNG and saved holds', async () => {
    const f = fixture(), before = f.controller.snapshot(), {ticket} = await candidate(f); ticket.cancel();
    expect(() => f.controller.commit(ticket)).toThrow(); await expect(f.controller.inspectPreview(ticket)).rejects.toThrow(); expect(f.controller.snapshot()).toEqual(before); await finish(f);
  });
  test('insufficient AP fails preparation without changing any authoritative coordinate', async () => {
    const initial = createSlabInitial(); initial.game.ap = 0; const f = fixture(initial), before = f.controller.snapshot();
    expect(await f.controller.request({kind: 'lift'}, 0).result).toMatchObject({status: 'failed', error: 'Insufficient AP.'}); expect(f.controller.snapshot()).toEqual(before); await finish(f);
  });
  test('a late rider ceiling collision rejects the whole translated terrain action', async () => {
    const f = fixture(editInitial(w => w.setCell(2, 2, 2, MAT.STONE))), before = f.controller.snapshot();
    const result = await f.controller.request({kind: 'lift'}, 0).result; expect(result.status).toBe('failed');
    if (result.status === 'failed') expect(result.error).toMatch(/unit rider/); expect(f.controller.snapshot()).toEqual(before); await finish(f);
  });
  test('a blocked intermediate terrain route rejects before spending resources', async () => {
    const f = fixture(editInitial(w => w.setCell(2, 4, 3, MAT.STONE))), before = f.controller.snapshot();
    expect((await f.controller.request({kind: 'lift'}, 0).result).status).toBe('failed'); expect(f.controller.snapshot()).toEqual(before); await finish(f);
  });
  test('heat and cooling both debit exact effort while retaining signed external energy', async () => {
    const f = fixture(), before = f.controller.snapshot();
    for (const deltaQ of [7, -7]) {
      const {ticket} = await candidate(f, {kind: 'heat', deltaQ}); const result = f.controller.commit(ticket);
      expect(result.receipt.externalEnergyQ).toBe(String(deltaQ * 4));
    }
    const after = f.controller.snapshot(); expect(after.terrain).toEqual(before.terrain); expect(after.accounting).toEqual(before.accounting);
    expect(after.game).toMatchObject({ap: 1, heatBudgetQ: 456, turn: 2, rng: before.game.rng}); await finish(f);
  });
  test('insufficient heat resource and unknown release reject atomically', async () => {
    const initial = createSlabInitial(); initial.game.heatBudgetQ = 2; const f = fixture(initial), before = f.controller.snapshot();
    for (const command of [{kind: 'heat', deltaQ: 1}, {kind: 'release'}]) expect((await f.controller.request(command, 0).result).status).toBe('failed');
    expect(f.controller.snapshot()).toEqual(before); await finish(f);
  });
  test('release changes saved temporary control without reseeding material', async () => {
    const f = fixture(); f.controller.commit((await candidate(f)).ticket); const before = f.controller.snapshot();
    f.controller.commit((await candidate(f, {kind: 'release'})).ticket); const after = f.controller.snapshot();
    expect(after.holds).toEqual([]); expect(after.terrain).toEqual(before.terrain); expect(after.game.units).toEqual(before.game.units); expect(after.game.ap).toBe(1); await finish(f);
  });
  test('default preview horizon actually uses the simulation driver rather than zero-tick approximation', async () => {
    const f = fixture(), ticket = f.controller.request({kind: 'wait'}), r = await ticket.result;
    expect(r).toMatchObject({status: 'ready', horizonTicks: SLAB_LIMITS.horizon, preview: {terrain: {tick: 2}}});
    expect(f.counts().steps).toBe(2); f.controller.commit(ticket); expect(f.controller.snapshot().game.units.every(u => u.body.step === 2)).toBe(true); await finish(f);
  });
  test('saved control expires at its absolute boundary through the real coordinator and inert ticks', async () => {
    const f = fixture(); f.controller.commit((await candidate(f)).ticket);
    f.controller.commit((await candidate(f, {kind: 'wait'}, 3)).ticket); expect(f.controller.snapshot().holds[0].expiresAtTick).toBe(4);
    f.controller.commit((await candidate(f, {kind: 'wait'}, 1)).ticket); expect(f.controller.snapshot().holds).toEqual([]); expect(f.controller.snapshot().terrain.tick).toBe(4); await finish(f);
  });
  test('a changed world invalidates a ready command even when its physical tick is unchanged', async () => {
    const f = fixture(), saved = f.controller.snapshot(), {ticket} = await candidate(f); f.controller.restore(saved);
    expect(() => f.controller.commit(ticket)).toThrow(/revision/); await expect(f.controller.inspectPreview(ticket)).rejects.toThrow();
    expect(f.controller.snapshot()).toEqual({...saved, revision: 1}); await finish(f);
  });
  test('save restore retains the whole tactical state and hold lifetime', async () => {
    const f = fixture(); f.controller.commit((await candidate(f)).ticket); const saved = f.controller.snapshot(), restored = createSlabSession(saved).snapshot();
    expect(restored).toEqual({...saved, revision: 1}); saved.game.units[0].body.minQ[0] = 0;
    expect(f.controller.snapshot().game.units[0].body.minQ[0]).not.toBe(0); await finish(f);
  });
  test('malformed saved game and embedded actors reject without replacing current state', async () => {
    const f = fixture(), before = f.controller.snapshot();
    const corrupt: ((s: SlabSnapshot) => void)[] = [s => {s.game.ap = -1;}, s => {s.game.rng = 0x100000000;}, s => {s.game.rulesVersion = 'other' as never;},
      s => {s.game.slab[1] = s.game.slab[0];}, s => {s.game.units[1].id = 'rider';}, s => {s.game.units[0].body.minQ[1] = 5 * 1024;},
      s => {s.game.units[1].body.minQ = [...s.game.units[0].body.minQ];}];
    for (const mutate of corrupt) {const copy = structuredClone(before); mutate(copy); expect(() => f.controller.restore(copy)).toThrow(); expect(f.controller.snapshot()).toEqual(before);} await finish(f);
  });
  test('invalid commands and horizons reject locally without superseding a valid ready action', async () => {
    const f = fixture(), {ticket} = await candidate(f), getter = vi.fn();
    for (const command of [null, {}, {kind: 'erase'}, {kind: 'lift', cost: 0}, {kind: 'heat', deltaQ: 0}, {kind: 'heat', deltaQ: 65},
      Object.defineProperty({}, 'kind', {get: getter, enumerable: true})]) expect(() => f.controller.request(command, 0)).toThrow();
    for (const horizon of [-1, 1.5, 9, NaN, Infinity]) expect(() => f.controller.request({kind: 'wait'}, horizon)).toThrow();
    expect(getter).not.toHaveBeenCalled(); expect(f.controller.state.readyId).toBe(ticket.id); f.controller.commit(ticket); await finish(f);
  });
  test('public result mutation cannot alter the controller candidate or committed game', async () => {
    const f = fixture(), {ticket, outcome} = await candidate(f); outcome.preview.game.ap = 999; outcome.preview.game.units[0].body.minQ[0] = 0;
    outcome.preview.holds.length = 0; const observation = await f.controller.inspectPreview(ticket);
    expect(observation.ap).toBe(2); expect(observation.holds).toHaveLength(1); observation.units[0].body.minQ[0] = 0;
    expect((await f.controller.inspectPreview(ticket)).units[0].body.minQ[0]).not.toBe(0); f.controller.commit(ticket); expect(f.controller.snapshot().game.ap).toBe(2); await finish(f);
  });
  test('mismatched geometry and snapshot boundaries reject display observations', async () => {
    const f = fixture(), before = f.controller.snapshot(), {ticket, outcome} = await candidate(f);
    expect(() => inspectSlab(outcome.preview, f.session.queries())).toThrow(/boundary/); f.controller.commit(ticket);
    expect(() => inspectSlab(before, f.session.queries())).toThrow(/boundary/); await finish(f);
  });
  test('close rejects pending display and further commands without corrupting committed state', async () => {
    const f = fixture(), before = f.controller.snapshot(), {ticket} = await candidate(f); await finish(f);
    expect(() => f.controller.request({kind: 'wait'}, 0)).toThrow(/closed/); await expect(f.controller.inspectPreview(ticket)).rejects.toThrow(/closed/); expect(f.controller.snapshot()).toEqual(before);
  });
  test('range and material selection remain application rules and cannot create replacement terrain', async () => {
    for (const initial of [editInitial(w => w.setCell(2, 5, 3, MAT.ICE)), createSlabInitial()]) {
      if ((initial.terrain.packedCells[index(2, 5, 3)] & 255) === MAT.STONE) initial.game.units[1].body.minQ = [7 * 1024, 6 * 1024 + 256, 7 * 1024];
      const f = fixture(initial), before = f.controller.snapshot(); expect((await f.controller.request({kind: 'lift'}, 0).result).status).toBe('failed'); expect(f.controller.snapshot()).toEqual(before); await finish(f);
    }
  });
  test('application command decoder returns owned normalized data', () => {
    const raw = {kind: 'heat', deltaQ: 3}, command = readSlabCommand(raw); raw.deltaQ = 20; expect(command).toEqual({kind: 'heat', deltaQ: 3});
  });
  test('explicit worker installation is idle until initialized and disposes owned listeners', async () => {
    const callbacks = new Map<string, Set<(e: MessageEvent) => void>>(), closed = vi.fn(), sent: unknown[] = [];
    const endpoint = {addEventListener(type: string, fn: (e: MessageEvent) => void) {const set = callbacks.get(type) ?? new Set(); set.add(fn); callbacks.set(type, set);},
      removeEventListener(type: string, fn: (e: MessageEvent) => void) {callbacks.get(type)?.delete(fn);}, postMessage: (value: unknown) => sent.push(structuredClone(value)), close: closed};
    const dispose = installSlabWorker(endpoint); expect(sent).toEqual([]); expect(callbacks.get('message')!.size).toBe(1);
    await dispose(); expect(callbacks.get('message')!.size).toBe(0); expect(closed).toHaveBeenCalledTimes(1); await dispose(); expect(closed).toHaveBeenCalledTimes(1);
  });
  test('worker bootstrap uses the identical command policy through a zero-tick mock channel', async () => {
    const listeners = new Map<string, Set<(e: MessageEvent) => void>>(); let receive = (_v: unknown) => {}; let disposed = 0;
    const endpoint = {addEventListener(type: string, fn: (e: MessageEvent) => void) {const set = listeners.get(type) ?? new Set(); set.add(fn); listeners.set(type, set);},
      removeEventListener(type: string, fn: (e: MessageEvent) => void) {listeners.get(type)?.delete(fn);}, postMessage: (value: unknown) => queueMicrotask(() => receive(structuredClone(value))), close() {disposed++;}};
    const dispatch = (value: unknown) => {for (const fn of [...listeners.get('message') ?? []]) fn({data: structuredClone(value)} as MessageEvent);};
    const cleanup = installSlabWorker(endpoint); dispatch({kind: 'initialize', channel: 'slab-mock', snapshot: null});
    const local = fixture();
    const client = createTacticalWorkerClient3D<SlabGame, {kind: 'lift'}>({send: v => queueMicrotask(() => dispatch(v)), subscribe(fn) {receive = fn; return () => {receive = () => {};};}, close() {}},
      {channel: 'slab-mock', worldId: 'hot-slab-chamber', gameRulesVersion: 'hot-slab-game-4'});
    await client.ready;
    const rejected = client.request({kind: 'lift'}, 9); expect((await rejected.result).status).toBe('failed');
    expect(client.snapshot()).toEqual(local.controller.snapshot());
    const t = client.request({kind: 'lift'}, 0, {paths: {}}), result = await t.result; expect(result.status).toBe('ready');
    const c = await client.commit(t); local.controller.commit((await candidate(local)).ticket); expect(c.snapshot).toEqual(local.controller.snapshot());
    await client.close(); await cleanup(); expect(disposed).toBe(1); expect([...listeners.values()].every(s => s.size === 0)).toBe(true); await finish(local);
  });
  test('invalid worker initialization closes its endpoint without starting a host', async () => {
    let fn: ((e: MessageEvent) => void) | undefined; const close = vi.fn();
    const dispose = installSlabWorker({addEventListener(_type, callback) {fn = callback;}, removeEventListener() {}, postMessage() {}, close});
    expect(() => fn!({data: {kind: 'initialize', channel: '', snapshot: null}} as MessageEvent)).toThrow(); expect(close).toHaveBeenCalledTimes(1); await dispose();
  });
});
