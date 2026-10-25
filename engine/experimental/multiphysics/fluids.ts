/** Bounded SPH references at frozen geometry; not a complete fluid/world integrator.
 * Density/divergence use mass-metric constraint projection, not the original
 * DFSPH coefficient iteration. Viscosity is pair relaxation, not an SI fit.
 */
import { assertRecordFields, copyPortableValue, type PortableValue } from '../../portable-data.js';
import { readMaterialParcel3D, type MaterialParcel3D } from './conservation.js';
import {
  type Vec3,
  addVec3,
  subtractVec3,
  scaleVec3,
  dotVec3,
  crossVec3,
  lengthVec3,
  assertFiniteVec3,
  applyWorldInverseInertia,
} from './math.js';

export type FluidMatrix3D = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];
export type GasThermalCurve3D = {
  /** Mechanical energy units. Sensible U = H-offset outside the plateau. */
  enthalpy: number;
  lowOffset: number;
  highOffset: number;
  plateauEnergy: number;
};
export type FluidParticle3D = {
  /** Sensible energy in mechanical units, supplied by the profile-aware thermal adapter. */
  parcel: MaterialParcel3D;
  thermalEnergy: number;
  phase: 'liquid' | 'gas';
  restDensity: number;
  /** Authoritative gas volume; liquid volume is constrained by rest density. */
  volume: number | null;
  /** Gas caloric curve; null for liquids, whose heat is applied by the world. */
  thermalCurve: GasThermalCurve3D | null;
  /** Nonnegative pair relaxation rate in inverse model-time, not dynamic viscosity. */
  viscosity: number;
};
export type FluidBoundaryBody3D = {
  id: string;
  center: Vec3;
  velocity: Vec3;
  angularVelocity: Vec3;
  inverseMass: number;
  inverseInertia: FluidMatrix3D;
};
export type FluidBoundarySample3D = { id: string; bodyId: string; position: Vec3; volume: number };
export type FluidBoundaryContact3D = {
  id: string;
  particleId: string;
  boundaryId: string;
  point: Vec3;
  /** Unit normal from solid to fluid. */
  normal: Vec3;
  /** Closing motion present before the gravity predictor is physical impact. */
  impact: boolean;
};
export type FluidReferenceInput3D = {
  particles: FluidParticle3D[];
  bodies: FluidBoundaryBody3D[];
  boundaries: FluidBoundarySample3D[];
  contacts?: FluidBoundaryContact3D[];
  /** Velocity-only correction after mechanical drift; no repeated pressure work or viscosity. */
  projectionOnly?: boolean;
  /** Applied after physical pressure/viscosity/contact, solely for the constraint predictor. */
  velocityPrediction?: Vec3;
  dt: number;
  /** Liquid kernel radius; dimensionless gas support factor h / cbrt(volume). */
  smoothingRadius: number;
};
export const FLUID_REFERENCE_LIMITS_3D = Object.freeze({
  particles: 128,
  bodies: 128,
  boundaries: 128,
  contacts: 256,
  advanceWork: 256,
  iterations: 512,
  densityTolerance: 1e-4,
  divergenceTolerance: 1e-7,
  // With unit spacing and h=1.5, bulk support is ~0.95, a flat free
  // surface ~0.87, and a lone sample ~0.46. Retain surface support while
  // excluding deficient spray from the extra zero-divergence constraint.
  // Every sample still receives the predicted-density guard.
  divergenceSupportRatio: 0.8,
  // Density alone also rises when two sparse droplets approach. Require a
  // resolved liquid/solid neighborhood: ten unit volumes at h=1.5, versus
  // 18 neighbors in a unit bulk lattice and 13 at a flat free surface.
  // Normalize by h^3 so scaling positions and reference volumes is consistent.
  divergenceSupportVolume: 10 / 1.5 ** 3,
  gamma: 1.4,
  energyQPerMechanicalUnit: 256,
  gasIterations: 96,
  gasPairVolumeFraction: 0.1,
  gasStepVolumeFraction: 0.25,
  gasMinimumVolume: 1e-9,
  gasMaximumVolume: 4096,
  gasMaximumSupportRadius: 64,
});
export type FluidReferenceResult3D = {
  /** Gas thermalEnergy/curve predict final heat; parcel Q stores remain unchanged.
   * The world owns position advance and applies the returned enthalpy work. */
  particles: FluidParticle3D[];
  bodies: FluidBoundaryBody3D[];
  densities: { id: string; density: number; pressure: number }[];
  gasVolumes: {
    id: string;
    volume: number;
    supportRadius: number;
    pressureWorkResidual: number;
    entropyResidual: number;
  }[];
  /** Signed mechanical energy: pressure may cool gas; viscosity only heats. */
  thermalWork: { id: string; pressure: number; viscous: number; contact: number }[];
  /** One aggregate per fixed sample. angularImpulse is a free couple in addition
   * to (sample.position - body.center) cross impulse. Root owns sampled solid heat. */
  boundaryTransfers: {
    id: string;
    bodyId: string;
    position: Vec3;
    impulse: Vec3;
    angularImpulse: Vec3;
    viscousHeat: number;
    contactHeat: number;
  }[];
  energy: {
    gasMechanicalWork: number;
    viscousHeat: number;
    contactHeat: number;
    projectionKineticChange: number;
    predictionKineticChange: number;
    impulseWorkResidual: number;
  };
  convergence: {
    densityIterations: number;
    divergenceIterations: number;
    densityError: number;
    divergenceError: number;
    gasVolumeResidual: number;
    contactError: number;
    divergenceRows: number;
    freeSurfaceRows: number;
    freeSurfaceCompressionRate: number;
  };
};
export type FluidReferenceProgress3D = {
  status: 'running' | 'complete' | 'cancelled';
  stage: string;
  completedWork: number;
  maxTotalWork: number;
};
export interface FluidReferenceJob3D {
  progress(): FluidReferenceProgress3D;
  advance(maxWork?: number): FluidReferenceProgress3D;
  cancel(): boolean;
  result(): FluidReferenceResult3D;
}
/** Private study capture. Copies cannot alter the reference solve. Capturing
 * retains dense operator data, so use a separate run for reference timing. */
export type FluidProjectionFaceCapture3D = {
  gradients: number[][];
  responses: number[][];
  indices: number[];
  rhs: number[];
  candidate: number[];
  kind: 'density' | 'divergence';
  iteration: number;
};
const ZERO: Vec3 = [0, 0, 0];
const axes: readonly Vec3[] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
const compareId = (a: { id: string }, b: { id: string }) =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const matrix = (m: FluidMatrix3D, v: Vec3): Vec3 => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];
function scalar(v: unknown, min: number, max: number, name: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max)
    throw Error(`Invalid fluid ${name}.`);
  return v;
}
function finite(v: number): number {
  return scalar(v, -Number.MAX_VALUE, Number.MAX_VALUE, 'finite result');
}
function identity(v: unknown): string {
  if (typeof v !== 'string' || !v.length || v.length > 128) throw Error('Invalid fluid identity.');
  return v;
}
function vector(v: unknown): Vec3 {
  if (!Array.isArray(v) || v.length !== 3) throw Error('Invalid fluid vector.');
  const out = v.map((n) =>
    scalar(n, -Number.MAX_VALUE, Number.MAX_VALUE, 'vector'),
  ) as unknown as Vec3;
  assertFiniteVec3(out);
  return out;
}
function rows<T>(
  raw: unknown,
  limit: number,
  read: (value: unknown) => T,
  id: (value: T) => string,
): T[] {
  if (!Array.isArray(raw) || raw.length > limit)
    throw Error('Fluid reference size exceeds its bound.');
  const values = raw.map(read).sort((a, b) => compareId({ id: id(a) }, { id: id(b) }));
  if (values.some((v, i) => i > 0 && id(v) === id(values[i - 1])))
    throw Error('Duplicate fluid identity.');
  return values;
}
function fields(raw: unknown, keys: string[]): asserts raw is Record<string, unknown> {
  assertRecordFields(raw, keys, [], 'Invalid fluid reference fields.');
}
function inverse(m: FluidMatrix3D): FluidMatrix3D {
  const [a, b, c, , d, e, , , f] = m,
    det = a * (d * f - e * e) - b * (b * f - c * e) + c * (b * e - c * d);
  if (!(a > 0 && a * d - b * b > 0 && det > 0) || !Number.isFinite(det))
    throw Error('Fluid dynamic inverse inertia must be positive definite.');
  const out: FluidMatrix3D = [
    (d * f - e * e) / det,
    (c * e - b * f) / det,
    (b * e - c * d) / det,
    (c * e - b * f) / det,
    (a * f - c * c) / det,
    (b * c - a * e) / det,
    (b * e - c * d) / det,
    (b * c - a * e) / det,
    (a * d - b * b) / det,
  ];
  if (!out.every(Number.isFinite)) throw Error('Fluid inertia inversion overflow.');
  return out;
}
function readInput(raw: FluidReferenceInput3D): FluidReferenceInput3D {
  const data = copyPortableValue(raw as unknown as PortableValue);
  assertRecordFields(
    data,
    ['particles', 'bodies', 'boundaries', 'dt', 'smoothingRadius'],
    ['contacts', 'projectionOnly', 'velocityPrediction'],
    'Invalid fluid reference fields.',
  );
  const particles = rows(
    data.particles,
    FLUID_REFERENCE_LIMITS_3D.particles,
    (rawParticle) => {
      fields(rawParticle, [
        'parcel',
        'thermalEnergy',
        'phase',
        'restDensity',
        'viscosity',
        'volume',
        'thermalCurve',
      ]);
      if (!['liquid', 'gas'].includes(rawParticle.phase as string))
        throw Error('Invalid fluid phase.');
      const thermalEnergy = scalar(rawParticle.thermalEnergy, 0, 1e12, 'sensible thermal energy');
      const volume =
        rawParticle.phase === 'gas'
          ? scalar(
              rawParticle.volume,
              FLUID_REFERENCE_LIMITS_3D.gasMinimumVolume,
              FLUID_REFERENCE_LIMITS_3D.gasMaximumVolume,
              'gas volume',
            )
          : null;
      if (rawParticle.phase === 'liquid' && rawParticle.volume !== null)
        throw Error('Liquid fluid volume must be null.');
      let thermalCurve: GasThermalCurve3D | null = null;
      if (rawParticle.phase === 'gas') {
        fields(rawParticle.thermalCurve, ['enthalpy', 'lowOffset', 'highOffset', 'plateauEnergy']);
        const curve = rawParticle.thermalCurve;
        thermalCurve = {
          enthalpy: scalar(curve.enthalpy, 0, 1e12, 'gas enthalpy'),
          lowOffset: scalar(curve.lowOffset, 0, 1e12, 'gas low offset'),
          highOffset: scalar(curve.highOffset, 0, 1e12, 'gas high offset'),
          plateauEnergy: scalar(curve.plateauEnergy, 0, 1e12, 'gas plateau energy'),
        };
        if (
          thermalCurve.highOffset < thermalCurve.lowOffset ||
          (thermalCurve.plateauEnergy === 0 && thermalCurve.highOffset !== thermalCurve.lowOffset)
        )
          throw Error('Invalid gas caloric plateau.');
        const sensible = gasSensibleEnergy(thermalCurve, thermalCurve.enthalpy);
        if (Math.abs(sensible - thermalEnergy) > 1e-12 * Math.max(1, sensible, thermalEnergy))
          throw Error('Gas sensible energy disagrees with caloric curve.');
      } else if (rawParticle.thermalCurve !== null)
        throw Error('Liquid thermal curve must be null.');
      return {
        parcel: readMaterialParcel3D(rawParticle.parcel),
        thermalEnergy,
        volume,
        thermalCurve,
        phase: rawParticle.phase as 'liquid' | 'gas',
        restDensity: scalar(rawParticle.restDensity, 1e-6, 1e6, 'rest density'),
        viscosity: scalar(rawParticle.viscosity, 0, 1e4, 'viscosity'),
      };
    },
    (p) => p.parcel.id,
  );
  const bodies = rows(
    data.bodies,
    FLUID_REFERENCE_LIMITS_3D.bodies,
    (row) => {
      fields(row, ['id', 'center', 'velocity', 'angularVelocity', 'inverseMass', 'inverseInertia']);
      if (!Array.isArray(row.inverseInertia) || row.inverseInertia.length !== 9)
        throw Error('Invalid fluid inverse tensor.');
      const values = row.inverseInertia.map((n) =>
        scalar(n, -Number.MAX_VALUE, Number.MAX_VALUE, 'inverse inertia'),
      );
      const scale = Math.max(...values.map(Math.abs));
      for (const [a, b] of [
        [1, 3],
        [2, 6],
        [5, 7],
      ]) {
        if (Math.abs(values[a] - values[b]) > 1e-12 * scale)
          throw Error('Fluid inverse inertia must be symmetric.');
        values[a] = values[b] = values[a] / 2 + values[b] / 2;
      }
      const tensor = values as unknown as FluidMatrix3D;
      const body = {
        id: identity(row.id),
        center: vector(row.center),
        velocity: vector(row.velocity),
        angularVelocity: vector(row.angularVelocity),
        inverseMass: scalar(row.inverseMass, 0, 1e12, 'inverse mass'),
        inverseInertia: tensor,
      };
      if (body.inverseMass === 0) {
        if ([...tensor, ...body.velocity, ...body.angularVelocity].some((v) => v !== 0))
          throw Error('Static fluid boundaries require zero inverse inertia and motion.');
      } else {
        if (!Number.isFinite(1 / body.inverseMass))
          throw Error('Unrepresentable fluid boundary mass.');
        inverse(tensor);
      }
      return body;
    },
    (b) => b.id,
  );
  const boundaries = rows(
    data.boundaries,
    FLUID_REFERENCE_LIMITS_3D.boundaries,
    (row) => {
      fields(row, ['id', 'bodyId', 'position', 'volume']);
      const value = {
        id: identity(row.id),
        bodyId: identity(row.bodyId),
        position: vector(row.position),
        volume: scalar(row.volume, 1e-9, 1e6, 'boundary volume'),
      };
      if (!bodies.some((b) => b.id === value.bodyId)) throw Error('Fluid boundary has no body.');
      return value;
    },
    (b) => b.id,
  );
  const contacts = rows(
    data.contacts ?? [],
    FLUID_REFERENCE_LIMITS_3D.contacts,
    (row) => {
      fields(row, ['id', 'particleId', 'boundaryId', 'point', 'normal', 'impact']);
      const value = {
        id: identity(row.id),
        particleId: identity(row.particleId),
        boundaryId: identity(row.boundaryId),
        point: vector(row.point),
        normal: vector(row.normal),
        impact: row.impact as boolean,
      };
      if (
        !particles.some((p) => p.parcel.id === value.particleId) ||
        !boundaries.some((b) => b.id === value.boundaryId) ||
        typeof value.impact !== 'boolean' ||
        Math.abs(lengthVec3(value.normal) - 1) > 1e-10
      )
        throw Error('Invalid fluid boundary contact.');
      return value;
    },
    (c) => c.id,
  );
  if (data.projectionOnly !== undefined && typeof data.projectionOnly !== 'boolean')
    throw Error('Invalid fluid projection mode.');
  const velocityPrediction =
    data.velocityPrediction === undefined ? ZERO : (data.velocityPrediction as unknown as Vec3);
  assertFiniteVec3(velocityPrediction, 'fluid velocity prediction');
  const smoothingRadius = scalar(data.smoothingRadius, 1e-3, 16, 'kernel radius');
  for (const particle of particles)
    if (particle.volume !== null) gasSupportRadius(particle.volume, smoothingRadius);
  return {
    particles,
    bodies,
    boundaries,
    contacts,
    projectionOnly: data.projectionOnly === true,
    velocityPrediction,
    dt: scalar(data.dt, 1e-9, 1, 'time step'),
    smoothingRadius,
  };
}
/** Poly6 density kernel and its exact position derivative, with compact radius h. */
export function fluidDensityKernel3D(offset: Vec3, h: number): { value: number; gradient: Vec3 } {
  assertFiniteVec3(offset);
  scalar(h, 1e-3, FLUID_REFERENCE_LIMITS_3D.gasMaximumSupportRadius, 'kernel radius');
  const r = lengthVec3(offset);
  finite(r);
  if (r >= h) return { value: 0, gradient: ZERO };
  const c = 315 / (64 * Math.PI * h ** 9),
    q = h * h - r * r;
  return { value: c * q ** 3, gradient: scaleVec3(offset, -6 * c * q * q) };
}
function gasSupportRadius(volume: number, factor: number): number {
  return scalar(
    factor * Math.cbrt(volume),
    1e-3,
    FLUID_REFERENCE_LIMITS_3D.gasMaximumSupportRadius,
    'gas support radius',
  );
}
function gasSensibleEnergy(curve: GasThermalCurve3D, enthalpy: number): number {
  const { lowOffset: low, highOffset: high, plateauEnergy: plateau } = curve;
  if (enthalpy < low + plateau) return Math.max(0, enthalpy - low);
  if (enthalpy <= high + plateau) return plateau;
  return enthalpy - high;
}
/** Exact integration of dH/d(log V)=-(gamma-1) U(H) across at most three segments. */
function gasEnthalpyChange(curve: GasThermalCurve3D, enthalpy: number, logVolume: number): number {
  const { lowOffset: low, highOffset: high, plateauEnergy: plateau } = curve;
  let remaining = (FLUID_REFERENCE_LIMITS_3D.gamma - 1) * Math.abs(logVolume),
    value = enthalpy,
    change = 0;
  if (logVolume >= 0) {
    if (value > high + plateau) {
      const energy = value - high,
        span = plateau === 0 ? Infinity : Math.log(energy / plateau);
      if (remaining <= span) return energy * Math.expm1(-remaining);
      change += high + plateau - value;
      value = high + plateau;
      remaining -= span;
    }
    if (value > low + plateau && plateau > 0) {
      const span = (value - low - plateau) / plateau;
      if (remaining <= span) return change - plateau * remaining;
      change += low + plateau - value;
      value = low + plateau;
      remaining -= span;
    }
    return change + Math.max(0, value - low) * Math.expm1(-remaining);
  }
  if (value < low + plateau) {
    const energy = Math.max(0, value - low);
    if (energy === 0) return 0;
    const span = Math.log(plateau / energy);
    if (remaining <= span) return energy * Math.expm1(remaining);
    change += low + plateau - value;
    value = low + plateau;
    remaining -= span;
  }
  if (value < high + plateau && plateau > 0) {
    const span = (high + plateau - value) / plateau;
    if (remaining <= span) return change + plateau * remaining;
    change += high + plateau - value;
    value = high + plateau;
    remaining -= span;
  }
  return change + Math.max(0, value - high) * Math.expm1(remaining);
}
/** Integral dH/U over the actual stored endpoints; latent intervals contribute
 * delta H / plateau U. This reduces to log(U_after/U_before) for a pure gas. */
function gasEntropyDifference(curve: GasThermalCurve3D, before: number, after: number): number {
  if (before === after) return 0;
  const lower = Math.min(before, after),
    upper = Math.max(before, after);
  const { lowOffset: low, highOffset: high, plateauEnergy: plateau } = curve;
  let integral = 0;
  const lowEnd = Math.min(upper, low + plateau);
  if (lowEnd > lower) integral += Math.log1p((lowEnd - lower) / (lower - low));
  const plateauStart = Math.max(lower, low + plateau),
    plateauEnd = Math.min(upper, high + plateau);
  if (plateauEnd > plateauStart) integral += (plateauEnd - plateauStart) / plateau;
  const highStart = Math.max(lower, high + plateau);
  if (upper > highStart) integral += Math.log1p((upper - highStart) / (highStart - high));
  return before < after ? integral : -integral;
}
type Endpoint = { particle: number } | { boundary: number };
type Pair = { i: number; j: number; gradient: Vec3 };
type WallPair = { i: number; s: number; gradient: Vec3 };
type Constraint = {
  i: number;
  terms: { i: number; gradient: Vec3 }[];
  walls: { s: number; gradient: Vec3; point?: Vec3 }[];
};

function* solve(
  input: FluidReferenceInput3D,
  capture?: (face: FluidProjectionFaceCapture3D) => void,
): Generator<string, FluidReferenceResult3D> {
  const { particles: p, bodies, boundaries, dt, smoothingRadius: h } = input;
  const n = p.length,
    bodyIndex = new Map(bodies.map((b, i) => [b.id, i]));
  const atBody = boundaries.map((s) => bodyIndex.get(s.bodyId)!);
  const inertias = bodies.map((b) => (b.inverseMass ? inverse(b.inverseInertia) : null));
  const density = p.map((v) => finite(v.parcel.mass * fluidDensityKernel3D(ZERO, h).value));
  const rows: Constraint[] = [];
  const supportVolume = p.map(() => 0);
  const adjacentPairs = p.map(() => [] as Pair[]),
    adjacentWalls = p.map(() => [] as WallPair[]);
  const available = p.map((v) => v.thermalEnergy),
    initialVolumes = p.map((v) => v.volume);
  const enthalpies = p.map((v) => v.thermalCurve?.enthalpy ?? v.thermalEnergy);
  const pressureResidual = p.map(() => 0),
    entropyResidual = p.map(() => 0);
  let gasVolumeResidual = 0;
  const pressureWork = p.map(() => 0),
    viscousWork = p.map(() => 0),
    wallHeat = boundaries.map(() => 0);
  const particleContactHeat = p.map(() => 0),
    wallContactHeat = boundaries.map(() => 0);
  let contactHeat = 0;
  const wallImpulse = boundaries.map((): Vec3 => [0, 0, 0]),
    wallCouple = boundaries.map((): Vec3 => [0, 0, 0]);
  let gasMechanicalWork = 0,
    viscousHeat = 0,
    projectionKineticChange = 0;
  function angularVelocity(i: number): Vec3 {
    const parcel = p[i].parcel;
    return applyWorldInverseInertia(
      parcel.orientation,
      parcel.principalInertia.map((v) => 1 / v) as unknown as Vec3,
      parcel.intrinsicAngularMomentum,
    );
  }
  const particleInverse = (i: number, v: Vec3) =>
    applyWorldInverseInertia(
      p[i].parcel.orientation,
      p[i].parcel.principalInertia.map((x) => 1 / x) as unknown as Vec3,
      v,
    );
  function kinetic(): number {
    let total = 0;
    for (let i = 0; i < n; i++)
      total +=
        0.5 * p[i].parcel.mass * dotVec3(p[i].parcel.velocity, p[i].parcel.velocity) +
        0.5 * dotVec3(p[i].parcel.intrinsicAngularMomentum, angularVelocity(i));
    for (let i = 0; i < bodies.length; i++)
      if (bodies[i].inverseMass)
        total +=
          (0.5 * dotVec3(bodies[i].velocity, bodies[i].velocity)) / bodies[i].inverseMass +
          0.5 * dotVec3(bodies[i].angularVelocity, matrix(inertias[i]!, bodies[i].angularVelocity));
    return finite(total);
  }
  const initialKinetic = kinetic();
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const kernel = fluidDensityKernel3D(subtractVec3(p[i].parcel.center, p[j].parcel.center), h);
      if (kernel.value) {
        density[i] += p[j].parcel.mass * kernel.value;
        density[j] += p[i].parcel.mass * kernel.value;
        if (p[j].phase === 'liquid') supportVolume[i] += p[j].parcel.mass / p[j].restDensity;
        if (p[i].phase === 'liquid') supportVolume[j] += p[i].parcel.mass / p[i].restDensity;
        const pair = { i, j, gradient: kernel.gradient };
        adjacentPairs[i].push(pair);
        adjacentPairs[j].push(pair);
      }
      yield 'neighbors';
    }
    for (let s = 0; s < boundaries.length; s++) {
      const kernel = fluidDensityKernel3D(
        subtractVec3(p[i].parcel.center, boundaries[s].position),
        h,
      );
      if (kernel.value) {
        density[i] += p[i].restDensity * boundaries[s].volume * kernel.value;
        supportVolume[i] += boundaries[s].volume;
        const pair = { i, s, gradient: kernel.gradient };
        adjacentWalls[i].push(pair);
      }
      yield 'boundary-neighbors';
    }
    if (!(density[i] > 0) || !Number.isFinite(density[i])) throw Error('Invalid SPH density.');
  }
  function bodyVelocity(s: number): Vec3 {
    const body = bodies[atBody[s]];
    return addVec3(
      body.velocity,
      crossVec3(body.angularVelocity, subtractVec3(boundaries[s].position, body.center)),
    );
  }
  function center(endpoint: Endpoint): Vec3 {
    return 'particle' in endpoint
      ? p[endpoint.particle].parcel.center
      : bodies[atBody[endpoint.boundary]].center;
  }
  function velocityAt(endpoint: Endpoint, point: Vec3): Vec3 {
    if ('particle' in endpoint)
      return addVec3(
        p[endpoint.particle].parcel.velocity,
        crossVec3(angularVelocity(endpoint.particle), subtractVec3(point, center(endpoint))),
      );
    const body = bodies[atBody[endpoint.boundary]];
    return addVec3(
      body.velocity,
      crossVec3(body.angularVelocity, subtractVec3(point, body.center)),
    );
  }
  function inverseAngular(endpoint: Endpoint, torque: Vec3): Vec3 {
    return 'particle' in endpoint
      ? particleInverse(endpoint.particle, torque)
      : matrix(bodies[atBody[endpoint.boundary]].inverseInertia, torque);
  }
  function response(endpoint: Endpoint, point: Vec3, impulse: Vec3): Vec3 {
    const r = subtractVec3(point, center(endpoint));
    const invMass =
      'particle' in endpoint
        ? 1 / p[endpoint.particle].parcel.mass
        : bodies[atBody[endpoint.boundary]].inverseMass;
    return addVec3(
      scaleVec3(impulse, invMass),
      crossVec3(inverseAngular(endpoint, crossVec3(r, impulse)), r),
    );
  }
  function impulse(endpoint: Endpoint, point: Vec3, value: Vec3): void {
    if ('particle' in endpoint) {
      const parcel = p[endpoint.particle].parcel;
      parcel.velocity = addVec3(parcel.velocity, scaleVec3(value, 1 / parcel.mass));
      parcel.intrinsicAngularMomentum = addVec3(
        parcel.intrinsicAngularMomentum,
        crossVec3(subtractVec3(point, parcel.center), value),
      );
    } else {
      const s = endpoint.boundary,
        body = bodies[atBody[s]];
      body.velocity = addVec3(body.velocity, scaleVec3(value, body.inverseMass));
      body.angularVelocity = addVec3(
        body.angularVelocity,
        matrix(body.inverseInertia, crossVec3(subtractVec3(point, body.center), value)),
      );
      wallImpulse[s] = addVec3(wallImpulse[s], value);
      wallCouple[s] = addVec3(
        wallCouple[s],
        crossVec3(subtractVec3(point, boundaries[s].position), value),
      );
    }
  }
  function pairWork(a: Endpoint, pa: Vec3, b: Endpoint, pb: Vec3, value: Vec3): number {
    return finite(
      dotVec3(value, subtractVec3(velocityAt(a, pa), velocityAt(b, pb))) +
        0.5 * dotVec3(value, addVec3(response(a, pa, value), response(b, pb, value))),
    );
  }
  /** Compatible discrete pressure/continuity update at frozen geometry.
   * SPH continuity gives dV_i = a_i * v_relative * dt. Ideal-gas adiabatic
   * U V^(gamma-1) = constant (or its exact latent-plateau continuation)
   * supplies a discrete pressure -delta H / delta V. The scalar implicit impulse
   * uses midpoint velocity, so finite impulse work equals -sum(delta H). Variable support follows saved volume, not a kernel
   * density solve: this is a split discrete-gradient reference, not grad-h SPH.
   * Continuum relations: users.monash.edu.au/~dprice/pubs/thesis/price_PhD_c3.pdf
   */
  function pressurePair(i: number, other: Endpoint, point: Vec3): void {
    const a: Endpoint = { particle: i },
      offset = subtractVec3(p[i].parcel.center, point),
      distance = lengthVec3(offset);
    if (!distance) return; // Coincident centers have no resolved radial volume mode.
    const direction = scaleVec3(offset, 1 / distance);
    const contributions: {
      index: number;
      coefficient: number;
      volume: number;
      energy: number;
      enthalpy: number;
      curve: GasThermalCurve3D;
    }[] = [];
    const otherMass = 'particle' in other ? p[other.particle].parcel.mass : null;
    function contribution(index: number, neighborMass: number | null): void {
      const volume = p[index].volume;
      if (volume === null) return;
      const radius = gasSupportRadius(volume, h),
        gradient = fluidDensityKernel3D(offset, radius).gradient;
      const radial = -dotVec3(gradient, direction);
      // Boundary virtual mass is rho_i * sample volume; it is not material rest mass.
      const mass =
        neighborMass ??
        (p[index].parcel.mass / volume) *
          boundaries[(other as { boundary: number }).boundary].volume;
      // A reflected wall neighbor has v_ghost = 2*v_wall - v_fluid.
      // Its continuity rate is twice the fluid/wall relative velocity.
      // Use that same derivative for pressure impulse and enthalpy work.
      const reflection = neighborMass === null ? 2 : 1;
      const coefficient = finite(
        ((reflection * dt * mass * volume * volume) / p[index].parcel.mass) * radial,
      );
      if (coefficient > 0)
        contributions.push({
          index,
          coefficient,
          volume,
          energy: available[index],
          enthalpy: enthalpies[index],
          curve: p[index].thermalCurve!,
        });
    }
    contribution(i, otherMass);
    if ('particle' in other) contribution(other.particle, p[i].parcel.mass);
    if (!contributions.length || input.projectionOnly) return;
    const initialSpeed = dotVec3(
      subtractVec3(velocityAt(a, p[i].parcel.center), velocityAt(other, point)),
      direction,
    );
    const effective = dotVec3(
      direction,
      addVec3(response(a, p[i].parcel.center, direction), response(other, point, direction)),
    );
    if (!(effective > 0) || !Number.isFinite(effective)) throw Error('Invalid gas effective mass.');
    const fraction = FLUID_REFERENCE_LIMITS_3D.gasPairVolumeFraction;
    // This admissible bracket also imposes a local volume CFL bound. No clamping
    // or thermal overspend is used when a timestep needs refinement.
    let lower = 0,
      upper = Number.MAX_VALUE;
    for (const c of contributions) {
      lower = Math.max(
        lower,
        (2 * ((-fraction * c.volume) / c.coefficient - initialSpeed)) / effective,
      );
      upper = Math.min(
        upper,
        (2 * ((fraction * c.volume) / c.coefficient - initialSpeed)) / effective,
      );
    }
    if (!(upper >= lower) || !Number.isFinite(lower) || !Number.isFinite(upper))
      throw Error('Gas volume step exceeds its refinement bound.');
    const exponent = FLUID_REFERENCE_LIMITS_3D.gamma - 1;
    function evaluate(value: number) {
      const midpointSpeed = initialSpeed + 0.5 * effective * value;
      const changes = contributions.map((c) => {
        const deltaVolume = c.coefficient * midpointSpeed,
          relative = deltaVolume / c.volume;
        if (!(relative > -1) || !Number.isFinite(relative))
          throw Error('Gas volume became nonpositive.');
        const deltaEnergy = gasEnthalpyChange(c.curve, c.enthalpy, Math.log1p(relative));
        const pressure =
          relative === 0 ? (exponent * c.energy) / c.volume : -deltaEnergy / deltaVolume;
        return { deltaVolume, deltaEnergy, pressure };
      });
      const pressureImpulse = contributions.reduce(
        (sum, c, index) => sum + c.coefficient * changes[index].pressure,
        0,
      );
      return {
        difference: finite(value - pressureImpulse),
        pressureImpulse,
        midpointSpeed,
        changes,
      };
    }
    let low = evaluate(lower);
    // The admissible volume bracket can span many orders of magnitude near
    // compact support, where the pressure impulse vanishes. Discrete pressure
    // decreases with expansion, so twice its lower-end impulse bounds the root
    // without spending the fixed iteration budget bisecting an enormous CFL box.
    upper = Math.min(upper, lower + 2 * Math.max(0, low.pressureImpulse - lower));
    let high = evaluate(upper);
    if (low.difference > 0 || high.difference < 0)
      throw Error('Gas volume step exceeds its refinement bound.');
    let value = lower,
      state = low,
      converged = false;
    for (let iteration = 0; iteration < FLUID_REFERENCE_LIMITS_3D.gasIterations; iteration++) {
      value = low.difference === 0 ? lower : high.difference === 0 ? upper : lower / 2 + upper / 2;
      state = evaluate(value);
      if (Math.abs(state.difference) <= 1e-13 * Math.max(1e-12, value, state.pressureImpulse)) {
        converged = true;
        break;
      }
      if (state.difference < 0) {
        lower = value;
        low = state;
      } else {
        upper = value;
        high = state;
      }
    }
    if (!converged) throw Error('Gas pressure solve did not converge within its work limit.');
    const impulseValue = scaleVec3(direction, value),
      work = pairWork(a, p[i].parcel.center, other, point, impulseValue);
    const thermal = state.changes.reduce((sum, c) => sum + c.deltaEnergy, 0);
    if (Math.abs(work + thermal) > 1e-11 * Math.max(1, Math.abs(work), Math.abs(thermal)))
      throw Error('Gas pressure-work residual exceeds tolerance.');
    for (let c = 0; c < contributions.length; c++) {
      const before = contributions[c],
        change = state.changes[c],
        index = before.index;
      const volume = before.volume + change.deltaVolume,
        enthalpy = before.enthalpy + change.deltaEnergy;
      const energy = gasSensibleEnergy(before.curve, enthalpy);
      scalar(
        volume,
        FLUID_REFERENCE_LIMITS_3D.gasMinimumVolume,
        FLUID_REFERENCE_LIMITS_3D.gasMaximumVolume,
        'updated gas volume',
      );
      gasSupportRadius(volume, h);
      if (
        Math.abs(volume / initialVolumes[index]! - 1) >
        FLUID_REFERENCE_LIMITS_3D.gasStepVolumeFraction
      )
        throw Error('Gas cumulative volume step exceeds its refinement bound.');
      if (!(energy >= 0 && enthalpy >= 0) || !Number.isFinite(energy) || !Number.isFinite(enthalpy))
        throw Error('Invalid gas thermal result.');
      gasVolumeResidual = Math.max(
        gasVolumeResidual,
        Math.abs(volume - before.volume - before.coefficient * state.midpointSpeed) / before.volume,
      );
      pressureResidual[index] += Math.abs(
        change.deltaEnergy + before.coefficient * change.pressure * state.midpointSpeed,
      );
      const entropy =
        before.energy === 0
          ? 0
          : gasEntropyDifference(before.curve, before.enthalpy, enthalpy) +
            exponent * Math.log(volume / before.volume);
      entropyResidual[index] = Math.max(entropyResidual[index], Math.abs(entropy));
      p[index].volume = volume;
      available[index] = energy;
      enthalpies[index] = enthalpy;
      pressureWork[index] += change.deltaEnergy;
    }
    impulse(a, p[i].parcel.center, impulseValue);
    impulse(other, point, scaleVec3(impulseValue, -1));
    gasMechanicalWork += work;
  }
  // Pressure considers every bounded candidate pair: saved-volume support can
  // exceed the fixed liquid radius and can grow during this canonical sweep.
  if (!input.projectionOnly && p.some((p) => p.phase === 'gas')) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        pressurePair(i, { particle: j }, p[j].parcel.center);
        yield 'gas-pressure';
      }
      for (let s = 0; s < boundaries.length; s++) {
        pressurePair(i, { boundary: s }, boundaries[s].position);
        yield 'gas-boundary-pressure';
      }
    }
  }
  function particleHeat(index: number, amount: number): void {
    enthalpies[index] += amount;
    available[index] =
      p[index].thermalCurve === null
        ? available[index] + amount
        : gasSensibleEnergy(p[index].thermalCurve!, enthalpies[index]);
    viscousWork[index] += amount;
  }
  function heat(a: number, b: Endpoint, amount: number): void {
    if (amount < -1e-12 || !Number.isFinite(amount)) throw Error('Invalid viscous dissipation.');
    amount = Math.max(0, amount);
    const share = amount / 2;
    particleHeat(a, share);
    if ('particle' in b) particleHeat(b.particle, amount - share);
    else wallHeat[b.boundary] += amount - share;
    viscousHeat += amount;
  }
  function viscousPair(
    i: number,
    other: Endpoint,
    otherPosition: Vec3,
    rate: number,
    weight: number,
  ): void {
    if (rate === 0 || input.projectionOnly) return;
    const a: Endpoint = { particle: i };
    const point =
      'boundary' in other
        ? otherPosition
        : scaleVec3(addVec3(p[i].parcel.center, otherPosition), 0.5);
    const blend = -Math.expm1(-rate * dt * weight);
    for (const axis of axes) {
      const relative = dotVec3(subtractVec3(velocityAt(a, point), velocityAt(other, point)), axis);
      const effective = dotVec3(
        axis,
        addVec3(response(a, point, axis), response(other, point, axis)),
      );
      if (!(effective > 0) || !Number.isFinite(effective))
        throw Error('Invalid viscous effective mass.');
      const value = scaleVec3(axis, (-blend * relative) / effective),
        work = pairWork(a, point, other, point, value);
      impulse(a, point, value);
      impulse(other, point, scaleVec3(value, -1));
      heat(i, other, -work);
    }
    // Equal/opposite pure torques exchange finite parcel spin without deleting it.
    for (const axis of axes) {
      const otherOmega =
        'particle' in other
          ? angularVelocity(other.particle)
          : bodies[atBody[other.boundary]].angularVelocity;
      const relative = dotVec3(subtractVec3(angularVelocity(i), otherOmega), axis);
      const effective = dotVec3(
        axis,
        addVec3(inverseAngular(a, axis), inverseAngular(other, axis)),
      );
      if (!(effective > 0) || !Number.isFinite(effective))
        throw Error('Invalid viscous angular effective mass.');
      const torque = scaleVec3(axis, (-blend * relative) / effective);
      const work =
        dotVec3(torque, scaleVec3(axis, relative)) +
        0.5 * dotVec3(torque, addVec3(inverseAngular(a, torque), inverseAngular(other, torque)));
      p[i].parcel.intrinsicAngularMomentum = addVec3(p[i].parcel.intrinsicAngularMomentum, torque);
      if ('particle' in other)
        p[other.particle].parcel.intrinsicAngularMomentum = subtractVec3(
          p[other.particle].parcel.intrinsicAngularMomentum,
          torque,
        );
      else {
        const body = bodies[atBody[other.boundary]];
        body.angularVelocity = subtractVec3(
          body.angularVelocity,
          matrix(body.inverseInertia, torque),
        );
        wallCouple[other.boundary] = subtractVec3(wallCouple[other.boundary], torque);
      }
      heat(i, other, -work);
    }
  }
  function viscousWeight(i: number, offset: Vec3): number {
    const radius = p[i].volume === null ? h : gasSupportRadius(p[i].volume!, h);
    return fluidDensityKernel3D(offset, radius).value / fluidDensityKernel3D(ZERO, radius).value;
  }
  if (!input.projectionOnly) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const offset = subtractVec3(p[i].parcel.center, p[j].parcel.center);
        const weight = (viscousWeight(i, offset) + viscousWeight(j, offset)) / 2;
        if (weight)
          viscousPair(
            i,
            { particle: j },
            p[j].parcel.center,
            (p[i].viscosity + p[j].viscosity) / 2,
            weight,
          );
        yield 'viscosity';
      }
      for (let s = 0; s < boundaries.length; s++) {
        const weight = viscousWeight(i, subtractVec3(p[i].parcel.center, boundaries[s].position));
        if (weight) viscousPair(i, { boundary: s }, boundaries[s].position, p[i].viscosity, weight);
        yield 'boundary-viscosity';
      }
    }
  }
  for (let i = 0; i < n; i++)
    if (p[i].phase === 'liquid') {
      const terms: Constraint['terms'] = [],
        wallTerms: Constraint['walls'] = [];
      let self: Vec3 = ZERO;
      for (const pair of adjacentPairs[i]) {
        const j = pair.i === i ? pair.j : pair.i,
          gradient = scaleVec3(pair.gradient, pair.i === i ? p[j].parcel.mass : -p[j].parcel.mass);
        self = addVec3(self, gradient);
        terms.push({ i: j, gradient: scaleVec3(gradient, -1) });
      }
      for (const wall of adjacentWalls[i]) {
        const gradient = scaleVec3(wall.gradient, p[i].restDensity * boundaries[wall.s].volume);
        self = addVec3(self, gradient);
        wallTerms.push({ s: wall.s, gradient: scaleVec3(gradient, -1) });
      }
      terms.push({ i, gradient: self });
      rows.push({ i, terms, walls: wallTerms });
      yield 'constraints';
    }
  function rate(row: Constraint): number {
    return finite(
      row.terms.reduce((s, t) => s + dotVec3(t.gradient, p[t.i].parcel.velocity), 0) +
        row.walls.reduce(
          (s, t) =>
            s +
            dotVec3(
              t.gradient,
              t.point ? velocityAt({ boundary: t.s }, t.point) : bodyVelocity(t.s),
            ),
          0,
        ),
    );
  }
  const effectiveMasses = new WeakMap<Constraint, number>();
  function effectiveMass(row: Constraint): number {
    let effective = effectiveMasses.get(row);
    if (effective === undefined) {
      effective = row.terms.reduce(
        (s, t) => s + dotVec3(t.gradient, t.gradient) / p[t.i].parcel.mass,
        0,
      );
      const bodyTerms = bodies.map(() => ({ linear: ZERO, angular: ZERO }));
      for (const t of row.walls) {
        const index = atBody[t.s],
          body = bodies[index];
        bodyTerms[index].linear = addVec3(bodyTerms[index].linear, t.gradient);
        bodyTerms[index].angular = addVec3(
          bodyTerms[index].angular,
          crossVec3(subtractVec3(t.point ?? boundaries[t.s].position, body.center), t.gradient),
        );
      }
      for (let b = 0; b < bodies.length; b++)
        effective +=
          bodies[b].inverseMass * dotVec3(bodyTerms[b].linear, bodyTerms[b].linear) +
          dotVec3(bodyTerms[b].angular, matrix(bodies[b].inverseInertia, bodyTerms[b].angular));
      if (!(effective > 0) || !Number.isFinite(effective))
        throw Error('Liquid density constraint has no movable support.');
      effectiveMasses.set(row, effective);
    }
    return effective;
  }
  function applyConstraint(row: Constraint, lambda: number): void {
    for (const t of row.terms)
      impulse({ particle: t.i }, p[t.i].parcel.center, scaleVec3(t.gradient, -lambda));
    for (const t of row.walls)
      impulse(
        { boundary: t.s },
        t.point ?? boundaries[t.s].position,
        scaleVec3(t.gradient, -lambda),
      );
  }
  function project(row: Constraint, target: number): number {
    const error = rate(row) - target;
    if (error <= 0) return 0;
    const effective = effectiveMass(row),
      lambda = error / effective;
    applyConstraint(row, lambda);
    return lambda * (error + target) - 0.5 * lambda * lambda * effective;
  }
  const contactRows = (input.contacts ?? []).map((c) => {
    const i = p.findIndex((p) => p.parcel.id === c.particleId),
      s = boundaries.findIndex((b) => b.id === c.boundaryId);
    return {
      i,
      s,
      impact: c.impact,
      row: {
        i,
        terms: [{ i, gradient: scaleVec3(c.normal, -1) }],
        walls: [{ s, gradient: c.normal, point: c.point }],
      } as Constraint,
    };
  });
  // Only the approach present before pressure stabilization/prediction can pay
  // physical contact heat. Repeated contact corrections inside SPH projection
  // are numerical work, even when that contact began as a real impact.
  const beforeContacts = kinetic();
  if (!input.projectionOnly) {
    for (let iteration = 0; contactRows.length; iteration++) {
      for (const contact of contactRows) {
        const loss = project(contact.row, 0);
        if (contact.impact && loss > 0) {
          const share = loss / 2;
          particleContactHeat[contact.i] += share;
          wallContactHeat[contact.s] += loss - share;
          contactHeat += loss;
          enthalpies[contact.i] += share;
          available[contact.i] =
            p[contact.i].thermalCurve === null
              ? available[contact.i] + share
              : gasSensibleEnergy(p[contact.i].thermalCurve!, enthalpies[contact.i]);
        }
        yield 'contact-impact';
      }
      if (contactRows.every((c) => rate(c.row) <= 1e-8)) break;
      if (iteration + 1 === FLUID_REFERENCE_LIMITS_3D.iterations)
        throw Error('Fluid impact solve did not converge.');
    }
  }
  const contactNumerical = kinetic() - beforeContacts + contactHeat;
  const beforePrediction = kinetic();
  const prediction = input.velocityPrediction ?? ZERO;
  for (const particle of p)
    particle.parcel.velocity = addVec3(particle.parcel.velocity, prediction);
  for (const body of bodies)
    if (body.inverseMass) body.velocity = addVec3(body.velocity, prediction);
  const divergenceSupported = (row: Constraint) =>
    density[row.i] >= FLUID_REFERENCE_LIMITS_3D.divergenceSupportRatio * p[row.i].restDensity &&
    supportVolume[row.i] >= FLUID_REFERENCE_LIMITS_3D.divergenceSupportVolume * h ** 3;
  const beforeProjection = kinetic();
  const predictionKineticChange = beforeProjection - beforePrediction;
  const convergence = {
    densityIterations: 0,
    divergenceIterations: 0,
    densityError: 0,
    divergenceError: 0,
    gasVolumeResidual,
    contactError: 0,
    divergenceRows: rows.filter(divergenceSupported).length,
    freeSurfaceRows: rows.filter((row) => !divergenceSupported(row)).length,
    freeSurfaceCompressionRate: 0,
  };
  const passes: ('density' | 'divergence')[] = input.projectionOnly
    ? ['divergence']
    : ['density', 'divergence'];
  // Accumulated unilateral impulses may decrease as neighboring constraints
  // change. One-way clipping can reach a feasible but over-corrected velocity,
  // pumping resting liquid or removing unrelated motion at a boundary.
  const constraints = [...contactRows.map((c) => c.row), ...rows];
  const lambdas = constraints.map(() => 0);
  let capturedGradients: number[][] = [],
    capturedResponses: number[][] = [];
  // Build J M^-1 J^T once at frozen geometry. Aggregate sample gradients
  // belonging to the same body before applying its full inverse inertia.
  function* buildGram(): Generator<string, number[][]> {
    const width = 3 * n + 6 * bodies.length;
    const gradients: Float64Array[] = [],
      responses: Float64Array[] = [];
    for (const row of constraints) {
      const gradient = new Float64Array(width),
        response = new Float64Array(width);
      for (const t of row.terms)
        for (let axis = 0; axis < 3; axis++) gradient[3 * t.i + axis] += t.gradient[axis];
      for (const t of row.walls) {
        const b = atBody[t.s],
          start = 3 * n + 6 * b,
          torque = crossVec3(
            subtractVec3(t.point ?? boundaries[t.s].position, bodies[b].center),
            t.gradient,
          );
        for (let axis = 0; axis < 3; axis++) {
          gradient[start + axis] += t.gradient[axis];
          gradient[start + 3 + axis] += torque[axis];
        }
      }
      for (let i = 0; i < n; i++)
        for (let axis = 0; axis < 3; axis++)
          response[3 * i + axis] = gradient[3 * i + axis] / p[i].parcel.mass;
      for (let b = 0; b < bodies.length; b++) {
        const start = 3 * n + 6 * b,
          angular = matrix(bodies[b].inverseInertia, [
            gradient[start + 3],
            gradient[start + 4],
            gradient[start + 5],
          ]);
        for (let axis = 0; axis < 3; axis++) {
          response[start + axis] = gradient[start + axis] * bodies[b].inverseMass;
          response[start + 3 + axis] = angular[axis];
        }
      }
      gradients.push(gradient);
      responses.push(response);
      yield 'projection-gradients';
    }
    if (capture) {
      capturedGradients = gradients.map((row) => Array.from(row));
      capturedResponses = responses.map((row) => Array.from(row));
    }
    const result = constraints.map(() => constraints.map(() => 0));
    let work = 0;
    for (let i = 0; i < constraints.length; i++)
      for (let j = 0; j <= i; j++) {
        let value = 0;
        for (let k = 0; k < width; k++) value += gradients[i][k] * responses[j][k];
        result[i][j] = result[j][i] = value;
        if (++work % 8 === 0) yield 'projection-gram';
      }
    return result;
  }
  let gram: number[][] | null = null;
  const initialRates = constraints.map(rate);
  for (const kind of passes) {
    const targets = constraints.map((row, k) => {
      if (k < contactRows.length) return 0;
      const densityTarget = (p[row.i].restDensity - density[row.i]) / dt;
      return kind === 'density' || !divergenceSupported(row)
        ? densityTarget
        : Math.min(0, densityTarget);
    });
    let converged = constraints.length === 0;
    let active: boolean[] = [];
    for (
      let iteration = 0;
      !converged && iteration < FLUID_REFERENCE_LIMITS_3D.iterations;
      iteration++
    ) {
      if (iteration < 32) {
        for (let k = 0; k < constraints.length; k++) {
          const row = constraints[k],
            error = rate(row) - targets[k];
          const next =
            error <= 0 && lambdas[k] === 0
              ? 0
              : Math.max(0, lambdas[k] + error / effectiveMass(row));
          applyConstraint(row, next - lambdas[k]);
          lambdas[k] = next;
          yield `${kind}-projection`;
        }
      } else {
        if (gram === null) {
          gram = yield* buildGram();
          active = lambdas.map((value) => value > 0);
        }
        if (!active.length) active = lambdas.map((value) => value > 0);
        const indices = constraints.flatMap((_, k) => (active[k] ? [k] : []));
        // Solve the current nonnegative face. Only near-zero Cholesky
        // pivots receive a floor for redundant rows; acceptance uses the
        // original KKT residual, never the factorized system's residual.
        const factor: number[][] = [],
          forward: number[] = [];
        for (let a = 0; a < indices.length; a++) {
          const i = indices[a],
            values: number[] = [];
          for (let b = 0; b <= a; b++) {
            const j = indices[b];
            let value = gram[i][j];
            for (let c = 0; c < b; c++) value -= values[c] * (a === b ? values[c] : factor[b][c]);
            values.push(
              a === b ? Math.sqrt(Math.max(value, gram[i][i] * 1e-12)) : value / factor[b][b],
            );
          }
          if (!(values[a] > 0) || !Number.isFinite(values[a]))
            throw Error('Invalid fluid projection factor.');
          factor.push(values);
          let value = initialRates[i] - targets[i];
          for (let b = 0; b < a; b++) value -= values[b] * forward[b];
          forward.push(value / values[a]);
          yield 'projection-factor';
        }
        const candidate = constraints.map(() => 0);
        for (let a = indices.length - 1; a >= 0; a--) {
          let value = forward[a];
          for (let b = a + 1; b < indices.length; b++)
            value -= factor[b][a] * candidate[indices[b]];
          candidate[indices[a]] = value / factor[a][a];
          yield 'projection-backsolve';
        }
        if (capture)
          capture(
            structuredClone({
              gradients: capturedGradients,
              responses: capturedResponses,
              indices,
              rhs: indices.map((i) => initialRates[i] - targets[i]),
              candidate: indices.map((i) => candidate[i]),
              kind,
              iteration,
            }),
          );
        let step = 1,
          limiting = -1;
        for (const k of indices)
          if (candidate[k] < 0 && lambdas[k] / (lambdas[k] - candidate[k]) <= step) {
            step = lambdas[k] / (lambdas[k] - candidate[k]);
            limiting = k;
          }
        for (let k = 0; k < constraints.length; k++) {
          const next =
            k === limiting ? 0 : Math.max(0, lambdas[k] + step * (candidate[k] - lambdas[k]));
          applyConstraint(constraints[k], next - lambdas[k]);
          lambdas[k] = next;
          yield `${kind}-projection`;
        }
        if (limiting >= 0) active[limiting] = false;
        else {
          let worst = -1,
            maximum = 1;
          for (let k = 0; k < constraints.length; k++) {
            const tolerance =
              k < contactRows.length
                ? 1e-8
                : p[constraints[k].i].restDensity *
                  (kind === 'density'
                    ? FLUID_REFERENCE_LIMITS_3D.densityTolerance / dt
                    : FLUID_REFERENCE_LIMITS_3D.divergenceTolerance);
            const error = (rate(constraints[k]) - targets[k]) / tolerance;
            if (!active[k] && error > maximum) {
              worst = k;
              maximum = error;
            }
          }
          if (worst >= 0) active[worst] = true;
        }
      }
      let maximum = 0,
        contactError = 0;
      for (let k = 0; k < constraints.length; k++) {
        const row = constraints[k],
          error = rate(row) - targets[k];
        // Projected KKT residual also detects unnecessary retained impulses.
        const residual =
          error >= 0
            ? error
            : lambdas[k] === 0
              ? 0
              : Math.min(-error, lambdas[k] * effectiveMass(row));
        if (k < contactRows.length) contactError = Math.max(contactError, residual);
        else
          maximum = Math.max(
            maximum,
            (residual * (kind === 'density' ? dt : 1)) / p[row.i].restDensity,
          );
        yield `${kind}-residual`;
      }
      convergence[kind === 'density' ? 'densityIterations' : 'divergenceIterations'] =
        iteration + 1;
      convergence[kind === 'density' ? 'densityError' : 'divergenceError'] = maximum;
      convergence.contactError = contactError;
      converged =
        contactError <= 1e-8 &&
        maximum <=
          FLUID_REFERENCE_LIMITS_3D[
            kind === 'density' ? 'densityTolerance' : 'divergenceTolerance'
          ];
    }
    if (!converged)
      throw Error(
        `Liquid ${kind} projection did not converge within its work limit (density ${convergence.densityError}, divergence ${convergence.divergenceError}, contact ${convergence.contactError}).`,
      );
  }
  convergence.densityError = 0;
  convergence.divergenceError = 0;
  for (const row of rows) {
    const change = dt * rate(row),
      rest = p[row.i].restDensity;
    convergence.densityError = Math.max(
      convergence.densityError,
      (density[row.i] + change - rest) / rest,
    );
    if (divergenceSupported(row))
      convergence.divergenceError = Math.max(convergence.divergenceError, change / (dt * rest));
    else
      convergence.freeSurfaceCompressionRate = Math.max(
        convergence.freeSurfaceCompressionRate,
        change / (dt * rest),
      );
  }
  projectionKineticChange = kinetic() - beforeProjection + contactNumerical;
  const residual =
    kinetic() -
    initialKinetic -
    gasMechanicalWork +
    viscousHeat +
    contactHeat -
    projectionKineticChange -
    predictionKineticChange;
  if (
    Math.abs(residual) >
      1e-9 * Math.max(1, initialKinetic, Math.abs(gasMechanicalWork), viscousHeat) ||
    !Number.isFinite(residual)
  )
    throw Error('Fluid impulse-work residual exceeds tolerance.');
  for (const particle of p) readMaterialParcel3D(particle.parcel);
  for (const body of bodies) {
    assertFiniteVec3(body.velocity);
    assertFiniteVec3(body.angularVelocity);
  }
  for (const value of [...wallImpulse, ...wallCouple]) assertFiniteVec3(value);
  for (const value of [...pressureWork, ...viscousWork, ...wallHeat, ...available]) finite(value);
  for (let i = 0; i < n; i++)
    if (p[i].thermalCurve !== null) {
      p[i].thermalEnergy = available[i];
      p[i].thermalCurve!.enthalpy = enthalpies[i];
    }
  yield 'validate';
  return {
    particles: p,
    bodies,
    densities: p.map((v, i) => ({
      id: v.parcel.id,
      density: v.volume === null ? density[i] : finite(v.parcel.mass / v.volume),
      pressure:
        v.volume === null
          ? 0
          : finite(((FLUID_REFERENCE_LIMITS_3D.gamma - 1) * available[i]) / v.volume),
    })),
    gasVolumes: p.flatMap((v, i) =>
      v.volume === null
        ? []
        : [
            {
              id: v.parcel.id,
              volume: v.volume,
              supportRadius: gasSupportRadius(v.volume, h),
              pressureWorkResidual: pressureResidual[i],
              entropyResidual: entropyResidual[i],
            },
          ],
    ),
    thermalWork: p.map((v, i) => ({
      id: v.parcel.id,
      pressure: pressureWork[i],
      viscous: viscousWork[i],
      contact: particleContactHeat[i],
    })),
    boundaryTransfers: boundaries.map((s, i) => ({
      id: s.id,
      bodyId: s.bodyId,
      position: s.position,
      impulse: wallImpulse[i],
      angularImpulse: wallCouple[i],
      viscousHeat: wallHeat[i],
      contactHeat: wallContactHeat[i],
    })),
    energy: {
      gasMechanicalWork,
      viscousHeat,
      contactHeat,
      projectionKineticChange,
      predictionKineticChange,
      impulseWorkResidual: residual,
    },
    convergence,
  };
}

/** Input copies/validation are bounded setup; each work unit visits one bounded pair or row. */
export function createFluidReferenceJob3D(
  raw: FluidReferenceInput3D,
  capture?: (face: FluidProjectionFaceCapture3D) => void,
): FluidReferenceJob3D {
  const input = readInput(raw),
    generator = solve(input, capture);
  const maximum =
    input.particles.length * (2 * input.particles.length + 3 * input.boundaries.length + 4) +
    2 * (input.particles.length + (input.contacts?.length ?? 0)) ** 2 +
    9 *
      FLUID_REFERENCE_LIMITS_3D.iterations *
      (input.particles.length + (input.contacts?.length ?? 0)) +
    16;
  let completedWork = 0,
    stage = 'ready',
    status: FluidReferenceProgress3D['status'] = 'running',
    result: FluidReferenceResult3D | null = null;
  const progress = (): FluidReferenceProgress3D => ({
    status,
    stage,
    completedWork,
    maxTotalWork: maximum,
  });
  return Object.freeze({
    progress,
    advance(maxWork = FLUID_REFERENCE_LIMITS_3D.advanceWork) {
      if (
        !Number.isSafeInteger(maxWork) ||
        maxWork < 1 ||
        maxWork > FLUID_REFERENCE_LIMITS_3D.advanceWork
      )
        throw Error('Invalid fluid work budget.');
      if (status !== 'running') throw Error('Fluid job is no longer running.');
      try {
        for (let work = 0; work < maxWork; work++) {
          const next = generator.next();
          if (next.done) {
            result = next.value;
            status = 'complete';
            stage = 'complete';
            break;
          }
          stage = next.value;
          if (++completedWork > maximum) throw Error('Fluid job exceeded its total work budget.');
        }
      } catch (error) {
        status = 'cancelled';
        stage = 'failed';
        generator.return(null as never);
        throw error;
      }
      return progress();
    },
    cancel() {
      if (status !== 'running') return false;
      status = 'cancelled';
      stage = 'cancelled';
      generator.return(null as never);
      return true;
    },
    result() {
      if (status !== 'complete' || !result) throw Error('Fluid reference result is not complete.');
      return structuredClone(result);
    },
  });
}
/** One bounded reference step; this does not move positions or apply returned heat. */
export function solveFluidReference3D(raw: FluidReferenceInput3D): FluidReferenceResult3D {
  const job = createFluidReferenceJob3D(raw);
  while (job.progress().status === 'running') job.advance();
  return job.result();
}
