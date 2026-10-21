/** Portable data validation only; no engine step or browser execution. */
import { beforeAll, describe, expect, test } from 'vitest';
import { DEFAULT_REGISTRY } from '../../registry.js';
import { COLD_STRIDE, PHASE, MAT } from '../../generated/materials.js';
import {
  createReactiveMaterialRegistry3D as create,
  defaultReactiveMaterialCatalog3D as catalog,
  REACTIVE_MATERIAL_RULES_3D,
  type ReactiveMaterialRegistry3D,
} from './reactive-registry.js';
import { createReactiveMaterialBlock3D } from '../reactive-materials.js';
let registry: ReactiveMaterialRegistry3D;
beforeAll(async () => {
  registry = await create();
});
function custom(id = 200) {
  const source = DEFAULT_REGISTRY.material(MAT.WOOD);
  return { ...source, properties: { ...source.properties }, id, name: 'resin' };
}
const material = (c: ReturnType<typeof catalog>, id: number) =>
  c.propertiesCatalog.materials.find((m) => m.id === id)!;

describe('versioned reactive material catalog', () => {
  test('default profile contains every physical builtin and excludes the player marker', () => {
    expect(registry.materialIds).toHaveLength(17);
    expect(registry.has(MAT.PLAYER)).toBe(false);
    for (const id of [
      MAT.WOOD,
      MAT.FIRE,
      MAT.SMOKE,
      MAT.ASH,
      MAT.OIL,
      MAT.OIL_VAPOR,
      MAT.MOLTEN_METAL,
    ])
      expect(registry.has(id)).toBe(true);
    expect(() => registry.material(MAT.PLAYER)).toThrow();
    expect(registry.rulesVersion).toBe(REACTIVE_MATERIAL_RULES_3D);
  });
  test('domain hash is separate while builtin property identity stays unchanged', () => {
    expect(registry.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(registry.sourceCatalogHash).toBe(DEFAULT_REGISTRY.hash);
    expect(registry.hash).not.toBe(DEFAULT_REGISTRY.hash);
  });
  test('reordered material records and active IDs have canonical identity', async () => {
    const c = catalog();
    c.materialIds.reverse();
    c.propertiesCatalog.materials.reverse();
    const r = await create(c);
    expect(r.hash).toBe(registry.hash);
    expect(r.toCatalog()).toEqual(registry.toCatalog());
  });
  test('property changes change both property and profile identity', async () => {
    const c = catalog();
    material(c, MAT.WOOD).properties.conductivity++;
    const r = await create(c);
    expect(r.hash).not.toBe(registry.hash);
    expect(r.sourceCatalogHash).not.toBe(registry.sourceCatalogHash);
  });
  test('active material selection changes only profile identity', async () => {
    const c = catalog();
    c.materialIds = [MAT.AIR];
    const r = await create(c);
    expect(r.hash).not.toBe(registry.hash);
    expect(r.sourceCatalogHash).toBe(registry.sourceCatalogHash);
  });
  test('public records and ID lists are immutable; catalog and table reads are isolated', () => {
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.materialIds)).toBe(true);
    expect(Object.isFrozen(registry.material(MAT.WOOD).properties)).toBe(true);
    const c = registry.toCatalog(),
      cold = registry.coldTable();
    c.materialIds.length = 0;
    material(c, MAT.WOOD).properties.density = 0;
    cold.fill(0);
    expect(registry.materialIds).toHaveLength(17);
    expect(registry.material(MAT.WOOD).properties.density).toBeGreaterThan(0);
    expect(registry.coldTable().some((v) => v > 0)).toBe(true);
    expect([
      ...registry.coldTable().slice(MAT.PLAYER * COLD_STRIDE, (MAT.PLAYER + 1) * COLD_STRIDE),
    ]).toEqual(new Array(COLD_STRIDE).fill(0));
  });
  test('custom fuel can be added at the highest ID without mutating the original', async () => {
    const r = await registry.extend([custom(255)]);
    expect(r.has(255)).toBe(true);
    expect(registry.has(255)).toBe(false);
    expect(r.material(255).properties.fuel_energy).toBe(80);
    expect((await create(JSON.parse(JSON.stringify(r.toCatalog())))).hash).toBe(r.hash);
  });
  test('constructor owns all data before asynchronous hashing begins', async () => {
    const c = catalog(),
      pending = create(c);
    c.materialIds.length = 0;
    material(c, MAT.WOOD).properties.fuel_energy = 0;
    expect((await pending).hash).toBe(registry.hash);
  });
  test('extension owns definitions before asynchronous hashing begins', async () => {
    const row = custom(),
      rows = [row],
      pending = registry.extend(rows);
    row.name = 'mutated';
    row.properties.fuel_energy = 0;
    rows.length = 0;
    const r = await pending;
    expect(r.material(200).name).toBe('resin');
    expect(r.material(200).properties.fuel_energy).toBe(80);
  });
  test('forged registry objects cannot create material blocks', () => {
    expect(() =>
      createReactiveMaterialBlock3D({ ...registry }, { width: 1, height: 1, depth: 1 }),
    ).toThrow(/validated/);
  });
  test('wrong wrapper rules, schema and unexpected fields are rejected', async () => {
    for (const patch of [
      { rulesVersion: '3d-m5' },
      { schemaVersion: 2 },
      { extra: 1 },
      { materialIds: null },
    ])
      await expect(create({ ...catalog(), ...patch })).rejects.toThrow();
  });
  test('duplicate or absent active IDs and missing air are rejected', async () => {
    for (const ids of [[0, 0], [], [MAT.STONE], [0, 256], [0, 1.5], [0, 200]])
      await expect(create({ ...catalog(), materialIds: ids })).rejects.toThrow();
  });
  test('phase and combustion destinations must all be active', async () => {
    for (const absent of [MAT.ICE, MAT.STEAM, MAT.LAVA, MAT.ASH, MAT.FIRE, MAT.SMOKE]) {
      const c = catalog();
      c.materialIds = c.materialIds.filter((id) => id !== absent);
      await expect(create(c)).rejects.toThrow();
    }
  });
  test('fire also needs smoke when no fuel is active', async () => {
    const c = catalog();
    c.materialIds = [MAT.AIR, MAT.FIRE];
    await expect(create(c)).rejects.toThrow(/smoke/);
  });
  test('unsupported transitional phase cannot enter the profile', async () => {
    const c = catalog();
    material(c, MAT.ASH).properties.default_phase = 5;
    await expect(create(c)).rejects.toThrow(/phase/);
  });
  test('air, fire, smoke and water retain required role identities', async () => {
    for (const [id, key, value] of [
      [MAT.AIR, 'oxidizer', 0],
      [MAT.AIR, 'density', 0],
      [MAT.AIR, 'default_phase', PHASE.SOLID],
      [MAT.FIRE, 'default_phase', PHASE.POWDER],
      [MAT.SMOKE, 'default_phase', PHASE.LIQUID],
      [MAT.WATER, 'default_phase', PHASE.GAS],
    ] as const) {
      const c = catalog();
      material(c, id).properties[key] = value;
      await expect(create(c)).rejects.toThrow();
    }
  });
  test('incomplete fuel and nonconservative phase definitions are rejected', async () => {
    for (const [id, key, value] of [
      [MAT.WOOD, 'flash_point', 0],
      [MAT.WOOD, 'burns_into', 0],
      [MAT.WOOD, 'smoke_product', 0],
      [MAT.STEAM, 'fuel_energy', 1],
      [MAT.WATER, 'latent_heat_boil', 0],
    ] as const) {
      const c = catalog();
      material(c, id).properties[key] = value;
      await expect(create(c)).rejects.toThrow();
    }
  });
  test('duplicate custom names and IDs are rejected', async () => {
    await expect(registry.extend([custom(), custom()])).rejects.toThrow();
    await expect(registry.extend([{ ...custom(), name: 'wood' }])).rejects.toThrow();
    await expect(registry.extend([custom(MAT.WOOD)])).rejects.toThrow();
  });
  test('undefined and extra material properties are rejected', async () => {
    const row = custom();
    row.properties.extra = 0;
    await expect(registry.extend([row])).rejects.toThrow();
    const c = catalog();
    (c as unknown as Record<string, unknown>).extra = undefined;
    await expect(create(c)).rejects.toThrow();
  });
  test('accessors are rejected without invocation at every data level', async () => {
    let calls = 0;
    for (const target of ['root', 'record', 'property', 'array']) {
      const c = catalog();
      const object =
        target === 'root'
          ? c
          : target === 'record'
            ? material(c, MAT.WOOD)
            : target === 'property'
              ? material(c, MAT.WOOD).properties
              : c.materialIds;
      const key =
        target === 'root'
          ? 'rulesVersion'
          : target === 'record'
            ? 'name'
            : target === 'property'
              ? 'density'
              : '0';
      Object.defineProperty(object, key, {
        get() {
          calls++;
          throw Error('invoked');
        },
        enumerable: true,
      });
      await expect(create(c)).rejects.toThrow();
    }
    expect(calls).toBe(0);
  });
  test('sparse, decorated and nonstandard arrays are rejected', async () => {
    const sparse = new Array(1),
      decorated = [0],
      nonstandard = [0];
    Object.assign(decorated, { extra: 1 });
    Object.setPrototypeOf(nonstandard, null);
    for (const ids of [sparse, decorated, nonstandard])
      await expect(create({ ...catalog(), materialIds: ids })).rejects.toThrow();
  });
  test('symbols, hidden fields and nonplain objects are rejected', async () => {
    const symbol = catalog(),
      hidden = catalog();
    Object.assign(symbol, { [Symbol('x')]: 1 });
    Object.defineProperty(hidden, 'x', { value: 1 });
    for (const c of [symbol, hidden, new Date(), Object.create(catalog())])
      await expect(create(c)).rejects.toThrow();
  });
  test('cyclic, excessively deep, oversized and fractional data are rejected', async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    let deep: unknown = 0;
    for (let i = 0; i < 14; i++) deep = { child: deep };
    for (const raw of [
      cyclic,
      deep,
      new Array(65537),
      { name: 'x'.repeat(257) },
      { x: NaN },
      { x: 0.5 },
    ])
      await expect(create(raw)).rejects.toThrow();
  });
  test('null-prototype portable records produce the same identity', async () => {
    expect((await create(Object.assign(Object.create(null), catalog()))).hash).toBe(registry.hash);
  });
});
