import { describe, expect, it } from 'vitest';
import { createStateSpaceField, MAT } from './browser_state_space.js';
import { runCpuPass, runCpuTick } from './cpu_physics.js';
import { buildColdTable } from './generated/materials.js';
import { KERNEL_SPECS } from './generated/schedule.js';
import { FRESH } from './structure.js';

describe('CPU tick input boundary', () => {
  const state = () => {
    const field = createStateSpaceField(3, 3);
    field.setCell(1, 1, MAT.METAL);
    field.setCell(2, 0, MAT.SAND);
    return field.snapshot();
  };

  it('rejects malformed complete state before executing a tick', () => {
    const initial = state();
    const malformed = [
      { ...initial, grid: initial.grid.subarray(1) },
      { ...initial, energyQ: initial.energyQ.subarray(1) },
      { ...initial, structure: initial.structure.subarray(1) },
      { ...initial, energyQ: initial.energyQ.map(() => 0) },
      { ...initial, grid: initial.grid.map(value => (value & 0xffffff00) | 254) },
      { ...initial, structure: initial.structure.map(() => 0x80000000) },
      { ...initial, structure: initial.structure.map((word, index) => index === 4 ? word | FRESH : word) },
    ];
    for (const invalid of malformed) {
      let observed = false;
      expect(() => runCpuTick(invalid, 3, 3, buildColdTable(), 0, () => { observed = true; })).toThrow();
      expect(observed).toBe(false);
    }
    expect(() => runCpuTick(initial, 0, 3, buildColdTable(), 0)).toThrow();
    expect(() => runCpuTick(initial, 3, 3, buildColdTable(), -1)).toThrow();
    expect(() => runCpuTick(initial, 3, 3, new Uint32Array(1), 0)).toThrow();
  });

  it('keeps all public pass boundaries validated', () => {
    const invalid = { ...state(), energyQ: new Uint32Array(9) };
    for (const spec of KERNEL_SPECS) {
      expect(() => runCpuPass(invalid, 3, 3, buildColdTable(), spec.id), spec.id).toThrow();
    }
  });

  it('isolates tick execution from caller state and cold-table changes in observers', () => {
    const expected = runCpuTick(state(), 3, 3, buildColdTable(), 17);
    const original = state(), cold = buildColdTable();
    const observedStates: Uint32Array[] = [];
    const actual = runCpuTick(original, 3, 3, cold, 17, (_id, observed) => {
      // Both aliases are public caller storage; neither may change owned physics.
      cold.fill(0);
      original.grid.fill(0); original.energyQ.fill(0); original.structure.fill(0);
      observedStates.push(observed.grid.slice());
      observed.grid.fill(0); observed.energyQ.fill(0); observed.structure.fill(0);
    });
    expect(actual).toEqual(expected);
    expect(observedStates).toHaveLength(23);
    expect(() => runCpuTick(state(), 3, 3, cold, 18)).toThrow(/Cold table/);
  });
});
