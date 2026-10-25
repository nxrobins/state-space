/** Owned, versioned candidate-world data. Runtime qualification is separate from admission. */
import { assertRecordFields, copyPortableValue, type PortableValue } from '../../portable-data.js';
import { readThermalParcel3D, THERMAL_FRACTION_SCALE_3D, type ThermalParcel3D } from './thermal.js';
import {
  MULTIPHYSICS_ENERGY_SCALE_3D,
  readMultiphysicsProfile3D,
  type MultiphysicsProfiles3D,
} from './profiles.js';
import { readPhysicalBattery3D, batteryStoredUnits3D, type PhysicalBattery3D } from './battery.js';
import { parcelConservation3D, type MaterialParcel3D } from './conservation.js';
import { validateRigidAssemblyMotion3D, type RigidBond3D } from './rigid.js';
import { addVec3, assertFiniteVec3, type Vec3 } from './math.js';

export const MULTIPHYSICS_RULES_3D = 'multiphysics-world-1';
export const MULTIPHYSICS_LIMITS_3D = Object.freeze({
  parcels: 256,
  bonds: 768,
  extent: 16,
  ticks: 1000000000,
});
export type MultiphysicsSettings3D = {
  dt: number;
  gravity: Vec3;
  restitution: number;
  friction: number;
  /** Absolute per-tick energy residual limit in model mechanical-energy units. */
  numericalEnergyLimit: number;
};
export type MultiphysicsInventory3D = {
  storedSubQ: string;
  conversionRemainderSubQ: number;
  mechanicalEnergy: number;
  mass: number;
  linearMomentum: Vec3;
  angularMomentum: Vec3;
};
export type MultiphysicsAccounting3D = {
  baseline: MultiphysicsInventory3D;
  externalStoredSubQ: string;
  externalMechanicalEnergy: number;
  externalConversionRemainderSubQ: number;
  numericalEnergy: number;
  externalMass: number;
  externalLinearMomentum: Vec3;
  externalAngularMomentum: Vec3;
  physicalLinearImpulse: Vec3;
  physicalAngularImpulse: Vec3;
  numericalLinearMomentum: Vec3;
  numericalAngularMomentum: Vec3;
};
export type MultiphysicsSnapshot3D = {
  schema: 1;
  rules: typeof MULTIPHYSICS_RULES_3D;
  profileVersion: string;
  catalogHash: string;
  tick: number;
  nextOwner: number;
  settings: MultiphysicsSettings3D;
  parcels: ThermalParcel3D[];
  bonds: RigidBond3D[];
  anchors: string[];
  battery: PhysicalBattery3D | null;
  /** Thermodynamic gas volumes; expansion work is resolved by the gas solver. */
  gasVolumes: { id: string; volume: number }[];
  /** Fractions below one thermal lattice unit. They remain part of the inventory. */
  conversionRemainders: { id: string; subQ: number }[];
  accounting: MultiphysicsAccounting3D;
};
export type MultiphysicsInitial3D = {
  parcels: ThermalParcel3D[];
  bonds?: RigidBond3D[];
  anchors?: string[];
  battery?: PhysicalBattery3D | null;
  settings?: Partial<MultiphysicsSettings3D>;
};
export const MULTIPHYSICS_SUBQ_PER_ENERGY_3D =
  THERMAL_FRACTION_SCALE_3D * MULTIPHYSICS_ENERGY_SCALE_3D;
export const compareIdentity3D = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const f = (v: unknown, low: number, high: number): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < low || v > high)
    throw Error('Invalid bounded multiphysics quantity.');
  return v;
};
const integer = (v: unknown, low: number, high: number): number => {
  const n = f(v, low, high);
  if (!Number.isSafeInteger(n)) throw Error('Invalid multiphysics integer.');
  return n;
};
function decimal(v: unknown): string {
  if (typeof v !== 'string' || !/^-?(0|[1-9][0-9]{0,24})$/.test(v) || v === '-0')
    throw Error('Invalid stored-energy integer.');
  return v;
}
function finiteVector(v: unknown): Vec3 {
  if (!Array.isArray(v) || v.length !== 3) throw Error('Invalid world vector.');
  assertFiniteVec3(v as unknown as Vec3);
  return v as unknown as Vec3;
}
export function baseParcel3D(parcel: ThermalParcel3D): MaterialParcel3D {
  const { halfExtents: _halfExtents, thermalRemainder: _thermalRemainder, ...base } = parcel;
  return base;
}
export function isRigidMaterial3D(
  profiles: MultiphysicsProfiles3D,
  parcel: ThermalParcel3D,
): boolean {
  const phase = readMultiphysicsProfile3D(profiles, parcel.material).phase;
  return phase === 'solid' || phase === 'granular';
}
export function bondedComponents3D(
  parcels: readonly ThermalParcel3D[],
  bonds: readonly RigidBond3D[],
): string[][] {
  const adjacent = new Map(parcels.map((p) => [p.id, [] as string[]]));
  for (const edge of bonds) {
    adjacent.get(edge.a)!.push(edge.b);
    adjacent.get(edge.b)!.push(edge.a);
  }
  const seen = new Set<string>(),
    components: string[][] = [];
  for (const parcel of [...parcels].sort((a, b) => compareIdentity3D(a.id, b.id))) {
    if (seen.has(parcel.id)) continue;
    const component = [parcel.id];
    seen.add(parcel.id);
    for (let i = 0; i < component.length; i++)
      for (const id of adjacent.get(component[i])!) {
        if (!seen.has(id)) {
          seen.add(id);
          component.push(id);
        }
      }
    components.push(component.sort(compareIdentity3D));
  }
  return components;
}
/** Keep unchanged assemblies' IDs; every split/merge/new solid receives a fresh owner. */
export function rebuildOwners3D(
  profiles: MultiphysicsProfiles3D,
  state: MultiphysicsSnapshot3D,
  previous: readonly ThermalParcel3D[],
): void {
  const old = new Map<string, string[]>();
  for (const p of previous) {
    const ids = old.get(p.owner) ?? [];
    ids.push(p.id);
    old.set(p.owner, ids);
  }
  for (const ids of old.values()) ids.sort(compareIdentity3D);
  const byId = new Map(state.parcels.map((p) => [p.id, p]));
  const solids = state.parcels.filter((p) => isRigidMaterial3D(profiles, p));
  for (const component of bondedComponents3D(solids, state.bonds)) {
    const first = byId.get(component[0])!,
      oldIds = old.get(first.owner);
    const unchanged =
      /^solid:[0-9]+$/.test(first.owner) &&
      oldIds?.length === component.length &&
      component.every((id, i) => oldIds[i] === id && byId.get(id)!.owner === first.owner);
    if (!unchanged && state.nextOwner >= Number.MAX_SAFE_INTEGER)
      throw Error('Assembly identity exhausted.');
    const owner = unchanged ? first.owner : `solid:${state.nextOwner++}`;
    for (const id of component) byId.get(id)!.owner = owner;
  }
  for (const p of state.parcels) if (!isRigidMaterial3D(profiles, p)) p.owner = 'fluid';
}
export function multiphysicsInventory3D(
  state: Pick<MultiphysicsSnapshot3D, 'parcels' | 'battery' | 'settings' | 'conversionRemainders'>,
): MultiphysicsInventory3D {
  let stored = 0n;
  const scale = BigInt(THERMAL_FRACTION_SCALE_3D);
  for (const p of state.parcels)
    stored +=
      (BigInt(p.thermalQ) + BigInt(p.latentQ) + BigInt(p.chemicalQ)) * scale +
      BigInt(p.thermalRemainder * THERMAL_FRACTION_SCALE_3D);
  if (state.battery) stored += BigInt(batteryStoredUnits3D(state.battery));
  const mechanical = parcelConservation3D(state.parcels.map(baseParcel3D), {
    gravity: state.settings.gravity,
  });
  return {
    storedSubQ: String(stored),
    conversionRemainderSubQ: state.conversionRemainders.reduce((sum, row) => sum + row.subQ, 0),
    mechanicalEnergy: mechanical.kineticEnergy + mechanical.potentialEnergy,
    mass: mechanical.mass,
    linearMomentum: mechanical.linearMomentum,
    angularMomentum: mechanical.angularMomentum,
  };
}
export function inventoryEnergyDelta3D(
  before: MultiphysicsInventory3D,
  after: MultiphysicsInventory3D,
): number {
  return (
    Number(BigInt(after.storedSubQ) - BigInt(before.storedSubQ)) / MULTIPHYSICS_SUBQ_PER_ENERGY_3D +
    (after.conversionRemainderSubQ - before.conversionRemainderSubQ) /
      MULTIPHYSICS_SUBQ_PER_ENERGY_3D +
    (after.mechanicalEnergy - before.mechanicalEnergy)
  );
}
function readSettings(raw: unknown): MultiphysicsSettings3D {
  assertRecordFields(
    raw,
    ['dt', 'gravity', 'restitution', 'friction', 'numericalEnergyLimit'],
    [],
    'Invalid world settings.',
  );
  const v = raw as MultiphysicsSettings3D;
  f(v.dt, 1e-6, 1 / 30);
  finiteVector(v.gravity);
  if (v.gravity.some((n) => Math.abs(n) > 100)) throw Error('Gravity exceeds model bounds.');
  f(v.restitution, 0, 1);
  f(v.friction, 0, 4);
  f(v.numericalEnergyLimit, 1e-10, 1);
  return v;
}
function readInventory(raw: unknown): MultiphysicsInventory3D {
  assertRecordFields(
    raw,
    [
      'storedSubQ',
      'conversionRemainderSubQ',
      'mechanicalEnergy',
      'mass',
      'linearMomentum',
      'angularMomentum',
    ],
    [],
    'Invalid inventory fields.',
  );
  const value = raw as MultiphysicsInventory3D;
  decimal(value.storedSubQ);
  if (BigInt(value.storedSubQ) < 0n) throw Error('Negative baseline store.');
  f(value.conversionRemainderSubQ, 0, MULTIPHYSICS_LIMITS_3D.parcels);
  f(value.mechanicalEnergy, -1e30, 1e30);
  f(value.mass, 0, 1e20);
  finiteVector(value.linearMomentum);
  finiteVector(value.angularMomentum);
  return value;
}
/** Reject unsupported rules, stores, geometry and ownership before any continuation. */
export function readMultiphysicsSnapshot3D(
  profiles: MultiphysicsProfiles3D,
  raw: unknown,
): MultiphysicsSnapshot3D {
  readMultiphysicsProfile3D(profiles, 'air');
  const value = copyPortableValue(raw as PortableValue) as unknown as MultiphysicsSnapshot3D;
  assertRecordFields(
    value,
    [
      'schema',
      'rules',
      'profileVersion',
      'catalogHash',
      'tick',
      'nextOwner',
      'settings',
      'parcels',
      'bonds',
      'anchors',
      'battery',
      'gasVolumes',
      'conversionRemainders',
      'accounting',
    ],
    [],
    'Invalid multiphysics snapshot fields.',
  );
  if (
    value.schema !== 1 ||
    value.rules !== MULTIPHYSICS_RULES_3D ||
    value.profileVersion !== profiles.version ||
    value.catalogHash !== profiles.catalogHash
  )
    throw Error('Incompatible multiphysics rules or profiles.');
  integer(value.tick, 0, MULTIPHYSICS_LIMITS_3D.ticks);
  integer(value.nextOwner, 0, Number.MAX_SAFE_INTEGER);
  readSettings(value.settings);
  if (!Array.isArray(value.parcels) || value.parcels.length > MULTIPHYSICS_LIMITS_3D.parcels)
    throw Error('World parcel limit exceeded.');
  value.parcels = value.parcels
    .map((p) => readThermalParcel3D(profiles, p))
    .sort((a, b) => compareIdentity3D(a.id, b.id));
  const byId = new Map(value.parcels.map((p) => [p.id, p]));
  if (byId.size !== value.parcels.length) throw Error('Duplicate world parcel.');
  for (const p of value.parcels) {
    if (
      p.center.some((v) => Math.abs(v) > 1e4) ||
      p.velocity.some((v) => Math.abs(v) > 1e3) ||
      p.halfExtents.some((v) => v > 16) ||
      p.mass > 1e8
    )
      throw Error('Parcel exceeds runtime geometry or motion bound.');
  }
  if (!Array.isArray(value.bonds) || value.bonds.length > MULTIPHYSICS_LIMITS_3D.bonds)
    throw Error('World bond limit exceeded.');
  for (const b of value.bonds) {
    assertRecordFields(b, ['a', 'b', 'strength', 'restLength'], [], 'Invalid bond fields.');
    if (!byId.has(b.a) || !byId.has(b.b) || b.a === b.b) throw Error('Invalid bond endpoints.');
    if (
      readMultiphysicsProfile3D(profiles, byId.get(b.a)!.material).phase !== 'solid' ||
      readMultiphysicsProfile3D(profiles, byId.get(b.b)!.material).phase !== 'solid'
    )
      throw Error('Only solids can be bonded.');
    f(b.strength, 1e-12, 1e12);
    f(b.restLength, 1e-6, 1e4);
    if (compareIdentity3D(b.a, b.b) > 0) [b.a, b.b] = [b.b, b.a];
  }
  value.bonds.sort((a, b) => compareIdentity3D(a.a, b.a) || compareIdentity3D(a.b, b.b));
  if (value.bonds.some((b, i) => i && b.a === value.bonds[i - 1].a && b.b === value.bonds[i - 1].b))
    throw Error('Duplicate bond.');
  if (
    !Array.isArray(value.anchors) ||
    value.anchors.length > value.parcels.length ||
    new Set(value.anchors).size !== value.anchors.length
  )
    throw Error('Invalid world anchors.');
  value.anchors.sort(compareIdentity3D);
  for (const id of value.anchors)
    if (
      !byId.has(id) ||
      readMultiphysicsProfile3D(profiles, byId.get(id)!.material).phase !== 'solid'
    )
      throw Error('Invalid anchored material.');
  const owners = new Set<string>();
  for (const component of bondedComponents3D(
    value.parcels.filter((p) => isRigidMaterial3D(profiles, p)),
    value.bonds,
  )) {
    const owner = byId.get(component[0])!.owner,
      match = /^solid:(0|[1-9][0-9]*)$/.exec(owner);
    if (
      !match ||
      Number(match[1]) >= value.nextOwner ||
      owners.has(owner) ||
      component.some((id) => byId.get(id)!.owner !== owner)
    )
      throw Error('Invalid solid ownership.');
    owners.add(owner);
    validateRigidAssemblyMotion3D(
      component.map((id) => byId.get(id)!),
      component.some((id) => value.anchors.includes(id)),
    );
    if (component.some((id) => value.anchors.includes(id)))
      for (const id of component) {
        const p = byId.get(id)!;
        if ([...p.velocity, ...p.intrinsicAngularMomentum].some((n) => n !== 0))
          throw Error('Anchored matter must be stationary.');
      }
  }
  for (const p of value.parcels)
    if (!isRigidMaterial3D(profiles, p) && p.owner !== 'fluid')
      throw Error('Invalid fluid ownership.');
  if (
    !Array.isArray(value.conversionRemainders) ||
    value.conversionRemainders.length !== value.parcels.length
  )
    throw Error('Invalid conversion remainder ownership.');
  value.conversionRemainders.sort((a, b) => compareIdentity3D(a.id, b.id));
  for (const [i, r] of value.conversionRemainders.entries()) {
    assertRecordFields(r, ['id', 'subQ'], [], 'Invalid conversion remainder.');
    if (r.id !== value.parcels[i].id) throw Error('Invalid conversion remainder owner.');
    f(r.subQ, 0, 1 - Number.EPSILON / 2);
  }
  const gases = value.parcels.filter(
    (p) => readMultiphysicsProfile3D(profiles, p.material).phase === 'gas',
  );
  if (!Array.isArray(value.gasVolumes) || value.gasVolumes.length !== gases.length)
    throw Error('Invalid gas volume ownership.');
  value.gasVolumes.sort((a, b) => compareIdentity3D(a.id, b.id));
  for (const [i, gas] of value.gasVolumes.entries()) {
    assertRecordFields(gas, ['id', 'volume'], [], 'Invalid gas volume.');
    if (gas.id !== gases[i].id) throw Error('Invalid gas volume owner.');
    f(gas.volume, 1e-6, 4096);
  }
  if (value.battery !== null) {
    value.battery = readPhysicalBattery3D(value.battery);
    const required = [
      ...value.battery.cores.map((c) => c.id),
      ...(value.battery.failed ? [] : [value.battery.positive, value.battery.negative]),
    ];
    for (const id of required) if (!byId.has(id)) throw Error('Battery refers to absent matter.');
  }
  assertRecordFields(
    value.accounting,
    [
      'baseline',
      'externalStoredSubQ',
      'externalMechanicalEnergy',
      'externalConversionRemainderSubQ',
      'numericalEnergy',
      'externalMass',
      'externalLinearMomentum',
      'externalAngularMomentum',
      'physicalLinearImpulse',
      'physicalAngularImpulse',
      'numericalLinearMomentum',
      'numericalAngularMomentum',
    ],
    [],
    'Invalid world accounting.',
  );
  readInventory(value.accounting.baseline);
  decimal(value.accounting.externalStoredSubQ);
  for (const key of [
    'externalMechanicalEnergy',
    'externalConversionRemainderSubQ',
    'numericalEnergy',
  ] as const)
    f(value.accounting[key], -1e30, 1e30);
  f(value.accounting.externalMass, -1e20, 1e20);
  const inventory = multiphysicsInventory3D(value),
    ledger = value.accounting;
  if (
    Math.abs(inventory.mass - (ledger.baseline.mass + ledger.externalMass)) >
    1e-12 * Math.max(1, inventory.mass, ledger.baseline.mass)
  )
    throw Error('World mass ledger is inconsistent.');
  for (const [total, external, physical, numerical] of [
    [
      'linearMomentum',
      'externalLinearMomentum',
      'physicalLinearImpulse',
      'numericalLinearMomentum',
    ],
    [
      'angularMomentum',
      'externalAngularMomentum',
      'physicalAngularImpulse',
      'numericalAngularMomentum',
    ],
  ] as const) {
    finiteVector(ledger[external]);
    finiteVector(ledger[physical]);
    finiteVector(ledger[numerical]);
    const expectedMomentum = addVec3(
      ledger.baseline[total],
      addVec3(ledger[external], addVec3(ledger[physical], ledger[numerical])),
    );
    assertFiniteVec3(expectedMomentum, 'expected momentum');
    if (
      inventory[total].some(
        (v, i) =>
          Math.abs(v - expectedMomentum[i]) >
          128 * Number.EPSILON * Math.max(1, Math.abs(v), Math.abs(expectedMomentum[i])) + 1e-10,
      )
    )
      throw Error('World momentum ledger is inconsistent.');
  }
  const actual = inventoryEnergyDelta3D(value.accounting.baseline, inventory);
  const expected =
    Number(BigInt(value.accounting.externalStoredSubQ)) / MULTIPHYSICS_SUBQ_PER_ENERGY_3D +
    value.accounting.externalMechanicalEnergy +
    value.accounting.externalConversionRemainderSubQ / MULTIPHYSICS_SUBQ_PER_ENERGY_3D +
    value.accounting.numericalEnergy;
  const roundoff =
    128 *
      Number.EPSILON *
      Math.max(
        1,
        Math.abs(actual),
        Math.abs(expected),
        Math.abs(inventory.mechanicalEnergy - ledger.baseline.mechanicalEnergy),
        Math.abs(ledger.externalMechanicalEnergy),
        Math.abs(ledger.numericalEnergy),
      ) +
    1e-10;
  if (
    !Number.isFinite(actual) ||
    !Number.isFinite(expected) ||
    Math.abs(actual - expected) > roundoff
  )
    throw Error('World energy ledger is inconsistent.');
  return value;
}
export function createMultiphysicsSnapshot3D(
  profiles: MultiphysicsProfiles3D,
  raw: MultiphysicsInitial3D,
): MultiphysicsSnapshot3D {
  const initial = copyPortableValue(
    raw as unknown as PortableValue,
  ) as unknown as MultiphysicsInitial3D;
  assertRecordFields(
    initial,
    ['parcels'],
    ['bonds', 'anchors', 'battery', 'settings'],
    'Invalid multiphysics initial state.',
  );
  if (
    !Array.isArray(initial.parcels) ||
    initial.parcels.length > MULTIPHYSICS_LIMITS_3D.parcels ||
    (initial.bonds !== undefined &&
      (!Array.isArray(initial.bonds) || initial.bonds.length > MULTIPHYSICS_LIMITS_3D.bonds)) ||
    (initial.anchors !== undefined &&
      (!Array.isArray(initial.anchors) || initial.anchors.length > MULTIPHYSICS_LIMITS_3D.parcels))
  )
    throw Error('Initial world exceeds collection bounds.');
  if (initial.settings !== undefined)
    assertRecordFields(
      initial.settings,
      [],
      ['dt', 'gravity', 'restitution', 'friction', 'numericalEnergyLimit'],
      'Invalid initial settings.',
    );
  const settings = {
    dt: 1 / 120,
    gravity: [0, -9.8, 0] as Vec3,
    restitution: 0.1,
    friction: 0.5,
    numericalEnergyLimit: 0.01,
    ...initial.settings,
  };
  const empty: MultiphysicsInventory3D = {
    storedSubQ: '0',
    conversionRemainderSubQ: 0,
    mechanicalEnergy: 0,
    mass: 0,
    linearMomentum: [0, 0, 0],
    angularMomentum: [0, 0, 0],
  };
  const state: MultiphysicsSnapshot3D = {
    schema: 1,
    rules: MULTIPHYSICS_RULES_3D,
    profileVersion: profiles.version,
    catalogHash: profiles.catalogHash,
    tick: 0,
    nextOwner: 0,
    settings,
    parcels: initial.parcels.map((p) => readThermalParcel3D(profiles, p)),
    bonds: initial.bonds ?? [],
    anchors: initial.anchors ?? [],
    battery: initial.battery ?? null,
    gasVolumes: initial.parcels
      .filter((p) => readMultiphysicsProfile3D(profiles, p.material).phase === 'gas')
      .map((p) => ({
        id: p.id,
        volume: p.mass / readMultiphysicsProfile3D(profiles, p.material).restDensity,
      })),
    conversionRemainders: initial.parcels.map((p) => ({ id: p.id, subQ: 0 })),
    accounting: {
      baseline: empty,
      externalStoredSubQ: '0',
      externalMechanicalEnergy: 0,
      externalConversionRemainderSubQ: 0,
      numericalEnergy: 0,
      externalMass: 0,
      externalLinearMomentum: [0, 0, 0],
      externalAngularMomentum: [0, 0, 0],
      physicalLinearImpulse: [0, 0, 0],
      physicalAngularImpulse: [0, 0, 0],
      numericalLinearMomentum: [0, 0, 0],
      numericalAngularMomentum: [0, 0, 0],
    },
  };
  // Validate endpoints before traversing the candidate graph.
  const ids = new Set(state.parcels.map((p) => p.id));
  for (const b of state.bonds) {
    assertRecordFields(b, ['a', 'b', 'strength', 'restLength'], [], 'Invalid initial bond fields.');
    if (
      !ids.has(b.a) ||
      !ids.has(b.b) ||
      b.a === b.b ||
      [b.a, b.b].some(
        (id) =>
          readMultiphysicsProfile3D(profiles, state.parcels.find((p) => p.id === id)!.material)
            .phase !== 'solid',
      )
    )
      throw Error('Invalid initial bond endpoints.');
    f(b.strength, 1e-12, 1e12);
    f(b.restLength, 1e-6, 1e4);
  }
  rebuildOwners3D(profiles, state, []);
  state.accounting.baseline = multiphysicsInventory3D(state);
  return readMultiphysicsSnapshot3D(profiles, state);
}
