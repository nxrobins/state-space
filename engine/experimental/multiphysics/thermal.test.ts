import { beforeAll, expect, test } from 'vitest';
import {
  createMultiphysicsProfiles3D,
  type MultiphysicsProfiles3D,
  MULTIPHYSICS_ENERGY_SCALE_3D as E,
} from './profiles.js';
import {
  advanceParcelThermal3D,
  advanceOwnedParcelThermal3D,
  seedThermalParcel3D,
  parcelTemperature3D,
  ownedParcelTemperature3D,
  readThermalParcel3D,
  readOwnedThermalParcel3D,
  depositParcelHeat3D,
  depositOwnedParcelHeat3D,
  THERMAL_FRACTION_SCALE_3D as S,
  type ThermalParcel3D,
} from './thermal.js';
import { encodeFrozen3D } from '../../test-support/multiphysics-frozen-cases.js';
let profiles: MultiphysicsProfiles3D;
beforeAll(async () => {
  profiles = await createMultiphysicsProfiles3D();
});
const seed = (material: string, temperature: number, id = material) =>
  seedThermalParcel3D(profiles, {
    id,
    material,
    owner: 'original-owner',
    center: [0, 0, 0],
    temperature,
    velocity: [2, -1, 3],
    angularVelocity: [1, 2, 3],
  });
const step = (p: readonly ThermalParcel3D[]) => advanceParcelThermal3D(profiles, p, [], 1 / 60);
const physical = (p: ThermalParcel3D) => {
  const {
    material: _material,
    thermalQ: _thermal,
    latentQ: _latent,
    chemicalQ: _chemical,
    thermalRemainder: _remainder,
    ...state
  } = p;
  return state;
};

test('all 22 profiles seed finite matter without modifying the legacy catalog or creating massless fire', () => {
  expect(Object.keys(profiles.byName)).toHaveLength(22);
  expect(profiles.catalogHash).toBe(
    '21e840506f7ccaddb1fe256d2d99299aaec6ee569493ac9bd13291c01d9433ab',
  );
  for (const profile of Object.values(profiles.byName)) {
    const p = seed(profile.name, profile.defaultTemperature);
    expect(p.mass).toBeGreaterThan(0);
    expect(p.heatCapacity).toBe(1);
    expect(p.chemicalQ).toBe(profile.fuelEnergyQ);
    expect(readThermalParcel3D(profiles, p)).toEqual(p);
    expect(Object.isFrozen(profile)).toBe(true);
  }
  expect(profiles.byName.ceramic.meltsInto).toBeNull();
  expect(profiles.byName.sand.phase).toBe('granular');
  expect(profiles.byName.ash.phase).toBe('granular');
  expect(profiles.byName.fire.phase).toBe('gas');
  expect(profiles.byName.copper.electricalConductivity).toBeGreaterThan(0);
  expect(profiles.byName.molten_copper.electricalConductivity).toBeGreaterThan(0);
  expect(profiles.byName.ceramic.electricalConductivity).toBe(0);
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
  '%s transitions to %s without resetting mass, geometry, stored fuel, momentum or spin',
  (from, to, temperature) => {
    const original = seed(from, temperature),
      untouched = structuredClone(original),
      result = step([original]),
      changed = result.parcels[0];
    expect(changed.material).toBe(to);
    expect(physical(changed)).toEqual(physical(original));
    expect(changed.chemicalQ).toBe(original.chemicalQ);
    expect(result.energy.afterSubQ).toBe(result.energy.beforeSubQ);
    expect(result.transitions).toEqual([{ id: from, from, to, kind: 'phase' }]);
    expect(original).toEqual(untouched);
    expect(changed.halfExtents).not.toBe(original.halfExtents);
  },
);

test('finite latent plateau stores sub-Q energy and completes only at the full transition boundary', () => {
  const ice = seed('ice', 35);
  expect(parcelTemperature3D(profiles, ice)).toBe(30);
  expect(ice.latentQ).toBe(5 * E);
  const partial = depositParcelHeat3D(profiles, ice, BigInt(9 * E * S) + BigInt(S / 2));
  const waiting = step([partial]);
  expect(waiting.parcels[0].material).toBe('ice');
  expect(parcelTemperature3D(profiles, waiting.parcels[0])).toBe(30);
  expect(waiting.parcels[0].thermalRemainder).toBe(0.5);
  const complete = depositParcelHeat3D(profiles, partial, BigInt(E * S) - BigInt(S / 2));
  const melted = step([complete]).parcels[0];
  expect(melted.material).toBe('water');
  expect(parcelTemperature3D(profiles, melted)).toBe(30);
  expect(melted.latentQ).toBe(15 * E);
});

test('pair exchange reaches equilibrium without overshoot and preserves exact fractional energy', () => {
  const cold = seed('copper', 0.25 / E, 'cold'),
    hot = seed('copper', 80 + 0.75 / E, 'hot');
  const result = advanceParcelThermal3D(profiles, [hot, cold], [{ a: 'hot', b: 'cold' }], 1);
  expect(result.parcels.map((p) => parcelTemperature3D(profiles, p))).toEqual([
    40 + 0.5 / E,
    40 + 0.5 / E,
  ]);
  expect(result.energy.beforeSubQ).toBe(result.energy.afterSubQ);
  expect(result.energy.roundoffQ).toBe(0);
  expect(advanceParcelThermal3D(profiles, [cold, hot], [{ a: 'cold', b: 'hot' }], 1)).toEqual(
    result,
  );
  const stable = advanceParcelThermal3D(profiles, result.parcels, [{ a: 'cold', b: 'hot' }], 1);
  expect(stable.parcels).toEqual(result.parcels);
});

test.each([
  ['wood', 'ash', 80],
  ['oil', 'smoke', 150],
  ['oil_vapor', 'smoke', 150],
  ['wax', 'ash', 100],
  ['molten_wax', 'ash', 100],
] as const)(
  '%s consumes finite fuel and one oxidizer parcel without reseeding products',
  (material, product, fuel) => {
    const input = [seed(material, 220, 'fuel'), seed('air', 220, 'oxidizer')],
      contacts = [{ a: 'fuel', b: 'oxidizer' }];
    const result = advanceParcelThermal3D(profiles, input, contacts, 1 / 60);
    expect(result.parcels.map((p) => p.material)).toEqual([product, 'fire']);
    expect(result.burns).toEqual([
      { fuel: 'fuel', oxidizer: 'oxidizer', releasedQ: fuel * E, transferredQ: (fuel * E) / 2 },
    ]);
    expect(result.parcels.map((p) => p.chemicalQ)).toEqual([0, 0]);
    expect(result.parcels.map(physical)).toEqual(input.map(physical));
    expect(result.energy.beforeSubQ).toBe(result.energy.afterSubQ);
    const continued = advanceParcelThermal3D(profiles, result.parcels, contacts, 1 / 60);
    expect(continued.burns).toEqual([]);
    expect(continued.parcels.map((p) => p.material)).toEqual([product, 'smoke']);
    expect(continued.energy.afterSubQ).toBe(result.energy.afterSubQ);
  },
);

test('ignition is strict, oxidizer is finite, and cold or isolated fuel does not burn', () => {
  for (const temperature of [120, 120 + 1 / E]) {
    const pair = [seed('oil_vapor', temperature, 'fuel'), seed('air', temperature, 'oxidizer')];
    expect(
      advanceParcelThermal3D(profiles, pair, [{ a: 'fuel', b: 'oxidizer' }], 1 / 60).burns.length,
    ).toBe(temperature === 120 ? 0 : 1);
  }
  expect(step([seed('wood', 220)]).burns).toEqual([]);
  const competing = [seed('wood', 220, 'b'), seed('air', 220, 'z'), seed('wood', 220, 'a')];
  const result = advanceParcelThermal3D(
    profiles,
    competing,
    [
      { a: 'b', b: 'z' },
      { a: 'z', b: 'a' },
    ],
    1 / 60,
  );
  expect(result.burns.map((b) => b.fuel)).toEqual(['a']);
  expect(result.parcels.find((p) => p.id === 'b')!.chemicalQ).toBe(80 * E);
  expect(
    advanceParcelThermal3D(
      profiles,
      result.parcels,
      [
        { a: 'b', b: 'z' },
        { a: 'z', b: 'a' },
      ],
      1 / 60,
    ).burns,
  ).toEqual([]);
});

test('fire requires neighboring fuel and sufficient temperature; liquid water extinguishes it', () => {
  expect(step([seed('fire', 200)]).parcels[0].material).toBe('smoke');
  const contacts = [{ a: 'fire', b: 'fuel' }];
  expect(
    advanceParcelThermal3D(
      profiles,
      [seed('fire', 100), seed('wood', 100, 'fuel')],
      contacts,
      0.001,
    ).parcels[0].material,
  ).toBe('fire');
  expect(
    advanceParcelThermal3D(profiles, [seed('fire', 70), seed('wood', 70, 'fuel')], contacts, 0.001)
      .parcels[0].material,
  ).toBe('smoke');
  const wet = advanceParcelThermal3D(
    profiles,
    [seed('fire', 120), seed('wood', 120, 'fuel'), seed('water', 20)],
    [...contacts, { a: 'fire', b: 'water' }],
    0.001,
  );
  expect(wet.parcels[0].material).toBe('smoke');
  expect(wet.parcels.find((p) => p.id === 'water')!.material).toBe('water');
});

test('invalid contacts, fractional stores and noncanonical thermal state reject without mutating input', () => {
  const p = seed('copper', 20),
    before = structuredClone(p);
  expect(() => readThermalParcel3D(profiles, { ...p, thermalRemainder: 0.1 })).toThrow(
    /fractional/,
  );
  expect(() => readThermalParcel3D(profiles, { ...p, chemicalQ: 1 })).toThrow(/Chemical/);
  expect(() => readThermalParcel3D(profiles, { ...p, referenceAmount: 0.5 })).toThrow(
    /unit reference/,
  );
  expect(() => depositParcelHeat3D(profiles, p, -BigInt(21 * E * S))).toThrow(/range/);
  expect(() => advanceParcelThermal3D(profiles, [p], [{ a: p.id, b: 'missing' }], 1 / 60)).toThrow(
    /endpoints/,
  );
  expect(() =>
    advanceParcelThermal3D(
      profiles,
      [p, { ...p, id: 'other' }],
      [
        { a: p.id, b: 'other' },
        { a: 'other', b: p.id },
      ],
      1 / 60,
    ),
  ).toThrow(/Duplicate/);
  expect(advanceParcelThermal3D(profiles, [p], [], 0).parcels).toEqual([p]);
  expect(p).toEqual(before);
});

// Key order aside, every bit of every number and the sign of each zero.
const outcome = (read: () => unknown) => {
  try {
    return `value ${encodeFrozen3D(read())}`;
  } catch (error) {
    return `error ${(error as Error).message}`;
  }
};
test('the owned parcel reader returns the copying reader’s parcel, or its rejection, for every record', () => {
  const p = seed('copper', 20),
    { owner: _owner, ...ownerless } = p,
    sparse = [0, 0, 0];
  delete sparse[1];
  class Parcel {
    constructor() {
      Object.assign(this, p);
    }
  }
  const records: unknown[] = [
    p,
    seed('water', 30),
    seed('wood', 20, 'fuel'),
    // Negative zeros: the copy turns each into zero, and so must reading in place.
    { ...p, center: [-0, 1, 2], velocity: [-0, 0, -0], intrinsicAngularMomentum: [0, -0, 0] },
    { ...p, orientation: [-0, 0, -0, 1], chemicalQ: -0, thermalRemainder: -0 },
    Object.assign(Object.create(null), p),
    // Values the checks reject.
    { ...p, principalInertia: [-0, 1, 1] },
    { ...p, mass: -0 },
    { ...p, orientation: [0, 0, 0, 2] },
    { ...p, halfExtents: [0.5, -0.5, 0.5] },
    { ...p, halfExtents: [0.5, 0.5] },
    { ...p, thermalRemainder: 0.1 },
    { ...p, thermalRemainder: 1 },
    { ...p, chemicalQ: 1 },
    { ...p, referenceAmount: 0.5 },
    { ...p, thermalQ: 0.5 },
    { ...p, material: 'unobtainium' },
    { ...p, id: '' },
    { ...p, id: 'x'.repeat(129) },
    { ...p, center: [0, 0] },
    // Values and shapes only the copy can judge: the owned reader must hand these over.
    { ...p, velocity: [Number.NaN, 0, 0] },
    { ...p, mass: Number.POSITIVE_INFINITY },
    { ...p, mass: null },
    { ...p, mass: true },
    { ...p, mass: undefined },
    { ...p, mass: 1n },
    { ...p, id: 5 },
    { ...p, center: 'abc' },
    { ...p, center: [0, 0, '0'] },
    { ...p, center: sparse },
    { ...p, center: { 0: 0, 1: 0, 2: 0, length: 3 } },
    { ...p, center: [[0], 0, 0] },
    { ...p, center: new Float64Array(3) },
    { ...p, center: Array<number>(70000).fill(0) },
    { ...p, owner: 'y'.repeat(1048577) },
    { ...p, extra: 1 },
    ownerless,
    Object.assign(Object.create({ inherited: 1 }), p),
    new Parcel(),
    [p],
    [],
    {},
    null,
    undefined,
    5,
    'parcel',
  ];
  let accepted = 0;
  for (const record of records) {
    const before = outcome(() => structuredClone(record)),
      copied = outcome(() => readThermalParcel3D(profiles, record));
    expect(outcome(() => readOwnedThermalParcel3D(profiles, record))).toBe(copied);
    // Neither reader changes its input.
    expect(outcome(() => structuredClone(record))).toBe(before);
    if (copied.startsWith('value')) accepted++;
  }
  expect(accepted).toBe(6);
  // The parcel returned shares no array with the record it was read from.
  const moving = { ...p, velocity: [1, 2, 3] as [number, number, number] },
    read = readOwnedThermalParcel3D(profiles, moving);
  for (const key of ['center', 'velocity', 'orientation', 'halfExtents'] as const)
    expect(read[key]).not.toBe(moving[key]);
  expect(read.velocity).toEqual([1, 2, 3]);
});

test('owned temperature, deposit and thermal advance equal their copying forms bit for bit', () => {
  const zeros = (parcel: ThermalParcel3D): ThermalParcel3D => ({
    ...parcel,
    velocity: [-0, 0, -0],
    intrinsicAngularMomentum: [-0, -0, 0],
  });
  const hot = zeros(seed('copper', 90, 'hot')),
    cold = zeros(seed('water', 10, 'cold')),
    fuel = seed('wood', 100, 'fuel'),
    air = seed('air', 100, 'oxidizer');
  for (const parcel of [hot, cold, fuel, air]) {
    expect(ownedParcelTemperature3D(profiles, parcel)).toBe(parcelTemperature3D(profiles, parcel));
    for (const delta of [0n, BigInt(S / 2), BigInt(3 * E * S)])
      expect(outcome(() => depositOwnedParcelHeat3D(profiles, parcel, delta))).toBe(
        outcome(() => depositParcelHeat3D(profiles, parcel, delta)),
      );
  }
  expect(outcome(() => depositOwnedParcelHeat3D(profiles, cold, -BigInt(21 * E * S)))).toBe(
    outcome(() => depositParcelHeat3D(profiles, cold, -BigInt(21 * E * S))),
  );
  expect(outcome(() => ownedParcelTemperature3D(profiles, { ...hot, mass: Number.NaN }))).toBe(
    outcome(() => parcelTemperature3D(profiles, { ...hot, mass: Number.NaN })),
  );
  for (const [parcels, contacts, dt] of [
    [[hot, cold], [{ a: 'hot', b: 'cold' }], 1],
    [[cold, hot], [{ a: 'cold', b: 'hot' }], 1 / 60],
    [[fuel, air], [{ a: 'fuel', b: 'oxidizer' }], 1 / 60],
    [[hot], [], 0],
    [[hot, { ...cold, velocity: [Number.NaN, 0, 0] }], [], 1 / 60],
    [[hot, hot], [], 1 / 60],
  ] as [ThermalParcel3D[], { a: string; b: string }[], number][])
    expect(outcome(() => advanceOwnedParcelThermal3D(profiles, parcels, contacts, dt))).toBe(
      outcome(() => advanceParcelThermal3D(profiles, parcels, contacts, dt)),
    );
  // The deposit normalizes the sign of zero in the parcel it returns, as the copy does.
  expect(Object.is(depositOwnedParcelHeat3D(profiles, hot, 0n).velocity[0], 0)).toBe(true);
});
