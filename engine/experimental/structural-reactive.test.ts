import { beforeAll, describe, expect, test } from 'vitest';
import {
  CpuStructuralWorld3D,
  validateStructuralSnapshot3D,
  STRUCTURAL_RULES_VERSION_3D,
  STRUCTURAL_REACTIVE_RULES_VERSION_3D,
} from './structural/structural-world-core.js';
import { structuralSchedule3D, structuralLaw3D } from './structural/structural-law.js';
import {
  reactiveFixture3D,
  sealedAirCells3D,
  type ReactiveFixture3D,
} from './structural/structural-reactive-fixtures.js';
import { createReactiveMaterialRegistry3D } from './reactive/reactive-registry.js';
import { createThermalMaterialRegistry3D, THERMAL_MAT_3D } from './reactive/thermal-materials.js';
import type { ReactiveMaterialRegistry3D } from './reactive/reactive-registry.js';
import { MAT, ENERGY_SCALE, MATERIALS_3D } from './3d.js';
import { COLD_STRIDE, COLD_OXIDIZER } from '../generated/materials.js';
import { DEFAULT_REGISTRY } from '../registry.js';

const WOOD_CHEMICAL_Q = 80n * BigInt(ENERGY_SCALE);
const NON_STRUCTURAL: number[] = [MAT.ASH, MAT.FIRE, MAT.SMOKE, MAT.AIR];
let thermal: ReactiveMaterialRegistry3D, legacy: ReactiveMaterialRegistry3D;
beforeAll(async () => {
  thermal = await createThermalMaterialRegistry3D();
  legacy = await createReactiveMaterialRegistry3D({
    schemaVersion: 1,
    rulesVersion: 'reactive-materials-1',
    propertiesCatalog: DEFAULT_REGISTRY.toCatalog(),
    materialIds: MATERIALS_3D.map((m) => m.id),
  });
});
const world = (size: number, chunkSize: number, registry?: ReactiveMaterialRegistry3D) =>
  new CpuStructuralWorld3D({
    width: size,
    height: size,
    depth: size,
    chunkSize,
    ...(registry ? { registry } : {}),
  });
const counts = (grid: Uint32Array) => {
  const n = new Map<number, number>();
  for (const v of grid) n.set(v & 255, (n.get(v & 255) ?? 0) + 1);
  return (id: number) => n.get(id) ?? 0;
};
const positions = (w: CpuStructuralWorld3D, id: number) => {
  const out: [number, number, number][] = [],
    grid = w.grid;
  for (let i = 0; i < grid.length; i++)
    if ((grid[i] & 255) === id)
      out.push([
        i % w.width,
        Math.floor(i / w.width) % w.height,
        Math.floor(i / (w.width * w.height)),
      ]);
  return out;
};
/** Runs a fixture, checking exact conservation after every tick. */
function run(f: ReactiveFixture3D, registry: ReactiveMaterialRegistry3D) {
  const w = world(f.size, f.chunkSize, registry);
  w.edit(f.initial);
  const before = w.energyLedger();
  for (let t = 0; t < f.ticks; t++) {
    w.step(1, { edits: f.scripted.get(t) ?? [] });
    expect(w.energyBalance().driftQ).toBe(0n);
    const grid = w.grid,
      structure = w.structure;
    for (let i = 0; i < grid.length; i++)
      if (NON_STRUCTURAL.includes(grid[i] & 255)) expect(structure[i]).toBe(0);
  }
  return { w, before, after: w.energyLedger() };
}

describe('ca-3d-m6 law binding', () => {
  test('a reactive registry selects ca-3d-m6; its absence keeps ca-3d-m5 exactly', () => {
    const m5 = world(8, 4),
      m6 = world(8, 4, thermal);
    expect(m5.rulesVersion).toBe(STRUCTURAL_RULES_VERSION_3D);
    expect(m5.snapshot().rulesVersion).toBe('ca-3d-m5');
    expect(m6.rulesVersion).toBe(STRUCTURAL_REACTIVE_RULES_VERSION_3D);
    expect(m6.materialCatalogHash).toBe(thermal.hash);
    expect(m6.snapshot().materialCatalogHash).toBe(thermal.hash);
    expect(structuralSchedule3D(0, false)).toHaveLength(27);
    expect(structuralSchedule3D(0, true)).toHaveLength(28);
    expect(structuralSchedule3D(5, true)[27].kind).toBe('combustion');
    expect(() => m5.setCell(1, 1, 1, MAT.WOOD)).toThrow('not supported by ca-3d-m5');
    expect(() => m6.setCell(1, 1, 1, MAT.PLAYER)).toThrow('not supported by ca-3d-m6');
    m6.setCell(1, 1, 1, THERMAL_MAT_3D.WAX);
    expect(m6.sample(1, 1, 1).materialName).toBe('wax');
  });
  test('snapshots bind their rules and catalog in both directions', () => {
    const m5 = world(8, 4),
      m6 = world(8, 4, thermal),
      other = world(8, 4, legacy);
    expect(() => m5.restore(m6.snapshot())).toThrow('Incompatible');
    expect(() => m6.restore(m5.snapshot())).toThrow('Incompatible');
    expect(() => other.restore(m6.snapshot())).toThrow('Incompatible');
    expect(() => validateStructuralSnapshot3D(m6.snapshot())).toThrow('Incompatible');
    expect(validateStructuralSnapshot3D(m6.snapshot(), thermal).grid).toHaveLength(512);
    expect(validateStructuralSnapshot3D(m5.snapshot()).grid).toHaveLength(512);
    const copy = world(8, 8, thermal);
    m6.setCell(2, 2, 2, THERMAL_MAT_3D.COPPER, 200);
    copy.restore(m6.snapshot());
    expect({ ...copy.snapshot(), chunkSize: 4 }).toEqual(m6.snapshot());
  });
  test('rejects objects that are not validated reactive registries and ambiguous fuels', () => {
    expect(() => structuralLaw3D({})).toThrow('validated');
    expect(() => structuralLaw3D({ ...thermal })).toThrow('validated');
    expect(() => structuralLaw3D(Object.freeze({ ...thermal, hash: 'x' }))).toThrow('validated');
    // The catalog validator already forbids oxidizers with chemical energy; the law checks the
    // cold table it actually executes, so a registry-shaped object with both roles is rejected too.
    const both = Object.freeze({
      ...thermal,
      coldTable: () => {
        const cold = thermal.coldTable();
        cold[MAT.WOOD * COLD_STRIDE + COLD_OXIDIZER] = 1;
        return cold;
      },
    });
    expect(() => structuralLaw3D(both)).toThrow('fuel or an oxidizer');
    expect(() => world(8, 4, both as ReactiveMaterialRegistry3D)).toThrow('fuel or an oxidizer');
    const inactive = Object.freeze({
      ...thermal,
      coldTable: () => {
        const cold = thermal.coldTable();
        cold[MAT.PLAYER * COLD_STRIDE] = 100;
        return cold;
      },
    });
    expect(() => structuralLaw3D(inactive)).toThrow('zero properties');
  });
});

describe('ca-3d-m6 with the M1 catalog subset reproduces ca-3d-m5 exactly', () => {
  for (const scene of ['control', 'cut', 'heat', 'ice'] as const)
    test(`${scene}: 64 ticks, every coordinate, every tick`, () => {
      const m5 = world(8, 4),
        m6 = world(8, 4, legacy),
        material = scene === 'ice' ? MAT.ICE : MAT.STONE;
      for (const w of [m5, m6]) {
        const cold = [];
        for (let z = 0; z < 8; z++)
          for (let y = 0; y < 8; y++)
            for (let x = 0; x < 8; x++)
              cold.push({ kind: 'material' as const, x, y, z, material: MAT.AIR, thermal: 0 });
        w.edit(cold);
        for (let x = 1; x <= 6; x++) w.setCell(x, 3, 3, material, 0);
        w.setAnchor(1, 3, 3, true);
        w.setAnchor(6, 3, 3, true);
      }
      for (let tick = 1; tick <= 64; tick++) {
        const edits =
          tick === 9 && scene !== 'control'
            ? [1, 6].map((x) =>
                scene === 'cut'
                  ? { kind: 'material' as const, x, y: 3, z: 3, material: MAT.AIR, thermal: 0 }
                  : {
                      kind: 'energy' as const,
                      x,
                      y: 3,
                      z: 3,
                      energyQ: (scene === 'ice' ? 100 : 1000) * ENERGY_SCALE,
                    },
              )
            : [];
        m5.step(1, { edits });
        m6.step(1, { edits });
        expect(m6.grid).toEqual(m5.grid);
        expect(m6.energyQ).toEqual(m5.energyQ);
        expect(m6.structure).toEqual(m5.structure);
      }
      expect(m6.energyBalance()).toEqual(m5.energyBalance());
      const a = m5.snapshot(),
        b = m6.snapshot();
      expect({
        ...b,
        rulesVersion: a.rulesVersion,
        materialCatalogHash: a.materialCatalogHash,
      }).toEqual(a);
    });
});

describe('ca-3d-m6 combustion in structural worlds (8^3 and 16^3)', () => {
  for (const size of [8, 16] as const) {
    test(`${size}^3 burning cantilever: consumed supports drop the span to the floor`, () => {
      const f = reactiveFixture3D('bridge', size),
        { w, before, after } = run(f, thermal),
        count = counts(w.grid),
        wood = positions(w, MAT.WOOD);
      expect(count(MAT.ASH)).toBe(2);
      expect(count(MAT.WOOD)).toBe(size - 2 - 2);
      expect(count(MAT.FIRE) + count(MAT.SMOKE)).toBe(2);
      expect(before.chemicalQ - after.chemicalQ).toBe(2n * WOOD_CHEMICAL_Q);
      expect(wood.filter(([, y]) => y === 2)).toEqual([f.cells.anchor]);
      expect(wood.filter(([, y]) => y === size - 1)).toHaveLength(size - 5);
      expect(w.sample(...f.cells.anchor).anchored).toBe(true);
      expect(w.sample(...f.cells.anchor).integrity).toBe(255);
    });
    test(`${size}^3 sealed chamber: reactions are bounded by its oxidizer, a vented one burns on`, () => {
      const air = sealedAirCells3D(size),
        sealed = run(reactiveFixture3D('sealed', size), thermal),
        vented = run(reactiveFixture3D('vented', size), thermal);
      const sealedAsh = counts(sealed.w.grid)(MAT.ASH),
        ventedAsh = counts(vented.w.grid)(MAT.ASH);
      expect(sealedAsh).toBe(air);
      expect(sealed.before.chemicalQ - sealed.after.chemicalQ).toBe(BigInt(air) * WOOD_CHEMICAL_Q);
      expect(counts(sealed.w.grid)(MAT.FIRE) + counts(sealed.w.grid)(MAT.SMOKE)).toBe(air);
      expect(ventedAsh).toBeGreaterThan(sealedAsh);
      expect(vented.before.chemicalQ - vented.after.chemicalQ).toBe(
        BigInt(ventedAsh) * WOOD_CHEMICAL_Q,
      );
    });
    test(`${size}^3 thermal pack: a copper path melts the wax plug and releases the water, ceramic holds it`, () => {
      const valve = run(reactiveFixture3D('valve', size), thermal),
        barrier = run(reactiveFixture3D('barrier', size), thermal),
        f = reactiveFixture3D('valve', size);
      expect(valve.w.sample(...f.cells.plug).material).not.toBe(THERMAL_MAT_3D.WAX);
      expect(positions(valve.w, MAT.WATER).some(([, y]) => y >= 4)).toBe(true);
      expect(valve.w.sample(...f.cells.source).material).toBe(THERMAL_MAT_3D.COPPER);
      expect(barrier.w.sample(...f.cells.plug).material).toBe(THERMAL_MAT_3D.WAX);
      expect(barrier.w.sample(...f.cells.plug).integrity).toBe(255);
      expect(positions(barrier.w, MAT.WATER).sort()).toEqual(
        [f.cells.waterTop, f.cells.waterBottom].sort(),
      );
      for (const r of [valve, barrier]) {
        expect(r.w.energyBalance().externalQ).toBeGreaterThan(0n);
        expect(r.after.chemicalQ).toBe(r.before.chemicalQ);
      }
    });
  }
  for (const size of [8, 16] as const)
    test(`${size}^3 uniform temperature: burning fuel reacts without any heat flux, dormant fuel never does`, () => {
      const uniform = run(reactiveFixture3D('uniform', size), thermal),
        dormant = reactiveFixture3D('dormant', size),
        w = world(size, dormant.chunkSize, thermal);
      expect(counts(uniform.w.grid)(MAT.ASH)).toBeGreaterThan(0);
      expect(uniform.before.chemicalQ - uniform.after.chemicalQ).toBe(
        BigInt(counts(uniform.w.grid)(MAT.ASH)) * WOOD_CHEMICAL_Q,
      );
      w.edit(dormant.initial);
      const before = w.snapshot();
      w.step(dormant.ticks);
      expect(w.snapshot()).toEqual({ ...before, tick: dormant.ticks });
    });
  test('motion traces and paths cover a reacting tick without counting combustion as movement', () => {
    const f = reactiveFixture3D('bridge', 8),
      w = world(8, 4, thermal);
    w.edit(f.initial);
    w.step(3);
    w.edit(f.scripted.get(3)!);
    const { motion, paths } = w.stepWithMotionPaths();
    expect(motion.physicsRulesVersion).toBe('ca-3d-m6');
    expect(motion.materialCatalogHash).toBe(thermal.hash);
    expect(paths.passesObserved).toBe(28);
    expect(paths.status).toBe('complete');
    expect(counts(w.grid)(MAT.ASH)).toBe(2);
    const restart = w.snapshot(),
      copy = world(8, 8, thermal);
    copy.restore(restart);
    w.step(9);
    copy.step(9);
    expect({ ...copy.snapshot(), chunkSize: 4 }).toEqual(w.snapshot());
  });
});
