/** Conservation references only: no phase, fracture, fluid or time-step solver. */
import { assertRecordFields, copyPortableValue, type PortableValue } from '../../portable-data.js';
import {
  addVec3,
  subtractVec3,
  scaleVec3,
  crossVec3,
  dotVec3,
  rotateVector,
  applyWorldInverseInertia,
  type Vec3,
  type Quat,
} from './math.js';

/** A material identity never determines the mass of an existing parcel. */
export type MaterialParcel3D = {
  id: string;
  material: string;
  owner: string;
  mass: number;
  referenceAmount: number;
  heatCapacity: number;
  thermalQ: number;
  latentQ: number;
  chemicalQ: number;
  center: Vec3;
  velocity: Vec3;
  orientation: Quat;
  /** World-space angular momentum about this parcel's own center. */
  intrinsicAngularMomentum: Vec3;
  /** Moments about the center in the orientation's local axes. */
  principalInertia: Vec3;
};
export type ParcelPartition3D = { id: string; weight: number };
export type AssemblyMotion3D = { center: Vec3; velocity: Vec3; angularVelocity: Vec3 };
export const MAX_REFERENCE_PARCELS_3D = 4096;
/** Relative per-vector consistency tolerance for releasing a rigid assembly. */
export const PARCEL_MOTION_TOLERANCE_3D = 1e-12;
const fields = [
  'id',
  'material',
  'owner',
  'mass',
  'referenceAmount',
  'heatCapacity',
  'thermalQ',
  'latentQ',
  'chemicalQ',
  'center',
  'velocity',
  'orientation',
  'intrinsicAngularMomentum',
  'principalInertia',
];
const energyFields = ['thermalQ', 'latentQ', 'chemicalQ'] as const;
const compareIds = (a: { id: string }, b: { id: string }) =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
function finite(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw Error(`Invalid finite ${name}.`);
  return value === 0 ? 0 : value;
}
function positive(value: unknown, name: string): number {
  const n = finite(value, name);
  if (n <= 0) throw Error(`Invalid positive ${name}.`);
  return n;
}
function identity(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128)
    throw Error('Invalid parcel identity.');
  return value;
}
function vector(raw: unknown, name: string): Vec3 {
  if (!Array.isArray(raw) || raw.length !== 3) throw Error(`Invalid ${name}.`);
  return [finite(raw[0], name), finite(raw[1], name), finite(raw[2], name)];
}
function data(raw: unknown): Record<string, unknown> {
  return copyPortableValue(raw as PortableValue) as Record<string, unknown>;
}
export function readMaterialParcel3D(raw: unknown): MaterialParcel3D {
  const p = data(raw);
  assertRecordFields(p, fields, [], 'Invalid material parcel fields.');
  const orientation = p.orientation;
  if (
    !Array.isArray(orientation) ||
    orientation.length !== 4 ||
    !orientation.every((v) => typeof v === 'number' && Number.isFinite(v)) ||
    Math.abs(Math.hypot(...orientation) - 1) > 1e-12
  )
    throw Error('Parcel orientation must be a unit quaternion.');
  const principalInertia = vector(p.principalInertia, 'principal inertia');
  if (principalInertia.some((v) => v <= 0 || !Number.isFinite(1 / v)))
    throw Error('Invalid positive principal inertia.');
  for (const key of energyFields) {
    if (!Number.isSafeInteger(p[key]) || (p[key] as number) < 0)
      throw Error('Parcel energy must be nonnegative safe integer Q.');
  }
  return {
    id: identity(p.id),
    material: identity(p.material),
    owner: identity(p.owner),
    mass: positive(p.mass, 'mass'),
    referenceAmount: positive(p.referenceAmount, 'reference amount'),
    heatCapacity: positive(p.heatCapacity, 'heat capacity'),
    thermalQ: p.thermalQ as number,
    latentQ: p.latentQ as number,
    chemicalQ: p.chemicalQ as number,
    center: vector(p.center, 'center'),
    velocity: vector(p.velocity, 'velocity'),
    orientation: [...orientation] as unknown as Quat,
    intrinsicAngularMomentum: vector(p.intrinsicAngularMomentum, 'intrinsic angular momentum'),
    principalInertia,
  };
}
/** Identity/ownership transfer alone changes no mass, energy, geometry or motion. */
export function transferMaterialParcel3D(
  raw: MaterialParcel3D,
  material: string,
  owner: string,
): MaterialParcel3D {
  return { ...readMaterialParcel3D(raw), material: identity(material), owner: identity(owner) };
}
function rows(raw: unknown, nonempty = false): unknown[] {
  if (
    !Array.isArray(raw) ||
    Object.getPrototypeOf(raw) !== Array.prototype ||
    raw.length > MAX_REFERENCE_PARCELS_3D ||
    (nonempty && !raw.length) ||
    Reflect.ownKeys(raw).length !== raw.length + 1
  )
    throw Error('Invalid bounded parcel list.');
  const result: unknown[] = [];
  for (let i = 0; i < raw.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, String(i));
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
      throw Error('Parcel lists require dense data.');
    result.push(descriptor.value);
  }
  return result;
}
function unique<T extends { id: string }>(values: T[]): T[] {
  values.sort(compareIds);
  if (values.some((v, i) => i > 0 && v.id === values[i - 1].id))
    throw Error('Duplicate parcel identity.');
  return values;
}
function parcels(raw: readonly MaterialParcel3D[], nonempty = false): MaterialParcel3D[] {
  return unique(rows(raw, nonempty).map(readMaterialParcel3D));
}
/** Neumaier summation; mechanical totals remain Float64, not exact integer ledgers. */
function sum(values: readonly number[]): number {
  let total = 0,
    correction = 0;
  for (const value of values) {
    const next = finite(total + finite(value, 'summand'), 'sum');
    correction += Math.abs(total) >= Math.abs(value) ? total - next + value : value - next + total;
    total = next;
  }
  return finite(total + correction, 'compensated sum');
}
function splitFloat(value: number, weights: readonly number[], total: number): number[] {
  const output = weights
    .slice(0, -1)
    .map((weight) => finite(value * (weight / total), 'partition'));
  output.push(finite(value - sum(output), 'partition residual'));
  return output;
}
/** Largest remainders, with stable ID ordering as the tie-breaker. No fractional Q is discarded. */
function splitQ(value: number, weights: readonly number[], total: bigint): number[] {
  const products = weights.map((weight) => BigInt(value) * BigInt(weight));
  const output = products.map((product) => Number(product / total));
  let remainder = BigInt(value) - output.reduce((s, n) => s + BigInt(n), 0n);
  const order = products
    .map((product, i) => ({ i, remainder: product % total }))
    .sort((a, b) => (a.remainder === b.remainder ? a.i - b.i : a.remainder > b.remainder ? -1 : 1));
  for (const { i } of order) {
    if (remainder === 0n) break;
    output[i]++;
    remainder--;
  }
  return output;
}
/**
 * Co-located accounting decomposition: children retain the same orientation and
 * scaled inertia distribution. This is not geometric subdivision or fracture.
 * Child IDs replace the parent ID; caller must replace, not append to, its owner.
 */
export function partitionMaterialParcel3D(
  raw: MaterialParcel3D,
  partition: readonly ParcelPartition3D[],
): MaterialParcel3D[] {
  const parent = readMaterialParcel3D(raw);
  const parts = unique(
    rows(partition, true).map((rawPart) => {
      const part = data(rawPart);
      assertRecordFields(part, ['id', 'weight'], [], 'Invalid parcel partition fields.');
      const weight = positive(part.weight, 'partition weight');
      if (!Number.isSafeInteger(weight)) throw Error('Partition weights must be safe integers.');
      const id = identity(part.id);
      if (id === parent.id) throw Error('Partition children require new identities.');
      return { id, weight };
    }),
  );
  const weights = parts.map((p) => p.weight),
    totalQ = weights.reduce((s, n) => s + BigInt(n), 0n);
  const total = Number(totalQ);
  if (!Number.isSafeInteger(total)) throw Error('Partition weight sum exceeds safe integer range.');
  const mass = splitFloat(parent.mass, weights, total),
    amount = splitFloat(parent.referenceAmount, weights, total);
  const capacity = splitFloat(parent.heatCapacity, weights, total);
  const inertia = parent.principalInertia.map((v) => splitFloat(v, weights, total));
  const spin = parent.intrinsicAngularMomentum.map((v) => splitFloat(v, weights, total));
  const energy = energyFields.map((key) => splitQ(parent[key], weights, totalQ));
  return parts.map(({ id }, i) =>
    readMaterialParcel3D({
      ...parent,
      id,
      mass: mass[i],
      referenceAmount: amount[i],
      heatCapacity: capacity[i],
      thermalQ: energy[0][i],
      latentQ: energy[1][i],
      chemicalQ: energy[2][i],
      principalInertia: inertia.map((axis) => axis[i]),
      intrinsicAngularMomentum: spin.map((axis) => axis[i]),
    }),
  );
}
export type ParcelConservation3D = {
  mass: number;
  referenceAmount: number;
  heatCapacity: number;
  linearMomentum: Vec3;
  angularMomentum: Vec3;
  translationalEnergy: number;
  rotationalEnergy: number;
  kineticEnergy: number;
  potentialEnergy: number;
  thermalQ: string;
  latentQ: string;
  chemicalQ: string;
  internalEnergyQ: string;
};
/** Mechanical model units and Q reservoirs are reported separately; no implicit conversion. */
export function parcelConservation3D(
  raw: readonly MaterialParcel3D[],
  options: { origin?: Vec3; gravity?: Vec3 } = {},
): ParcelConservation3D {
  const list = parcels(raw),
    settings = data(options);
  assertRecordFields(settings, [], ['origin', 'gravity'], 'Invalid conservation options.');
  const origin = vector(settings.origin ?? [0, 0, 0], 'origin'),
    gravity = vector(settings.gravity ?? [0, 0, 0], 'gravity');
  const momenta = list.map((p) => scaleVec3(p.velocity, p.mass));
  const angular = list.map((p, i) =>
    addVec3(crossVec3(subtractVec3(p.center, origin), momenta[i]), p.intrinsicAngularMomentum),
  );
  const translationalEnergy = sum(list.map((p) => 0.5 * p.mass * dotVec3(p.velocity, p.velocity)));
  const rotationalEnergy = sum(
    list.map((p) => {
      const omega = applyWorldInverseInertia(
        p.orientation,
        p.principalInertia.map((v) => 1 / v) as unknown as Vec3,
        p.intrinsicAngularMomentum,
      );
      const value = 0.5 * dotVec3(p.intrinsicAngularMomentum, omega);
      if (value < 0) throw Error('Negative rotational energy.');
      return value;
    }),
  );
  const totals = energyFields.map((key) => list.reduce((s, p) => s + BigInt(p[key]), 0n));
  return {
    mass: sum(list.map((p) => p.mass)),
    referenceAmount: sum(list.map((p) => p.referenceAmount)),
    heatCapacity: sum(list.map((p) => p.heatCapacity)),
    linearMomentum: [0, 1, 2].map((axis) => sum(momenta.map((v) => v[axis]))) as unknown as Vec3,
    angularMomentum: [0, 1, 2].map((axis) => sum(angular.map((v) => v[axis]))) as unknown as Vec3,
    translationalEnergy,
    rotationalEnergy,
    kineticEnergy: finite(translationalEnergy + rotationalEnergy, 'kinetic energy'),
    potentialEnergy: sum(
      list.map((p) => -p.mass * dotVec3(gravity, subtractVec3(p.center, origin))),
    ),
    thermalQ: String(totals[0]),
    latentQ: String(totals[1]),
    chemicalQ: String(totals[2]),
    internalEnergyQ: String(totals.reduce((a, b) => a + b, 0n)),
  };
}
/**
 * Release world-positioned parcels from one rigid assembly. Their stored intrinsic
 * spin must already include I_world * omega, and velocity must match the rigid
 * velocity field. Release preserves authoritative motion; it never initializes it.
 * This checks parcel consistency, not an absent aggregate body ledger.
 */
export function releaseAssemblyParcels3D(
  raw: readonly MaterialParcel3D[],
  motion: AssemblyMotion3D,
  owner: string,
): MaterialParcel3D[] {
  const list = parcels(raw, true),
    m = data(motion),
    nextOwner = identity(owner);
  assertRecordFields(
    m,
    ['center', 'velocity', 'angularVelocity'],
    [],
    'Invalid assembly motion fields.',
  );
  const center = vector(m.center, 'assembly center'),
    velocity = vector(m.velocity, 'assembly velocity'),
    omega = vector(m.angularVelocity, 'angular velocity');
  if (new Set(list.map((p) => p.owner)).size !== 1)
    throw Error('Release requires a single assembly owner.');
  return list.map((p) => {
    const q = p.orientation,
      localOmega = rotateVector([-q[0], -q[1], -q[2], q[3]], omega);
    const expected = rotateVector(
      q,
      localOmega.map((v, i) => v * p.principalInertia[i]) as unknown as Vec3,
    );
    const consistent = (actual: Vec3, expected: Vec3) => {
      const scale = Math.max(...expected.map(Math.abs), ...actual.map(Math.abs));
      return expected.every(
        (v, i) => Math.abs(v - actual[i]) <= PARCEL_MOTION_TOLERANCE_3D * scale,
      );
    };
    if (!consistent(p.intrinsicAngularMomentum, expected)) {
      throw Error('Parcel intrinsic spin is inconsistent with rigid assembly rotation.');
    }
    const expectedVelocity = addVec3(velocity, crossVec3(omega, subtractVec3(p.center, center)));
    if (!expectedVelocity.every(Number.isFinite) || !consistent(p.velocity, expectedVelocity)) {
      throw Error('Parcel velocity is inconsistent with rigid assembly motion.');
    }
    return { ...p, owner: nextOwner };
  });
}
