/** Extended release gates. Run explicitly under the supervisor; report each result independently. */
import { beforeAll, expect, test } from 'vitest';
import { createMultiphysicsProfiles3D, type MultiphysicsProfiles3D } from './profiles.js';
import { seedThermalParcel3D } from './thermal.js';
import {
  createMultiphysicsSnapshot3D,
  multiphysicsInventory3D,
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

test('overlapping liquid can freeze into admissible unbonded solids without deleting matter', () => {
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
  const result = run(initial);
  expect(result.snapshot.parcels.map((p) => p.material)).toEqual(['ice', 'ice']);
  expect(result.snapshot.bonds).toEqual([]);
  expect(multiphysicsInventory3D(result.snapshot).mass).toBe(multiphysicsInventory3D(initial).mass);
});
