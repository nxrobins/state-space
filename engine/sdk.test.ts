import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CATALOG, MAT } from './generated/materials.js';
import { createMaterialRegistry, DEFAULT_REGISTRY, validateCatalog, type MaterialCatalog } from './registry.js';
import { createStateSpaceField } from './browser_state_space.js';

const extensions = JSON.parse(readFileSync('examples/sdk/materials.json', 'utf8'));
const python = process.env.STATE_SPACE_PYTHON ?? resolve('.venv/Scripts/python.exe');

describe('portable registries and field APIs', () => {
  it('matches Python catalog acceptance and SHA-256 identity', async () => {
    const { stdout } = await promisify(execFile)(python, ['-m', 'tests.sdk_catalog_cases'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 30_000 });
    const cases = JSON.parse(stdout);
    expect(cases.length).toBeGreaterThanOrEqual(25);
    for (const fixture of cases) {
      if (fixture.accepted) expect((await createMaterialRegistry(fixture.catalog)).hash, fixture.name).toBe(fixture.hash);
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
    expect(() => { (registry.material(1).properties as Record<string, number>).conductivity = 0; }).toThrow();
    expect(() => { DEFAULT_CATALOG.materials[0].name = 'corrupt_authority'; }).toThrow();
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

  it('supports non-air fill, custom phases, high IDs, inspection and exact edits', async () => {
    const builtin = createStateSpaceField(2, 1, MAT.STONE);
    expect(builtin.sample(0, 0).material).toBe(MAT.STONE);
    const registry = await DEFAULT_REGISTRY.extend(extensions);
    const field = createStateSpaceField(1, 1, 18, registry);
    field.setEnergy(0, 0, 120 * 256 + 17);
    const reports = field.step(3, { inspect: true });
    expect(field.sample(0, 0)).toMatchObject({ material: 19, materialName: 'molten_copper', energyQ: 120 * 256 + 17 });
    expect(reports).toHaveLength(54);
    expect(reports.every(report => report.before.totalQ === report.after.totalQ)).toBe(true);
    const transition = reports.flatMap(report => report.changes).find(change => (change.afterPacked & 255) === 19)!;
    expect(transition).toBeDefined();
    expect(() => { (transition as { afterEnergyQ: number }).afterEnergyQ = 0; }).toThrow();
    field.setEnergy(0, 0, 55 * 256 + 11);
    field.step();
    expect(field.sample(0, 0).material).toBe(18);
    field.paintCircle(0, 0, 0, 255, 20, 15);
    expect(field.sample(0, 0)).toMatchObject({ material: 255, flags: 15 });
    expect(field.energyBalance().driftQ).toBe(0n);
  });

  it('restores only compatible registry state and rejects invalid edits atomically', async () => {
    const registry = await DEFAULT_REGISTRY.extend(extensions);
    const field = createStateSpaceField(3, 1, 18, registry);
    const before = field.packedSnapshot();
    const alternate: MaterialCatalog = registry.toCatalog();
    alternate.materials[18].properties.conductivity -= 1;
    const other = createStateSpaceField(3, 1, 18, await createMaterialRegistry(alternate));
    expect(() => other.restore(before)).toThrow();
    expect(() => field.restore({ ...before, materialCatalogHash: DEFAULT_REGISTRY.hash })).toThrow();
    expect(() => field.setCell(100, 100, 254)).toThrow();
    expect(() => field.setCell(0, 0, 18, null as unknown as number)).toThrow();
    expect(() => field.setEnergy(0, 0, -1)).toThrow();
    expect(() => field.sample(Number.MAX_VALUE, 0)).toThrow();
    expect(field.packedSnapshot()).toEqual(before);
    field.close();
    field.close();
    expect(() => field.step()).toThrow(/closed/);
    expect(field.packedSnapshot()).toEqual(before);
  });

  it('matches the native public API, including every custom-scene pass delta and restart', async () => {
    const { stdout } = await promisify(execFile)(python, ['-c', "import runpy; runpy.run_path('examples/sdk/native.py', run_name='__main__')"],
      { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 30_000 });
    const native = JSON.parse(stdout);
    const registry = await DEFAULT_REGISTRY.extend(extensions);
    expect(registry.hash).toBe(native.catalogHash);
    const field = createStateSpaceField(8, 7, 0, registry);
    field.restore(native.initial);
    const reports = field.step(3, { inspect: true });
    expect(reports.map(report => ({ tick: report.tick, passId: report.passId,
      changes: report.changes.map(change => ({ index: change.index, before_packed: change.beforePacked, after_packed: change.afterPacked,
        before_energy_q: change.beforeEnergyQ, after_energy_q: change.afterEnergyQ,
        before_structure: change.beforeStructure, after_structure: change.afterStructure })), deltaQ: (report.after.totalQ - report.before.totalQ).toString() }))).toEqual(native.passes);
    const saved = JSON.parse(JSON.stringify(field.packedSnapshot()));
    field.step(2);
    expect(field.packedSnapshot()).toEqual(native.final);
    field.restore(saved);
    field.step(2);
    expect(field.packedSnapshot()).toEqual(native.final);
    expect(field.energyBalance().driftQ).toBe(0n);
  }, 20_000);

  it('keeps public ESM imports and factory parameter types portable', async () => {
    // @ts-expect-error The standalone structural checker deliberately has no declarations.
    const { lintSource } = await import('./lint_ts.mjs');
    expect(lintSource('export function field(fill = MAT.AIR) {}')).toContain('SS020 material factory defaults require an explicit numeric parameter type');
    expect(lintSource('export function field(fill: number = MAT.AIR) {}')).toEqual([]);
    expect(lintSource("export { field } from './field';")).not.toEqual([]);
    expect(lintSource("export { field } from './field.js';")).toEqual([]);
  });
});
