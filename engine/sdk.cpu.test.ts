import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { pythonInterpreter } from './test-support/python-interpreter.mjs';
import { DEFAULT_CATALOG, MAT } from './generated/materials.js';
import { createMaterialRegistry, DEFAULT_REGISTRY, validateCatalog } from './registry.js';
import { createStateSpaceField } from './browser_state_space.js';

// The CPU-only cases of the native SDK fixture: the Python catalog cases are plain
// Python, so these run under `npm test` on hosts without an adapter.
const python = pythonInterpreter();

describe('portable registries and field APIs (CPU)', () => {
  it('copies complete state into reusable caller storage without exposing field arrays', () => {
    const field = createStateSpaceField(3, 2, MAT.WATER);
    const storage = new Uint32Array(18);
    const target = {
      grid: storage.subarray(0, 6),
      energyQ: storage.subarray(6, 12),
      structure: storage.subarray(12),
    };
    field.step(3);
    expect(field.copyStateInto(target)).toBe(3);
    const saved = field.snapshot();
    for (const key of ['grid', 'energyQ', 'structure'] as const)
      expect(target[key]).toEqual(saved[key]);
    storage.fill(0);
    expect(field.snapshot()).toEqual(saved);
    const unchanged = target.grid.slice();
    expect(() => field.copyStateInto({ ...target, structure: new Uint32Array(5) })).toThrow();
    expect(target.grid).toEqual(unchanged);
    expect(() => field.copyStateInto({ ...target, energyQ: target.grid })).toThrow(/overlap/);
    const accessor = { ...target };
    Object.defineProperty(accessor, 'grid', {
      get: () => {
        throw new Error('must not invoke caller getter');
      },
    });
    expect(() => field.copyStateInto(accessor)).toThrow(/Uint32Arrays/);
    field.close();
    expect(field.copyStateInto(target)).toBe(3);
  });

  it('matches Python catalog acceptance and SHA-256 identity', async () => {
    const { stdout } = await promisify(execFile)(python, ['-m', 'tests.sdk_catalog_cases'], {
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      timeout: 30_000,
    });
    const cases = JSON.parse(stdout);
    expect(cases.length).toBeGreaterThanOrEqual(25);
    for (const fixture of cases) {
      if (fixture.accepted)
        expect((await createMaterialRegistry(fixture.catalog)).hash, fixture.name).toBe(
          fixture.hash,
        );
      else expect(() => validateCatalog(fixture.catalog), fixture.name).toThrow();
    }
  });

  it('isolates catalog inputs before asynchronous hashing and protects returned views', async () => {
    const catalog = DEFAULT_REGISTRY.toCatalog();
    const pending = createMaterialRegistry(catalog);
    catalog.materials[0].name = 'changed_after_validation';
    const registry = await pending;
    expect(registry.hash).toBe(DEFAULT_REGISTRY.hash);
    registry.coldTable().fill(0);
    registry.toCatalog().materials[0].name = 'changed_export';
    expect(registry.material(0).name).toBe('air');
    expect(() => {
      (registry.material(1).properties as Record<string, number>).conductivity = 0;
    }).toThrow();
    expect(() => {
      DEFAULT_CATALOG.materials[0].name = 'corrupt_authority';
    }).toThrow();
    expect(registry.coldTable()).toEqual(DEFAULT_REGISTRY.coldTable());
  });

  it('rejects sparse metadata and every reserved material identity reuse', async () => {
    const sparse = DEFAULT_REGISTRY.toCatalog();
    delete sparse.cold_fields[0];
    await expect(createMaterialRegistry(sparse)).rejects.toThrow();
    for (let id = 0; id < 18; id += 1) {
      const catalog = DEFAULT_REGISTRY.toCatalog();
      catalog.materials[id].name = 'reused_identity';
      expect(() => validateCatalog(catalog)).toThrow();
    }
  });
});
