/** Held physical equivalence/replay cases; not part of edit/mock verification. */
import { describe, expect, test } from 'vitest';
import { MAT, MAX_ENERGY_Q } from './3d.js';
import { volumeSchedule } from './3d-core.js';
import {
  CpuStructuralWorld3D,
  type StructuralSnapshot3D,
} from './structural/structural-world-core.js';
import {
  solveStructure3D,
  normalizeStructure3D,
  type StructuralState3D,
} from './structural-mechanics.js';
import { executeStructuralMaterialPass as oldMaterialPass } from './structural-material.motion-baseline.js';
import { readMotionTrace3D } from './motion-trace.js';

function world() {
  return new CpuStructuralWorld3D({ width: 4, height: 4, depth: 4, chunkSize: 4 });
}
function restore(s: StructuralSnapshot3D) {
  const w = new CpuStructuralWorld3D({
    width: s.width,
    height: s.height,
    depth: s.depth,
    chunkSize: s.chunkSize,
  });
  w.restore(s);
  return w;
}
function scene() {
  const w = world();
  w.setCell(1, 1, 1, MAT.STONE);
  w.setCell(2, 1, 1, MAT.STONE);
  w.setCell(0, 0, 0, MAT.WATER, 120);
  w.setCell(3, 0, 0, MAT.SAND);
  w.setCell(3, 0, 3, MAT.ICE, 30);
  w.setCell(0, 2, 3, MAT.LAVA, 240);
  for (let x = 0; x < 4; x++) w.setCell(x, 3, 1, MAT.STONE);
  return w.snapshot();
}
function oldTick(input: StructuralState3D, shape: StructuralSnapshot3D, tick: number) {
  let state = solveStructure3D(input, shape).state;
  let spare: StructuralState3D = {
    grid: state.grid.slice(),
    energyQ: state.energyQ.slice(),
    structure: state.structure.slice(),
  };
  for (const pass of volumeSchedule(tick)) {
    oldMaterialPass(state, spare, shape.width, shape.height, shape.depth, tick, pass);
    [state, spare] = [spare, state];
  }
  state.structure = normalizeStructure3D(state.grid, state.structure, shape);
  return state;
}

describe('held CPU motion capture equivalence and exact continuation', () => {
  test('capture on/off matches the frozen old kernel across complete mixed-material states', () => {
    const seed = scene(),
      plain = restore(seed),
      observed = restore(seed);
    let reference: StructuralState3D = {
      grid: Uint32Array.from(seed.packedCells),
      energyQ: Uint32Array.from(seed.energyQ),
      structure: Uint32Array.from(seed.structure),
    };
    for (let tick = 0; tick < 12; tick++) {
      reference = oldTick(reference, seed, tick);
      const before = observed.snapshot();
      plain.step(1);
      const trace = observed.stepWithMotion({ maxEntries: 65536 }),
        after = observed.snapshot();
      expect(after).toEqual(plain.snapshot());
      expect(after.packedCells).toEqual(Array.from(reference.grid));
      expect(after.energyQ).toEqual(Array.from(reference.energyQ));
      expect(after.structure).toEqual(Array.from(reference.structure));
      expect(readMotionTrace3D(trace, before, after)).toEqual(trace);
      expect(observed.energyBalance()).toEqual(plain.energyBalance());
      expect(observed.energyBalance().driftQ).toBe(0n);
    }
  });
  test('identical interior column cells retain actual source identities after descent', () => {
    const w = new CpuStructuralWorld3D({ width: 4, height: 8, depth: 4, chunkSize: 4 });
    for (let y = 1; y <= 4; y++) w.setCell(1, y, 1, MAT.STONE);
    const before = w.snapshot(),
      trace = w.stepWithMotion(),
      after = w.snapshot();
    expect([after.packedCells[45], after.energyQ[45], after.structure[45]]).toEqual([
      before.packedCells[45],
      before.energyQ[45],
      before.structure[45],
    ]);
    expect(trace.moves).toContainEqual([45, 49, 1]);
    expect(trace.fragments).toEqual([
      {
        id: 37,
        cells: 4,
        sourceRuns: [
          [37, 1],
          [41, 1],
          [45, 1],
          [49, 1],
        ],
      },
    ]);
    expect(readMotionTrace3D(trace, before, after)).toEqual(trace);
  });
  test('phase changes follow transported original matter without resetting provenance', () => {
    const w = world();
    w.setCell(1, 1, 1, MAT.WATER);
    w.setEnergy(1, 1, 1, MAX_ENERGY_Q);
    const before = w.snapshot(),
      trace = w.stepWithMotion(),
      after = w.snapshot();
    const move = trace.moves.find(([from, , count]) => from <= 21 && 21 < from + count),
      destination = move ? move[1] + 21 - move[0] : 21;
    expect(after.packedCells[destination] & 255).toBe(MAT.STEAM);
    expect(readMotionTrace3D(trace, before, after)).toEqual(trace);
    expect(w.energyBalance().driftQ).toBe(0n);
  });
  test('detail overflow changes no authoritative coordinate', () => {
    const w = world();
    w.setCell(1, 1, 1, MAT.STONE);
    const a = restore(w.snapshot()),
      b = restore(w.snapshot());
    a.step(1);
    const trace = b.stepWithMotion({ maxEntries: 0 });
    expect(trace).toMatchObject({
      status: 'overflow',
      requiresReexecution: true,
      moves: [],
      touched: [],
      fragments: [],
    });
    expect(b.snapshot()).toEqual(a.snapshot());
  });
  test('snapshot restart at an odd tick reproduces exact subsequent states and traces', () => {
    const a = restore(scene());
    for (let i = 0; i < 3; i++) a.stepWithMotion();
    const b = restore(a.snapshot());
    for (let i = 0; i < 4; i++) {
      expect(b.stepWithMotion()).toEqual(a.stepWithMotion());
      expect(b.snapshot()).toEqual(a.snapshot());
    }
  });
  test('invalid capture limits leave the field untouched', () => {
    const w = restore(scene()),
      before = w.snapshot();
    expect(() => w.stepWithMotion({ maxEntries: -1 })).toThrow();
    expect(w.snapshot()).toEqual(before);
  });
});
