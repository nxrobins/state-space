/** Tiny real reactive trajectories; native and old M5 stepping remain held. */
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { CpuVolume } from './3d-core.js';
import { CpuStructuralWorld3D } from './structural-world-core.js';
import * as mechanics from './structural-mechanics.js';
import { createReactiveMaterialRegistry3D, defaultReactiveMaterialCatalog3D, createReactiveMaterialBlock3D as block,
  editReactiveMaterialBlock3D as edit, createReactiveWorldSnapshot3D as world, createConstrainedReactiveWorldSnapshot3D as constrained,
  createReactiveDomainsSnapshot3D as domains, createReactiveSession3D as session, reactiveMaterialEnergyLedger3D as ledger,
  createReactiveMaterialTransport3D as create, readReactiveMaterialTransport3D as read, applyReactiveMaterialTransport3D as apply,
  captureReactiveMaterialTransportMemory3D as capture, restoreReactiveMaterialTransportMemory3D as restore, followReactiveMaterialTransport3D as follow,
  REACTIVE_TRANSPORT_LIMITS_3D as LIMITS, MAT, type ReactiveMaterialRegistry3D, type ReactiveMaterialEdit3D,
  type ReactiveSessionPolicy3D, type ReactiveBranch3D, type ReactiveMaterialTransportMemory3D, type ReactiveTranslationRequest3D,
  type ReactiveMaterialTransport3D, type ReactiveHold3D } from './reactive-materials.js';
const guards = [vi.spyOn(CpuVolume.prototype, 'step'), vi.spyOn(mechanics, 'solveStructure3D'),
  ...(['step', 'stepWithMotion', 'stepWithMotionPaths', 'inspectStructure'] as const).map(k => vi.spyOn(CpuStructuralWorld3D.prototype, k))];
for (const g of guards) g.mockImplementation(() => {throw Error('Old runtime held.');});
afterAll(() => {for (const g of guards) {expect(g).not.toHaveBeenCalled(); g.mockRestore();}});
let r: ReactiveMaterialRegistry3D, custom: ReactiveMaterialRegistry3D;
beforeAll(async () => {
  const c = defaultReactiveMaterialCatalog3D(); for (const m of c.propertiesCatalog.materials) m.properties.conductivity = 0;
  r = await createReactiveMaterialRegistry3D(c);
  custom = await r.extend([{...r.material(MAT.SMOKE), id: 200, name: 'mist'},
    {...r.material(MAT.OIL), id: 201, name: 'fuel', properties: {...r.material(MAT.OIL).properties, boils_into: 0}},
    {...r.material(MAT.STONE), id: 202, name: 'inert', properties: {...r.material(MAT.STONE).properties, melts_into: 0, cohesion: 0, softening: 0}},
    {...r.material(MAT.STONE), id: 203, name: 'debris', properties: {...r.material(MAT.STONE).properties, melts_into: 0}}]);
});
type V = [number, number, number];
type Game = {memory: ReactiveMaterialTransportMemory3D | null};
type Tick = Parameters<NonNullable<ReactiveSessionPolicy3D<Game>['reduceTick']>>[0];
type Command = Parameters<NonNullable<ReactiveSessionPolicy3D<Game>['reduceCommand']>>[0];
const Q = LIMITS.scale, shape = {width: 5, height: 5, depth: 5}, center: V = [2, 2, 2];
const vector = (axis: number, n: number): V => {const v: V = [0, 0, 0]; v[axis] = n; return v;};
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const place = (cell: V = center, material: number = MAT.SAND, thermal = 70): ReactiveMaterialEdit3D => ({kind: 'place', x: cell[0], y: cell[1], z: cell[2], material, thermal});
const index = (s: ReactiveMaterialTransport3D, c: V) => c[0] + s.world.block.width * (c[1] + s.world.block.height * c[2]);
function fixture(edits: ReactiveMaterialEdit3D[] = [place()], size = shape, registry = r, tick = 0, holds?: ReactiveHold3D[], policy: ReactiveSessionPolicy3D<Game> = {}) {
  expect(size.width * size.height * size.depth).toBeLessThanOrEqual(125);
  const b = edit(registry, block(registry, size), edits).block;
  const w = holds ? constrained(registry, b, tick, holds) : world(registry, b, tick);
  const initial = {worldId: 'transport-fixture', gameRulesVersion: 'test-1', domains: domains(registry, w), game: {memory: null} as Game};
  const s = session(registry, initial, policy); return {s, initial, view: s.queries()};
}
function single(material: number = MAT.SAND, velocityQ: V = [Q, 0, 0], cell: V = center, registry = r) {
  const f = fixture([place(cell, material), ...(material === MAT.STONE || material === 203 ? [{kind: 'integrity', x: cell[0], y: cell[1], z: cell[2], integrity: 0} as const] : [])], shape, registry);
  return {...f, state: create(registry, f.view, [{id: 'gust', cell, velocityQ}])};
}
function finish(b: ReactiveBranch3D<Game>) {let n = 0; while (['preparing', 'running'].includes(b.progress().status)) {if (++n > 6000) throw Error('Tiny work budget'); b.advance(7);} return b;}
function observedTick(edits = [place()], size = shape, enabled = true, maxEntries = 8192, registry = r) {
  let context!: Tick; const f = fixture(edits, size, registry, 3, undefined, {reduceTick(c) {context = c; return c.game;}});
  const b = f.s.branch({horizonTicks: 1, ...(enabled ? {motion: {maxEntries}} : {})}); finish(b);
  return {...f, b, context, before: context.beforeQueries(), after: context.queries(), movement: context.movement()};
}
function observedTranslation(edits = [place()], request: ReactiveTranslationRequest3D = {cells: [center], path: [[1, 0, 0]]}, enabled = true, maxEntries = 4096) {
  expect(request.path.length).toBeLessThanOrEqual(8); let context!: Command;
  const f = fixture(edits, shape, r, 0, undefined, {reduceCommand(c) {context = c; return c.game;}});
  const b = f.s.branch({horizonTicks: 0, ...(enabled ? {translation: {maxEntries}} : {})}); b.enqueue({kind: 'translate', domain: null, request}); finish(b);
  return {...f, b, context, before: context.beforeQueries(), after: context.queries(), movement: context.translation()!};
}
const signature = (s: ReactiveMaterialTransport3D) => s.world.block.packedCells.map((v, i) => [v, s.world.block.energyQ[i], s.world.block.structure[i]].join('/')).sort();

describe('reactive conservative material control', () => {
  test('has a separate explicit clock and never publishes its candidate', () => {
    const f = single(), before = f.s.snapshot(), out = apply(r, f.state);
    expect(out.state.cycle).toBe(1); expect(out.state.world.tick).toBe(0); expect(out.receipt.externalEnergyQ).toBe('0'); expect(f.s.snapshot()).toEqual(before);
    expect(LIMITS).toEqual({parcels: 256, scale: 1024, speedQ: 2048, swaps: 1536});
  });
  test('moves every axis and sign by exactly one cell', () => {
    for (const axis of [0, 1, 2]) for (const sign of [-1, 1]) {
      const f = single(MAT.SAND, vector(axis, sign * Q)), target: V = [...center]; target[axis] += sign;
      const out = apply(r, f.state); expect(out.receipt.swaps).toEqual([[index(f.state, center), index(f.state, target)]]);
      expect(out.state.parcels[0].velocityQ).toEqual(vector(axis, sign * Q)); expect(signature(out.state)).toEqual(signature(f.state));
    }
  });
  test('sweeps X then Z then Y with at most two steps on each axis', () => {
    const f = single(MAT.SAND, [2 * Q, 2 * Q, 2 * Q]), out = apply(r, f.state);
    expect(out.receipt.swaps).toEqual([[62, 63], [63, 64], [64, 89], [89, 114], [114, 119], [119, 124]]); expect(signature(out.state)).toEqual(signature(f.state));
  });
  test('fractional positive and negative motion accumulates and survives JSON restart', () => {
    for (const sign of [-1, 1]) {
      const s = single(MAT.SMOKE, [sign * 400, 0, 0]).state, first = apply(r, s).state, second = apply(r, copy(first)).state, third = apply(r, second);
      expect(first.parcels[0].cell).toBe(62); expect(second.parcels[0].remainderQ[0]).toBe(sign * 800);
      expect(third.state.parcels[0]).toMatchObject({cell: 62 + sign, remainderQ: [sign * 176, 0, 0]}); expect(third).toEqual(apply(r, apply(r, first).state));
    }
  });
  test('impulses change control velocity once and reject an overflowing sum before mutation', () => {
    const s = single(MAT.SAND, [400, 0, 0]).state, original = copy(s), out = apply(r, s, [{id: 'gust', impulseQ: [624, 0, 0]}]);
    expect(out.state.parcels[0].cell).toBe(63); expect(s).toEqual(original);
    expect(() => apply(r, s, [{id: 'gust', impulseQ: [2048, 0, 0]}])).toThrow(); expect(s).toEqual(original);
  });
  test('canonical lexical parcel order determines serial occupancy', () => {
    const f = fixture([place([1, 2, 2]), place([2, 2, 2])]), seeds = [{id: 'a', cell: [1, 2, 2] as V, velocityQ: [Q, 0, 0] as V}, {id: 'B', cell: center, velocityQ: [Q, 0, 0] as V}];
    const out = apply(r, create(r, f.view, seeds)); expect(out.receipt.parcels).toEqual([{id: 'B', source: 62, destination: 63}, {id: 'a', source: 61, destination: 62}]);
    expect(out).toEqual(apply(r, create(r, f.view, seeds.reverse())));
  });
  test('stationary parcels block other parcels without displacement or pushing', () => {
    const f = fixture([place([1, 2, 2]), place()]), s = create(r, f.view, [{id: 'a', cell: [1, 2, 2], velocityQ: [Q, 0, 0]}, {id: 'b', cell: center}]), out = apply(r, s);
    expect(out.receipt.contacts).toEqual([{id: 'a', axis: 0, source: 61, target: 62, normal: -1, kind: 'parcel', parcelId: 'b'}]); expect(out.state.parcels[0].velocityQ).toEqual([0, 0, 0]);
  });
  test('closed faces cancel only normal control and never wrap rows or layers', () => {
    for (const axis of [0, 1, 2]) for (const sign of [-1, 1]) {
      const c: V = [...center]; c[axis] = sign < 0 ? 0 : 4; const s = single(MAT.SAND, vector(axis, sign * Q), c).state;
      s.parcels[0].remainderQ[axis] = sign * 100; const out = apply(r, s);
      expect(out.receipt.contacts[0]).toMatchObject({axis, kind: 'boundary', target: null, normal: -sign}); expect(out.state.parcels[0].velocityQ[axis]).toBe(0); expect(out.state.parcels[0].remainderQ[axis]).toBe(0);
    }
  });
  test('single-cell and odd rectangular dimensions obey the same schedule', () => {
    const f = fixture([place([0, 0, 0], MAT.SMOKE)], {width: 1, height: 1, depth: 1}), out = apply(r, create(r, f.view, [{id: 'p', cell: [0, 0, 0], velocityQ: [Q, Q, Q]}]));
    expect(out.receipt.contacts.map(c => c.axis)).toEqual([0, 2, 1]); expect(out.receipt.swaps).toEqual([]);
    const room = fixture([place([1, 0, 1])], {width: 3, height: 1, depth: 3}); expect(apply(r, create(r, room.view, [{id: 'p', cell: [1, 0, 1], velocityQ: [Q, 0, Q]}])).receipt.swaps).toEqual([[4, 5], [5, 8]]);
  });
  test('all loose phases and completely failed cohesive debris retain every cell coordinate', () => {
    for (const m of [MAT.SMOKE, MAT.STEAM, MAT.WATER, MAT.OIL, MAT.SAND, MAT.LAVA, MAT.MOLTEN_GLASS, MAT.STONE]) {
      const s = single(m).state, out = apply(r, s); expect(out.receipt.swaps).toHaveLength(1); expect(signature(out.state)).toEqual(signature(s)); expect(read(r, out.state)).toEqual(out.state);
    }
  });
  test('custom gases fuel and cohesion use the active catalog', () => {
    for (const m of [200, 201, 203]) {const s = single(m, [Q, 0, 0], center, custom).state, out = apply(custom, s); expect(out.state.world.block.packedCells[63] & 255).toBe(m); expect(signature(out.state)).toEqual(signature(s));}
    expect(() => create(custom, fixture([place(center, 202)], shape, custom).view, [{id: 'p', cell: center}])).toThrow(/mobile/);
  });
  test('chemical and sensible energy move without combustion cooling or external charge', () => {
    const f = fixture([place(center, 201, 210)], shape, custom), s = create(custom, f.view, [{id: 'fuel', cell: center, velocityQ: [Q, 0, 0]}]), out = apply(custom, s);
    expect(ledger(custom, out.state.world.block)).toEqual(ledger(custom, s.world.block)); expect(ledger(custom, s.world.block).chemicalQ).toBeGreaterThan(0n); expect(out.receipt.externalEnergyQ).toBe('0');
  });
  test('intact damaged anchored bonded and held matter cannot be selected', () => {
    for (const changes of [[], [{kind: 'integrity', x: 2, y: 2, z: 2, integrity: 1}], [{kind: 'anchor', x: 2, y: 2, z: 2, anchored: true}],
      [place([3, 2, 2], MAT.STONE), {kind: 'bond', x: 2, y: 2, z: 2, direction: 1, bonded: true}]] as ReactiveMaterialEdit3D[][]) {
      expect(() => create(r, fixture([place(center, MAT.STONE), ...changes]).view, [{id: 'p', cell: center}])).toThrow(/mobile/);
    }
    const held = fixture([place(center, MAT.STONE), {kind: 'integrity', x: 2, y: 2, z: 2, integrity: 0}], shape, r, 0, [{id: 'lift', cells: [62], expiresAtTick: 2}]);
    expect(() => create(r, held.view, [{id: 'p', cell: center}])).toThrow(/holds/);
  });
  test('only unbound gas may be displaced even when other matter is mobile', () => {
    for (const material of [MAT.SAND, MAT.WATER, MAT.STONE, MAT.ICE]) {
      const f = fixture([place(), place([3, 2, 2], material)]), s = create(r, f.view, [{id: 'p', cell: center, velocityQ: [Q, 0, 0]}]), out = apply(r, s);
      expect(out.receipt.swaps).toEqual([]); expect(out.receipt.contacts[0].kind).toBe('material'); expect(out.state.world).toEqual(s.world);
    }
  });
  test('custom displaced gas retains its exact energy at the vacated source', () => {
    const f = fixture([place(), place([3, 2, 2], 200, 173)], shape, custom), s = create(custom, f.view, [{id: 'p', cell: center, velocityQ: [Q, 0, 0]}]), out = apply(custom, s);
    expect(out.state.world.block.energyQ[62]).toBe(s.world.block.energyQ[63]); expect(out.state.world.block.packedCells[62]).toBe(s.world.block.packedCells[63]);
  });
  test('value-identical gas still records a real swap and material identity', () => {
    const f = fixture([place(center, MAT.SMOKE), place([3, 2, 2], MAT.SMOKE)]), s = create(r, f.view, [{id: 'p', cell: center, velocityQ: [Q, 0, 0]}]), out = apply(r, s);
    expect(out.receipt.editedCells).toEqual([]); expect(out.receipt.swaps).toEqual([[62, 63]]); expect(out.state.parcels[0].cell).toBe(63);
  });
  test('unrelated holds and their absolute lifetime survive planning unchanged', () => {
    const f = fixture([place(), place([0, 0, 0], MAT.STONE)], shape, r, 4, [{id: 'lift', cells: [0], expiresAtTick: 6}]), s = create(r, f.view, [{id: 'p', cell: center, velocityQ: [Q, 0, 0]}]), out = apply(r, s);
    expect(out.state.world).toMatchObject({tick: 4, holds: [{id: 'lift', cells: [0], expiresAtTick: 6}]});
  });
  test('empty cycles are exact and overflow is rejected', () => {
    const f = fixture([]), s = create(r, f.view); expect(apply(r, s).state).toEqual({...s, cycle: 1});
    expect(() => apply(r, {...s, cycle: Number.MAX_SAFE_INTEGER})).toThrow();
  });
  test('seeds reject air duplicates invalid vectors unknown fields and sparse arrays', () => {
    const f = fixture(); const good = {id: 'p', cell: center};
    for (const seeds of [[{id: 'p', cell: [0, 0, 0]}], [good, good], [{...good, velocityQ: [0, 0]}], [{...good, id: '!'}], [{...good, unknown: 1}], new Array(1)]) expect(() => create(r, f.view, seeds as never)).toThrow();
  });
  test('all impulse validation happens on an isolated candidate', () => {
    const s = single().state, before = copy(s);
    for (const commands of [[{id: 'missing', impulseQ: [1, 0, 0]}], [{id: 'gust', impulseQ: [1, 0, 0]}, {id: 'gust', impulseQ: [2, 0, 0]}], [{id: 'gust', impulseQ: [NaN, 0, 0]}], [{id: 'gust', impulseQ: [0, 0, 0], extra: true}]]) expect(() => apply(r, s, commands as never)).toThrow();
    expect(s).toEqual(before);
  });
  test('records and dense arrays reject getters without invoking them', () => {
    const f = single(), getter = vi.fn(() => 0), s = copy(f.state); Object.defineProperty(s, 'cycle', {get: getter, enumerable: true}); expect(() => read(r, s)).toThrow();
    const impulses = [{id: 'gust', impulseQ: [0, 0, 0]}]; Object.defineProperty(impulses, '0', {get: getter, enumerable: true}); expect(() => apply(r, f.state, impulses as never)).toThrow(); expect(getter).not.toHaveBeenCalled();
  });
  test('state validation rejects incompatible envelopes bounds and noncanonical parcels', () => {
    const s = single().state;
    for (const change of [(v: typeof s) => {v.schemaVersion = 2 as never;}, (v: typeof s) => {v.rulesVersion = 'old' as never;}, (v: typeof s) => {v.identity.width++;}, (v: typeof s) => {v.parcels[0].remainderQ[0] = Q;}, (v: typeof s) => {v.parcels.push(copy(v.parcels[0]));}]) {const v = copy(s); change(v); expect(() => read(r, v)).toThrow();}
    expect(() => read(custom, s)).toThrow();
  });
  test('public states results memories and witnesses are isolated', () => {
    const f = single(), original = copy(f.state), owned = read(r, f.state), out = apply(r, f.state), memory = capture(r, f.state);
    owned.parcels[0].velocityQ[0] = 0; out.state.world.block.energyQ[0] = 0; memory.parcels[0].remainderQ[0] = 1;
    expect(f.state).toEqual(original); expect(f.s.snapshot().domains.world).toEqual(original.world);
  });
  test('compact saved memory restores exactly against a matching committed view', () => {
    const f = single(MAT.OIL, [10, -7, 9]); f.state.cycle = 3; f.state.parcels[0].remainderQ = [-3, 4, 5];
    const memory = capture(r, f.state); expect(Object.hasOwn(memory, 'world')).toBe(false); expect(restore(r, f.view, copy(memory))).toEqual(f.state);
    expect(apply(r, restore(r, f.view, copy(memory)))).toEqual(apply(r, f.state));
  });
  test('each changed witness and incompatible memory field rejects without reseeding', () => {
    const f = single(), memory = capture(r, f.state);
    for (const key of ['packed', 'energyQ', 'structure'] as const) {const m = copy(memory); m.parcels[0][key]++; expect(() => restore(r, f.view, m)).toThrow(/witness/);}
    for (const key of ['worldId', 'gameRulesVersion', 'materialCatalogHash', 'evolutionRulesVersion', 'structureRulesVersion'] as const) {const m = copy(memory); m.identity[key] += 'x'; expect(() => restore(r, f.view, m)).toThrow();}
    const bad = copy(memory); bad.memoryRulesVersion = 'old' as never; expect(() => restore(r, f.view, bad)).toThrow(); expect(capture(r, f.state)).toEqual(memory);
  });
  test('memory is domain-bound and rejects a stale physical tick', () => {
    const f = single(), memory = capture(r, f.state), s = session(r, {...f.initial, domains: domains(r, f.initial.domains.world, [{id: 'bottle', world: f.initial.domains.world}])});
    expect(() => restore(r, s.queries('bottle'), memory)).toThrow(/domain/);
    const stale = copy(memory); stale.identity.tick++; expect(() => restore(r, f.view, stale)).toThrow(/identity/);
  });
  test('memory is not a revision proof for identical matter or a substitute for a transaction', () => {
    const f = single(), memory = capture(r, f.state), b = f.s.branch({horizonTicks: 0}); b.enqueue({kind: 'game', game: {memory}}); finish(b); f.s.commit(b);
    expect(restore(r, f.s.queries(), memory)).toEqual(f.state); expect(f.s.revision.revision).toBe(1);
  });
});

describe('reactive transport follows executed material history', () => {
  test('a real tick follows all movement passes without adding control motion', () => {
    const f = observedTick(), s = create(r, f.before, [{id: 'p', cell: center, velocityQ: [400, 0, 0]}]); s.cycle = 7; s.parcels[0].remainderQ[0] = 999;
    const out = follow(r, f.before, f.after, f.movement, capture(r, s));
    expect(out.memory.cycle).toBe(7); expect(out.memory.identity.tick).toBe(4); expect(out.memory.parcels[0]).toMatchObject({velocityQ: [400, 0, 0], remainderQ: [999, 0, 0]});
    expect(out.moved[0].to).not.toBe(62); expect(restore(r, f.after, out.memory).parcels[0].cell).toBe(out.moved[0].to);
  });
  test('freezing retires control when a mobile parcel becomes intact ice', () => {
    const f = observedTick([place([0, 0, 0], MAT.WATER), {kind: 'energy', x: 0, y: 0, z: 0, energyQ: 0}], {width: 1, height: 1, depth: 1}), m = capture(r, create(r, f.before, [{id: 'water', cell: [0, 0, 0]}]));
    expect(f.b.inspect().state.domains.world.block.packedCells[0] & 255).toBe(MAT.ICE);
    expect(follow(r, f.before, f.after, f.movement, m)).toMatchObject({memory: {parcels: []}, retired: [{id: 'water', cell: 0, reason: 'immobile'}]});
  });
  test('fire to smoke refreshes thermal and material witnesses while preserving control', () => {
    const f = observedTick([place([0, 0, 0], MAT.FIRE, 200)], {width: 1, height: 1, depth: 1}), m = capture(r, create(r, f.before, [{id: 'fire', cell: [0, 0, 0], velocityQ: [9, 0, 0]}])), out = follow(r, f.before, f.after, f.movement, m);
    expect(out.memory.parcels[0].packed & 255).toBe(MAT.SMOKE); expect(out.memory.parcels[0].energyQ).toBe(m.parcels[0].energyQ); expect(out.memory.parcels[0].velocityQ[0]).toBe(9); expect(out.retired).toEqual([]);
  });
  test('gas condensation stays attached to the new mobile liquid', () => {
    const energyQ = (r.material(MAT.WATER).properties.phase_energy + r.material(MAT.STEAM).properties.condense_point) * 256;
    const f = observedTick([place([0, 0, 0], MAT.STEAM), {kind: 'energy', x: 0, y: 0, z: 0, energyQ}], {width: 1, height: 1, depth: 1}), m = capture(r, create(r, f.before, [{id: 'steam', cell: [0, 0, 0]}])), out = follow(r, f.before, f.after, f.movement, m);
    expect(out.memory.parcels[0].packed & 255).toBe(MAT.WATER); expect(out.retired).toEqual([]);
  });
  test('executed controlled translation follows the selected parcel without another cycle', () => {
    const f = observedTranslation(), s = create(r, f.before, [{id: 'p', cell: center, velocityQ: [12, 4, 8]}]); s.cycle = 3;
    const out = follow(r, f.before, f.after, f.movement, capture(r, s)); expect(out.memory.parcels[0].cell).toBe(63); expect(out.memory.cycle).toBe(3); expect(out.memory.identity.tick).toBe(0);
  });
  test('displaced gas follows relocation back to the selected run head', () => {
    const f = observedTranslation([place(center, MAT.STONE), place([3, 2, 2], MAT.SMOKE)], {cells: [center], path: [[1, 0, 0]], displacement: 'mobile'}), s = create(r, f.before, [{id: 'smoke', cell: [3, 2, 2]}]);
    const out = follow(r, f.before, f.after, f.movement, capture(r, s)); expect(out.moved).toEqual([{id: 'smoke', from: 63, to: 62}]);
  });
  test('translation of identical gas follows lineage despite zero endpoint changes', () => {
    const f = observedTranslation([place(center, MAT.SMOKE), place([3, 2, 2], MAT.SMOKE)], {cells: [center], path: [[1, 0, 0]], displacement: 'mobile'});
    expect(f.b.inspect().state.domains).toEqual(f.initial.domains);
    const m = capture(r, create(r, f.before, [{id: 'a', cell: center}, {id: 'b', cell: [3, 2, 2]}])), out = follow(r, f.before, f.after, f.movement, m);
    expect(out.memory.parcels.map(p => p.cell)).toEqual([63, 62]);
  });
  test('round-trip translation preserves accumulated control and full path provenance', () => {
    const f = observedTranslation([place()], {cells: [center], path: [[1, 0, 0], [-1, 0, 0]]}), s = create(r, f.before, [{id: 'p', cell: center}]); s.parcels[0].remainderQ[2] = -7;
    const m = capture(r, s); expect(follow(r, f.before, f.after, f.movement, m).memory).toEqual(m);
  });
  test('disabled or overflowed tick and translation capture fail without partial continuity', () => {
    for (const enabled of [false, true]) {
      const t = observedTick(undefined, undefined, enabled, 0), c = observedTranslation(undefined, undefined, enabled, 0);
      for (const f of [t, c]) {const m = capture(r, create(r, f.before, [{id: 'p', cell: center}])), before = copy(m); expect(() => follow(r, f.before, f.after, f.movement, m)).toThrow(/complete/); expect(m).toEqual(before);}
    }
  });
  test('serialized lookalikes foreign views and reversed boundaries cannot forge continuity', () => {
    const f = observedTick(), m = capture(r, create(r, f.before, [{id: 'p', cell: center}]));
    expect(() => follow(r, f.before, f.after, copy(f.movement), m)).toThrow(/live/);
    expect(() => follow(r, f.after, f.before, f.movement, m)).toThrow(/boundaries/);
    expect(() => follow(r, f.s.queries(), f.after, f.movement, m)).toThrow(/boundaries/);
    const c = observedTranslation(); expect(() => follow(r, c.before, c.after, copy(c.movement), capture(r, create(r, c.before, [{id: 'p', cell: center}])))).toThrow(/live/);
  });
  test('mutating disposable public observations cannot corrupt privately executed paths', () => {
    for (const f of [observedTick(), observedTranslation()]) {
      const m = capture(r, create(r, f.before, [{id: 'p', cell: center}])), expected = follow(r, f.before, f.after, f.movement, m);
      if ('trace' in f.movement) f.movement.trace!.passes.length = 0; else f.movement.paths.passes.length = 0;
      expect(follow(r, f.before, f.after, f.movement, m)).toEqual(expected);
    }
  });
  test('failed continuity inside application policy rolls back the entire branch', () => {
    let memory: ReactiveMaterialTransportMemory3D;
    const f = fixture(undefined, undefined, undefined, 0, undefined, {reduceTick(c) {follow(r, c.beforeQueries(), c.queries(), c.movement(), memory); return c.game;}});
    memory = capture(r, create(r, f.view, [{id: 'p', cell: center}])); const before = f.s.snapshot(), b = f.s.branch({horizonTicks: 1}); b.enqueue({kind: 'game', game: {memory}});
    expect(() => finish(b)).toThrow(/complete/); expect(b.progress().status).toBe('failed'); expect(f.s.snapshot()).toEqual(before);
  });
  test('saved game control follows odd-tick session restart exactly', () => {
    const f = fixture([place([0, 0, 0], MAT.SMOKE)], {width: 1, height: 1, depth: 1}, r, 3);
    const memory = capture(r, create(r, f.view, [{id: 'p', cell: [0, 0, 0], velocityQ: [123, -7, 9]}])); memory.cycle = 5;
    const policy: ReactiveSessionPolicy3D<Game> = {reduceTick(c) {return {memory: follow(r, c.beforeQueries(), c.queries(), c.movement(), c.game.memory!).memory};}};
    const initial = {...f.initial, game: {memory} as Game}, a = session(r, initial, policy), save = a.snapshot(), b = session(r, initial, policy); b.restore(copy(save));
    const run = (s: typeof a) => {const branch = s.branch({horizonTicks: 2, motion: {}}); finish(branch); return s.commit(branch).snapshot;};
    const x = run(a), y = run(b); expect({...x, revision: y.revision}).toEqual(y); expect(x.game.memory!.cycle).toBe(5); expect(x.game.memory!.identity.tick).toBe(5); expect(a.energyBalance().driftQ).toBe(0n);
  });
});
