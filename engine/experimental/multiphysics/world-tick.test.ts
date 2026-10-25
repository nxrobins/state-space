import { beforeAll, expect, test } from 'vitest';
import { createMultiphysicsProfiles3D, type MultiphysicsProfiles3D } from './profiles.js';
import { seedThermalParcel3D, parcelTemperature3D } from './thermal.js';
import {
  createMultiphysicsSnapshot3D,
  multiphysicsInventory3D,
  inventoryEnergyDelta3D,
  type MultiphysicsSnapshot3D,
} from './model.js';
import { createMultiphysicsTickJob3D } from './world-tick.js';
import { batteryStoredUnits3D } from './battery.js';
import type { Vec3 } from './math.js';
let profiles: MultiphysicsProfiles3D;
beforeAll(async () => {
  profiles = await createMultiphysicsProfiles3D();
});
function seed(
  id: string,
  material: string,
  center: Vec3,
  temperature = 20,
  velocity: Vec3 = [0, 0, 0],
  angularVelocity: Vec3 = [0, 0, 0],
) {
  return seedThermalParcel3D(profiles, {
    id,
    material,
    owner: 'authored',
    center,
    temperature,
    velocity,
    angularVelocity,
  });
}
function run(state: MultiphysicsSnapshot3D, budget = 256) {
  const job = createMultiphysicsTickJob3D(profiles, state);
  while (job.progress().status === 'running')
    expect(job.advance(budget).lastAdvanceWork).toBeLessThanOrEqual(budget);
  return job.result();
}
function circuit(open = false, damaged = false) {
  const parcels = [
    seed('positive', 'copper', [-1, 1, 0]),
    seed('core', 'ceramic', [0, 1, 0]),
    seed('negative', 'copper', [1, 1, 0]),
    seed('left', 'copper', [-1, 2, 0]),
    seed('right', 'copper', [1, 2, 0]),
  ];
  if (!open) parcels.push(seed('bridge', 'copper', [0, 2, 0]));
  return createMultiphysicsSnapshot3D(profiles, {
    parcels,
    settings: { gravity: [0, 0, 0] },
    bonds: damaged
      ? []
      : [
          { a: 'positive', b: 'core', strength: 1e6, restLength: 1 },
          { a: 'core', b: 'negative', strength: 1e6, restLength: 1 },
        ],
    battery: {
      id: 'source',
      positive: 'positive',
      negative: 'negative',
      cores: [{ id: 'core', energyQ: 1000, energyFractionQ: 0 }],
      emf: 12,
      internalResistance: 2,
      failureRateQPerSecond: 3,
      failureTemperature: 180,
      failed: false,
      drawRemainderUnits: 0,
    },
  });
}
test('free fall advances owned matter with conservative potential/kinetic exchange and exact JSON continuation', () => {
  const initial = createMultiphysicsSnapshot3D(profiles, {
    parcels: [seed('a', 'copper', [0, 3, 0])],
  });
  const result = run(initial),
    dt = initial.settings.dt;
  expect(result.snapshot.parcels[0].center[1]).toBeCloseTo(3 - 4.9 * dt * dt, 12);
  expect(result.snapshot.parcels[0].velocity[1]).toBeCloseTo(-9.8 * dt, 12);
  expect(result.report.numericalEnergy).toBeCloseTo(0, 12);
  expect(initial.parcels[0].center).toEqual([0, 3, 0]);
  expect(run(JSON.parse(JSON.stringify(result.snapshot)), 1)).toEqual(run(result.snapshot, 256));
});
test('physical series circuit pays all external/internal Joule heat from its one finite battery', () => {
  const initial = circuit(),
    result = run(initial);
  expect(result.report.battery?.sourceCurrent).toBeCloseTo(2, 11); // 12V / (4 contact ohms + 2 internal ohms)
  const spent =
    BigInt(batteryStoredUnits3D(initial.battery!)) -
    BigInt(batteryStoredUnits3D(result.snapshot.battery!));
  expect(spent).toBeGreaterThan(0n);
  expect(result.report.battery?.drawnUnits).toBe(String(spent));
  expect(
    parcelTemperature3D(profiles, result.snapshot.parcels.find((p) => p.id === 'core')!),
  ).toBeGreaterThan(20);
  expect(
    inventoryEnergyDelta3D(
      multiphysicsInventory3D(initial),
      multiphysicsInventory3D(result.snapshot),
    ),
  ).toBeCloseTo(0, 11);
  const open = run(circuit(true));
  expect(open.report.battery?.sourceCurrent).toBe(0);
  expect(open.report.battery?.drawnUnits).toBe('0');
});
test('broken battery cores stop electrical output and retain their paid bounded thermal discharge', () => {
  const initial = circuit(false, true),
    result = run(initial);
  expect(result.snapshot.battery?.failed).toBe(true);
  expect(result.report.battery?.sourceCurrent).toBe(0);
  expect(Number(result.report.battery!.drawnUnits) / 1048576).toBeLessThanOrEqual(
    3 * initial.settings.dt,
  );
  expect(Number(result.report.battery!.drawnUnits)).toBeGreaterThan(0);
  expect(
    inventoryEnergyDelta3D(
      multiphysicsInventory3D(initial),
      multiphysicsInventory3D(result.snapshot),
    ),
  ).toBeCloseTo(0, 11);
  expect(run(JSON.parse(JSON.stringify(result.snapshot))).snapshot.battery?.failed).toBe(true);
});
test('spinning melt preserves finite parcel mass/spin and releases its solid ownership', () => {
  const initial = createMultiphysicsSnapshot3D(profiles, {
    parcels: [seed('wax', 'wax', [0, 2, 0], 60, [0, 0, 0], [0, 0, 2])],
    settings: { gravity: [0, 0, 0] },
  });
  const result = run(initial),
    before = multiphysicsInventory3D(initial),
    after = multiphysicsInventory3D(result.snapshot);
  expect(result.snapshot.parcels[0].material).toBe('molten_wax');
  expect(result.snapshot.parcels[0].owner).toBe('fluid');
  expect(after.mass).toBe(before.mass);
  expect(after.angularMomentum[2]).toBeCloseTo(before.angularMomentum[2], 12);
  expect(inventoryEnergyDelta3D(before, after)).toBeCloseTo(0, 11);
});
test('gas pressure expands saved volume and funds motion from profile-aware internal energy', () => {
  const initial = createMultiphysicsSnapshot3D(profiles, {
    parcels: [seed('air-a', 'air', [0, 0, 0]), seed('air-b', 'air', [1, 0, 0])],
    settings: { gravity: [0, 0, 0], dt: 0.001 },
  });
  const result = run(initial),
    before = multiphysicsInventory3D(initial),
    after = multiphysicsInventory3D(result.snapshot);
  expect(result.snapshot.gasVolumes.every((g) => g.volume > 1)).toBe(true);
  expect(result.snapshot.parcels[0].velocity[0]).toBeLessThan(0);
  expect(after.mechanicalEnergy).toBeGreaterThan(before.mechanicalEnergy);
  expect(BigInt(after.storedSubQ)).toBeLessThan(BigInt(before.storedSubQ));
  expect(inventoryEnergyDelta3D(before, after)).toBeCloseTo(0, 10);
  expect(after.linearMomentum).toEqual([0, 0, 0]);
});
test('cancellation and result ownership cannot publish a partial tick', () => {
  const initial = circuit(),
    original = structuredClone(initial),
    job = createMultiphysicsTickJob3D(profiles, initial);
  job.advance(3);
  expect(() => job.result()).toThrow();
  expect(job.cancel()).toBe(true);
  expect(job.advance().status).toBe('cancelled');
  expect(() => job.result()).toThrow();
  expect(initial).toEqual(original);
  const completed = createMultiphysicsTickJob3D(profiles, initial);
  while (completed.progress().status === 'running') completed.advance();
  const copy = completed.result();
  copy.snapshot.parcels[0].mass = 999;
  expect(completed.result().snapshot.parcels[0].mass).not.toBe(999);
  expect(run(initial, 1)).toEqual(run(initial, 256));
});

test('liquid column couples to a sampled wide floor without leaking through its boundary', () => {
  const floor = seedThermalParcel3D(profiles, {
    id: 'floor',
    material: 'ceramic',
    owner: 'fixed',
    center: [0, 0, 0],
    halfExtents: [2.5, 0.5, 2.5],
  });
  const water = Array.from({ length: 27 }, (_, i) =>
    seed(`water-${i}`, 'water', [(i % 3) - 1, 1 + Math.floor(i / 9), (Math.floor(i / 3) % 3) - 1]),
  );
  let state = createMultiphysicsSnapshot3D(profiles, {
    parcels: [floor, ...water],
    anchors: ['floor'],
  });
  const initial = multiphysicsInventory3D(state);
  let maximumDensityError = 0;
  for (let i = 0; i < 12; i++) {
    const result = run(state);
    state = result.snapshot;
    maximumDensityError = Math.max(
      maximumDensityError,
      result.report.fluid?.convergence.densityError ?? 0,
    );
  }
  expect(state.parcels.filter((p) => p.id !== 'floor').every((p) => p.center[1] >= 1 - 1e-5)).toBe(
    true,
  );
  expect(multiphysicsInventory3D(state).mass).toBe(initial.mass);
  expect(maximumDensityError).toBeLessThanOrEqual(1e-4);
  expect(state.accounting.externalStoredSubQ).toBe('0');
});

test('freezing spinning liquid preserves its stored inertia, momentum, and energy in a fresh solid owner', () => {
  const liquid = seed('wax', 'molten_wax', [0, 3, 0], 0, [1, 0, 0], [0, 0, 2]);
  const initial = createMultiphysicsSnapshot3D(profiles, {
    parcels: [liquid],
    settings: { gravity: [0, 0, 0] },
  });
  const result = run(initial),
    before = multiphysicsInventory3D(initial),
    after = multiphysicsInventory3D(result.snapshot);
  expect(result.snapshot.parcels[0].material).toBe('wax');
  expect(result.snapshot.parcels[0].owner).toMatch(/^solid:/);
  expect(result.snapshot.parcels[0].principalInertia).toEqual(liquid.principalInertia);
  expect(after.mass).toBe(before.mass);
  expect(after.linearMomentum).toEqual(before.linearMomentum);
  after.angularMomentum.forEach((v, i) => expect(v).toBeCloseTo(before.angularMomentum[i], 11));
  expect(inventoryEnergyDelta3D(before, after)).toBeCloseTo(0, 11);
});

test('compressing gas heats from paid mechanical work in a complete world tick', () => {
  const initial = createMultiphysicsSnapshot3D(profiles, {
    parcels: [
      seed('a', 'air', [0, 0, 0], 20, [1, 0, 0]),
      seed('b', 'air', [1, 0, 0], 20, [-1, 0, 0]),
    ],
    settings: { gravity: [0, 0, 0], dt: 0.001 },
  });
  const result = run(initial),
    before = multiphysicsInventory3D(initial),
    after = multiphysicsInventory3D(result.snapshot);
  expect(result.snapshot.gasVolumes.every((g) => g.volume < 1)).toBe(true);
  expect(result.snapshot.parcels.every((p) => parcelTemperature3D(profiles, p) > 20)).toBe(true);
  expect(after.mechanicalEnergy).toBeLessThan(before.mechanicalEnergy);
  expect(inventoryEnergyDelta3D(before, after)).toBeCloseTo(0, 10);
});

test('moving water transfers force and torque to a bonded conductor without losing momentum or impact heat', () => {
  const initial = createMultiphysicsSnapshot3D(profiles, {
    parcels: [
      seed('water', 'water', [0, 0, 0], 20, [2, 0, 0]),
      seed('lower', 'copper', [1, 0, 0]),
      seed('upper', 'copper', [1, 1, 0]),
    ],
    bonds: [{ a: 'lower', b: 'upper', strength: 1e6, restLength: 1 }],
    settings: { gravity: [0, 0, 0], dt: 0.001 },
  });
  const result = run(initial),
    before = multiphysicsInventory3D(initial),
    after = multiphysicsInventory3D(result.snapshot);
  const copper = result.snapshot.parcels.filter((p) => p.material === 'copper');
  expect(copper.every((p) => p.velocity[0] > 0)).toBe(true);
  expect(copper.every((p) => p.intrinsicAngularMomentum[2] > 0)).toBe(true);
  expect(result.report.fluid!.energy.contactHeat + result.report.mechanicalHeat).toBeGreaterThan(0);
  after.linearMomentum.forEach((v, i) => expect(v).toBeCloseTo(before.linearMomentum[i], 10));
  after.angularMomentum.forEach((v, i) => expect(v).toBeCloseTo(before.angularMomentum[i], 10));
  const delta = inventoryEnergyDelta3D(before, after);
  expect(delta).toBeCloseTo(result.report.numericalEnergy, 12);
  expect(Math.abs(delta)).toBeLessThan(1e-4); // Explicit pressure/projection error, never heat.
});

test('burning a rotating support breaks its bond while preserving fuel products, matter, and spin', () => {
  const initial = createMultiphysicsSnapshot3D(profiles, {
    parcels: [
      seed('fuel', 'wood', [0, 0, 0], 220, [0, 0, 0], [0, 0, 1]),
      seed('beam', 'ceramic', [1, 0, 0], 220, [0, 1, 0], [0, 0, 1]),
      seed('oxygen', 'air', [0, 1, 0], 220, [-1, 0, 0], [0, 0, 1]),
    ],
    bonds: [{ a: 'fuel', b: 'beam', strength: 1e6, restLength: 1 }],
    settings: { gravity: [0, 0, 0], dt: 0.00001 },
  });
  const result = run(initial),
    before = multiphysicsInventory3D(initial),
    after = multiphysicsInventory3D(result.snapshot);
  expect(result.report.burns).toHaveLength(1);
  expect(result.report.brokenBonds).toHaveLength(1);
  expect(result.snapshot.bonds).toHaveLength(0);
  expect(result.snapshot.parcels.find((p) => p.id === 'fuel')!.material).toBe('ash');
  expect(result.snapshot.parcels.find((p) => p.id === 'oxygen')!.material).toBe('fire');
  expect(result.snapshot.parcels.every((p) => p.chemicalQ === 0)).toBe(true);
  expect(after.mass).toBe(before.mass);
  after.linearMomentum.forEach((v, i) => expect(v).toBeCloseTo(before.linearMomentum[i], 9));
  after.angularMomentum.forEach((v, i) => expect(v).toBeCloseTo(before.angularMomentum[i], 9));
  expect(Math.abs(inventoryEnergyDelta3D(before, after))).toBeLessThan(1e-8);
});

test('a falling tilted battery fractures physically and then pays its bounded core discharge', () => {
  const angle = 0.25,
    q = [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)] as const;
  const part = (id: string, material: string, x: number) =>
    seedThermalParcel3D(profiles, {
      id,
      material,
      owner: 'authored',
      center: [x * Math.cos(angle), 2 + x * Math.sin(angle), 0],
      orientation: q,
      temperature: 20,
    });
  let state = createMultiphysicsSnapshot3D(profiles, {
    parcels: [
      part('positive', 'copper', -1),
      part('core', 'ceramic', 0),
      part('negative', 'copper', 1),
      seedThermalParcel3D(profiles, {
        id: 'floor',
        material: 'ceramic',
        owner: 'fixed',
        center: [0, 0, 0],
        halfExtents: [4, 0.5, 4],
        temperature: 20,
      }),
    ],
    anchors: ['floor'],
    settings: { dt: 1 / 240 },
    bonds: [
      { a: 'positive', b: 'core', strength: 0.001, restLength: 1 },
      { a: 'core', b: 'negative', strength: 0.001, restLength: 1 },
    ],
    battery: {
      id: 'source',
      positive: 'positive',
      negative: 'negative',
      cores: [{ id: 'core', energyQ: 1000, energyFractionQ: 0 }],
      emf: 12,
      internalResistance: 2,
      failureRateQPerSecond: 3,
      failureTemperature: 180,
      failed: false,
      drawRemainderUnits: 0,
    },
  });
  const mass = multiphysicsInventory3D(state).mass;
  for (let step = 0; step < 240 && !state.battery!.failed; step++) state = run(state).snapshot;
  expect(state.battery!.failed).toBe(true);
  expect(state.bonds.length).toBeLessThan(2);
  const remaining = BigInt(batteryStoredUnits3D(state.battery!)),
    next = run(state);
  const spent = remaining - BigInt(batteryStoredUnits3D(next.snapshot.battery!));
  expect(spent).toBeGreaterThan(0n);
  expect(next.report.battery!.sourceCurrent).toBe(0);
  expect(Number(spent) / 1048576).toBeLessThanOrEqual(3 * state.settings.dt);
  expect(multiphysicsInventory3D(next.snapshot).mass).toBe(mass);
  state = next.snapshot;
  for (let step = 0; step < 4; step++) state = run(state).snapshot;
  expect(state.battery!.failed).toBe(true);
  expect(multiphysicsInventory3D(state).mass).toBe(mass);
});
