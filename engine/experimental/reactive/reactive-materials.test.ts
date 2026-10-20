import { holdPhysics, STRUCTURAL_CALLS } from '../../test-support/hold-physics.js';
/** Data/edits only; any material step or support solve fails this suite. */
import { beforeAll, describe, expect, test } from 'vitest';

import { CpuStructuralWorld3D, type StructuralSnapshot3D } from '../structural-world-core.js';
import { createReactiveMaterialRegistry3D, createReactiveMaterialBlock3D as create, readReactiveMaterialBlock3D as read,
  editReactiveMaterialBlock3D as edit, reactiveMaterialEnergyLedger3D as ledger, MAT, PHASE, ENERGY_SCALE,
  INTEGRITY_3D, ANCHOR_3D, BONDS_3D, MAX_ENERGY_Q, type ReactiveMaterialRegistry3D, type ReactiveMaterialEdit3D } from '../reactive-materials.js';
holdPhysics('solveStructure3D', ...STRUCTURAL_CALLS);
let registry: ReactiveMaterialRegistry3D;
beforeAll(async () => {registry = await createReactiveMaterialRegistry3D();});
const dimensions = {width: 3, height: 1, depth: 1}, at = {x: 0, y: 0, z: 0};
function joined() {return edit(registry, create(registry, dimensions, MAT.WOOD), [
  {...at, kind: 'bond', direction: 1, bonded: true}, {...at, kind: 'integrity', integrity: 73}, {...at, kind: 'anchor', anchored: true},
]).block;}

describe('reactive material blocks and atomic edits', () => {
  test('odd rectangular volumes preserve x then y then z indexing', () => {
    const b = create(registry, {width: 3, height: 5, depth: 7});
    const r = edit(registry, b, [{kind: 'place', x: 2, y: 3, z: 4, material: MAT.WOOD}]);
    expect(r.block.packedCells).toHaveLength(105); expect(r.receipt.changedCells).toEqual([71]);
    expect(r.block.packedCells[71] & 255).toBe(MAT.WOOD); expect(b.packedCells[71] & 255).toBe(MAT.AIR);
  });
  test('singleton and long single-cell axes are supported', () => {
    for (const s of [{width: 1, height: 1, depth: 1}, {width: 128, height: 1, depth: 1}, {width: 1, height: 1, depth: 9}]) {
      const b = create(registry, s, MAT.SMOKE); expect(read(registry, b)).toEqual(b);
    }
  });
  test('dimension, volume and extra-field limits reject before constructing a block', () => {
    for (const s of [{width: 0, height: 1, depth: 1}, {width: 129, height: 1, depth: 1}, {width: 33, height: 32, depth: 32},
      {width: 1.5, height: 1, depth: 1}, {width: 1, height: NaN, depth: 1}, {...dimensions, extra: 1}]) expect(() => create(registry, s)).toThrow();
  });
  test('solid construction has fresh integrity without bonds or anchors', () => {
    const b = create(registry, dimensions, MAT.WOOD); expect(b.structure).toEqual([255, 255, 255]);
    for (const id of [MAT.SAND, MAT.WATER, MAT.STEAM, MAT.LAVA, MAT.FIRE, MAT.SMOKE]) expect(create(registry, dimensions, id).structure).toEqual([0, 0, 0]);
    expect(create(registry, dimensions, MAT.ICE).structure).toEqual([255, 255, 255]);
  });
  test('custom cohesion governs structural eligibility rather than the builtin table', async () => {
    const r = await registry.extend([{...structuredClone(registry.material(MAT.WOOD)), id: 200, name: 'resin'},
      {...structuredClone(registry.material(MAT.ASH)), id: 201, name: 'soft_solid', properties: {...registry.material(MAT.ASH).properties, default_phase: PHASE.SOLID, cohesion: 0}}]);
    expect(create(r, dimensions, 200).structure).toEqual([255, 255, 255]); expect(create(r, dimensions, 201).structure).toEqual([0, 0, 0]);
  });
  test('fuel placement accounts for chemical and thermal external energy exactly', () => {
    const b = create(registry, dimensions), r = edit(registry, b, [{...at, kind: 'place', material: MAT.WOOD, thermal: 25}]);
    expect(r.block.energyQ[0]).toBe((80 + 25) * ENERGY_SCALE);
    expect(ledger(registry, r.block).chemicalQ).toBe(80n * 256n);
    expect(BigInt(r.receipt.externalEnergyQ)).toBe(ledger(registry, r.block).totalQ - ledger(registry, b).totalQ);
  });
  test('removing fuel debits its complete conserved energy', () => {
    const b = create(registry, dimensions, MAT.WOOD), r = edit(registry, b, [{...at, kind: 'place', material: MAT.AIR}]);
    expect(BigInt(r.receipt.externalEnergyQ)).toBe(BigInt(r.block.energyQ[0]) - BigInt(b.energyQ[0])); expect(BigInt(r.receipt.externalEnergyQ)).toBeLessThan(0n);
  });
  test('thermal edits preserve damage, anchors, bonds and chemical fuel', () => {
    const b = joined(), r = edit(registry, b, [{...at, kind: 'energy', energyQ: b.energyQ[0] + 256}]);
    expect(r.block.structure).toEqual(b.structure); expect(r.block.packedCells[0] & 255).toBe(MAT.WOOD);
    expect(ledger(registry, r.block).chemicalQ).toBe(ledger(registry, b).chemicalQ); expect(r.receipt.externalEnergyQ).toBe('256');
  });
  test('thermal edits cannot consume chemical energy even after other valid commands', () => {
    const b = joined(), saved = structuredClone(b);
    expect(() => edit(registry, b, [{...at, kind: 'integrity', integrity: 1}, {...at, kind: 'energy', energyQ: 80 * 256 - 1}])).toThrow(/chemical/);
    expect(b).toEqual(saved);
  });
  test('chemical floor and maximum energy remain valid without silently transforming material', () => {
    const b = joined();
    for (const energyQ of [80 * 256, MAX_ENERGY_Q]) {
      const r = edit(registry, b, [{...at, kind: 'energy', energyQ}]); expect(read(registry, r.block)).toEqual(r.block);
      expect(r.block.packedCells[0] & 255).toBe(MAT.WOOD); expect(r.block.structure).toEqual(b.structure);
    }
  });
  test('explicit join and cut update both cells and report the actual neighbor reach', () => {
    const b = create(registry, dimensions, MAT.WOOD), r = edit(registry, b, [{...at, kind: 'bond', direction: 1, bonded: true}]);
    expect(r.receipt.changedCells).toEqual([0, 1]); expect(r.block.structure[0]).toBe(255 | BONDS_3D[1]); expect(r.block.structure[1]).toBe(255 | BONDS_3D[0]);
    const cut = edit(registry, r.block, [{...at, kind: 'bond', direction: 1, bonded: false}]); expect(cut.block).toEqual(b); expect(cut.receipt.externalEnergyQ).toBe('0');
  });
  test('bonds use all three coordinate axes and reject closed boundaries', () => {
    const b = create(registry, {width: 3, height: 3, depth: 3}, MAT.STONE), center = {x: 1, y: 1, z: 1};
    for (let dir = 0; dir < 6; dir++) {
      const r = edit(registry, b, [{...center, kind: 'bond', direction: dir, bonded: true}]); expect(read(registry, r.block)).toEqual(r.block);
      expect(r.receipt.changedCells).toEqual([13, [12, 14, 10, 16, 4, 22][dir]].sort((a, b) => a - b));
    }
    for (const direction of [0, 2, 4]) expect(() => edit(registry, b, [{...at, kind: 'bond', direction, bonded: true}])).toThrow(/boundary/);
  });
  test('replacement clears reciprocal old bonds and never welds into neighboring terrain', () => {
    const b = joined(), r = edit(registry, b, [{...at, kind: 'place', material: MAT.STONE}]);
    expect(r.block.structure).toEqual([255, 255, 255]); expect(r.receipt.changedCells).toEqual([0, 1]); expect(b.structure[1] & BONDS_3D[0]).not.toBe(0);
  });
  test('zero integrity clears both bond endpoints while retaining explicit anchor state', () => {
    const r = edit(registry, joined(), [{...at, kind: 'integrity', integrity: 0}]); expect(r.block.structure).toEqual([ANCHOR_3D, 255, 255]);
    expect(r.receipt.changedCells).toEqual([0, 1]); expect(read(registry, r.block)).toEqual(r.block);
  });
  test('repairs restore integrity without manufacturing bonds', () => {
    const damaged = edit(registry, joined(), [{...at, kind: 'integrity', integrity: 0}]).block;
    const repaired = edit(registry, damaged, [{...at, kind: 'integrity', integrity: INTEGRITY_3D}]); expect(repaired.block.structure).toEqual([255 | ANCHOR_3D, 255, 255]);
  });
  test('joins require both endpoints intact and structurally eligible', () => {
    for (const change of [{...at, x: 1, kind: 'integrity', integrity: 0}, {...at, x: 1, kind: 'place', material: MAT.WATER}] as ReactiveMaterialEdit3D[]) {
      const b = edit(registry, create(registry, dimensions, MAT.WOOD), [change]).block;
      expect(() => edit(registry, b, [{...at, kind: 'bond', direction: 1, bonded: true}])).toThrow(/intact/);
    }
  });
  test('nonstructural material rejects integrity, anchor and bond edits atomically', () => {
    const b = create(registry, dimensions, MAT.WATER), saved = structuredClone(b);
    for (const row of [{...at, kind: 'integrity', integrity: 20}, {...at, kind: 'anchor', anchored: true}, {...at, kind: 'bond', direction: 1, bonded: false}] as ReactiveMaterialEdit3D[])
      expect(() => edit(registry, b, [row])).toThrow(/eligible/);
    expect(b).toEqual(saved);
  });
  test('ordered edits charge the net external change and report canonical unique indices', () => {
    const b = create(registry, dimensions), r = edit(registry, b, [{...at, x: 2, kind: 'place', material: MAT.WOOD},
      {...at, kind: 'place', material: MAT.WOOD}, {...at, kind: 'energy', energyQ: 81 * 256}, {...at, x: 2, kind: 'integrity', integrity: 3}]);
    expect(r.receipt.changedCells).toEqual([0, 2]); expect(BigInt(r.receipt.externalEnergyQ)).toBe(ledger(registry, r.block).totalQ - ledger(registry, b).totalQ);
  });
  test('empty and no-op edits still return isolated coordinates and zero receipts', () => {
    const b = joined(); for (const edits of [[], [{...at, kind: 'energy', energyQ: b.energyQ[0]}] as ReactiveMaterialEdit3D[]]) {
      const r = edit(registry, b, edits); expect(r.block).toEqual(b); expect(r.block.packedCells).not.toBe(b.packedCells); expect(r.receipt.changedCells).toEqual([]); expect(r.receipt.externalEnergyQ).toBe('0');
    }
  });
  test('JSON continuation preserves full damage, thermal and bond history', () => {
    const b = joined(), edits: ReactiveMaterialEdit3D[] = [{...at, kind: 'energy', energyQ: b.energyQ[0] + 777}, {...at, kind: 'anchor', anchored: false}];
    expect(edit(registry, read(registry, JSON.parse(JSON.stringify(b))), edits)).toEqual(edit(registry, b, edits));
  });
  test('reads return isolated arrays and cannot alter saved material history', () => {
    const b = joined(), saved = structuredClone(b), copied = read(registry, b); copied.packedCells.fill(0); copied.energyQ.fill(0); copied.structure.fill(0); expect(b).toEqual(saved);
  });
  test('wrong schemas, rules, identities and coordinate lengths reject untouched input', () => {
    const b = joined(); for (const patch of [{schemaVersion: 2}, {rulesVersion: 'ca-3d-m5'}, {materialCatalogHash: registry.sourceCatalogHash}, {packedCells: []}, {structure: []}, {energyQ: []}]) {
      const bad = {...b, ...patch}, saved = structuredClone(bad); expect(() => read(registry, bad)).toThrow(); expect(bad).toEqual(saved);
    }
  });
  test('another validated catalog cannot read the original block', async () => {
    const r = await registry.extend([{...structuredClone(registry.material(MAT.WOOD)), id: 200, name: 'resin'}]); expect(() => read(r, joined())).toThrow(/Incompatible/);
  });
  test('packed flags, velocity, wrong phase and inactive materials are rejected', () => {
    const b = joined(); for (const word of [b.packedCells[0] | (1 << 16), b.packedCells[0] | (1 << 28), b.packedCells[0] | (PHASE.GAS << 24),
      (b.packedCells[0] & ~255) | MAT.PLAYER, -1, 2 ** 32, 1.5]) {
      const bad = structuredClone(b); bad.packedCells[0] = word; expect(() => read(registry, bad)).toThrow();
    }
  });
  test('energy bounds, fuel floor and mismatched thermal views are rejected', () => {
    const b = joined(); for (const q of [-1, MAX_ENERGY_Q + 1, 80 * 256 - 1, b.energyQ[0] + 256, 1.5]) {
      const bad = structuredClone(b); bad.energyQ[0] = q; expect(() => read(registry, bad)).toThrow();
    }
  });
  test('ineligible, reserved, nonreciprocal and boundary structural words are rejected', () => {
    const b = joined(); for (const word of [0x8000, 0x10000, 255 | BONDS_3D[0], BONDS_3D[1], 255]) {
      const bad = structuredClone(b); bad.structure[0] = word; expect(() => read(registry, bad)).toThrow();
    }
    const air = create(registry, dimensions); air.structure[0] = 255; expect(() => read(registry, air)).toThrow();
  });
  test('late invalid commands cannot publish earlier placement or energy edits', () => {
    const b = joined(), saved = structuredClone(b);
    expect(() => edit(registry, b, [{...at, kind: 'place', material: MAT.WATER}, {...at, kind: 'anchor', anchored: true}])).toThrow();
    expect(b).toEqual(saved);
  });
  test('invalid edits reject unknown tags, fields, coordinates and nonportable optional values', () => {
    const b = joined(); for (const row of [{...at, kind: 'other'}, {...at, kind: 'energy', energyQ: NaN}, {...at, kind: 'energy', energyQ: MAX_ENERGY_Q + 1},
      {...at, kind: 'energy', energyQ: 123, extra: 1}, {...at, x: 3, kind: 'anchor', anchored: true}, {...at, kind: 'anchor', anchored: 1},
      {...at, kind: 'place', material: MAT.PLAYER}, {...at, kind: 'place', material: MAT.WOOD, thermal: undefined}, {...at, kind: 'place', material: MAT.WOOD, thermal: null},
      {...at, kind: 'bond', direction: 6, bonded: true}, {...at, kind: 'integrity', integrity: 256}]) expect(() => edit(registry, b, [row] as unknown as ReactiveMaterialEdit3D[])).toThrow();
  });
  test('accessor commands and coordinate reads fail without executing getters', () => {
    let calls = 0; const b = joined(), row = {...at, kind: 'place', material: MAT.WOOD};
    Object.defineProperty(row, 'material', {get() {calls++; return MAT.WOOD;}, enumerable: true}); expect(() => edit(registry, b, [row] as ReactiveMaterialEdit3D[])).toThrow();
    Object.defineProperty(b.packedCells, '0', {get() {calls++; return 0;}, enumerable: true}); expect(() => read(registry, b)).toThrow(); expect(calls).toBe(0);
  });
  test('null, sparse, decorated, oversized and typed-array edits are rejected', () => {
    const rows: unknown[] = []; Object.assign(rows, {extra: 1});
    for (const value of [null, new Array(1), new Array(4097), rows, new Uint32Array(0)]) expect(() => edit(registry, joined(), value as ReactiveMaterialEdit3D[])).toThrow();
  });
  test('the block is not silently accepted as an M5 world snapshot', () => {
    const world = new CpuStructuralWorld3D({width: 4, height: 4, depth: 4, chunkSize: 4}), before = world.snapshot();
    expect(() => world.restore(create(registry, {width: 4, height: 4, depth: 4}, MAT.WOOD) as unknown as StructuralSnapshot3D)).toThrow(); expect(world.snapshot()).toEqual(before);
    expect(() => read(registry, before)).toThrow();
  });
});
