import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createStateSpaceField, packVoxel, unpackVoxel } from './browser_state_space';
import { validateDimensions, validatePackedCells, validateSnapshot } from './contracts';
import { MAT, MATERIAL_CATALOG_HASH, RULES_VERSION, SCHEMA_VERSION, buildColdTable } from './generated/materials';

describe('portable engine contracts', () => {
  it('matches every Python cold-table slot, including optical and reserved data', () => {
    const python = process.env.STATE_SPACE_PYTHON ?? (existsSync('.venv/Scripts/python.exe') ? resolve('.venv/Scripts/python.exe') : 'python');
    const source = 'import json; from engine.schema import build_cold_table_buffer; print(json.dumps(build_cold_table_buffer().tolist()))';
    const expected = JSON.parse(execFileSync(python, ['-c', source], { encoding: 'utf8', timeout: 20_000 }));
    expect([...buildColdTable()]).toEqual(expected);
  });

  it('roundtrips signed fields and every bit over seeded packed states', () => {
    let seed = 417;
    for (let index = 0; index < 10_000; index += 1) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const state = unpackVoxel(seed);
      expect(packVoxel(state.material, state.thermal, state.kineticX, state.kineticY, state.phase, state.flags)).toBe(seed);
    }
  });

  it('rejects malformed cells before typed-array coercion', () => {
    for (const value of [-1, 2 ** 32, 0.5, NaN, Infinity, true, '3', null]) {
      expect(() => validatePackedCells([value] as number[], 1)).toThrow();
    }
    expect(() => validatePackedCells([], 1)).toThrow();
    expect(() => validatePackedCells({ length: 1 } as ArrayLike<number>, 1)).toThrow();
  });

  it('rejects unsafe or fractional dimensions before allocation', () => {
    for (const [width, height] of [[0, 1], [-1, 3], [1.5, 4], [NaN, 1], [65536, 65536]]) {
      expect(() => validateDimensions(width, height)).toThrow();
      expect(() => createStateSpaceField(width, height)).toThrow();
    }
    expect(validateDimensions(7, 3)).toBe(21);
  });

  it('copies snapshots and rejects incompatible schema, rules, catalog, and tick', () => {
    const snapshot = { schemaVersion: SCHEMA_VERSION, rulesVersion: RULES_VERSION,
      materialCatalogHash: MATERIAL_CATALOG_HASH, width: 1, height: 1, tick: 3, packedCells: [packVoxel(MAT.SMOKE, 255, -1, -1, 15, 15)], energyQ: [255 * 256], structure: [0] };
    const cells = validateSnapshot(snapshot);
    const originalCell = snapshot.packedCells[0];
    snapshot.packedCells[0] = 0;
    snapshot.energyQ[0] = 0;
    expect(cells.grid[0]).toBe(originalCell);
    expect(cells.energyQ[0]).toBe(255 * 256);
    for (const update of [{ schemaVersion: SCHEMA_VERSION + 1 }, { rulesVersion: 'other' }, { materialCatalogHash: 'other' }, { tick: -1 }, { tick: 2 ** 53 }]) {
      expect(() => validateSnapshot({ ...snapshot, ...update })).toThrow();
    }
    expect(() => validateSnapshot({ ...snapshot, extra: 1 } as typeof snapshot)).toThrow();
  });

  it('rejects invalid tick counts and cell edits without mutating the field', () => {
    const field = createStateSpaceField(3, 3);
    const before = field.snapshot();
    for (const value of [-1, 0.5, NaN, Infinity]) expect(() => field.step(value)).toThrow();
    for (const value of [-1, 256, 0.5, NaN]) expect(() => field.setCell(1, 1, MAT.WATER, value)).toThrow();
    expect(field.snapshot()).toEqual(before);
    field.step(1);
    field.clear();
    expect(field.tick).toBe(0);
  });

  it('bounds brush work by the field and rejects nonfinite geometry and reads', () => {
    const field = createStateSpaceField(3, 3);
    for (const radius of [-1, NaN, Infinity]) expect(() => field.paintCircle(1, 1, radius, MAT.SAND)).toThrow();
    for (const value of [NaN, Infinity]) expect(() => field.sample(value, 0)).toThrow();
    field.paintCircle(1, 1, 1_000_000, MAT.SAND);
    expect([...field.grid].every(value => (value & 255) === MAT.SAND)).toBe(true);
    expect(() => packVoxel(MAT.LAVA, 260)).toThrow();
  });
});
