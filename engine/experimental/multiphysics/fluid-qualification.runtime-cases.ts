/** Extended release gates. Run explicitly under the supervisor; report each result independently. */
import { beforeAll, expect, test } from 'vitest';
import { createMultiphysicsProfiles3D, type MultiphysicsProfiles3D } from './profiles.js';
import { seedThermalParcel3D, depositParcelHeat3D, THERMAL_FRACTION_SCALE_3D } from './thermal.js';
import { orientedCuboidContact } from './collision.js';
import {
  createMultiphysicsSnapshot3D,
  multiphysicsInventory3D,
  inventoryEnergyDelta3D,
  type MultiphysicsSnapshot3D,
} from './model.js';
import { createMultiphysicsWorld3D } from './world.js';
import { createMultiphysicsDemonstration3D } from './demonstrations.js';
import { createMultiphysicsTickJob3D } from './world-tick.js';
import type { Vec3 } from './math.js';
let profiles: MultiphysicsProfiles3D;
beforeAll(async () => {
  profiles = await createMultiphysicsProfiles3D();
});

test('sustained resting liquid support neither leaks nor creates artificial heat', () => {
  const seed = (id: string, material: string, center: Vec3, halfExtents: Vec3 = [0.5, 0.5, 0.5]) =>
    seedThermalParcel3D(profiles, {
      id,
      material,
      center,
      halfExtents,
      owner: 'authored',
      temperature: 20,
    });
  const walls = [
    seed('floor', 'ceramic', [0, 0, 0], [1.5, 0.5, 1.5]),
    seed('left', 'ceramic', [-2, 2, 0], [0.5, 1.5, 1.5]),
    seed('right', 'ceramic', [2, 2, 0], [0.5, 1.5, 1.5]),
    seed('front', 'ceramic', [0, 2, -2], [2.5, 1.5, 0.5]),
    seed('back', 'ceramic', [0, 2, 2], [2.5, 1.5, 0.5]),
  ];
  const water = Array.from({ length: 27 }, (_, i) =>
    seed(`w${i}`, 'water', [(i % 3) - 1, 1 + Math.floor(i / 9), (Math.floor(i / 3) % 3) - 1]),
  );
  const measured = [];
  for (const dt of [1 / 120, 1 / 240]) {
    let state = createMultiphysicsSnapshot3D(profiles, {
      parcels: [...walls, ...water],
      anchors: walls.map((p) => p.id),
      settings: { dt },
    });
    let heat = 0,
      maximumSpeed = 0,
      maximumMove = 0;
    const mass = multiphysicsInventory3D(state).mass;
    for (let step = 0; step < Math.round(0.5 / dt); step++) {
      const job = createMultiphysicsTickJob3D(profiles, state);
      while (job.progress().status === 'running') job.advance(256);
      const result = job.result();
      state = result.snapshot;
      heat +=
        result.report.mechanicalHeat +
        result.report.fluid!.energy.viscousHeat +
        result.report.fluid!.energy.contactHeat;
      for (const p of state.parcels.filter((p) => p.material === 'water')) {
        maximumSpeed = Math.max(maximumSpeed, Math.hypot(...p.velocity));
        maximumMove = Math.max(
          maximumMove,
          Math.hypot(...p.center.map((v, i) => v - water.find((q) => q.id === p.id)!.center[i])),
        );
      }
    }
    measured.push({
      dt,
      heat,
      maximumSpeed,
      maximumMove,
      energy: state.accounting.numericalEnergy,
    });
    console.log(JSON.stringify({ case: 'sustained-liquid', measured }));
    expect(multiphysicsInventory3D(state).mass).toBe(mass);
  }
  for (const row of measured) {
    expect(row.heat).toBeLessThan(1e-9);
    expect(row.maximumSpeed).toBeLessThan(1e-6);
    expect(row.maximumMove).toBeLessThan(1e-6);
    expect(Math.abs(row.energy)).toBeLessThan(1e-6);
  }
}, 30000);

test('heated gas over a floor expands and rises relative to an otherwise identical cold column', () => {
  const measured = [];
  for (const dt of [0.0005, 0.00025]) {
    for (const temperature of [20, 80]) {
      const floor = seedThermalParcel3D(profiles, {
        id: 'floor',
        material: 'ceramic',
        center: [0, 0, 0],
        halfExtents: [2.5, 0.5, 2.5],
        owner: 'fixed',
        temperature: 20,
      });
      const gas = Array.from({ length: 27 }, (_, i) =>
        seedThermalParcel3D(profiles, {
          id: `g${i}`,
          material: 'air',
          owner: 'authored',
          center: [(i % 3) - 1, 1 + Math.floor(i / 9), (Math.floor(i / 3) % 3) - 1],
          temperature: i === 4 ? temperature : 20,
        }),
      );
      let state = createMultiphysicsSnapshot3D(profiles, {
        parcels: [floor, ...gas],
        anchors: ['floor'],
        settings: { dt },
      });
      const mass = multiphysicsInventory3D(state).mass;
      for (let step = 0; step < Math.round(0.03 / dt); step++) {
        const job = createMultiphysicsTickJob3D(profiles, state);
        while (job.progress().status === 'running') job.advance(256);
        state = job.result().snapshot;
      }
      const parcel = state.parcels.find((p) => p.id === 'g4')!;
      measured.push({
        temperature,
        dt,
        height: parcel.center[1],
        speed: parcel.velocity[1],
        volume: state.gasVolumes.find((v) => v.id === 'g4')!.volume,
        energy: state.accounting.numericalEnergy,
      });
      console.log(JSON.stringify({ case: 'heated-gas', measured }));
      expect(multiphysicsInventory3D(state).mass).toBe(mass);
      expect(state.accounting.externalStoredSubQ).toBe('0');
    }
  }
  for (const row of measured) expect(Math.abs(row.energy)).toBeLessThan(1e-4);
  for (let i = 0; i < measured.length; i += 2) {
    expect(measured[i + 1].height).toBeGreaterThan(measured[i].height);
    expect(measured[i + 1].speed).toBeGreaterThan(measured[i].speed);
    expect(measured[i + 1].volume).toBeGreaterThan(measured[i].volume);
  }
}, 30000);

function run(state: MultiphysicsSnapshot3D) {
  const job = createMultiphysicsTickJob3D(profiles, state);
  try {
    while (job.progress().status === 'running') job.advance(256);
    return job.result();
  } catch (error) {
    throw Error(`Tick ${state.tick}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

test('source heating releases fluid that breaks a loaded support, while the unpowered control holds', () => {
  const initial = createMultiphysicsDemonstration3D(profiles, 'combined-failure');
  let state = initial,
    releasedAt = -1,
    brokenAt = -1;
  for (let i = 0; i < 80; i++) {
    const result = run(state);
    state = result.snapshot;
    if (releasedAt < 0 && state.parcels.find((p) => p.id === 'valve')!.material === 'molten_wax')
      releasedAt = i;
    if (result.report.brokenBonds.some((b) => b.a === 'plate' || b.b === 'plate')) {
      brokenAt = i;
      break;
    }
  }
  expect(releasedAt).toBeGreaterThanOrEqual(0);
  expect(brokenAt).toBeGreaterThan(releasedAt);
  expect(state.parcels.find((p) => p.id === 'water')!.center[1]).toBeLessThan(3);
  expect(state.parcels.find((p) => p.id === 'plate')!.owner).not.toBe(
    state.parcels.find((p) => p.id === 'core')!.owner,
  );
  expect(multiphysicsInventory3D(state).mass).toBe(multiphysicsInventory3D(initial).mass);
  expect(state.accounting.externalStoredSubQ).toBe('0');
  expect(run(JSON.parse(JSON.stringify(state)))).toEqual(run(state));
  for (let i = 0; i < 8; i++) state = run(state).snapshot;
  expect(state.parcels.find((p) => p.id === 'plate')!.center[1]).toBeLessThan(0.75);
  const world = createMultiphysicsWorld3D(profiles, initial);
  world.edit([{ kind: 'battery', battery: null }]);
  let control = world.snapshot();
  for (let i = 0; i <= brokenAt + 8; i++) control = run(control).snapshot;
  expect(control.parcels.find((p) => p.id === 'valve')!.material).toBe('wax');
  expect(control.bonds.some((b) => b.a === 'plate' || b.b === 'plate')).toBe(true);
});

test('overlapping liquid retains its state while freezing waits, then solidifies when motion creates room', () => {
  const initial = createMultiphysicsSnapshot3D(profiles, {
    parcels: [0, 0.9].map((x, i) =>
      seedThermalParcel3D(profiles, {
        id: String(i),
        material: 'water',
        center: [x, 3, 0],
        owner: 'fluid',
        temperature: 0,
      }),
    ),
    settings: { gravity: [0, 0, 0], dt: 0.001 },
  });
  const held = run(initial);
  expect(held.snapshot.parcels).toEqual(initial.parcels);
  expect(held.report.transitions).toEqual([]);
  expect(held.report.deferredTransitions).toEqual([
    { id: '0', from: 'water', to: 'ice', kind: 'phase', blockedBy: ['1'] },
    { id: '1', from: 'water', to: 'ice', kind: 'phase', blockedBy: ['0'] },
  ]);
  expect(multiphysicsInventory3D(held.snapshot)).toEqual(multiphysicsInventory3D(initial));
  expect(run(JSON.parse(JSON.stringify(held.snapshot)))).toEqual(run(held.snapshot));

  // Supply separating initial motion and enough cooling below the transition
  // threshold that physical viscosity cannot reheat the pair past freezing.
  const moving = createMultiphysicsSnapshot3D(profiles, {
    parcels: initial.parcels.map((p, i) =>
      depositParcelHeat3D(
        profiles,
        { ...p, velocity: [i === 0 ? -0.5 : 0.5, 0, 0] },
        -256n * BigInt(THERMAL_FRACTION_SCALE_3D),
      ),
    ),
    settings: initial.settings,
  });
  let state = moving,
    frozenAt = -1;
  for (let i = 0; i < 200; i++) {
    const result = run(state);
    state = result.snapshot;
    if (state.parcels.every((p) => p.material === 'ice')) {
      frozenAt = i;
      break;
    }
  }
  expect(frozenAt).toBeGreaterThan(0);
  expect(state.parcels.map((p) => p.material)).toEqual(['ice', 'ice']);
  expect(orientedCuboidContact(state.parcels[0], state.parcels[1])?.depth ?? 0).toBeLessThanOrEqual(
    1e-8,
  );
  expect(state.bonds).toEqual([]);
  expect(state.anchors).toEqual([]);
  const before = multiphysicsInventory3D(moving),
    after = multiphysicsInventory3D(state);
  expect(after.mass).toBe(before.mass);
  expect(inventoryEnergyDelta3D(before, after)).toBeCloseTo(0, 8);
  after.linearMomentum.forEach((v, i) => expect(v).toBeCloseTo(before.linearMomentum[i], 9));
  after.angularMomentum.forEach((v, i) => expect(v).toBeCloseTo(before.angularMomentum[i], 9));
  expect(state.accounting.externalStoredSubQ).toBe('0');
});

test('moving paddle: an off-center plate drives resting liquid with equal and opposite momentum and torque', () => {
  const seed = (id: string, material: string, center: Vec3, halfExtents: Vec3, velocity: Vec3) =>
    seedThermalParcel3D(profiles, {
      id,
      material,
      center,
      halfExtents,
      velocity,
      owner: 'authored',
      temperature: 20,
    });
  const water = Array.from({ length: 27 }, (_, i) =>
    seed(
      `w${i}`,
      'water',
      [(i % 3) - 1, Math.floor(i / 9) - 1, (Math.floor(i / 3) % 3) - 1],
      [0.5, 0.5, 0.5],
      [0, 0, 0],
    ),
  );
  const measured: { dt: number; energy: number }[] = [];
  for (const dt of [1 / 120, 1 / 240]) {
    // The plate's centre sits 0.5 above the block's, so the liquid's reaction twists it.
    let state = createMultiphysicsSnapshot3D(profiles, {
      parcels: [seed('paddle', 'copper', [-2.5, 0.5, 0], [0.25, 1, 1.5], [0.5, 0, 0]), ...water],
      settings: { gravity: [0, 0, 0], dt },
    });
    const before = multiphysicsInventory3D(state),
      paddleMomentum = () => {
        const p = state.parcels.find((q) => q.id === 'paddle')!;
        return p.mass * p.velocity[0];
      },
      start = paddleMomentum(),
      kinetic = before.mechanicalEnergy;
    let impactHeat = 0,
      viscousHeat = 0;
    for (let step = 0; step < Math.round(220 / 120 / dt); step++) {
      const job = createMultiphysicsTickJob3D(profiles, state);
      while (job.progress().status === 'running') job.advance(256);
      const result = job.result();
      state = result.snapshot;
      impactHeat += result.report.mechanicalHeat;
      viscousHeat +=
        result.report.fluid!.energy.viscousHeat +
        result.report.fluidPostProjection!.energy.viscousHeat;
    }
    const after = multiphysicsInventory3D(state),
      paddle = state.parcels.find((p) => p.id === 'paddle')!,
      liquidMomentum = state.parcels
        .filter((p) => p.material === 'water')
        .reduce((sum, p) => sum + p.mass * p.velocity[0], 0),
      energy = inventoryEnergyDelta3D(before, after);
    console.log(
      JSON.stringify({
        case: 'moving-paddle',
        dt,
        paddle: paddle.velocity[0],
        liquidMomentum,
        spin: paddle.intrinsicAngularMomentum[2],
        impactHeat,
        viscousHeat,
        energy,
        kinetic,
      }),
    );
    // The plate reached the liquid and gave it most of its momentum.
    expect(paddle.center[0]).toBeGreaterThan(-1.8);
    expect(liquidMomentum).toBeGreaterThan(0.5 * start);
    expect(Math.abs(paddleMomentum() - start + liquidMomentum)).toBeLessThan(1e-12);
    for (let k = 0; k < 3; k++)
      expect(after.linearMomentum[k]).toBeCloseTo(before.linearMomentum[k], 12);
    // Reaction below the plate's centre: clockwise spin, with total angular momentum retained.
    expect(paddle.intrinsicAngularMomentum[2]).toBeLessThan(-1e-3);
    expect(
      Math.hypot(...after.angularMomentum.map((v, k) => v - before.angularMomentum[k])),
    ).toBeLessThan(1e-5);
    expect(impactHeat).toBeGreaterThan(0);
    expect(viscousHeat).toBeGreaterThan(0);
    // Unpaid projection correction stays under 5% of the plate's kinetic energy.
    expect(Math.abs(energy)).toBeLessThan(0.05 * kinetic);
    measured.push({ dt, energy: Math.abs(energy) });
  }
  expect(measured[1].energy).toBeLessThan(measured[0].energy);
}, 60000);
