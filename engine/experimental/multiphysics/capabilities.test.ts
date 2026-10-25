/** World-level ownership and conservation checks, beyond the thermal reference operator. */
import { beforeAll, expect, test } from 'vitest';
import { createMultiphysicsProfiles3D, type MultiphysicsProfiles3D } from './profiles.js';
import { seedThermalParcel3D } from './thermal.js';
import {
  createMultiphysicsSnapshot3D,
  multiphysicsInventory3D,
  inventoryEnergyDelta3D,
  type MultiphysicsSnapshot3D,
} from './model.js';
import { createMultiphysicsTickJob3D } from './world-tick.js';
let profiles: MultiphysicsProfiles3D;
beforeAll(async () => {
  profiles = await createMultiphysicsProfiles3D();
});
function run(state: MultiphysicsSnapshot3D) {
  const job = createMultiphysicsTickJob3D(profiles, state);
  while (job.progress().status === 'running') job.advance(256);
  return job.result();
}
const seed = (id: string, material: string, temperature: number, x = 0) =>
  seedThermalParcel3D(profiles, {
    id,
    material,
    temperature,
    owner: 'authored',
    center: [x, 3, 0],
    velocity: [0.2, -0.1, 0.3],
    angularVelocity: [0.1, 0.2, 0.3],
  });
test.each([
  ['stone', 'lava', 251],
  ['lava', 'stone', 0],
  ['ice', 'water', 46],
  ['water', 'ice', 0],
  ['water', 'steam', 141],
  ['steam', 'water', 0],
  ['sand', 'glass', 226],
  ['glass', 'molten_glass', 271],
  ['molten_glass', 'glass', 0],
  ['metal', 'molten_metal', 266],
  ['molten_metal', 'metal', 0],
  ['oil', 'oil_vapor', 111],
  ['oil_vapor', 'oil', 0],
  ['copper', 'molten_copper', 141],
  ['molten_copper', 'copper', 0],
  ['wax', 'molten_wax', 51],
  ['molten_wax', 'wax', 0],
] as const)(
  'world transition %s to %s preserves matter, spin, enthalpy and continuation',
  (from, to, temperature) => {
    const original = seed('matter', from, temperature),
      initial = createMultiphysicsSnapshot3D(profiles, {
        parcels: [original],
        settings: { gravity: [0, 0, 0], dt: 0.001 },
      });
    const result = run(initial),
      p = result.snapshot.parcels[0],
      before = multiphysicsInventory3D(initial),
      after = multiphysicsInventory3D(result.snapshot);
    expect(p.material).toBe(to);
    expect(p.id).toBe(original.id);
    expect(p.principalInertia).toEqual(original.principalInertia);
    expect(p.chemicalQ).toBe(original.chemicalQ);
    expect(after.mass).toBe(before.mass);
    after.linearMomentum.forEach((v, i) => expect(v).toBeCloseTo(before.linearMomentum[i], 12));
    after.angularMomentum.forEach((v, i) => expect(v).toBeCloseTo(before.angularMomentum[i], 12));
    expect(inventoryEnergyDelta3D(before, after)).toBeCloseTo(0, 10);
    expect(result.snapshot.bonds).toEqual([]);
    expect(result.snapshot.anchors).toEqual([]);
    expect(result.snapshot.gasVolumes.length).toBe(profiles.byName[to].phase === 'gas' ? 1 : 0);
    expect(run(JSON.parse(JSON.stringify(result.snapshot)))).toEqual(run(result.snapshot));
  },
);
test.each([
  ['wood', 'ash', 80],
  ['oil', 'smoke', 150],
  ['oil_vapor', 'smoke', 150],
  ['wax', 'ash', 100],
  ['molten_wax', 'ash', 100],
] as const)(
  'burning %s in a complete world pays its finite fuel and preserves both product parcels',
  (material, product, energy) => {
    const initial = createMultiphysicsSnapshot3D(profiles, {
      parcels: [seed('fuel', material, 220), seed('oxygen', 'air', 220, 1)],
      settings: { gravity: [0, 0, 0], dt: 0.0001 },
    });
    const result = run(initial),
      before = multiphysicsInventory3D(initial),
      after = multiphysicsInventory3D(result.snapshot);
    expect(result.snapshot.parcels.find((p) => p.id === 'fuel')!.material).toBe(product);
    expect(result.snapshot.parcels.find((p) => p.id === 'oxygen')!.material).toBe('fire');
    expect(result.report.burns).toHaveLength(1);
    expect(result.report.burns[0].releasedQ).toBe(energy * 256);
    expect(result.snapshot.parcels.every((p) => p.chemicalQ === 0)).toBe(true);
    expect(after.mass).toBe(before.mass);
    expect(Math.abs(inventoryEnergyDelta3D(before, after))).toBeLessThan(1e-7);
    after.linearMomentum.forEach((v, i) => expect(v).toBeCloseTo(before.linearMomentum[i], 9));
    after.angularMomentum.forEach((v, i) => expect(v).toBeCloseTo(before.angularMomentum[i], 9));
  },
);
test('fire extinction retains its positive mass and grains settle without welding', () => {
  const fire = createMultiphysicsSnapshot3D(profiles, {
    parcels: [seed('fire', 'fire', 0)],
    settings: { gravity: [0, 0, 0] },
  });
  const extinguished = run(fire).snapshot;
  expect(extinguished.parcels[0].material).toBe('smoke');
  expect(multiphysicsInventory3D(extinguished).mass).toBe(multiphysicsInventory3D(fire).mass);
  let state = createMultiphysicsSnapshot3D(profiles, {
    parcels: [
      seedThermalParcel3D(profiles, {
        id: 'floor',
        material: 'ceramic',
        owner: 'fixed',
        center: [0, 0, 0],
        halfExtents: [4, 0.5, 2],
        temperature: 20,
      }),
      ...['sand', 'ash'].map((material, i) =>
        seedThermalParcel3D(profiles, {
          id: material,
          material,
          owner: 'grain',
          center: [i * 2 - 1, 1.01, 0],
          temperature: 20,
        }),
      ),
    ],
    anchors: ['floor'],
    settings: { dt: 1 / 240 },
  });
  const mass = multiphysicsInventory3D(state).mass;
  let heat = 0;
  for (let i = 0; i < 32; i++) {
    const result = run(state);
    state = result.snapshot;
    heat += result.report.mechanicalHeat;
  }
  expect(heat).toBeGreaterThan(0);
  expect(state.bonds).toEqual([]);
  expect(multiphysicsInventory3D(state).mass).toBe(mass);
  for (const grain of state.parcels.filter((p) => p.id !== 'floor')) {
    expect(grain.center[1]).toBeCloseTo(1, 5);
    expect(Math.abs(grain.velocity[1])).toBeLessThan(1e-7);
  }
});
