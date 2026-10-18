/** Chamber wind interventions on real edit geometry with inert material steps. */
import { afterAll, describe, expect, test, vi } from 'vitest';
import { createSlabInitial, createSlabPolicy, createSlabSession, prepareSlabCommand, readSlabCommand, inspectSlab, SLAB_RULES } from '../../examples/tactical-slab/scenario.js';
import { createSlabController } from '../../examples/tactical-slab/controller.js';
import { createTacticalSessionCore3D, type TacticalSimulationFactory3D } from './tactical-session-core.js';
import { captureMaterialTransportMemory3D as capture, restoreMaterialTransportMemory3D as restore } from './material-transport-coupling.js';
import { CpuStructuralWorld3D } from './structural-world-core.js';
import * as mechanics from './structural-mechanics.js';
import { observe } from './terrain-motion.fixtures.js';
import { MAT } from './3d.js';
const guards = [vi.spyOn(mechanics, 'solveStructure3D'), ...(['step', 'stepWithMotion', 'stepWithMotionPaths', 'inspectStructure'] as const).map(k => vi.spyOn(CpuStructuralWorld3D.prototype, k))];
for (const g of guards) g.mockImplementation(() => {throw Error('Material runtime held.');});
afterAll(() => {for (const g of guards) {expect(g).not.toHaveBeenCalled(); g.mockRestore();}});
const wind = {kind: 'wind', parcel: 'steam', direction: 'east'} as const;
function fixture(initial = createSlabInitial(), fail = false) {
  let steps = 0, closed = 0, made = 0;
  const factory: TacticalSimulationFactory3D = input => {
    made++; let s = structuredClone(input), result: ReturnType<typeof observe>;
    return {load(next) {s = structuredClone(next);}, step() {steps++; if (fail) throw Error('inert failure'); result = observe(s, {after: s}); s = result.after;},
      snapshot: () => s, motion: () => result.motion, paths: () => result.paths, close() {closed++;}};
  };
  const session = createTacticalSessionCore3D(initial, factory, createSlabPolicy(), async () => {}), controller = createSlabController(session);
  return {session, controller, steps: () => steps, async close() {await controller.close(); expect(closed).toBe(made);}};
}
async function ready(f: ReturnType<typeof fixture>, command: unknown = wind, ticks = 0) {
  const ticket = f.controller.request(command, ticks), r = await ticket.result;
  if (r.status !== 'ready') throw Error('Expected ready wind: ' + r.status + ' ' + r.error); return {ticket, preview: r.preview};
}
function withControls(edit: (s: ReturnType<typeof restore>) => void) {
  const initial = createSlabInitial(), state = restore(initial.terrain, initial.game.wind); edit(state);
  initial.terrain = state.terrain; initial.game.wind = capture(state); return initial;
}
describe('existing-matter chamber wind', () => {
  test('v4 seeds three deterministic existing parcels with zero saved velocity', () => {
    const a = createSlabInitial(); expect(createSlabInitial()).toEqual(a); expect(SLAB_RULES).toBe('hot-slab-game-4');
    expect(a.game.wind.parcels.map(p => [p.id, p.packed & 255, p.velocityQ])).toEqual([['sand', MAT.SAND, [0, 0, 0]], ['steam', MAT.STEAM, [0, 0, 0]], ['water', MAT.WATER, [0, 0, 0]]]);
  });
  test('strict wind and drift commands reject accessors unknown fields and identities', () => {
    expect(readSlabCommand(wind)).toEqual(wind); expect(readSlabCommand({kind: 'drift'})).toEqual({kind: 'drift'}); const get = vi.fn();
    for (const raw of [{...wind, parcel: 'new'}, {...wind, direction: 'down'}, {...wind, cost: 0}, {...wind, direction: '__proto__'}, {kind: 'drift', parcel: 'steam'}, Object.defineProperty({...wind}, 'direction', {get, enumerable: true})]) expect(() => readSlabCommand(raw)).toThrow();
    expect(get).not.toHaveBeenCalled();
  });
  test('half-cell pulse stages only fractions and resources until atomic commit', async () => {
    const f = fixture(), before = f.session.snapshot(), r = await ready(f); expect(f.session.snapshot()).toEqual(before); expect(r.preview.terrain).toEqual(before.terrain);
    expect(r.preview.game.wind.parcels[1]).toMatchObject({velocityQ: [512, 0, 0], remainderQ: [512, 0, 0]}); expect(r.preview.game.ap).toBe(2); expect(r.preview.game.turn).toBe(1);
    const out = f.controller.commit(r.ticket); expect(out.snapshot.game.wind.cycle).toBe(1); expect(out.receipt.externalEnergyQ).toBe('0'); expect(f.steps()).toBe(0); await f.close();
  });
  test('drift repeats saved momentum and exactly transports steam history', async () => {
    const f = fixture(), before = f.session.snapshot(); f.controller.commit((await ready(f)).ticket); const r = await ready(f, {kind: 'drift'}), after = r.preview;
    const source = before.game.wind.parcels[1].cell; expect(after.game.wind.parcels[1]).toMatchObject({cell: source + 1, velocityQ: [512, 0, 0], remainderQ: [0, 0, 0]});
    for (const key of ['packedCells', 'energyQ', 'structure'] as const) expect(after.terrain[key][source + 1]).toBe(before.terrain[key][source]);
    expect(after.accounting).toEqual(before.accounting); expect(after.game.ap).toBe(1); f.controller.commit(r.ticket); await f.close();
  });
  test('water and sand share conservative transport semantics', async () => {
    for (const parcel of ['water', 'sand'] as const) {const f = fixture(), before = f.session.snapshot(), source = before.game.wind.parcels.find(p => p.id === parcel)!.cell;
      f.controller.commit((await ready(f, {...wind, parcel})).ticket); const r = await ready(f, {kind: 'drift'}); expect(r.preview.game.wind.parcels.find(p => p.id === parcel)!.cell).toBe(source + 1);
      expect(r.preview.accounting).toEqual(before.accounting); expect(r.preview.game.units).toEqual(before.game.units); await f.close();}
  });
  test('all saved parcels advance once per cycle in canonical order', async () => {
    const initial = withControls(s => {for (const p of s.parcels) p.velocityQ = [1024, 0, 0];}), f = fixture(initial), r = await ready(f, {kind: 'drift'});
    expect(r.preview.game.wind.parcels.map(p => p.cell)).toEqual(initial.game.wind.parcels.map(p => p.cell + 1)); expect(r.preview.game.wind.cycle).toBe(1); await f.close();
  });
  test('additional inert horizon ticks follow controls without repeating the pulse', async () => {
    const f = fixture(), r = await ready(f, wind, 3); expect(r.preview.game.wind.cycle).toBe(1); expect(r.preview.game.wind.terrain.tick).toBe(3);
    expect(r.preview.game.wind.parcels[1].remainderQ).toEqual([512, 0, 0]); expect(r.preview.game.wind.parcels[1].velocityQ).toEqual([512, 0, 0]); expect(f.steps()).toBe(3); await f.close();
  });
  test('JSON save and restart preserve later drift exactly', async () => {
    const a = fixture(); a.controller.commit((await ready(a)).ticket); const saved = JSON.parse(JSON.stringify(a.session.snapshot())), b = fixture(); b.controller.restore(saved);
    expect(a.controller.commit((await ready(a, {kind: 'drift'}, 1)).ticket).snapshot).toEqual(b.controller.commit((await ready(b, {kind: 'drift'}, 1)).ticket).snapshot); await a.close(); await b.close();
  });
  test('earth lift and thermal edits retain unrelated parcel controls', async () => {
    const f = fixture(), before = f.session.snapshot(); f.controller.commit((await ready(f, {kind: 'lift'})).ticket); f.controller.commit((await ready(f, {kind: 'heat', deltaQ: 1})).ticket);
    expect(f.session.snapshot().game.wind).toEqual(before.game.wind); await f.close();
  });
  test('malformed input preserves the prior ready candidate', async () => {
    const f = fixture(), r = await ready(f); expect(() => f.controller.request({...wind, direction: 'bad'}, 0)).toThrow(); expect(f.controller.state.readyId).toBe(r.ticket.id); f.controller.commit(r.ticket); await f.close();
  });
  test('speed overflow fails preparation without publishing AP or matter', async () => {
    const f = fixture(withControls(s => {s.parcels[1].velocityQ = [2048, 0, 0];})), before = f.session.snapshot(), b = f.session.branch({horizonTicks: 0});
    expect(() => prepareSlabCommand(b, wind)).toThrow(); expect(() => f.session.commit(b)).toThrow(); expect(f.session.snapshot()).toEqual(before); await f.close();
  });
  test('wind pushing sand into a trapped unit rejects terrain and game together', async () => {
    const initial = withControls(s => {
      const p = s.parcels[0], target = 5 + 8 * (4 + 8 * 3);
      for (const k of ['packedCells', 'energyQ', 'structure'] as const) [s.terrain[k][p.cell], s.terrain[k][target]] = [s.terrain[k][target], s.terrain[k][p.cell]];
      p.cell = target; p.velocityQ = [0, 0, -1024];
      const w = new CpuStructuralWorld3D({width: 8, height: 8, depth: 8, chunkSize: 4}); w.restore(s.terrain); w.setCell(5, 4, 1, MAT.STONE); s.terrain = w.snapshot();
    });
    const f = fixture(initial), before = f.session.snapshot(); expect((await f.controller.request({kind: 'drift'}, 0).result).status).toBe('failed'); expect(f.session.snapshot()).toEqual(before); await f.close();
  });
  test('range and AP failures never publish a transport cycle', async () => {
    const far = withControls(s => {const p = s.parcels[1], target = 0; for (const k of ['packedCells', 'energyQ', 'structure'] as const) [s.terrain[k][p.cell], s.terrain[k][target]] = [s.terrain[k][target], s.terrain[k][p.cell]]; p.cell = target;});
    for (const initial of [far, {...createSlabInitial(), game: {...createSlabInitial().game, ap: 0}}]) {const f = fixture(initial), before = f.session.snapshot(); expect((await f.controller.request(wind, 0).result).status).toBe('failed'); expect(f.session.snapshot()).toEqual(before); await f.close();}
  });
  test('retired parcel cannot be recreated by its old selector', async () => {
    const f = fixture(withControls(s => {s.parcels = s.parcels.filter(p => p.id !== 'steam');})), before = f.session.snapshot(); expect((await f.controller.request(wind, 0).result).status).toBe('failed'); expect(f.session.snapshot()).toEqual(before); await f.close();
  });
  test('stale concurrent preview cannot overwrite committed momentum', async () => {
    const f = fixture(), a = f.session.branch({horizonTicks: 0}), b = f.session.branch({horizonTicks: 0}); prepareSlabCommand(a, wind); prepareSlabCommand(b, {...wind, direction: 'west'});
    f.session.commit(a); const before = f.session.snapshot(); expect(() => f.session.commit(b)).toThrow(); expect(f.session.snapshot()).toEqual(before); await f.close();
  });
  test('failed horizon leaves terrain actors resources and saved controls untouched', async () => {
    const f = fixture(createSlabInitial(), true), before = f.session.snapshot(); expect((await f.controller.request(wind, 1).result).status).toBe('failed'); expect(f.session.snapshot()).toEqual(before); await f.close();
  });
  test('old application saves and wrong parcel witnesses reject atomically', () => {
    const s = createSlabSession(), before = s.snapshot();
    for (const version of ['hot-slab-game-1', 'hot-slab-game-2']) {const bad = structuredClone(before); bad.gameRulesVersion = version; expect(() => s.restore(bad)).toThrow();}
    const bad = structuredClone(before); bad.game.wind.parcels[0].energyQ++; expect(() => s.restore(bad)).toThrow(); expect(s.snapshot()).toEqual(before);
  });
  test('inspection isolates parcel controls from authoritative state', () => {
    const s = createSlabSession(), before = s.snapshot(), out = inspectSlab(before, s.queries()); out.wind.parcels[0].velocityQ[0] = 999; expect(s.snapshot()).toEqual(before);
  });
});
