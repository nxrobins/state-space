/** Exact observations on tiny worlds; no old M5 simulation or native runtime. */
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { CpuVolume } from './3d-core.js';
import { CpuStructuralWorld3D } from './structural-world-core.js';
import * as mechanics from './structural-mechanics.js';
import { createTacticalSession3D } from './tactical-session.js';
import { assertGameplayGeometry3D, gameplayGeometrySource3D } from './gameplay-geometry.js';
import { createReactiveGeometry3D } from './reactive-geometry.js';
import { createReactiveMaterialRegistry3D, defaultReactiveMaterialCatalog3D, createReactiveMaterialBlock3D as block,
  editReactiveMaterialBlock3D as edit, createReactiveWorldSnapshot3D as world, createReactiveDomainsSnapshot3D as domains,
  createReactiveSession3D as create, GEOMETRY_SCALE_3D as S, REACTIVE_GEOMETRY_RULES_3D, MAT,
  type ReactiveMaterialRegistry3D, type ReactiveMaterialEdit3D, type ReactiveSessionPolicy3D,
  type ReactiveBranch3D, type ReactiveSessionQueryAccess3D, type GeometryBox3D } from './reactive-materials.js';
const guards = [vi.spyOn(CpuVolume.prototype, 'step'), vi.spyOn(mechanics, 'solveStructure3D'),
  ...(['step', 'stepWithMotion', 'stepWithMotionPaths', 'inspectStructure'] as const).map(k => vi.spyOn(CpuStructuralWorld3D.prototype, k))];
for (const guard of guards) guard.mockImplementation(() => {throw Error('Old physical runtime remains held.');});
afterAll(() => {for (const g of guards) {expect(g).not.toHaveBeenCalled(); g.mockRestore();}});
let r: ReactiveMaterialRegistry3D;
beforeAll(async () => {
  const c = defaultReactiveMaterialCatalog3D(); for (const m of c.propertiesCatalog.materials) m.properties.conductivity = 0;
  const base = await createReactiveMaterialRegistry3D(c), wood = base.material(MAT.WOOD), oil = base.material(MAT.OIL);
  const fuel = {...wood, properties: {...wood.properties, fuel_energy: 120}};
  const sap = {...oil, properties: {...oil.properties, boils_into: 0, boil_point: 0, latent_heat_boil: 0}};
  r = await base.extend([{...fuel, id: 200, name: 'resin'}, {...sap, id: 201, name: 'sap'}]);
});
type V = [number, number, number];
const vec = (x: number, y: number, z: number): V => [x * S, y * S, z * S];
const box = (lo: V, hi: V): GeometryBox3D => ({minQ: vec(...lo), maxQ: vec(...hi)});
const unit = box([0, 1, 0], [1, 2, 1]), cellBox = box([0, 0, 0], [1, 1, 1]);
const place = (x = 0, y = 0, z = 0, material: number = MAT.STONE, thermal = 70): ReactiveMaterialEdit3D => ({kind: 'place', x, y, z, material, thermal});
function initial(edits: ReactiveMaterialEdit3D[] = [], tick = 0, shape = {width: 3, height: 3, depth: 3}, stored: ReactiveMaterialEdit3D[] = []) {
  const a = world(r, edit(r, block(r, shape), edits).block, tick), b = world(r, edit(r, block(r, {width: 2, height: 3, depth: 1}), stored).block, tick);
  expect(a.block.packedCells.length + b.block.packedCells.length).toBeLessThanOrEqual(125);
  return {worldId: 'query-mission', gameRulesVersion: 'query-game-1', domains: domains(r, a, [{id: 'flask', world: b}]), game: {ap: 2, turn: 0}};
}
type Game = ReturnType<typeof initial>['game'];
const session = (input = initial(), policy: ReactiveSessionPolicy3D<Game> = {}) => create(r, input, policy);
const finish = (b: ReactiveBranch3D<Game>) => {let calls = 0; while (['preparing', 'running'].includes(b.progress().status)) {if (++calls > 10000) throw Error('Tiny fixture work bound'); b.advance(7);} return b.inspect();};
const plain = <T extends {stamp: unknown}>(value: T) => {const {stamp: _stamp, ...rest} = value; return rest;};
const expose = (q: ReturnType<ReturnType<typeof session>['queries']>, b = cellBox) => q.exposure({box: b});

describe('reactive gameplay geometry and exact preview boundaries', () => {
  test('committed observations identify their world catalog domain tick and local revision', () => {
    const s = session(initial([place()], 3)), q = s.queries();
    expect(q.stamp).toEqual({kind: 'committed', revision: s.revision, domain: null, rulesVersion: REACTIVE_GEOMETRY_RULES_3D, worldRulesVersion: 'reactive-world-1', tick: 3});
    expect(q.fit({box: cellBox}).stamp).toBe(q.stamp); expect(q.support({box: unit, maxDropQ: 0}).stamp).toBe(q.stamp);
    expect(Object.isFrozen(q)).toBe(true); expect(Object.isFrozen(q.stamp)).toBe(true); expect(Object.isFrozen(q.stamp.kind === 'committed' && q.stamp.revision)).toBe(true);
  });
  test('all five shared queries match the existing M5 adapter for the same complete builtin cells', () => {
    const old = new CpuStructuralWorld3D({width: 4, height: 4, depth: 4, chunkSize: 4});
    old.setCell(2, 1, 1, MAT.STONE, 70); old.setCell(1, 2, 1, MAT.WATER, 40); old.setCell(2, 2, 1, MAT.ICE, 10); old.setCell(0, 0, 0, MAT.GLASS, 50);
    const saved = old.snapshot(), legacy = createTacticalSession3D({worldId: 'parity', gameRulesVersion: 'parity-1', terrain: saved, game: {}}).queries();
    const b = {...block(r, {width: 4, height: 4, depth: 4}), packedCells: saved.packedCells, energyQ: saved.energyQ, structure: saved.structure};
    const modern = session({...initial(), domains: domains(r, world(r, b))}).queries();
    for (const b of [cellBox, box([1, 1, 1], [2, 2, 2]), box([0.5, 0.5, 0.5], [3.5, 3.5, 3.5]), box([-1, 0, 0], [2, 2, 2])]) {
      expect(plain(modern.fit({box: b}))).toEqual(plain(legacy.fit({box: b})));
      expect(plain(modern.sweep({box: b, deltaQ: vec(2, 1, -1)}))).toEqual(plain(legacy.sweep({box: b, deltaQ: vec(2, 1, -1)})));
      expect(plain(modern.support({box: b, maxDropQ: 4 * S}))).toEqual(plain(legacy.support({box: b, maxDropQ: 4 * S})));
      expect(plain(expose(modern, b))).toEqual(plain(expose(legacy as never, b)));
    }
    for (const from of [vec(-1, 1.5, 1.5), vec(4, 1.5, 1.5), vec(0, 0, 0)]) {
      const request = {fromQ: from, toQ: vec(3, 2, 1)}; expect(plain(modern.raycast(request))).toEqual(plain(legacy.raycast(request)));
    }
  });
  test('custom solid phases block bodies and explicit filters can target custom fluid', () => {
    const q = session(initial([place(0, 0, 0, 201, 40), place(1, 0, 0, 200, 50)])).queries();
    expect(q.fit({box: cellBox}).fits).toBe(true); expect(q.fit({box: cellBox, materials: [201]}).fits).toBe(false);
    const ray = {fromQ: vec(0.5, 0.5, 0.5), toQ: vec(2.5, 0.5, 0.5)};
    expect(q.raycast(ray).contact?.cell?.material).toBe(200); expect(q.raycast({...ray, materials: [201]}).contact?.cell?.material).toBe(201);
    expect(q.raycast({...ray, materials: []}).contact).toBeNull();
  });
  test('custom fuel exposure excludes chemical energy and reports exact sensible temperature', () => {
    const s = session(initial([place(0, 0, 0, 200, 50)])), e = expose(s.queries());
    expect(s.snapshot().domains.world.block.energyQ[0]).toBe((120 + 50) * 256);
    expect(e.materials).toEqual([{material: 200, cells: 1, volumeQ3: String(S ** 3), minTemperatureQ: 50 * 256, maxTemperatureQ: 50 * 256,
      meanTemperatureQ: {numerator: String(BigInt(S ** 3) * 50n * 256n), denominator: String(S ** 3)}, maxImmersionDepthQ: 0}]);
  });
  test('water in its latent boiling interval retains the phase-boundary temperature', () => {
    const input = initial([place(0, 0, 0, MAT.WATER, 100)]), b = input.domains.world.block, energy = b.energyQ[0];
    input.domains.world.block = edit(r, b, [{kind: 'energy', x: 0, y: 0, z: 0, energyQ: energy + 1}]).block;
    expect(expose(session(input).queries()).materials[0].minTemperatureQ).toBe(100 * 256);
  });
  test('partial-volume weighted temperatures and outside volumes remain exact integers', () => {
    const q = session(initial([place(0, 0, 0, 200, 40), place(1, 0, 0, 200, 80)])).queries();
    const e = expose(q, box([-0.5, 0, 0], [1.5, 1, 1])), fuel = e.materials[0];
    expect(e.volumeQ3).toBe(String(2 * S ** 3)); expect(e.outsideVolumeQ3).toBe(String(S ** 3 / 2)); expect(fuel.cells).toBe(2);
    expect(fuel.meanTemperatureQ).toEqual({numerator: String(BigInt(S ** 3) * 80n * 256n), denominator: String(1.5 * S ** 3)});
  });
  test('immersion counts only the contiguous liquid column touching the feet', () => {
    const q = session(initial([place(0, 0, 0, MAT.WATER, 40), place(0, 2, 0, MAT.WATER, 40)])).queries();
    expect(expose(q, box([0, 0, 0], [1, 2.5, 1])).materials.find(m => m.material === MAT.WATER)?.maxImmersionDepthQ).toBe(S / 2);
    expect(expose(q, box([0, 0, 0], [1, 2, 1])).materials.find(m => m.material === MAT.WATER)?.maxImmersionDepthQ).toBe(0);
  });
  test('all axes and signs retain rational swept contacts against custom terrain', () => {
    for (const axis of [0, 1, 2]) for (const sign of [-1, 1]) {
      const p: V = [1, 1, 1], d: V = [0, 0, 0], normal: V = [0, 0, 0]; p[axis] = sign > 0 ? 2 : 0; d[axis] = sign * S; normal[axis] = -sign;
      const q = session(initial([place(...p, 200)])).queries(), b = box([1.25, 1.25, 1.25], [1.75, 1.75, 1.75]);
      expect(q.sweep({box: b, deltaQ: d}).contact).toMatchObject({time: {numerator: 1, denominator: 4}, normal, cell: {material: 200, coordinate: p}});
    }
  });
  test('odd rectangular and single-cell domains use their real closed boundaries', () => {
    const q = session(initial([], 0, {width: 5, height: 1, depth: 3})).queries();
    expect(q.support({box: cellBox, maxDropQ: 0})).toMatchObject({bodyFits: true, distanceQ: 0, surfaces: [{boundary: true, cell: null, areaQ2: S * S}]});
    expect(q.fit({box: box([4, 0, 2], [5, 1, 3])}).fits).toBe(true); expect(q.fit({box: box([4, 0, 2], [5, 2, 3])}).outside).toBe(true);
    expect(session(initial([], 0, {width: 1, height: 1, depth: 1})).queries().sweep({box: cellBox, deltaQ: [1, 0, 0]}).contact?.time).toEqual({numerator: 0, denominator: 1});
  });
  test('ray grid-plane and tied-axis ownership stays exact for custom material', () => {
    const q = session(initial([place(0, 1, 1, 200), place(1, 1, 1, MAT.ICE)])).queries();
    expect(q.raycast({fromQ: vec(1, 1.5, 1.5), toQ: vec(0.5, 1.5, 1.5)}).contact).toMatchObject({normal: [1, 0, 0], cell: {material: 200}, time: {numerator: 0, denominator: 1}});
    const diagonal = session(initial([place(1, 0, 0, 200)])).queries();
    expect(diagonal.raycast({fromQ: vec(0.5, 0.5, 0.5), toQ: vec(2.5, 2.5, 0.5)}).contact).toBeNull();
  });
  test('co-nearest support faces retain exact areas and damage without implying capacity', () => {
    const q = session(initial([place(0, 2, 0, 200), place(1, 2, 0), {kind: 'integrity', x: 0, y: 2, z: 0, integrity: 31}])).queries();
    const s = q.support({box: box([0.5, 0, 0], [1.5, 1, 1]), maxDropQ: S});
    expect(s.distanceQ).toBe(S); expect(s.surfaces.map(v => [v.cell?.material, v.areaQ2])).toEqual([[200, S * S / 2], [MAT.STONE, S * S / 2]]); expect(s.surfaces[0].cell?.structure).toBe(31);
  });
  test('material filters reject inactive duplicate fractional and sparse identities', () => {
    const q = session().queries(); for (const materials of [[255], [MAT.PLAYER], [200, 200], [1.5], new Array(1), new Uint8Array([200])]) expect(() => q.fit({box: cellBox, materials: materials as never})).toThrow();
    expect(q.fit({box: cellBox, materials: r.materialIds}).fits).toBe(false);
  });
  test('malformed queries reject without executing accessors or changing state', () => {
    const s = session(), before = s.snapshot(), q = s.queries(), getter = vi.fn(() => cellBox);
    expect(() => q.fit(Object.defineProperty({}, 'box', {get: getter, enumerable: true}) as never)).toThrow(); expect(getter).not.toHaveBeenCalled();
    for (const b of [{minQ: [0.5, 0, 0], maxQ: [S, S, S]}, {minQ: [0, 0, 0], maxQ: [0, S, S]}, {minQ: [-524289, 0, 0], maxQ: [S, S, S]}]) expect(() => q.exposure({box: b as never})).toThrow();
    expect(() => q.support({box: cellBox, maxDropQ: Infinity})).toThrow(); expect(s.snapshot()).toEqual(before);
  });
  test('query arrays cannot run caller array methods', () => {
    const q = session().queries(), callback = vi.fn(() => {throw Error('Caller method');}), proto = Object.create(Array.prototype, {map: {value: callback}, [Symbol.iterator]: {value: callback}});
    const lo = Object.setPrototypeOf([0, 0, 0], proto), hi = Object.setPrototypeOf([S, S, S], proto);
    expect(q.fit({box: {minQ: lo, maxQ: hi}}).fits).toBe(true); expect(callback).not.toHaveBeenCalled();
  });
  test('unknown and malformed reservoir requests preserve all candidates', () => {
    const s = session(), b = s.branch({horizonTicks: 0}); for (const domain of ['missing', 3, {}, '']) {expect(() => s.queries(domain as never)).toThrow(); expect(() => b.queries(domain as never)).toThrow();}
    finish(b); expect(s.commit(b).snapshot.revision).toBe(1);
  });
  test('reservoir geometry cannot alias the primary world and has its own shape', () => {
    const s = session(initial([place()], 0, {width: 3, height: 3, depth: 3}, [place(1, 2, 0, 200)])), q = s.queries('flask');
    expect(q.stamp.domain).toBe('flask'); expect(q.fit({box: cellBox}).fits).toBe(true); expect(s.queries().fit({box: cellBox}).fits).toBe(false);
    expect(q.fit({box: box([2, 0, 0], [3, 1, 1])}).outside).toBe(true); expect(q.support({box: box([1, 1, 0], [2, 2, 1]), maxDropQ: 0}).surfaces[0].cell?.material).toBe(200);
  });
  test('preview commands change queries only at complete boundaries with truthful stamps', () => {
    const s = session(), b = s.branch({horizonTicks: 0}); b.enqueue({kind: 'game', game: {ap: 1, turn: 0}}); b.enqueue({kind: 'edit', domain: null, edits: [place()]});
    expect(b.queries().stamp).toMatchObject({kind: 'preview', completedCommands: 0, completedTicks: 0, horizonTicks: 0});
    b.advance(); expect(b.queries().fit({box: cellBox}).fits).toBe(true); b.advance(); const q = b.queries();
    expect(q.stamp).toMatchObject({completedCommands: 2, tick: 0, branchId: b.branchId, base: b.base}); expect(q.fit({box: cellBox}).fits).toBe(false); expect(s.queries().fit({box: cellBox}).fits).toBe(true);
  });
  test('partial conservative transfers remain invisible to source and destination queries', () => {
    const s = session(initial([place(), place(1)])), b = s.branch({horizonTicks: 0}); b.enqueue({kind: 'transfer', request: {from: null, to: 'flask', cells: [[0, 0, 0], [1, 0, 0]], offset: [0, 0, 0]}});
    b.advance(1); b.advance(1); expect(b.queries().fit({box: cellBox}).fits).toBe(false); expect(b.queries('flask').fit({box: cellBox}).fits).toBe(true);
    finish(b); expect(b.queries().fit({box: cellBox}).fits).toBe(true); expect(b.queries('flask').fit({box: cellBox}).fits).toBe(false);
  });
  test('partial synchronized ticks retain the previous complete geometry until publication', () => {
    const s = session(initial([place()])), b = s.branch({horizonTicks: 1}); b.advance(1); b.advance(1);
    expect(b.queries().stamp.tick).toBe(0); expect(b.queries().fit({box: cellBox}).fits).toBe(false);
    finish(b); expect(b.queries().stamp).toMatchObject({tick: 1, completedTicks: 1}); expect(b.queries().fit({box: cellBox}).fits).toBe(true); expect(b.queries().fit({box: unit}).fits).toBe(false);
  });
  test('a held slab reports constrained world identity without temporary structural anchor bits', () => {
    const s = session(initial([place()])), b = s.branch({horizonTicks: 1}); b.enqueue({kind: 'hold', domain: null, request: {id: 'lift', cells: [[0, 0, 0]], expiresAtTick: 2}}); finish(b);
    expect(b.queries().stamp.worldRulesVersion).toBe('reactive-world-2'); expect(b.queries().fit({box: cellBox}).blocker?.structure).toBe(255);
  });
  test('retained committed and preview views survive commit and restore as historical observations', () => {
    const s = session(), saved = s.snapshot(), old = s.queries(), b = s.branch({horizonTicks: 0}); b.enqueue({kind: 'edit', domain: null, edits: [place()]}); finish(b); const preview = b.queries(); s.commit(b); const committed = s.queries(); s.restore(saved);
    expect(old.fit({box: cellBox}).fits).toBe(true); expect(preview.fit({box: cellBox}).fits).toBe(false); expect(committed.fit({box: cellBox}).fits).toBe(false); expect(s.queries().fit({box: cellBox}).fits).toBe(true);
    expect(committed.stamp.kind === 'committed' && committed.stamp.revision.revision).toBe(1); expect(s.revision.revision).toBe(2); expect(() => b.queries()).toThrow();
  });
  test('discarded failed and stale branches reject new views but retained views remain usable', () => {
    const s = session(initial([place()])), discarded = s.branch({horizonTicks: 0}), old = discarded.queries(); discarded.discard(); expect(() => discarded.queries()).toThrow();
    const failed = s.branch({horizonTicks: 0}); expect(() => failed.enqueue(null as never)).toThrow(); expect(() => failed.queries()).toThrow();
    const stale = s.branch({horizonTicks: 0}), winner = s.branch({horizonTicks: 0}); finish(winner); s.commit(winner); expect(() => stale.queries()).toThrow(/stale/); expect(old.fit({box: cellBox}).fits).toBe(false);
  });
  test('query results and caller snapshots cannot mutate owned observations or future physics', () => {
    const s = session(initial([place()])), q = s.queries(), saved = s.snapshot(), hit = q.fit({box: cellBox}).blocker!; hit.coordinate = [9, 9, 9]; hit.energyQ = 0; hit.structure = 0; saved.domains.world.block.packedCells[0] = 0;
    const e = expose(q); e.materials[0].minTemperatureQ = 0; expect(q.fit({box: cellBox}).blocker).toMatchObject({coordinate: [0, 0, 0], structure: 255}); expect(expose(q).materials[0].minTemperatureQ).toBe(70 * 256);
    const before = s.snapshot(); for (let i = 0; i < 8; i++) q.raycast({fromQ: vec(0.5, 0.5, 0.5), toQ: vec(2, 2, 2)}); expect(s.snapshot()).toEqual(before); expect(s.energyBalance().driftQ).toBe(0n);
  });
  test('reactive observations do not acquire the old M5 geometry brand', () => {
    const q = session().queries(); expect(() => assertGameplayGeometry3D(q as never)).toThrow(); expect(() => gameplayGeometrySource3D(q as never)).toThrow();
  });
  test('internal reactive adapter rejects mismatched catalog tick and malformed state before querying', () => {
    const s = session(), state = s.snapshot(), identity = {kind: 'committed' as const, revision: s.revision, domain: null};
    expect(() => createReactiveGeometry3D(r, {...state.domains.world, tick: 1}, identity)).toThrow(/tick/);
    expect(() => createReactiveGeometry3D(r, state.domains.world, {...identity, revision: {...s.revision, materialCatalogHash: 'bad'}})).toThrow(/catalog/);
    const bad = structuredClone(state.domains.world); bad.block.energyQ = []; expect(() => createReactiveGeometry3D(r, bad, identity)).toThrow();
  });
  test('reducers see exact before and after geometry while branch inspection stays at its prior boundary', () => {
    let b: ReactiveBranch3D<Game>; const s = session(initial([place()]), {reduceTick(c) {
      expect(c.beforeQueries().fit({box: cellBox}).fits).toBe(false); expect(c.queries().fit({box: cellBox}).fits).toBe(true);
      expect(c.queries().fit({box: unit}).fits).toBe(false); expect(c.beforeQueries().stamp).toMatchObject({completedTicks: 0});
      expect(c.queries().stamp).toMatchObject({kind: 'preview', completedTicks: 1, tick: 1}); expect(b.queries().stamp.tick).toBe(0); return {...c.game, turn: 1};
    }}); b = s.branch({horizonTicks: 1}); finish(b); expect(b.inspect().state.game.turn).toBe(1);
  });
  test('retained reducer query access keeps its own tick and reservoir boundaries after later ticks and discard', () => {
    const kept: {before: ReactiveSessionQueryAccess3D; after: ReactiveSessionQueryAccess3D}[] = [];
    const s = session(initial([place()], 3, {width: 3, height: 3, depth: 3}, [place()]), {reduceTick(c) {kept.push({before: c.beforeQueries, after: c.queries}); return c.game;}}), b = s.branch({horizonTicks: 2}); finish(b); b.discard();
    expect(kept.map(k => [k.before().stamp.tick, k.after().stamp.tick])).toEqual([[3, 4], [4, 5]]);
    expect(kept[0].before('flask').fit({box: cellBox}).fits).toBe(false); expect(kept[0].after('flask').fit({box: unit}).fits).toBe(false);
    expect(kept[0].after()).toBe(kept[0].after()); expect(kept[1].after().stamp).toMatchObject({completedTicks: 2});
  });
  test('reducer argument mutations cannot alter its query views', () => {
    const s = session(initial([place()]), {reduceTick(c) {c.domains.world.block.packedCells.fill(0); c.report.domains.length = 0; expect(c.queries().fit({box: unit}).fits).toBe(false); return c.game;}});
    const b = s.branch({horizonTicks: 1}); finish(b); s.commit(b); expect(s.queries().fit({box: unit}).fits).toBe(false);
  });
  test('a unit embedded by a falling slab rejects the whole paid heated ability', () => {
    const s = session(initial([place()]), {reduceTick(c) {if (!c.queries().fit({box: unit}).fits) throw Error('Teammate trapped'); return c.game;}}), before = s.snapshot(), b = s.branch({horizonTicks: 1});
    b.enqueue({kind: 'game', game: {ap: 0, turn: 0}}); b.enqueue({kind: 'edit', domain: null, edits: [{kind: 'energy', x: 0, y: 0, z: 0, energyQ: before.domains.world.block.energyQ[0] + 7}]});
    expect(() => finish(b)).toThrow(/Teammate trapped/); expect(s.snapshot()).toEqual(before); expect(b.progress().status).toBe('failed'); expect(s.energyBalance().externalQ).toBe(0n);
  });
  test('invalid reducer queries roll back a complete physical tick and earlier game costs', () => {
    const s = session(initial([place()]), {reduceTick(c) {c.queries('missing'); return c.game;}}), before = s.snapshot(), b = s.branch({horizonTicks: 1}); b.enqueue({kind: 'game', game: {ap: 1, turn: 0}});
    expect(() => finish(b)).toThrow(/reservoir/); expect(s.snapshot()).toEqual(before);
  });
  test('queries report lost support after extraction at the far end of a bonded walkway', () => {
    const edits: ReactiveMaterialEdit3D[] = [place(0, 2, 0), ...Array.from({length: 5}, (_, x) => place(x, 1, 0)), ...Array.from({length: 4}, (_, x) => ({kind: 'bond' as const, x, y: 1, z: 0, direction: 1, bonded: true}))];
    const s = session(initial(edits, 0, {width: 5, height: 3, depth: 1})), b = s.branch({horizonTicks: 1}), far = box([4, 0, 0], [5, 1, 1]);
    expect(s.queries().support({box: far, maxDropQ: 0}).distanceQ).toBe(0); b.enqueue({kind: 'transfer', request: {from: null, to: 'flask', cells: [[0, 2, 0]], offset: [0, -2, 0]}}); finish(b);
    expect(b.queries().support({box: far, maxDropQ: 0}).distanceQ).toBeNull(); expect(b.queries().support({box: far, maxDropQ: S}).distanceQ).toBe(S); expect(s.queries().support({box: far, maxDropQ: 0}).distanceQ).toBe(0);
  });
  test('accounted cooling previews a new supporting ice surface after exact phase evolution', () => {
    const s = session(initial([place(0, 1, 0, MAT.WATER, 40)], 0, {width: 1, height: 2, depth: 1})), b = s.branch({horizonTicks: 1});
    expect(s.queries().support({box: cellBox, maxDropQ: 0}).distanceQ).toBeNull(); b.enqueue({kind: 'edit', domain: null, edits: [{kind: 'energy', x: 0, y: 1, z: 0, energyQ: 0}]}); finish(b);
    expect(b.queries().support({box: cellBox, maxDropQ: 0}).surfaces[0].cell?.material).toBe(MAT.ICE); expect(b.queries().stamp.tick).toBe(1);
    expect(BigInt(b.inspect().state.accounting.externalQ)).toBeLessThan(0n); expect(s.queries().support({box: cellBox, maxDropQ: 0}).distanceQ).toBeNull();
  });
  test('query-driven game results and full physical states continue exactly after an odd-tick JSON restart', () => {
    const input = initial([place()], 3), policy: ReactiveSessionPolicy3D<Game> = {reduceTick(c) {const materialCount = c.queries().exposure({box: box([0, 0, 0], [3, 3, 3])}).materials.length; return {...c.game, turn: c.game.turn + materialCount};}};
    const a = session(input, policy), first = a.branch({horizonTicks: 1}); finish(first); a.commit(first); const b = session(input, policy); b.restore(JSON.parse(JSON.stringify(a.snapshot())));
    for (const current of [a, b]) {const branch = current.branch({horizonTicks: 2}); finish(branch); current.commit(branch);}
    expect(a.snapshot()).toEqual(b.snapshot()); expect(a.queries().exposure({box: cellBox})).toEqual(b.queries().exposure({box: cellBox})); expect(a.energyBalance()).toEqual(b.energyBalance());
  });
  test('query-heavy and unobserved previews produce identical complete physics and accounting', () => {
    const input = initial([place(0, 0, 0, MAT.WATER, 40)]), observed = session(input, {reduceTick(c) {for (const q of [c.beforeQueries(), c.queries(), c.queries('flask')]) {q.fit({box: unit}); q.support({box: cellBox, maxDropQ: S}); q.exposure({box: unit}); q.raycast({fromQ: [0, 0, 0], toQ: [S, S, S]});} return c.game;}}), plainSession = session(input);
    for (const s of [observed, plainSession]) {const b = s.branch({horizonTicks: 2}); finish(b); s.commit(b);} expect(observed.snapshot()).toEqual(plainSession.snapshot());
  });
});
