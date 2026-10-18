import { describe, expect, test } from 'vitest';
import { createStateSpaceStructuralWorld3D, type StructuralSnapshot3D } from './structural-world-core.js';
import { MAT, ENERGY_SCALE } from './3d.js';
import { ANCHOR_3D, BONDS_3D, FRESH_3D } from './structural-mechanics.js';
import { INTERVENTION_RULES_VERSION_3D, translateStructuralRegion3D as translate, type CellCoordinate3D, type TranslationRequest3D } from './interventions.js';

const world = () => createStateSpaceStructuralWorld3D({width: 8, height: 8, depth: 8, chunkSize: 4});
const index = (c: CellCoordinate3D) => c[0] + 8 * (c[1] + 8 * c[2]);
const tuples = (s: StructuralSnapshot3D) => s.packedCells.map((v, i) => `${v}:${s.energyQ[i]}`).sort();
const energy = (s: StructuralSnapshot3D) => s.energyQ.reduce((sum, q) => sum + BigInt(q), 0n);
const changed = (a: StructuralSnapshot3D, b: StructuralSnapshot3D) => a.packedCells.flatMap((v, i) =>
  v !== b.packedCells[i] || a.energyQ[i] !== b.energyQ[i] || a.structure[i] !== b.structure[i] ? [i] : []);
const baseRequest: TranslationRequest3D = {cells: [[3, 3, 3]], path: [[1, 0, 0]]};

function conserved(before: StructuralSnapshot3D, result: ReturnType<typeof translate>) {
  expect(tuples(result.snapshot)).toEqual(tuples(before));
  expect(energy(result.snapshot)).toBe(energy(before));
  expect(result.receipt.externalEnergyQ).toBe(0n);
  expect(result.snapshot.tick).toBe(before.tick);
  expect(result.receipt.editedCells).toEqual(Uint32Array.from(changed(before, result.snapshot)));
}

describe('conservative translation: CPU edit-only fixtures, zero simulation ticks', () => {
  test('hot damaged slab keeps exact coordinates, internal bonds and displaced hot air', () => {
    const w = world();
    w.setCell(2, 2, 2, MAT.STONE, 160); w.setCell(3, 2, 2, MAT.STONE, 170);
    w.setIntegrity(2, 2, 2, 93); w.setIntegrity(3, 2, 2, 157);
    w.setEnergy(3, 2, 2, w.sample(3, 2, 2).energyQ + 1);
    w.setEnergy(2, 3, 2, 75 * ENERGY_SCALE);
    const before = w.snapshot(); before.tick = 17;
    const result = translate(before, {cells: [[2, 2, 2], [3, 2, 2]], path: [[0, 1, 0]]});
    for (const x of [2, 3]) {
      const source = index([x, 2, 2]), destination = index([x, 3, 2]);
      for (const key of ['packedCells', 'energyQ', 'structure'] as const) expect(result.snapshot[key][destination]).toBe(before[key][source]);
      expect(result.snapshot.energyQ[source]).toBe(before.energyQ[destination]);
    }
    expect(result.receipt.rulesVersion).toBe(INTERVENTION_RULES_VERSION_3D);
    expect(result.receipt.tick).toBe(17); conserved(before, result);
  });

  test.each([[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]] as CellCoordinate3D[])(
    'overlapping run preserves all coordinates along direction (%i,%i,%i)', (dx, dy, dz) => {
      const step: CellCoordinate3D = [dx, dy, dz], axis = step.findIndex(n => n !== 0);
      const a: [number, number, number] = [3, 3, 3], b: [number, number, number] = [3, 3, 3]; b[axis]++;
      const w = world(); w.setCell(...a, MAT.STONE, 100); w.setCell(...b, MAT.GLASS, 120);
      w.setIntegrity(...a, 71); w.setIntegrity(...b, 129);
      const terminal = (step[axis] < 0 ? a : b).map((n, k) => n + step[k]) as [number, number, number];
      w.setEnergy(...terminal, 91 * ENERGY_SCALE);
      const before = w.snapshot(), result = translate(before, {cells: [b, a], path: [step]});
      for (const cell of [a, b]) {
        const dest = cell.map((n, k) => n + step[k]) as [number, number, number];
        for (const key of ['packedCells', 'energyQ', 'structure'] as const) expect(result.snapshot[key][index(dest)]).toBe(before[key][index(cell)]);
      }
      const head = step[axis] > 0 ? a : b;
      expect(result.snapshot.energyQ[index(head)]).toBe(before.energyQ[index(terminal)]);
      conserved(before, result);
    });

  test('contact with an intact destination neighbor does not weld', () => {
    const w = world(); w.setCell(3, 2, 3, MAT.STONE); w.setCell(4, 3, 3, MAT.STONE);
    const before = w.snapshot(), result = translate(before, {cells: [[3, 2, 3]], path: [[0, 1, 0]]});
    expect(result.snapshot.structure[index([3, 3, 3])] & BONDS_3D[1]).toBe(0);
    expect(result.snapshot.structure[index([4, 3, 3])] & BONDS_3D[0]).toBe(0);
    conserved(before, result);
  });

  test('external bonds reject by default and explicit cuts update both endpoints without healing', () => {
    const w = world(); for (const x of [2, 3, 4]) {w.setCell(x, 3, 3, MAT.STONE); w.setIntegrity(x, 3, 3, 82);}
    const before = w.snapshot(), saved = structuredClone(before), request: TranslationRequest3D = {cells: [[3, 3, 3]], path: [[0, -1, 0]]};
    expect(() => translate(before, request)).toThrow(/external bonds/); expect(before).toEqual(saved);
    const result = translate(before, {...request, externalBonds: 'cut'});
    expect(result.receipt.cutBonds).toEqual([[index([2, 3, 3]), index([3, 3, 3])], [index([3, 3, 3]), index([4, 3, 3])]]);
    for (const cell of [[2, 3, 3], [3, 2, 3], [4, 3, 3]] as CellCoordinate3D[]) expect(result.snapshot.structure[index(cell)]).toBe(82);
    expect(result.receipt.editedCells).toContain(index([2, 3, 3])); expect(result.receipt.editedCells).toContain(index([4, 3, 3]));
    conserved(before, result); expect(before).toEqual(saved);
  });

  test('pins require explicit release and are not carried into the destination', () => {
    const w = world(); w.setCell(3, 3, 3, MAT.STONE); w.setIntegrity(3, 3, 3, 41); w.setAnchor(3, 3, 3, true);
    const before = w.snapshot();
    expect(() => translate(before, baseRequest)).toThrow(/anchors/);
    const result = translate(before, {...baseRequest, anchors: 'release'});
    expect(result.snapshot.structure[index([4, 3, 3])]).toBe(41);
    expect(result.receipt.releasedAnchors).toEqual(Uint32Array.of(index([3, 3, 3])));
    expect(before.structure[index([3, 3, 3])]).toBe(41 | ANCHOR_3D); conserved(before, result);
  });

  test('mobile water displacement is explicit and conservative through successive steps', () => {
    const w = world(); w.setCell(3, 3, 3, MAT.STONE, 80);
    w.setCell(4, 3, 3, MAT.WATER, 60); w.setCell(5, 3, 3, MAT.WATER, 20);
    const before = w.snapshot(), request: TranslationRequest3D = {...baseRequest, path: [[1, 0, 0], [1, 0, 0]]};
    expect(() => translate(before, request)).toThrow(/obstructed/);
    const result = translate(before, {...request, displacement: 'mobile'});
    for (const [source, dest] of [[4, 3], [5, 4], [3, 5]]) {
      expect(result.snapshot.packedCells[index([dest, 3, 3])]).toBe(before.packedCells[index([source, 3, 3])]);
      expect(result.snapshot.energyQ[index([dest, 3, 3])]).toBe(before.energyQ[index([source, 3, 3])]);
    }
    conserved(before, result);
    const reverse = translate(result.snapshot, {cells: [[5, 3, 3]], path: [[-1, 0, 0], [-1, 0, 0]], displacement: 'mobile'});
    expect(reverse.snapshot).toEqual(before);
  });

  test('existing fluid can be selected and moved without manufacturing or cooling it', () => {
    const w = world(); w.setCell(3, 3, 3, MAT.WATER, 90);
    const before = w.snapshot(), result = translate(before, baseRequest);
    expect(result.snapshot.energyQ[index([4, 3, 3])]).toBe(before.energyQ[index([3, 3, 3])]); conserved(before, result);
  });

  test('mobile displacement admits broken grains but rejects intact ice and pinned debris', () => {
    for (const mode of ['intact', 'broken', 'pinned']) {
      const w = world(); w.setCell(3, 3, 3, MAT.WATER); w.setCell(4, 3, 3, MAT.ICE, 0);
      if (mode !== 'intact') w.setIntegrity(4, 3, 3, 0);
      if (mode === 'pinned') w.setAnchor(4, 3, 3, true);
      const before = w.snapshot(), request = {...baseRequest, displacement: 'mobile' as const};
      if (mode === 'broken') conserved(before, translate(before, request));
      else expect(() => translate(before, request)).toThrow(/obstructed/);
    }
  });

  test('an empty endpoint cannot tunnel through an intervening solid', () => {
    const w = world(); w.setCell(2, 3, 3, MAT.STONE); w.setCell(3, 3, 3, MAT.STONE);
    const before = w.snapshot(), saved = structuredClone(before);
    expect(() => translate(before, {cells: [[2, 3, 3]], path: [[1, 0, 0], [1, 0, 0]], externalBonds: 'cut'})).toThrow(/obstructed/);
    expect(before).toEqual(saved);
  });

  test('late boundary failure rolls back earlier movement, cuts and pin releases', () => {
    const w = world(); w.setCell(6, 3, 3, MAT.STONE); w.setCell(6, 4, 3, MAT.STONE); w.setAnchor(6, 3, 3, true);
    const before = w.snapshot(), saved = structuredClone(before);
    expect(() => translate(before, {cells: [[6, 3, 3]], path: [[1, 0, 0], [1, 0, 0]], externalBonds: 'cut', anchors: 'release'})).toThrow(/boundary/);
    expect(before).toEqual(saved);
  });

  test('selection order and disconnected runs do not change results or receipts', () => {
    const w = world(); w.setCell(1, 3, 3, MAT.STONE); w.setCell(3, 3, 3, MAT.GLASS);
    const before = w.snapshot(), a: CellCoordinate3D = [1, 3, 3], b: CellCoordinate3D = [3, 3, 3];
    const result = translate(before, {cells: [a, b], path: [[1, 0, 0], [0, -1, 0]]});
    expect(translate(before, {cells: [b, a], path: [[1, 0, 0], [0, -1, 0]]})).toEqual(result);
    expect(result.receipt.destinations).toEqual(Uint32Array.of(index([2, 2, 3]), index([4, 2, 3]))); conserved(before, result);
  });

  test('malformed, sparse, duplicate, missing and excessive requests never mutate input', () => {
    const w = world(); w.setCell(3, 3, 3, MAT.STONE);
    const before = w.snapshot(), saved = structuredClone(before);
    const invalid = [null, [], {}, {...baseRequest, extra: 1}, {...baseRequest, cells: []},
      {...baseRequest, cells: new Array(1)}, {...baseRequest, path: new Array(1)}, {...baseRequest, cells: [[3, 3, 3], [3, 3, 3]]},
      {...baseRequest, cells: [[8, 3, 3]]}, {...baseRequest, cells: [[0, 0, 0]]}, {...baseRequest, cells: [[3.5, 3, 3]]},
      {...baseRequest, path: []}, {...baseRequest, path: [[0, 0, 0]]}, {...baseRequest, path: [[1, 1, 0]]},
      {...baseRequest, path: [[2, 0, 0]]}, {...baseRequest, path: [[Infinity, 0, 0]]}, {...baseRequest, anchors: null},
      {...baseRequest, externalBonds: 'weld'}, {...baseRequest, displacement: 'overwrite'},
      {...baseRequest, cells: Array(65537).fill([3, 3, 3])}, {...baseRequest, path: Array(385).fill([1, 0, 0])},
      {cells: Array(4096).fill([3, 3, 3]), path: Array(64).fill([1, 0, 0])}];
    for (const request of invalid) {expect(() => translate(before, request as never)).toThrow(); expect(before).toEqual(saved);}
  });

  test('invalid snapshots fail before an operation can publish', () => {
    const w = world(); w.setCell(3, 3, 3, MAT.STONE);
    const before = w.snapshot();
    const bad = structuredClone(before); bad.structure[index([3, 3, 3])] |= FRESH_3D;
    for (const snapshot of [bad, {...before, rulesVersion: 'unknown'}, {...before, extra: true}]) {
      const saved = structuredClone(snapshot); expect(() => translate(snapshot, baseRequest)).toThrow(); expect(snapshot).toEqual(saved);
    }
  });

  test('frozen input is accepted and all result storage is isolated', () => {
    const w = world(); w.setCell(3, 3, 3, MAT.ICE, 0); const before = w.snapshot(), saved = structuredClone(before);
    Object.freeze(before.packedCells); Object.freeze(before.energyQ); Object.freeze(before.structure); Object.freeze(before);
    const request: TranslationRequest3D = {cells: [[3, 3, 3]], path: [[1, 0, 0]]};
    const a = translate(before, request), b = translate(before, request);
    a.snapshot.packedCells.fill(0); a.snapshot.energyQ.fill(0); a.snapshot.structure.fill(0);
    a.receipt.sources.fill(0); a.receipt.destinations.fill(0); a.receipt.editedCells.fill(0);
    (a.receipt.path as unknown as number[][])[0][0] = -1;
    expect(before).toEqual(saved); expect(request.path).toEqual([[1, 0, 0]]);
    expect(b).toEqual(translate(before, request));
  });
});
