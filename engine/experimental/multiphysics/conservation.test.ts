import { expect, test } from 'vitest';
import { copyPortableValue, type PortableValue } from '../../portable-data.js';
import { encodeFrozen3D } from '../../test-support/multiphysics-frozen-cases.js';
import {
  readMaterialParcel3D,
  readShapedMaterialParcel3D,
  ownedFlatRecord3D,
  MATERIAL_PARCEL_FIELDS_3D,
  transferMaterialParcel3D,
  partitionMaterialParcel3D,
  parcelConservation3D,
  releaseAssemblyParcels3D,
  type MaterialParcel3D,
} from './conservation.js';

const parcel = (patch: Partial<MaterialParcel3D> = {}): MaterialParcel3D => ({
  id: 'copper-1',
  material: 'copper',
  owner: 'solid-1',
  mass: 2,
  referenceAmount: 1,
  heatCapacity: 4,
  thermalQ: 101,
  latentQ: 7,
  chemicalQ: 13,
  center: [0, 0, 0],
  velocity: [1, 2, 3],
  orientation: [0, 0, 0, 1],
  intrinsicAngularMomentum: [0, 0, 6],
  principalInertia: [1, 2, 3],
  ...patch,
});

test('material/owner transfer retains authoritative mass, energy and spin across melting or combustion identity changes', () => {
  const original = parcel(),
    before = parcelConservation3D([original]);
  for (const material of ['molten-copper', 'ash']) {
    const moved = transferMaterialParcel3D(original, material, 'particles');
    expect(moved.mass).toBe(2); // Never recompute from destination density or cell volume.
    expect(moved.id).toBe(original.id);
    expect(moved.intrinsicAngularMomentum).toEqual([0, 0, 6]);
    expect(parcelConservation3D([moved])).toEqual(before);
    expect(moved.center).not.toBe(original.center);
    expect(moved.orientation).not.toBe(original.orientation);
    expect(moved.intrinsicAngularMomentum).not.toBe(original.intrinsicAngularMomentum);
  }
  // Identity transfer itself neither releases chemical energy nor implements a reaction.
  expect(original.material).toBe('copper');
});

test('weighted accounting partition preserves extensive quantities and exactly allocates every energy Q', () => {
  const original = parcel({ thermalQ: Number.MAX_SAFE_INTEGER }),
    parts = [
      { id: 'child-c', weight: 2 },
      { id: 'child-a', weight: 1 },
      { id: 'child-b', weight: 3 },
    ];
  const children = partitionMaterialParcel3D(original, parts);
  expect(children.map((p) => p.id)).toEqual(['child-a', 'child-b', 'child-c']);
  expect(partitionMaterialParcel3D(original, [...parts].reverse())).toEqual(children);
  const before = parcelConservation3D([original]),
    after = parcelConservation3D(children);
  for (const key of ['thermalQ', 'latentQ', 'chemicalQ', 'internalEnergyQ'] as const)
    expect(after[key]).toBe(before[key]);
  for (const key of ['mass', 'referenceAmount', 'heatCapacity', 'kineticEnergy'] as const)
    expect(after[key]).toBeCloseTo(before[key], 12);
  for (let axis = 0; axis < 3; axis++) {
    expect(after.linearMomentum[axis]).toBeCloseTo(before.linearMomentum[axis], 12);
    expect(after.angularMomentum[axis]).toBeCloseTo(before.angularMomentum[axis], 12);
  }
  expect(children[0].center).not.toBe(children[1].center);
  expect(children[0].center).not.toBe(original.center);
  expect(original.thermalQ).toBe(Number.MAX_SAFE_INTEGER);
  const singleQ = partitionMaterialParcel3D(parcel({ thermalQ: 1 }), [
    { id: 'b', weight: 1 },
    { id: 'a', weight: 1 },
  ]);
  expect(singleQ.map((p) => p.thermalQ)).toEqual([1, 0]);
});

test('rigid release retains cell spin and agrees with independent parallel-axis angular momentum and kinetic energy', () => {
  // Two unit cubes, each mass 2: intrinsic Izz=m/6=1/3; centers x=±1.
  // Whole-body Izz=2*(1/3+2)=14/3. Omega=3 gives Lz=14 and Erotation=21.
  const cubes = [-1, 1].map((x, i) =>
    parcel({
      id: `cube-${i}`,
      center: [x, 0, 0],
      velocity: [1, 3 * x, 0],
      principalInertia: [1 / 3, 1 / 3, 1 / 3],
      intrinsicAngularMomentum: [0, 0, 1],
    }),
  );
  const motion = {
    center: [0, 0, 0] as const,
    velocity: [1, 0, 0] as const,
    angularVelocity: [0, 0, 3] as const,
  };
  const released = releaseAssemblyParcels3D(cubes, motion, 'free-particles'),
    result = parcelConservation3D(released);
  expect(released.map((p) => p.velocity)).toEqual([
    [1, -3, 0],
    [1, 3, 0],
  ]);
  expect(released.map((p) => p.intrinsicAngularMomentum)).toEqual([
    [0, 0, 1],
    [0, 0, 1],
  ]);
  expect(result.angularMomentum).toEqual([0, 0, 14]);
  expect(result.linearMomentum).toEqual([4, 0, 0]);
  expect(result.kineticEnergy).toBeCloseTo(21 + 4 / 2, 12);
  expect(result.internalEnergyQ).toBe(parcelConservation3D(cubes).internalEnergyQ);
  expect(result).toEqual(parcelConservation3D(cubes));
  expect(cubes[0].velocity).toEqual([1, -3, 0]);
  expect(released[0].velocity).not.toBe(cubes[0].velocity);
  expect(() =>
    releaseAssemblyParcels3D([parcel({ intrinsicAngularMomentum: [0, 0, 0] })], motion, 'fluid'),
  ).toThrow(/intrinsic spin/); // A one-cell rotating body cannot become a spinless point.
  expect(() =>
    releaseAssemblyParcels3D(
      [parcel({ velocity: [100, 0, 0], intrinsicAngularMomentum: [0, 0, 0] })],
      { center: [0, 0, 0], velocity: [0, 0, 0], angularVelocity: [0, 0, 0] },
      'fluid',
    ),
  ).toThrow(/velocity/);
});

test('rotated anisotropic inertia and explicit gravitational reference are measured in world axes', () => {
  const value = parcel({
    center: [0, 3, 0],
    velocity: [0, 0, 0],
    orientation: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
    intrinsicAngularMomentum: [2, 0, 0],
  });
  const result = parcelConservation3D([value], { origin: [0, 1, 0], gravity: [0, -10, 0] });
  expect(result.rotationalEnergy).toBeCloseTo(1, 12); // World X uses local Iyy=2.
  expect(result.potentialEnergy).toBe(40);
  expect(result.angularMomentum).toEqual([2, 0, 0]);
});

test('public boundaries reject invalid energies, missing state, duplicate ownership and numerical overflow', () => {
  expect(() => readMaterialParcel3D({ ...parcel(), thermalQ: 0.5 })).toThrow(/integer Q/);
  expect(() => readMaterialParcel3D({ ...parcel(), mass: 0 })).toThrow(/positive/);
  expect(() => readMaterialParcel3D({ ...parcel(), orientation: [0, 0, 0, 2] })).toThrow(
    /unit quaternion/,
  );
  expect(() => readMaterialParcel3D({ ...parcel(), density: 100 })).toThrow(/fields/);
  expect(() => parcelConservation3D([parcel(), parcel()])).toThrow(/Duplicate/);
  expect(() => parcelConservation3D([parcel({ velocity: [Number.MAX_VALUE, 0, 0] })])).toThrow(
    /finite/,
  );
  expect(() =>
    partitionMaterialParcel3D(parcel(), [
      { id: 'child', weight: Number.MAX_SAFE_INTEGER },
      { id: 'other', weight: 1 },
    ]),
  ).toThrow(/weight sum/);
  expect(() =>
    partitionMaterialParcel3D(parcel(), [
      { id: 'child', weight: 1 },
      { id: 'child', weight: 1 },
    ]),
  ).toThrow(/Duplicate/);
  expect(() =>
    partitionMaterialParcel3D(parcel({ mass: Number.MIN_VALUE }), [
      { id: 'a', weight: 1 },
      { id: 'b', weight: 1 },
    ]),
  ).toThrow(/positive/);
  let getterCalls = 0;
  const malicious = {
    ...parcel(),
    get mass() {
      getterCalls++;
      return 1;
    },
  };
  expect(() => readMaterialParcel3D(malicious)).toThrow(/accessors/);
  expect(getterCalls).toBe(0);
  const exact = parcelConservation3D([
    parcel({ thermalQ: Number.MAX_SAFE_INTEGER }),
    parcel({ id: 'second', thermalQ: Number.MAX_SAFE_INTEGER }),
  ]);
  expect(exact.thermalQ).toBe('18014398509481982');
});

test('an owned flat record is the portable copy of that record, and anything else is left to the copy', () => {
  const shape = MATERIAL_PARCEL_FIELDS_3D,
    signed = parcel({ center: [-0, 1, -0], velocity: [0, -0, 0], thermalQ: -0, chemicalQ: 0 });
  for (const record of [parcel(), signed, Object.assign(Object.create(null), signed)]) {
    const owned = ownedFlatRecord3D(record, shape)!;
    // Key order aside, the same record bit for bit, with every negative zero made zero.
    expect(encodeFrozen3D(owned)).toBe(
      encodeFrozen3D(copyPortableValue(record as unknown as PortableValue)),
    );
    expect(encodeFrozen3D(readShapedMaterialParcel3D(owned))).toBe(
      encodeFrozen3D(readMaterialParcel3D(record)),
    );
    expect(owned).not.toBe(record);
  }
  // An array is copied only when it holds a negative zero; the record itself never changes.
  const owned = ownedFlatRecord3D(signed, shape)!;
  expect(owned.center).not.toBe(signed.center);
  expect(owned.orientation).toBe(signed.orientation);
  expect(Object.is(signed.center[0], -0) && Object.is(signed.thermalQ, -0)).toBe(true);
  const { owner: _owner, ...ownerless } = parcel(),
    sparse = [0, 0, 0];
  delete sparse[2];
  class Record {
    constructor() {
      Object.assign(this, parcel());
    }
  }
  for (const record of [
    { ...parcel(), density: 100 },
    ownerless,
    { ...ownerless, density: 100 },
    { ...parcel(), mass: Number.NaN },
    { ...parcel(), velocity: [0, Number.POSITIVE_INFINITY, 0] },
    { ...parcel(), velocity: [0, '0', 0] },
    { ...parcel(), velocity: sparse },
    { ...parcel(), velocity: [[0], 0, 0] },
    { ...parcel(), velocity: { 0: 0, 1: 0, 2: 0 } },
    { ...parcel(), velocity: new Float64Array(3) },
    { ...parcel(), velocity: Array<number>(70000).fill(0) },
    { ...parcel(), owner: 'o'.repeat(1048577) },
    { ...parcel(), mass: null },
    { ...parcel(), mass: false },
    { ...parcel(), mass: undefined },
    Object.assign(Object.create({ inherited: 1 }), parcel()),
    new Record(),
    [parcel()],
    null,
    undefined,
    7,
    'parcel',
  ])
    expect(ownedFlatRecord3D(record, shape)).toBeUndefined();
  // Strings and long arrays within the portable budgets are still flat data.
  expect(ownedFlatRecord3D({ ...parcel(), owner: 'o'.repeat(4096) }, shape)).toBeDefined();
  expect(ownedFlatRecord3D({ ...parcel(), velocity: [1, 2, 3, 4] }, shape)).toBeDefined();
});
