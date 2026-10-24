/** Owned parcel heat/reaction kernel. Contacts and mechanical ownership belong to the world solver. */
import { assertRecordFields, copyPortableValue, type PortableValue } from '../../portable-data.js';
import { readMaterialParcel3D, type MaterialParcel3D } from './conservation.js';
import { rotateVector, normalizeQuaternion, type Vec3, type Quat } from './math.js';
import {
  readMultiphysicsProfile3D,
  MULTIPHYSICS_ENERGY_SCALE_3D as E,
  type MaterialProfile3D,
  type MultiphysicsProfiles3D,
} from './profiles.js';

/** Exactly representable binary fraction of one Q; smaller mechanical remainders belong to the world ledger. */
export const THERMAL_FRACTION_SCALE_3D = 1048576;
export const THERMAL_LIMITS_3D = Object.freeze({
  parcels: 4096,
  contacts: 16384,
  maxHeatQ: 0x3fffffff,
  maxDt: 1,
});
const S = BigInt(THERMAL_FRACTION_SCALE_3D),
  MAX_HEAT = BigInt(THERMAL_LIMITS_3D.maxHeatQ) * S;
export type ThermalParcel3D = MaterialParcel3D & {
  halfExtents: Vec3;
  /** Fraction of combined sensible+latent enthalpy Q, on the binary sub-Q lattice. */
  thermalRemainder: number;
};
export type ThermalContact3D = { a: string; b: string };
export type ThermalSeed3D = {
  id: string;
  material: string;
  owner: string;
  center: Vec3;
  temperature?: number;
  velocity?: Vec3;
  orientation?: Quat;
  angularVelocity?: Vec3;
  halfExtents?: Vec3;
};
export type ThermalTransition3D = {
  id: string;
  from: string;
  to: string;
  kind: 'phase' | 'combustion' | 'extinction';
};
export type ThermalBurn3D = {
  fuel: string;
  oxidizer: string;
  releasedQ: number;
  transferredQ: number;
};
export type ThermalAdvanceResult3D = {
  parcels: ThermalParcel3D[];
  transitions: ThermalTransition3D[];
  burns: ThermalBurn3D[];
  energy: {
    beforeQ: string;
    afterQ: string;
    beforeRemainderQ: number;
    afterRemainderQ: number;
    beforeSubQ: string;
    afterSubQ: string;
    roundoffQ: 0;
  };
};
const data = (value: unknown) =>
  copyPortableValue(value as PortableValue) as Record<string, unknown>;
function vector(value: unknown): Vec3 {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !value.every((v) => typeof v === 'number' && Number.isFinite(v))
  )
    throw Error('Invalid thermal vector.');
  return [...value] as unknown as Vec3;
}
function list(value: unknown, limit: number): unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > limit ||
    Reflect.ownKeys(value).length !== value.length + 1
  )
    throw Error('Thermal list exceeds its data bound.');
  return Array.from({ length: value.length }, (_, i) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
      throw Error('Thermal lists require dense data.');
    return descriptor.value;
  });
}
const heat = (p: ThermalParcel3D) =>
  (BigInt(p.thermalQ) + BigInt(p.latentQ)) * S +
  BigInt(p.thermalRemainder * THERMAL_FRACTION_SCALE_3D);
const offset = (profile: MaterialProfile3D) => BigInt(profile.phaseEnergyQ) * S;
function sensible(
  profiles: MultiphysicsProfiles3D,
  profile: MaterialProfile3D,
  enthalpy: bigint,
): bigint {
  const base = offset(profile),
    zero = 0n;
  let result = enthalpy > base ? enthalpy - base : zero;
  const up = profile.boilsInto ?? profile.meltsInto,
    down = profile.freezesInto ?? profile.condensesInto;
  const upAt = BigInt((profile.boilsInto ? profile.boilPoint : profile.meltPoint) * E) * S;
  const downAt =
    BigInt((profile.freezesInto ? profile.freezePoint : profile.condensePoint) * E) * S;
  if (up && enthalpy >= base + upAt) {
    const available = enthalpy - offset(readMultiphysicsProfile3D(profiles, up));
    result = available > upAt ? available : upAt;
  } else if (down && enthalpy <= base + downAt) {
    const available = enthalpy - offset(readMultiphysicsProfile3D(profiles, down));
    result = available < zero ? zero : available < downAt ? available : downAt;
  }
  if (result < zero || result > enthalpy) throw Error('Invalid profile enthalpy interval.');
  return result;
}
function withHeat(
  profiles: MultiphysicsProfiles3D,
  parcel: ThermalParcel3D,
  enthalpy: bigint,
): ThermalParcel3D {
  if (enthalpy < 0n || enthalpy > MAX_HEAT) throw Error('Thermal enthalpy exceeds its range.');
  const thermal = sensible(
      profiles,
      readMultiphysicsProfile3D(profiles, parcel.material),
      enthalpy,
    ),
    latent = enthalpy - thermal;
  return {
    ...parcel,
    thermalQ: Number(thermal / S),
    latentQ: Number(latent / S),
    thermalRemainder: Number(enthalpy % S) / THERMAL_FRACTION_SCALE_3D,
  };
}
export function readThermalParcel3D(
  profiles: MultiphysicsProfiles3D,
  raw: unknown,
): ThermalParcel3D {
  const owned = data(raw);
  if (!owned || typeof owned !== 'object') throw Error('Invalid thermal parcel.');
  const { halfExtents, thermalRemainder, ...base } = owned;
  const parcel = readMaterialParcel3D(base),
    profile = readMultiphysicsProfile3D(profiles, parcel.material),
    half = vector(halfExtents);
  if (
    half.some((v) => v <= 0) ||
    typeof thermalRemainder !== 'number' ||
    thermalRemainder < 0 ||
    thermalRemainder >= 1 ||
    !Number.isSafeInteger(thermalRemainder * THERMAL_FRACTION_SCALE_3D)
  )
    throw Error('Invalid thermal geometry or fractional energy.');
  if (parcel.referenceAmount !== 1 || parcel.heatCapacity !== 1)
    throw Error('Thermal v1 requires unit reference amount and heat capacity.');
  if (parcel.chemicalQ > profile.fuelEnergyQ)
    throw Error('Chemical store exceeds this material profile.');
  const result = { ...parcel, halfExtents: half, thermalRemainder },
    normalized = withHeat(profiles, result, heat(result));
  if (normalized.thermalQ !== result.thermalQ || normalized.latentQ !== result.latentQ)
    throw Error('Thermal parcel decomposition disagrees with its enthalpy.');
  return result;
}
/** External initialization only. Requested temperature is quantized down to one binary sub-Q. */
export function seedThermalParcel3D(
  profiles: MultiphysicsProfiles3D,
  raw: ThermalSeed3D,
): ThermalParcel3D {
  const value = data(raw);
  assertRecordFields(
    value,
    ['id', 'material', 'owner', 'center'],
    ['temperature', 'velocity', 'orientation', 'angularVelocity', 'halfExtents'],
    'Invalid thermal seed fields.',
  );
  if (typeof value.material !== 'string') throw Error('Invalid seed material.');
  const profile = readMultiphysicsProfile3D(profiles, value.material),
    halfExtents = vector(value.halfExtents ?? [0.5, 0.5, 0.5]);
  if (halfExtents.some((v) => v <= 0)) throw Error('Invalid positive parcel half extents.');
  const orientation = normalizeQuaternion((value.orientation ?? [0, 0, 0, 1]) as Quat),
    omega = vector(value.angularVelocity ?? [0, 0, 0]);
  const mass = profile.massPerReference,
    [x, y, z] = halfExtents;
  const principalInertia: Vec3 = [
    (mass * (y * y + z * z)) / 3,
    (mass * (x * x + z * z)) / 3,
    (mass * (x * x + y * y)) / 3,
  ];
  const localOmega = rotateVector(
    [-orientation[0], -orientation[1], -orientation[2], orientation[3]],
    omega,
  );
  const intrinsicAngularMomentum = rotateVector(
    orientation,
    localOmega.map((v, i) => v * principalInertia[i]) as unknown as Vec3,
  );
  const temperature = value.temperature ?? profile.defaultTemperature;
  if (typeof temperature !== 'number' || !Number.isFinite(temperature) || temperature < 0)
    throw Error('Invalid seed temperature.');
  const units = Math.floor(temperature * E * THERMAL_FRACTION_SCALE_3D);
  if (!Number.isSafeInteger(units)) throw Error('Seed thermal energy exceeds its range.');
  const parcel = {
    ...readMaterialParcel3D({
      id: value.id,
      material: value.material,
      owner: value.owner,
      center: vector(value.center),
      velocity: vector(value.velocity ?? [0, 0, 0]),
      orientation,
      mass,
      referenceAmount: 1,
      heatCapacity: 1,
      principalInertia,
      intrinsicAngularMomentum,
      thermalQ: 0,
      latentQ: 0,
      chemicalQ: profile.fuelEnergyQ,
    }),
    halfExtents,
    thermalRemainder: 0,
  };
  return readThermalParcel3D(profiles, withHeat(profiles, parcel, BigInt(units) + offset(profile)));
}
export function parcelTemperature3D(
  profiles: MultiphysicsProfiles3D,
  raw: ThermalParcel3D,
): number {
  const p = readThermalParcel3D(profiles, raw);
  return (
    Number(sensible(profiles, readMultiphysicsProfile3D(profiles, p.material), heat(p))) /
    THERMAL_FRACTION_SCALE_3D /
    E
  );
}
/** Signed, exact lattice transfer. The caller owns any external or mechanical conversion receipt. */
export function depositParcelHeat3D(
  profiles: MultiphysicsProfiles3D,
  raw: ThermalParcel3D,
  deltaSubQ: bigint,
): ThermalParcel3D {
  if (typeof deltaSubQ !== 'bigint') throw Error('Heat deposit requires integer sub-Q units.');
  const parcel = readThermalParcel3D(profiles, raw);
  return withHeat(profiles, parcel, heat(parcel) + deltaSubQ);
}
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
function total(parcels: readonly ThermalParcel3D[]): bigint {
  return parcels.reduce((sum, p) => sum + heat(p) + BigInt(p.chemicalQ) * S, 0n);
}
function energyReport(before: bigint, after: bigint): ThermalAdvanceResult3D['energy'] {
  if (before !== after) throw Error('Thermal kernel violated exact energy conservation.');
  return {
    beforeQ: String(before / S),
    afterQ: String(after / S),
    beforeRemainderQ: Number(before % S) / THERMAL_FRACTION_SCALE_3D,
    afterRemainderQ: Number(after % S) / THERMAL_FRACTION_SCALE_3D,
    beforeSubQ: String(before),
    afterSubQ: String(after),
    roundoffQ: 0,
  };
}
/** One enthalpy-driven material edge per parcel; no conduction, chemistry or extinction. */
function settleOwnedPhases(
  profiles: MultiphysicsProfiles3D,
  parcels: ThermalParcel3D[],
): ThermalTransition3D[] {
  const transitions: ThermalTransition3D[] = [];
  for (let i = 0; i < parcels.length; i++) {
    const p = parcels[i],
      profile = readMultiphysicsProfile3D(profiles, p.material),
      h = heat(p);
    const up = profile.boilsInto ?? profile.meltsInto,
      down = profile.freezesInto ?? profile.condensesInto;
    let target: string | null = null;
    if (
      up &&
      h >=
        offset(readMultiphysicsProfile3D(profiles, up)) +
          BigInt((profile.boilsInto ? profile.boilPoint : profile.meltPoint) * E) * S
    )
      target = up;
    else if (
      down &&
      h <=
        offset(readMultiphysicsProfile3D(profiles, down)) +
          BigInt((profile.freezesInto ? profile.freezePoint : profile.condensePoint) * E) * S
    )
      target = down;
    if (target) {
      parcels[i] = withHeat(profiles, { ...p, material: target }, h);
      transitions.push({ id: p.id, from: p.material, to: target, kind: 'phase' });
    }
  }
  return transitions;
}
/** Owned phase-only settlement after pressure work; all extensive state survives. */
export function settleThermalPhases3D(
  profiles: MultiphysicsProfiles3D,
  raw: readonly ThermalParcel3D[],
): { parcels: ThermalParcel3D[]; transitions: ThermalTransition3D[] } {
  readMultiphysicsProfile3D(profiles, 'air');
  const parcels = list(raw, THERMAL_LIMITS_3D.parcels)
    .map((p) => readThermalParcel3D(profiles, p))
    .sort((a, b) => compare(a.id, b.id));
  if (new Set(parcels.map((p) => p.id)).size !== parcels.length)
    throw Error('Duplicate thermal parcel identity.');
  const before = total(parcels),
    transitions = settleOwnedPhases(profiles, parcels);
  energyReport(before, total(parcels));
  return { parcels: parcels.map((p) => readThermalParcel3D(profiles, p)), transitions };
}
/** One bounded pass: canonical pair heat exchange, phase changes, matched combustion, extinction. */
export function advanceParcelThermal3D(
  profiles: MultiphysicsProfiles3D,
  raw: readonly ThermalParcel3D[],
  rawContacts: readonly ThermalContact3D[],
  dt: number,
): ThermalAdvanceResult3D {
  readMultiphysicsProfile3D(profiles, 'air');
  if (!Number.isFinite(dt) || dt < 0 || dt > THERMAL_LIMITS_3D.maxDt)
    throw Error('Invalid bounded thermal time step.');
  const parcels = list(raw, THERMAL_LIMITS_3D.parcels)
    .map((p) => readThermalParcel3D(profiles, p))
    .sort((a, b) => compare(a.id, b.id));
  const index = new Map<string, number>();
  for (let i = 0; i < parcels.length; i++) {
    if (index.has(parcels[i].id)) throw Error('Duplicate thermal parcel identity.');
    index.set(parcels[i].id, i);
  }
  const contacts = list(rawContacts, THERMAL_LIMITS_3D.contacts)
    .map((rawContact) => {
      const edge = data(rawContact);
      assertRecordFields(edge, ['a', 'b'], [], 'Invalid thermal contact fields.');
      if (
        typeof edge.a !== 'string' ||
        typeof edge.b !== 'string' ||
        edge.a === edge.b ||
        !index.has(edge.a) ||
        !index.has(edge.b)
      )
        throw Error('Invalid thermal contact endpoints.');
      return compare(edge.a, edge.b) < 0 ? { a: edge.a, b: edge.b } : { a: edge.b, b: edge.a };
    })
    .sort((a, b) => compare(a.a, b.a) || compare(a.b, b.b));
  if (contacts.some((v, i) => i > 0 && v.a === contacts[i - 1].a && v.b === contacts[i - 1].b))
    throw Error('Duplicate thermal contact.');
  const before = total(parcels),
    transitions: ThermalTransition3D[] = [],
    burns: ThermalBurn3D[] = [];
  if (dt === 0) return { parcels, transitions, burns, energy: energyReport(before, before) };
  const adjacent: number[][] = parcels.map(() => []);
  for (const { a, b } of contacts) {
    const i = index.get(a)!,
      j = index.get(b)!;
    adjacent[i].push(j);
    adjacent[j].push(i);
    const left = parcels[i],
      right = parcels[j],
      lp = readMultiphysicsProfile3D(profiles, left.material),
      rp = readMultiphysicsProfile3D(profiles, right.material);
    const lh = heat(left),
      rh = heat(right);
    const difference =
      Number(sensible(profiles, lp, lh) - sensible(profiles, rp, rh)) / THERMAL_FRACTION_SCALE_3D;
    const k =
      lp.conductivity + rp.conductivity
        ? (2 * lp.conductivity * rp.conductivity) / (lp.conductivity + rp.conductivity)
        : 0;
    const proposed = BigInt(
      Math.floor(
        Math.min(Math.abs(difference) / 2, Math.abs(difference) * k * dt) *
          THERMAL_FRACTION_SCALE_3D,
      ),
    );
    const source = difference > 0 ? lh : rh,
      sink = difference > 0 ? rh : lh;
    const capacity = MAX_HEAT - sink,
      flux =
        proposed < source
          ? proposed < capacity
            ? proposed
            : capacity
          : source < capacity
            ? source
            : capacity;
    const signed = difference > 0 ? flux : -flux;
    parcels[i] = withHeat(profiles, left, lh - signed);
    parcels[j] = withHeat(profiles, right, rh + signed);
  }
  const change = (
    i: number,
    material: string,
    kind: ThermalTransition3D['kind'],
    enthalpy = heat(parcels[i]),
    chemicalQ = parcels[i].chemicalQ,
  ) => {
    const previous = parcels[i];
    parcels[i] = withHeat(profiles, { ...previous, material, chemicalQ }, enthalpy);
    transitions.push({ id: previous.id, from: previous.material, to: material, kind });
  };
  transitions.push(...settleOwnedPhases(profiles, parcels));
  const reacted = new Set<number>(),
    phaseState = parcels.slice();
  const burning = (i: number) => {
    const p = phaseState[i],
      profile = readMultiphysicsProfile3D(profiles, p.material);
    return (
      p.chemicalQ > 0 && sensible(profiles, profile, heat(p)) > BigInt(profile.flashPoint * E) * S
    );
  };
  for (const { a, b } of contacts) {
    const ai = index.get(a)!,
      bi = index.get(b)!;
    let fuel = -1,
      oxidizer = -1;
    if (burning(ai) && readMultiphysicsProfile3D(profiles, phaseState[bi].material).oxidizer) {
      fuel = ai;
      oxidizer = bi;
    } else if (
      burning(bi) &&
      readMultiphysicsProfile3D(profiles, phaseState[ai].material).oxidizer
    ) {
      fuel = bi;
      oxidizer = ai;
    }
    if (fuel < 0 || reacted.has(fuel) || reacted.has(oxidizer)) continue;
    const profile = readMultiphysicsProfile3D(profiles, phaseState[fuel].material);
    if (!profile.burnsInto || !profile.smokeProduct) throw Error('Fuel profile has no products.');
    const releasedQ = phaseState[fuel].chemicalQ,
      transferredQ = Math.floor(releasedQ / 2);
    change(
      fuel,
      profile.burnsInto,
      'combustion',
      heat(phaseState[fuel]) + BigInt(releasedQ - transferredQ) * S,
      0,
    );
    change(
      oxidizer,
      profile.smokeProduct,
      'combustion',
      heat(phaseState[oxidizer]) + BigInt(transferredQ) * S,
      0,
    );
    burns.push({
      fuel: phaseState[fuel].id,
      oxidizer: phaseState[oxidizer].id,
      releasedQ,
      transferredQ,
    });
    reacted.add(fuel);
    reacted.add(oxidizer);
  }
  for (let i = 0; i < phaseState.length; i++)
    if (phaseState[i].material === 'fire' && !reacted.has(i)) {
      const near = adjacent[i];
      if (
        !near.some((j) => phaseState[j].chemicalQ > 0) ||
        near.some((j) => phaseState[j].material === 'water') ||
        sensible(profiles, readMultiphysicsProfile3D(profiles, 'fire'), heat(phaseState[i])) <
          BigInt(80 * E) * S
      )
        change(i, 'smoke', 'extinction');
    }
  return {
    parcels: parcels.map((p) => readThermalParcel3D(profiles, p)),
    transitions,
    burns,
    energy: energyReport(before, total(parcels)),
  };
}
