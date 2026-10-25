import { beforeAll, expect, test } from 'vitest';
import { createMultiphysicsProfiles3D, type MultiphysicsProfiles3D } from './profiles.js';
import {
  seedThermalParcel3D,
  parcelTemperature3D,
  depositParcelHeat3D,
  THERMAL_FRACTION_SCALE_3D,
} from './thermal.js';
import {
  createMultiphysicsSnapshot3D,
  multiphysicsInventory3D,
  inventoryEnergyDelta3D,
  type MultiphysicsSnapshot3D,
} from './model.js';
import { createMultiphysicsTickJob3D } from './world-tick.js';
import { batteryStoredUnits3D } from './battery.js';
import { createMultiphysicsWorld3D } from './world.js';
import { createMultiphysicsDemonstration3D } from './demonstrations.js';
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
  const network = result.report.battery!.network!;
  expect(network.sampledTick).toBe(initial.tick);
  for (const [id, potential] of Object.entries({
    positive: 8,
    left: 6,
    bridge: 4,
    right: 2,
    negative: 0,
  }))
    expect(network.nodes.find((n) => n.id === id)!.potential).toBeCloseTo(potential, 10);
  expect(network.nodes.find((n) => n.id === 'core')!.potential).toBeNull();
  expect(network.edges).toHaveLength(4);
  for (const edge of network.edges) {
    const a = network.nodes.find((n) => n.id === edge.a)!.potential!,
      b = network.nodes.find((n) => n.id === edge.b)!.potential!;
    expect(edge.current).toBeCloseTo((a - b) / edge.resistance, 11);
    expect(edge.power).toBeCloseTo(4, 11);
  }
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
  let state = createMultiphysicsDemonstration3D(profiles, 'falling-battery');
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

test.each(['water', 'air'])(
  'fluid-driven %s loads break a weak conductor bond and preserve matter and momentum',
  (material) => {
    const scene = (strength: number, offset: Vec3 = [0, 0, 0], anchored = false, driven = true) => {
      const position = (x: number, y: number): Vec3 => [x + offset[0], y + offset[1], offset[2]];
      return createMultiphysicsSnapshot3D(profiles, {
        parcels: [
          seed(
            'fluid',
            material,
            position(0, 0),
            driven || material === 'water' ? 20 : 0,
            driven && material === 'water' ? [2, 0, 0] : [0, 0, 0],
          ),
          seed('lower', 'copper', position(1, 0), 0),
          seed('upper', 'copper', position(1, 1), 0),
        ],
        bonds: [{ a: 'lower', b: 'upper', strength, restLength: 1 }],
        anchors: anchored ? ['upper'] : [],
        settings: { gravity: [0, 0, 0], dt: 0.001 },
      });
    };
    const initial = scene(0.0001),
      weak = run(initial),
      strong = run(scene(1e6)),
      shifted = run(scene(0.0001, [5, -3, 2]));
    expect(weak.report.brokenBonds).toHaveLength(1);
    expect(weak.snapshot.bonds).toHaveLength(0);
    expect(strong.snapshot.bonds).toHaveLength(1);
    expect(shifted.report.brokenBonds).toEqual(weak.report.brokenBonds);
    expect(weak.snapshot.parcels.find((p) => p.id === 'lower')!.owner).not.toBe(
      weak.snapshot.parcels.find((p) => p.id === 'upper')!.owner,
    );
    for (const p of weak.snapshot.parcels) {
      const q = shifted.snapshot.parcels.find((q) => q.id === p.id)!;
      p.velocity.forEach((v, i) => expect(q.velocity[i]).toBeCloseTo(v, 10));
      p.intrinsicAngularMomentum.forEach((v, i) =>
        expect(q.intrinsicAngularMomentum[i]).toBeCloseTo(v, 10),
      );
      const held = strong.snapshot.parcels.find((q) => q.id === p.id)!;
      expect(held.velocity).toEqual(p.velocity); // fracture releases the existing motion, after all coupled impulses
      expect(held.intrinsicAngularMomentum).toEqual(p.intrinsicAngularMomentum);
    }
    const before = multiphysicsInventory3D(initial),
      after = multiphysicsInventory3D(weak.snapshot);
    expect(after.mass).toBe(before.mass);
    after.linearMomentum.forEach((v, i) => expect(v).toBeCloseTo(before.linearMomentum[i], 10));
    after.angularMomentum.forEach((v, i) => expect(v).toBeCloseTo(before.angularMomentum[i], 10));
    expect(inventoryEnergyDelta3D(before, after)).toBeCloseTo(weak.report.numericalEnergy, 11);
    expect(run(scene(0.0001, [0, 0, 0], false, false)).snapshot.bonds).toHaveLength(1);
    const fixed = run(scene(0.0001, [0, 0, 0], true));
    expect(fixed.snapshot.bonds).toHaveLength(0);
    expect(Math.hypot(...fixed.report.boundaryLinearImpulse)).toBeGreaterThan(0);
    expect(run(JSON.parse(JSON.stringify(weak.snapshot)), 1)).toEqual(run(weak.snapshot, 256));
  },
);

test('a moving finite source depletes within the tick without extra heat or stopping its motion', () => {
  const source = circuit();
  const initial = createMultiphysicsSnapshot3D(profiles, {
    parcels: source.parcels.map((p) => ({ ...p, velocity: [2, 0, 0] })),
    bonds: source.bonds,
    settings: source.settings,
    battery: { ...source.battery!, cores: [{ id: 'core', energyQ: 1, energyFractionQ: 0 }] },
  });
  const result = run(initial),
    next = run(result.snapshot),
    report = result.report.battery!;
  expect(report.depleted).toBe(true);
  expect(report.drawnUnits).toBe('1048576');
  expect(report.sourceCurrent).toBeCloseTo(2, 11);
  expect(report.activeSeconds).toBeCloseTo(1 / (24 * 256), 14);
  expect(batteryStoredUnits3D(result.snapshot.battery!)).toBe('0');
  for (const p of result.snapshot.parcels) {
    expect(p.center[0]).toBeCloseTo(
      initial.parcels.find((q) => q.id === p.id)!.center[0] + 2 * initial.settings.dt,
      12,
    );
    expect(p.velocity).toEqual([2, 0, 0]);
  }
  expect(next.report.battery!.drawnUnits).toBe('0');
  expect(next.report.battery!.sourceCurrent).toBe(0);
  expect(next.report.battery!.network).toBeNull();
  expect(
    inventoryEnergyDelta3D(
      multiphysicsInventory3D(initial),
      multiphysicsInventory3D(next.snapshot),
    ),
  ).toBeCloseTo(0, 10);
  expect(run(JSON.parse(JSON.stringify(result.snapshot)))).toEqual(next);
});

test('a copper path remains electrically live after melting while its finite face contacts remain', () => {
  const source = circuit();
  const initial = createMultiphysicsSnapshot3D(profiles, {
    parcels: source.parcels.map((p) =>
      p.id === 'bridge' ? seed('bridge', 'copper', p.center, 160) : p,
    ),
    bonds: source.bonds,
    battery: source.battery,
    settings: source.settings,
  });
  const melted = run(initial),
    liquid = run(melted.snapshot);
  expect(melted.snapshot.parcels.find((p) => p.id === 'bridge')!.material).toBe('molten_copper');
  expect(liquid.snapshot.parcels.find((p) => p.id === 'bridge')!.owner).toBe('fluid');
  expect(liquid.report.battery!.sourceCurrent).toBeCloseTo(2, 10);
  expect(
    liquid.report.battery!.network!.nodes.find((p) => p.id === 'bridge')!.potential,
  ).toBeCloseTo(4, 10);
  expect(multiphysicsInventory3D(liquid.snapshot).mass).toBe(multiphysicsInventory3D(initial).mass);
  expect(
    inventoryEnergyDelta3D(
      multiphysicsInventory3D(initial),
      multiphysicsInventory3D(liquid.snapshot),
    ),
  ).toBeCloseTo(0, 9);
});

test('fractured battery cores retain separate finite stores and removing one cannot refill the other', () => {
  const source = circuit();
  const initial = createMultiphysicsSnapshot3D(profiles, {
    parcels: [
      ...source.parcels,
      seed('second-core', 'ceramic', [0, 1, 1]),
      seed('gas', 'air', [0, 1, 2]),
    ],
    anchors: ['core'],
    bonds: [...source.bonds, { a: 'core', b: 'second-core', strength: 0.0001, restLength: 1 }],
    settings: source.settings,
    battery: {
      ...source.battery!,
      cores: [
        { id: 'core', energyQ: 600, energyFractionQ: 0 },
        { id: 'second-core', energyQ: 400, energyFractionQ: 0 },
      ],
    },
  });
  const broken = run(initial),
    failed = run(broken.snapshot);
  expect(broken.snapshot.battery!.failed).toBe(true);
  expect(failed.report.battery!.sourceCurrent).toBe(0);
  expect(failed.report.battery!.network).toBeNull();
  const cores = failed.snapshot.battery!.cores;
  expect(cores).toHaveLength(2);
  for (const core of cores)
    expect(core.energyQ + core.energyFractionQ).toBeLessThan(core.id === 'core' ? 600 : 400);
  expect(
    inventoryEnergyDelta3D(
      multiphysicsInventory3D(initial),
      multiphysicsInventory3D(failed.snapshot),
    ),
  ).toBeCloseTo(failed.snapshot.accounting.numericalEnergy, 10);
  expect(Math.abs(failed.snapshot.accounting.numericalEnergy)).toBeLessThan(1e-4);
  const world = createMultiphysicsWorld3D(profiles, failed.snapshot);
  const removed = world.edit([{ kind: 'remove', ids: ['core'] }]);
  expect(removed.result.snapshot.battery!.cores).toEqual([
    cores.find((c) => c.id === 'second-core')!,
  ]);
  expect(BigInt(removed.result.edits.storedSubQ)).toBeLessThan(0n);
  const continued = run(world.snapshot());
  expect(continued.snapshot.battery!.failed).toBe(true);
  expect(BigInt(batteryStoredUnits3D(continued.snapshot.battery!))).toBeLessThan(
    BigInt(batteryStoredUnits3D(world.snapshot().battery!)),
  );
  expect(run(JSON.parse(JSON.stringify(world.snapshot())))).toEqual(continued);
});

test('touching liquid parcels freeze immediately without joining or moving', () => {
  const initial = createMultiphysicsSnapshot3D(profiles, {
    parcels: [seed('a', 'water', [0, 3, 0], 0), seed('b', 'water', [1, 3, 0], 0)],
    settings: { gravity: [0, 0, 0], dt: 0.001 },
  });
  const result = run(initial);
  expect(result.snapshot.parcels.map((p) => p.material)).toEqual(['ice', 'ice']);
  expect(result.snapshot.parcels.map((p) => p.center)).toEqual(
    initial.parcels.map((p) => p.center),
  );
  expect(result.report.deferredTransitions).toEqual([]);
  expect(result.snapshot.bonds).toEqual([]);
  expect(result.snapshot.anchors).toEqual([]);
  expect(multiphysicsInventory3D(result.snapshot)).toEqual(multiphysicsInventory3D(initial));
});

test('solidification retains liquid geometry at a rotated wall', () => {
  const liquid = seed('water', 'water', [1.1, 0, 0], 0);
  liquid.orientation = [0, 0, Math.sin(Math.PI / 8), Math.cos(Math.PI / 8)];
  const initial = createMultiphysicsSnapshot3D(profiles, {
    parcels: [seed('wall', 'copper', [0, 0, 0], 15), liquid],
    anchors: ['wall'],
    settings: { gravity: [0, 0, 0], dt: 0.001 },
  });
  const result = run(initial);
  expect(result.snapshot.parcels).toEqual(initial.parcels);
  expect(result.report.deferredTransitions).toEqual([
    { id: 'water', from: 'water', to: 'ice', kind: 'phase', blockedBy: ['wall'] },
  ]);
  expect(result.report.transitions).toEqual([]);
  expect(run(initial, 1)).toEqual(result);
  const job = createMultiphysicsTickJob3D(profiles, initial);
  while (job.progress().status === 'running' && job.progress().stage !== 'phase-admission')
    job.advance(1);
  expect(job.progress().stage).toBe('phase-admission');
  expect(job.cancel()).toBe(true);
  expect(() => job.result()).toThrow();
  expect(initial.parcels.find((p) => p.id === 'water')!.material).toBe('water');
});

test('phase admission does not conceal pre-existing invalid solid penetration', () => {
  const initial = createMultiphysicsSnapshot3D(profiles, {
    parcels: [seed('a', 'ice', [0, 3, 0], 10), seed('b', 'ice', [0.9, 3, 0], 10)],
    settings: { gravity: [0, 0, 0], dt: 0.001 },
  });
  expect(() => run(initial)).toThrow(/penetration/);
});

test('postponed solidification retains the current enthalpy after conduction', () => {
  const initial = createMultiphysicsSnapshot3D(profiles, {
    parcels: [0, 0.9].map((x, i) =>
      depositParcelHeat3D(
        profiles,
        seed(String(i), 'water', [x, 3, 0], 0),
        -BigInt((i + 1) * 256 * THERMAL_FRACTION_SCALE_3D),
      ),
    ),
    settings: { gravity: [0, 0, 0], dt: 0.001 },
  });
  const result = run(initial);
  expect(result.snapshot.parcels.map((p) => p.material)).toEqual(['water', 'water']);
  expect(result.report.deferredTransitions).toHaveLength(2);
  expect(parcelTemperature3D(profiles, result.snapshot.parcels[0])).toBeLessThan(14);
  expect(parcelTemperature3D(profiles, result.snapshot.parcels[1])).toBeGreaterThan(13);
  expect(multiphysicsInventory3D(result.snapshot)).toEqual(multiphysicsInventory3D(initial));
  expect(result.snapshot.parcels.map((p) => p.center)).toEqual(
    initial.parcels.map((p) => p.center),
  );
});
