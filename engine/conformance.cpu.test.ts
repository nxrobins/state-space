import { describe, expect, it } from 'vitest';
import { createStateSpaceField, packVoxel } from './browser_state_space.js';
import { runCpuTick } from './cpu_physics.js';
import { MAT, buildColdTable } from './generated/materials.js';
import { seedState } from './thermal.js';
import { seedStructureState } from './structure.js';
import { DEFAULT_REGISTRY } from './registry.js';

// The CPU-only properties of the native conformance fixture: they need no Python
// corpus, so they run under `npm test` on hosts without an adapter.
describe('browser CPU conformance properties', () => {
  it('requires mutually exclusive oxygen claims and actual hot-gas buoyancy', () => {
    const field = createStateSpaceField(3, 1);
    field.setCell(0, 0, MAT.WOOD, 255);
    field.setCell(2, 0, MAT.WOOD, 255);
    field.step();
    const materials = [...field.grid].map((v) => v & 255);
    expect(materials.filter((m) => m === MAT.WOOD)).toHaveLength(1);
    expect(materials.filter((m) => m === MAT.AIR)).toHaveLength(0);
    const smoke = createStateSpaceField(3, 5);
    smoke.setCell(1, 3, MAT.SMOKE, 200);
    smoke.step(4);
    expect([...smoke.grid].findIndex((v) => (v & 255) === MAT.SMOKE)).toBeLessThan(9);
  });

  it('preserves immutable pass inputs and prevents observers changing the simulation', () => {
    const cells = Uint32Array.of(
      packVoxel(MAT.WOOD, 255),
      packVoxel(MAT.AIR),
      packVoxel(MAT.WOOD, 255),
    );
    const original = cells.slice();
    const cold = buildColdTable();
    const expected = runCpuTick(
      seedStructureState(seedState(cells), 3, 1, DEFAULT_REGISTRY),
      3,
      1,
      cold,
      0,
    );
    const result = runCpuTick(
      seedStructureState(seedState(cells), 3, 1, DEFAULT_REGISTRY),
      3,
      1,
      cold,
      0,
      (_id, observed) => {
        observed.grid.fill(0);
        observed.energyQ.fill(0);
        observed.structure.fill(0);
      },
    );
    expect([...cells]).toEqual([...original]);
    expect(result).toEqual(expected);
  });
});
