import { beforeAll, expect, test } from 'vitest';
import { createMultiphysicsProfiles3D, type MultiphysicsProfiles3D } from './profiles.js';
import { seedThermalParcel3D } from './thermal.js';
import {
  createMultiphysicsSnapshot3D,
  readMultiphysicsSnapshot3D,
  inventoryEnergyDelta3D,
  MULTIPHYSICS_SUBQ_PER_ENERGY_3D,
  type MultiphysicsInventory3D,
} from './model.js';
let profiles: MultiphysicsProfiles3D;
beforeAll(async () => {
  profiles = await createMultiphysicsProfiles3D();
});
const seed = (id: string, material = 'copper') =>
  seedThermalParcel3D(profiles, {
    id,
    material,
    owner: 'authored',
    center: [0, 2, 0],
    velocity: [1, 0, 0],
  });
test('snapshots own parcels, bind profile/rules, and survive exact JSON restoration', () => {
  const initial = seed('a'),
    snapshot = createMultiphysicsSnapshot3D(profiles, {
      parcels: [initial],
      settings: { gravity: [0, 0, 0] },
    });
  expect(snapshot.parcels[0].owner).toBe('solid:0');
  expect(snapshot.nextOwner).toBe(1);
  expect(readMultiphysicsSnapshot3D(profiles, JSON.parse(JSON.stringify(snapshot)))).toEqual(
    snapshot,
  );
  expect(snapshot.parcels[0].center).not.toBe(initial.center);
  expect(() =>
    readMultiphysicsSnapshot3D(profiles, { ...snapshot, rules: 'reactive-world-2' }),
  ).toThrow(/Incompatible/);
  expect(() => readMultiphysicsSnapshot3D(profiles, { ...snapshot, catalogHash: 'other' })).toThrow(
    /Incompatible/,
  );
  expect(() => readMultiphysicsSnapshot3D(profiles, { ...snapshot, unknown: 1 })).toThrow(/fields/);
});
test('restoration rejects unaccounted mass, energy, and equal-energy momentum reversal', () => {
  const snapshot = createMultiphysicsSnapshot3D(profiles, {
    parcels: [seed('a')],
    settings: { gravity: [0, 0, 0] },
  });
  const reversed = structuredClone(snapshot);
  reversed.parcels[0].velocity = [-1, 0, 0];
  expect(() => readMultiphysicsSnapshot3D(profiles, reversed)).toThrow(/momentum/);
  const mass = structuredClone(snapshot);
  mass.parcels[0].mass *= 2;
  expect(() => readMultiphysicsSnapshot3D(profiles, mass)).toThrow(/mass/);
  const heat = structuredClone(snapshot);
  heat.parcels[0].thermalQ++;
  expect(() => readMultiphysicsSnapshot3D(profiles, heat)).toThrow(/energy/);
});
test('grain bonds, moving anchors, and non-rigid bonded motion are rejected at admission', () => {
  const first = seed('a'),
    second = { ...seed('b'), center: [1, 2, 0] as const };
  const bond = { a: 'a', b: 'b', strength: 100, restLength: 1 };
  expect(() =>
    createMultiphysicsSnapshot3D(profiles, { parcels: [first], anchors: ['a'] }),
  ).toThrow(/stationary/);
  expect(() =>
    createMultiphysicsSnapshot3D(profiles, {
      parcels: [seed('a', 'sand'), seed('b', 'sand')],
      bonds: [bond],
    }),
  ).toThrow(/bond/);
  expect(() =>
    createMultiphysicsSnapshot3D(profiles, {
      parcels: [first, { ...second, velocity: [-1, 0, 0] }],
      bonds: [bond],
    }),
  ).toThrow(/rigid/);
  const valid = createMultiphysicsSnapshot3D(profiles, { parcels: [first, second], bonds: [bond] });
  expect(valid.parcels.map((p) => p.owner)).toEqual(['solid:0', 'solid:0']);
});
test('gas thermodynamic volume has explicit unique ownership and finite bounds', () => {
  const gas = createMultiphysicsSnapshot3D(profiles, { parcels: [seed('steam', 'steam')] });
  expect(gas.gasVolumes).toEqual([{ id: 'steam', volume: 1 }]);
  expect(gas.parcels[0].owner).toBe('fluid');
  expect(() => readMultiphysicsSnapshot3D(profiles, { ...gas, gasVolumes: [] })).toThrow(/volume/);
  expect(() =>
    readMultiphysicsSnapshot3D(profiles, { ...gas, gasVolumes: [{ id: 'missing', volume: 1 }] }),
  ).toThrow(/owner/);
  expect(() =>
    readMultiphysicsSnapshot3D(profiles, { ...gas, gasVolumes: [{ id: 'steam', volume: 0 }] }),
  ).toThrow();
});
test('small thermal deltas remain measurable next to large unchanged mechanical energy', () => {
  const before: MultiphysicsInventory3D = {
    storedSubQ: '0',
    conversionRemainderSubQ: 0,
    mechanicalEnergy: 5e13,
    mass: 1,
    linearMomentum: [0, 0, 0],
    angularMomentum: [0, 0, 0],
  };
  expect(
    inventoryEnergyDelta3D(before, {
      ...before,
      storedSubQ: String(MULTIPHYSICS_SUBQ_PER_ENERGY_3D / 256),
    }),
  ).toBe(1 / 256);
});
test('malformed and oversized authored data reject before creating any world', () => {
  let reads = 0;
  expect(() =>
    createMultiphysicsSnapshot3D(profiles, {
      get parcels() {
        reads++;
        return [];
      },
    }),
  ).toThrow();
  expect(reads).toBe(0);
  expect(() =>
    createMultiphysicsSnapshot3D(profiles, {
      parcels: Array.from({ length: 257 }, (_, i) => seed(`p${i}`)),
    }),
  ).toThrow(/bounds/);
  expect(() =>
    createMultiphysicsSnapshot3D(profiles, {
      parcels: [seed('a')],
      bonds: [{ a: 'a', b: 'missing', strength: 1, restLength: 1 }],
    }),
  ).toThrow(/endpoints/);
});
