import { holdPhysics, STRUCTURAL_CALLS } from '../test-support/hold-physics.js';
/** Conservative edit checks only; real M5 ticks and support solves remain held. */
import { describe, expect, test, vi } from 'vitest';
import { createMaterialTransport3D as create, readMaterialTransport3D as read, applyMaterialTransport3D as apply,
  MATERIAL_TRANSPORT_LIMITS_3D as LIMITS, type MaterialTransportState3D, type MaterialParcelSeed3D } from './material-transport.js';
import { CpuStructuralWorld3D, validateStructuralSnapshot3D } from './structural-world-core.js';

import { MAT } from './3d.js';
holdPhysics('solveStructure3D', ...STRUCTURAL_CALLS);
type V = [number, number, number];
const Q = LIMITS.scale;
const volume = (width = 8, height = 8, depth = 8) => new CpuStructuralWorld3D({width, height, depth, chunkSize: 4});
const vector = (axis: number, value: number) => {const v: V = [0, 0, 0]; v[axis] = value; return v;};
const cell = (s: MaterialTransportState3D, p: V) => p[0] + s.terrain.width * (p[1] + s.terrain.height * p[2]);
function single(material: number = MAT.SAND, p: V = [3, 3, 3], velocityQ: V = [0, 0, 0]) {
  const w = volume(); w.setCell(...p, material); if (material === MAT.STONE) w.setIntegrity(...p, 0);
  return create(w.snapshot(), [{id: 'gust', cell: p, velocityQ}]);
}
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const signature = (s: MaterialTransportState3D) => s.terrain.packedCells.map((v, i) => `${v}/${s.terrain.energyQ[i]}/${s.terrain.structure[i]}`).sort();
const total = (s: MaterialTransportState3D) => s.terrain.energyQ.reduce((n, q) => n + BigInt(q), 0n);

describe('saved conservative material transport', () => {
  test('creates a separate portable clock without changing the material tick', () => {
    const w = volume(), terrain = {...w.snapshot(), tick: 17}, state = create(terrain), result = apply(state);
    expect(result.state).toEqual({...state, cycle: 1}); expect(result.receipt).toEqual({rulesVersion: 'material-transport-1', fromCycle: 0, toCycle: 1, materialTick: 17, externalEnergyQ: '0', swaps: [], parcels: [], contacts: [], editedCells: []});
    expect(() => validateStructuralSnapshot3D(state as never)).toThrow(); expect(() => read(terrain)).toThrow();
  });
  test('moves each axis and sign exactly and retains saved velocity', () => {
    for (const axis of [0, 1, 2]) for (const sign of [-1, 1]) {
      const before = single(MAT.SAND, [3, 3, 3], vector(axis, sign * Q)), target: V = [3, 3, 3]; target[axis] += sign;
      const result = apply(before); expect(result.state.parcels[0].cell).toBe(cell(before, target));
      expect(result.state.parcels[0].velocityQ).toEqual(vector(axis, sign * Q)); expect(result.receipt.swaps).toEqual([[cell(before, [3, 3, 3]), cell(before, target)]]);
      expect(result.state.terrain.packedCells[cell(before, target)]).toBe(before.terrain.packedCells[cell(before, [3, 3, 3])]);
    }
  });
  test('supports steam water sand molten materials and completely failed solid debris', () => {
    for (const material of [MAT.STEAM, MAT.WATER, MAT.SAND, MAT.LAVA, MAT.MOLTEN_GLASS, MAT.STONE]) {
      const before = single(material, [3, 3, 3], [Q, 0, 0]), result = apply(before);
      expect(result.receipt.swaps).toHaveLength(1); expect(signature(result.state)).toEqual(signature(before));
      expect(total(result.state)).toBe(total(before)); validateStructuralSnapshot3D(result.state.terrain);
    }
  });
  test('rejects air intact damaged anchored and bonded solids without changing terrain', () => {
    for (const material of [MAT.AIR, MAT.STONE, MAT.ICE, MAT.GLASS]) {
      const w = volume(); w.setCell(3, 3, 3, material); const s = w.snapshot(), before = copy(s);
      expect(() => create(s, [{id: 'no', cell: [3, 3, 3]}])).toThrow(); expect(s).toEqual(before);
    }
    const w = volume(); w.setCell(3, 3, 3, MAT.STONE); w.setCell(4, 3, 3, MAT.STONE); w.setIntegrity(3, 3, 3, 1);
    expect(() => create(w.snapshot(), [{id: 'damaged', cell: [3, 3, 3]}])).toThrow();
    w.setIntegrity(3, 3, 3, 0); w.setAnchor(3, 3, 3, true);
    expect(() => create(w.snapshot(), [{id: 'anchor', cell: [3, 3, 3]}])).toThrow();
  });
  test('accumulates positive and negative fractional travel without premature cell motion', () => {
    for (const sign of [-1, 1]) {
      let s = single(MAT.STEAM, [3, 3, 3], [sign * 256, 0, 0]); const origin = s.parcels[0].cell;
      for (let cycle = 1; cycle <= 4; cycle++) {const r = apply(s); s = r.state; expect(s.parcels[0].cell).toBe(origin + (cycle === 4 ? sign : 0)); expect(s.parcels[0].remainderQ[0]).toBe(cycle === 4 ? 0 : sign * 256 * cycle);}
    }
  });
  test('reversal cancels stored fractional travel exactly', () => {
    const start = single(MAT.STEAM, [3, 3, 3], [600, 0, 0]), a = apply(start).state;
    const b = apply(a, [{id: 'gust', impulseQ: [-1200, 0, 0]}]).state;
    expect(b.parcels[0]).toEqual({...start.parcels[0], velocityQ: [-600, 0, 0]});
    const c = apply(apply(b).state).state; expect(c.parcels[0].cell).toBe(start.parcels[0].cell - 1); expect(c.parcels[0].remainderQ).toEqual([-176, 0, 0]);
  });
  test('applies impulses once then continues with saved momentum', () => {
    let s = single(MAT.WATER, [1, 3, 3]); s = apply(s, [{id: 'gust', impulseQ: [512, 0, 0]}]).state;
    s = apply(s).state; expect(s.parcels[0].cell).toBe(cell(s, [2, 3, 3])); expect(s.parcels[0].velocityQ).toEqual([512, 0, 0]);
    s = apply(apply(s).state).state; expect(s.parcels[0].cell).toBe(cell(s, [3, 3, 3]));
  });
  test('freezes the ordered X Z Y unit path', () => {
    const s = single(MAT.SAND, [3, 3, 3], [Q, -Q, Q]), result = apply(s);
    expect(result.receipt.swaps).toEqual([[cell(s, [3, 3, 3]), cell(s, [4, 3, 3])], [cell(s, [4, 3, 3]), cell(s, [4, 3, 4])], [cell(s, [4, 3, 4]), cell(s, [4, 2, 4])]]);
  });
  test('checks every crossed cell so maximum speed cannot tunnel through a wall', () => {
    for (const axis of [0, 1, 2]) for (const sign of [-1, 1]) {
      const w = volume(), p: V = [3, 3, 3], obstacle = [...p] as V; obstacle[axis] += sign;
      w.setCell(...p, MAT.SAND); w.setCell(...obstacle, MAT.STONE);
      const s = create(w.snapshot(), [{id: 'gust', cell: p, velocityQ: vector(axis, sign * 2 * Q)}]), result = apply(s);
      expect(result.state.terrain).toEqual(s.terrain); expect(result.state.parcels[0].velocityQ).toEqual([0, 0, 0]);
      expect(result.receipt.contacts).toEqual([{id: 'gust', axis, source: cell(s, p), target: cell(s, obstacle), normal: -sign, kind: 'material', parcelId: null}]);
    }
  });
  test('partial travel before a wall is retained with no normal residual debt', () => {
    const w = volume(); w.setCell(1, 3, 3, MAT.WATER); w.setCell(3, 3, 3, MAT.STONE);
    const s = create(w.snapshot(), [{id: 'gust', cell: [1, 3, 3], velocityQ: [2 * Q, 0, 0]}]); s.parcels[0].remainderQ[0] = 127;
    const result = apply(s); expect(result.receipt.swaps).toHaveLength(1); expect(result.state.parcels[0]).toMatchObject({cell: cell(s, [2, 3, 3]), velocityQ: [0, 0, 0], remainderQ: [0, 0, 0]});
  });
  test('blocked normal movement preserves tangential movement', () => {
    const w = volume(); w.setCell(3, 3, 3, MAT.STEAM); w.setCell(4, 3, 3, MAT.STONE);
    const s = create(w.snapshot(), [{id: 'gust', cell: [3, 3, 3], velocityQ: [Q, 0, Q]}]), r = apply(s);
    expect(r.state.parcels[0].cell).toBe(cell(s, [3, 3, 4])); expect(r.state.parcels[0].velocityQ).toEqual([0, 0, Q]);
  });
  test('rectangular and minimum complete-chunk boundaries block on all axes and signs', () => {
    for (const shape of [[4, 8, 12], [4, 4, 4]]) for (const axis of [0, 1, 2]) for (const sign of [-1, 1]) {
      const w = volume(...shape as V), p: V = [0, 0, 0]; p[axis] = sign > 0 ? shape[axis] - 1 : 0; w.setCell(...p, MAT.STEAM);
      const s = create(w.snapshot(), [{id: 'gust', cell: p, velocityQ: vector(axis, sign * Q)}]), r = apply(s);
      expect(r.state.terrain).toEqual(s.terrain); expect(r.receipt.contacts[0]).toMatchObject({kind: 'boundary', target: null, axis, normal: -sign});
    }
  });
  test('rejects odd and single-cell domains outside the existing M5 geometry contract', () => {
    const original = volume().snapshot();
    for (const [width, height, depth] of [[5, 3, 7], [1, 1, 1]]) {
      const size = width * height * depth;
      expect(() => create({...original, width, height, depth, packedCells: original.packedCells.slice(0, size), energyQ: original.energyQ.slice(0, size), structure: original.structure.slice(0, size)})).toThrow(/complete chunks/);
    }
  });
  test('unselected gas returns to the source with its exact thermal history', () => {
    const w = volume(); w.setCell(3, 3, 3, MAT.WATER, 55); w.setCell(4, 3, 3, MAT.STEAM, 190);
    const s = create(w.snapshot(), [{id: 'gust', cell: [3, 3, 3], velocityQ: [Q, 0, 0]}]), r = apply(s), a = cell(s, [3, 3, 3]), b = a + 1;
    for (const key of ['packedCells', 'energyQ', 'structure'] as const) {expect(r.state.terrain[key][a]).toBe(s.terrain[key][b]); expect(r.state.terrain[key][b]).toBe(s.terrain[key][a]);}
    expect(total(r.state)).toBe(total(s)); expect(r.receipt.externalEnergyQ).toBe('0');
  });
  test('liquid powder and loose debris targets block rather than being erased or pushed', () => {
    for (const material of [MAT.WATER, MAT.SAND, MAT.STONE]) {
      const w = volume(); w.setCell(3, 3, 3, MAT.STEAM); w.setCell(4, 3, 3, material); if (material === MAT.STONE) w.setIntegrity(4, 3, 3, 0);
      const s = create(w.snapshot(), [{id: 'gust', cell: [3, 3, 3], velocityQ: [Q, 0, 0]}]), r = apply(s);
      expect(r.state.terrain).toEqual(s.terrain); expect(r.receipt.contacts[0].kind).toBe('material');
    }
  });
  test('tracked gas blocks a peer and two head-on parcels do not exchange positions', () => {
    const w = volume(); w.setCell(3, 3, 3, MAT.STEAM); w.setCell(4, 3, 3, MAT.STEAM);
    const s = create(w.snapshot(), [{id: 'a', cell: [3, 3, 3], velocityQ: [Q, 0, 0]}, {id: 'b', cell: [4, 3, 3], velocityQ: [-Q, 0, 0]}]), r = apply(s);
    expect(r.receipt.swaps).toEqual([]); expect(r.receipt.contacts.map(c => c.parcelId)).toEqual(['b', 'a']); expect(r.state.parcels.map(p => p.velocityQ)).toEqual([[0, 0, 0], [0, 0, 0]]);
  });
  test('ASCII priority is independent of seed and impulse input order', () => {
    const w = volume(); w.setCell(2, 3, 3, MAT.SAND); w.setCell(4, 3, 3, MAT.STEAM);
    const seeds: MaterialParcelSeed3D[] = [{id: 'b', cell: [4, 3, 3]}, {id: 'A', cell: [2, 3, 3]}], impulses = [{id: 'b', impulseQ: [-Q, 0, 0] as V}, {id: 'A', impulseQ: [Q, 0, 0] as V}];
    const r = apply(create(w.snapshot(), seeds), impulses);
    expect(r).toEqual(apply(create(w.snapshot(), seeds.slice().reverse()), impulses.slice().reverse()));
    expect(r.state.parcels.map(p => [p.id, p.cell])).toEqual([['A', cell(r.state, [3, 3, 3])], ['b', cell(r.state, [4, 3, 3])]]);
  });
  test('a later parcel can enter a cell vacated by an earlier parcel', () => {
    const w = volume(); w.setCell(2, 3, 3, MAT.SAND); w.setCell(3, 3, 3, MAT.SAND);
    const s = create(w.snapshot(), [{id: 'a', cell: [3, 3, 3], velocityQ: [Q, 0, 0]}, {id: 'b', cell: [2, 3, 3], velocityQ: [Q, 0, 0]}]), r = apply(s);
    expect(r.receipt.swaps).toHaveLength(2); expect(r.receipt.contacts).toEqual([]); expect(signature(r.state)).toEqual(signature(s));
  });
  test('identical gas swaps still report physical provenance with zero edited cells', () => {
    const w = volume(); w.setCell(3, 3, 3, MAT.STEAM); w.setCell(4, 3, 3, MAT.STEAM);
    const s = create(w.snapshot(), [{id: 'gust', cell: [3, 3, 3], velocityQ: [Q, 0, 0]}]), r = apply(s);
    expect(r.receipt.swaps).toHaveLength(1); expect(r.receipt.editedCells).toEqual([]); expect(r.state.terrain).toEqual(s.terrain); expect(r.state.parcels[0].cell).not.toBe(s.parcels[0].cell);
  });
  test('ordered receipts reconstruct every coordinate and exact edit coverage', () => {
    const s = single(MAT.SAND, [2, 2, 2], [2 * Q, Q, -Q]), r = apply(s), reconstructed = copy(s.terrain);
    for (const [a, b] of r.receipt.swaps) for (const key of ['packedCells', 'energyQ', 'structure'] as const) [reconstructed[key][a], reconstructed[key][b]] = [reconstructed[key][b], reconstructed[key][a]];
    expect(reconstructed).toEqual(r.state.terrain);
    const edited = s.terrain.packedCells.flatMap((_, i) => ['packedCells', 'energyQ', 'structure'].some(k => s.terrain[k as 'packedCells'][i] !== r.state.terrain[k as 'packedCells'][i]) ? [i] : []);
    expect(r.receipt.editedCells).toEqual(edited); expect(signature(s)).toEqual(signature(r.state));
  });
  test('JSON continuation retains exact fractional motion and complete terrain state', () => {
    let a = single(MAT.STEAM, [2, 2, 2], [333, -111, 129]); a = apply(a).state;
    let b = read(copy(a));
    for (let n = 0; n < 13; n++) {const x = apply(a), y = apply(b); expect(x).toEqual(y); a = x.state; b = read(copy(y.state));}
  });
  test('independent runs produce identical complete states and receipts', () => {
    const run = () => {let s = single(MAT.WATER, [2, 2, 2]); const receipts = []; for (let n = 0; n < 12; n++) {const r = apply(s, n === 0 ? [{id: 'gust', impulseQ: [301, 173, -57]}] : []); s = r.state; receipts.push(r.receipt);} return {s, receipts};};
    expect(run()).toEqual(run());
  });
  test('all public reads and results own their nested storage', () => {
    const w = volume(); w.setCell(3, 3, 3, MAT.SAND); const terrain = w.snapshot(), seeds: MaterialParcelSeed3D[] = [{id: 'a', cell: [3, 3, 3], velocityQ: [Q, 0, 0]}], s = create(terrain, seeds), before = copy(s);
    terrain.energyQ.fill(0); seeds[0].id = 'changed'; expect(s).toEqual(before);
    const owned = read(s); owned.terrain.energyQ.fill(0); owned.parcels[0].velocityQ[0] = 0; expect(s).toEqual(before);
    const result = apply(s); result.state.terrain.energyQ.fill(0); result.state.parcels[0].velocityQ[0] = 0; result.receipt.parcels[0].id = 'different'; expect(s).toEqual(before);
  });
  test('late invalid impulse and speed overflow leave all input state untouched', () => {
    const s = single(MAT.SAND, [3, 3, 3], [Q, 0, 0]), before = copy(s);
    for (const impulses of [[{id: 'gust', impulseQ: [Q, 0, 0] as V}, {id: 'missing', impulseQ: [0, 0, 0] as V}], [{id: 'gust', impulseQ: [Q + 1, 0, 0] as V}], [{id: 'gust', impulseQ: [0, 0, 0] as V}, {id: 'gust', impulseQ: [0, 0, 0] as V}]]) {
      expect(() => apply(s, impulses)).toThrow(); expect(s).toEqual(before);
    }
  });
  test('invalid identities duplicate cells and excessive parcel or impulse arrays reject', () => {
    const w = volume(); w.setCell(3, 3, 3, MAT.SAND); const seed: MaterialParcelSeed3D = {id: 'a', cell: [3, 3, 3]};
    for (const seeds of [[seed, seed], [seed, {...seed, id: 'b'}], [{...seed, id: 'bad id'}], [{...seed, cell: [8, 0, 0] as V}], Array(257).fill(seed)]) expect(() => create(w.snapshot(), seeds)).toThrow();
    expect(() => apply(single(), Array(257).fill({id: 'gust', impulseQ: [0, 0, 0]}))).toThrow();
  });
  test('incompatible malformed and noncanonical saved state rejects atomically', () => {
    const s = single(), before = copy(s);
    const corruptions = [ (v: MaterialTransportState3D) => {v.schemaVersion = 2 as 1;}, (v: MaterialTransportState3D) => {v.rulesVersion = 'other' as never;},
      (v: MaterialTransportState3D) => {v.cycle = -1;}, (v: MaterialTransportState3D) => {v.parcels[0].remainderQ[0] = Q;},
      (v: MaterialTransportState3D) => {v.parcels[0].velocityQ[0] = 2 * Q + 1;}, (v: MaterialTransportState3D) => {v.parcels[0].cell = 0;},
      (v: MaterialTransportState3D) => {v.parcels.push(copy(v.parcels[0]));}, (v: MaterialTransportState3D) => {v.terrain.structure[0] = 255;},
      (v: MaterialTransportState3D) => {v.terrain.energyQ.pop();}, (v: MaterialTransportState3D) => {v.terrain.rulesVersion = 'other';} ];
    for (const change of corruptions) {const bad = copy(s); change(bad); expect(() => read(bad)).toThrow(); expect(s).toEqual(before);}
  });
  test('cycle overflow rejects before terrain or momentum changes', () => {
    const s = {...single(), cycle: Number.MAX_SAFE_INTEGER}, before = copy(s);
    expect(() => apply(s, [{id: 'gust', impulseQ: [Q, 0, 0]}])).toThrow(); expect(s).toEqual(before);
  });
  test('sparse arrays extra properties symbols and accessors reject without invoking getters', () => {
    const s = single(), getter = vi.fn(() => 0), mutations: ((v: MaterialTransportState3D) => void)[] = [
      v => {delete (v.parcels as unknown[])[0];}, v => {delete (v.parcels[0].velocityQ as unknown[])[0];},
      v => {Object.defineProperty(v, 'cycle', {get: getter, enumerable: true});}, v => {Object.defineProperty(v.terrain.energyQ, '0', {get: getter, enumerable: true});},
      v => {Object.assign(v.parcels, {extra: 1});}, v => {Object.defineProperty(v, Symbol('hidden'), {value: 1});},
      v => {Object.defineProperty(v.parcels[0], 'cell', {value: v.parcels[0].cell, enumerable: false});},
    ];
    for (const mutate of mutations) {const bad = copy(s); mutate(bad); expect(() => read(bad)).toThrow();} expect(getter).not.toHaveBeenCalled();
    const command = {id: 'gust', impulseQ: [0, 0, 0]}; Object.defineProperty(command, 'impulseQ', {get: getter, enumerable: true}); expect(() => apply(s, [command as never])).toThrow(); expect(getter).not.toHaveBeenCalled();
  });
  test('fractional nonfinite and out-of-range scalar values reject', () => {
    for (const bad of [NaN, Infinity, -Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      const s = single(); s.parcels[0].velocityQ[0] = bad; expect(() => read(s)).toThrow();
      expect(() => apply(single(), [{id: 'gust', impulseQ: [bad, 0, 0]}])).toThrow();
    }
  });
  test('normalizes negative zero in saved and resulting control coordinates', () => {
    const s = single(MAT.SAND, [3, 3, 3], [-0, 0, 0]); s.cycle = -0; s.parcels[0].remainderQ = [-0, -0, -0];
    const owned = read(s), r = apply(owned); expect(Object.is(owned.cycle, -0)).toBe(false);
    expect([...r.state.parcels[0].velocityQ, ...r.state.parcels[0].remainderQ].some(v => Object.is(v, -0))).toBe(false);
  });
});
