/** Bounded rigid candidate kernel. Release qualification still requires coupled runtime evidence. */
import { copyPortableValue, type PortableValue } from '../../portable-data.js';
import { readMaterialParcel3D, type MaterialParcel3D } from './conservation.js';
import {
  type Vec3,
  type Quat,
  IDENTITY_QUATERNION,
  addVec3,
  subtractVec3,
  scaleVec3,
  dotVec3,
  crossVec3,
  lengthVec3,
  normalizeVec3,
  assertFiniteVec3,
  rotateVector,
  integrateOrientation,
  multiplyQuaternions,
  normalizeQuaternion,
} from './math.js';
import { type OrientedCuboid, orientedCuboidContact, boundsOverlap } from './collision.js';

/** Row-major world-space tensor. */
export type Matrix3 = readonly [
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
export type RigidParcel3D = MaterialParcel3D & { halfExtents: Vec3 };
export type RigidBond3D = { a: string; b: string; strength: number; restLength: number };
export type RigidStepOptions3D = {
  dt: number;
  gravity?: Vec3;
  restitution?: number;
  friction?: number;
  nonCollidingParticleIds?: string[];
  solverIterations?: number;
  maxWork?: number;
  maxEvents?: number;
  contactTolerance?: number;
  velocityTolerance?: number;
  maxPenetration?: number;
};
export type RigidWork3D = { phase: 'assembly' | 'sweep' | 'contact' | 'fracture'; work: number };
export type RigidStepResult3D<T extends RigidParcel3D> = {
  parcels: T[];
  bonds: RigidBond3D[];
  brokenBonds: RigidBond3D[];
  components: string[][];
  dissipatedEnergyByParcel: { id: string; impact: number; friction: number }[];
  boundaryLinearImpulse: Vec3;
  boundaryAngularImpulse: Vec3;
  numericalEnergyResidual: number;
  numericalLinearMomentumResidual: Vec3;
  numericalAngularMomentumResidual: Vec3;
  /** Signed kinetic work of support constraints; never deposited as physical heat. */
  supportConstraintEnergy: number;
  report: { work: number; events: number; contacts: number };
};
const ZERO: Vec3 = [0, 0, 0];
const ZERO_MATRIX: Matrix3 = [0, 0, 0, 0, 0, 0, 0, 0, 0];
const BASIS: readonly Vec3[] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
const lexical = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const finite = (n: number) => {
  if (!Number.isFinite(n)) throw Error('Rigid arithmetic exceeded finite range.');
  return n;
};
export function applyMatrix3(matrix: Matrix3, vector: Vec3): Vec3 {
  return [0, 1, 2].map((i) =>
    finite(
      matrix[3 * i] * vector[0] + matrix[3 * i + 1] * vector[1] + matrix[3 * i + 2] * vector[2],
    ),
  ) as unknown as Vec3;
}
function tensor(orientation: Quat, principal: Vec3): Matrix3 {
  const axes = BASIS.map((axis) => rotateVector(orientation, axis));
  return Array.from({ length: 9 }, (_, at) =>
    axes.reduce((sum, axis, k) => sum + principal[k] * axis[Math.floor(at / 3)] * axis[at % 3], 0),
  ) as unknown as Matrix3;
}
function rotateTensor(matrix: Matrix3, orientation: Quat): Matrix3 {
  const columns = BASIS.map((axis) => rotateVector(orientation, axis));
  return Array.from({ length: 9 }, (_, at) => {
    const row = Math.floor(at / 3),
      column = at % 3;
    let value = 0;
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) value += columns[i][row] * matrix[3 * i + j] * columns[j][column];
    return finite(value);
  }) as unknown as Matrix3;
}
/** Scaled Cholesky rejects singular or poorly conditioned inertia. */
function invertTensor(matrix: Matrix3): Matrix3 {
  const scale = Math.max(...matrix.map(Math.abs));
  if (!(scale > 0) || !Number.isFinite(scale)) throw Error('Invalid assembly inertia.');
  const a = matrix.map((value) => value / scale),
    l = new Array<number>(9).fill(0);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j <= i; j++) {
      let value = a[3 * i + j];
      for (let k = 0; k < j; k++) value -= l[3 * i + k] * l[3 * j + k];
      if (i === j) {
        if (!(value > 1e-12)) throw Error('Singular or ill-conditioned assembly inertia.');
        l[3 * i + j] = Math.sqrt(value);
      } else l[3 * i + j] = value / l[3 * j + j];
    }
  const result = new Array<number>(9).fill(0);
  for (let column = 0; column < 3; column++) {
    const y = [0, 0, 0],
      x = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      let value = Number(i === column);
      for (let k = 0; k < i; k++) value -= l[3 * i + k] * y[k];
      y[i] = value / l[3 * i + i];
    }
    for (let i = 2; i >= 0; i--) {
      let value = y[i];
      for (let k = i + 1; k < 3; k++) value -= l[3 * k + i] * x[k];
      x[i] = value / l[3 * i + i];
      result[3 * i + column] = finite(x[i] / scale);
    }
  }
  return result as unknown as Matrix3;
}
function readParcel<T extends RigidParcel3D>(raw: T): T {
  const copy = copyPortableValue(raw as unknown as PortableValue) as unknown as T;
  const base = Object.fromEntries(
    [
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
    ].map((key) => [key, (copy as unknown as Record<string, unknown>)[key]]),
  );
  readMaterialParcel3D(base);
  assertFiniteVec3(copy.halfExtents);
  if (copy.halfExtents.some((v) => v <= 0)) throw Error('Rigid half extents must be positive.');
  return copy;
}
export function rigidAssemblyMassProperties3D(raw: readonly RigidParcel3D[]): {
  mass: number;
  center: Vec3;
  inertia: Matrix3;
  inverseInertia: Matrix3;
} {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 256)
    throw Error('Rigid assemblies require 1..256 parcels.');
  const owned = copyPortableValue(raw as unknown as PortableValue) as unknown as RigidParcel3D[];
  const parcels = owned.map(readParcel).sort((a, b) => lexical(a.id, b.id));
  if (new Set(parcels.map((p) => p.id)).size !== parcels.length)
    throw Error('Duplicate rigid parcel ID.');
  const mass = finite(parcels.reduce((sum, p) => sum + p.mass, 0));
  const center = parcels.reduce<Vec3>(
    (sum, p) => addVec3(sum, scaleVec3(p.center, p.mass / mass)),
    ZERO,
  );
  assertFiniteVec3(center);
  const inertia = new Array<number>(9).fill(0);
  for (const parcel of parcels) {
    const local = tensor(parcel.orientation, parcel.principalInertia),
      r = subtractVec3(parcel.center, center),
      squared = dotVec3(r, r);
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        inertia[3 * i + j] = finite(
          inertia[3 * i + j] +
            local[3 * i + j] +
            parcel.mass * (Number(i === j) * squared - r[i] * r[j]),
        );
  }
  const matrix = inertia as unknown as Matrix3;
  return { mass, center, inertia: matrix, inverseInertia: invertTensor(matrix) };
}

/** Shared admission check: no hidden unaccounted weld or moving anchor is accepted. */
export function validateRigidAssemblyMotion3D(
  raw: readonly RigidParcel3D[],
  anchored = false,
): {
  mass: number;
  center: Vec3;
  inertia: Matrix3;
  inverseInertia: Matrix3;
  velocity: Vec3;
  angularMomentum: Vec3;
  angularVelocity: Vec3;
} {
  const props = rigidAssemblyMassProperties3D(raw);
  const members = (copyPortableValue(raw as unknown as PortableValue) as unknown as RigidParcel3D[])
    .map(readParcel)
    .sort((a, b) => lexical(a.id, b.id));
  const velocity = members.reduce<Vec3>(
    (v, p) => addVec3(v, scaleVec3(p.velocity, p.mass / props.mass)),
    ZERO,
  );
  const angularMomentum = members.reduce<Vec3>(
    (sum, p) =>
      addVec3(
        sum,
        addVec3(
          p.intrinsicAngularMomentum,
          crossVec3(
            subtractVec3(p.center, props.center),
            scaleVec3(subtractVec3(p.velocity, velocity), p.mass),
          ),
        ),
      ),
    ZERO,
  );
  const angularVelocity = applyMatrix3(props.inverseInertia, angularMomentum);
  for (const p of members) {
    const expectedVelocity = addVec3(
      velocity,
      crossVec3(angularVelocity, subtractVec3(p.center, props.center)),
    );
    const expectedSpin = applyMatrix3(tensor(p.orientation, p.principalInertia), angularVelocity);
    if (
      lengthVec3(subtractVec3(p.velocity, expectedVelocity)) >
        1e-9 * Math.max(1, lengthVec3(p.velocity)) ||
      lengthVec3(subtractVec3(p.intrinsicAngularMomentum, expectedSpin)) >
        1e-9 * Math.max(1, lengthVec3(expectedSpin))
    )
      throw Error('Bonded parcel motion is not rigid; welding requires an accounted edit.');
  }
  if (
    anchored &&
    members.some(
      (p) => p.velocity.some((v) => v !== 0) || p.intrinsicAngularMomentum.some((v) => v !== 0),
    )
  )
    throw Error('Anchored assemblies require exactly stationary input.');
  return { ...props, velocity, angularMomentum, angularVelocity };
}

type Body<T extends RigidParcel3D> = {
  members: T[];
  mass: number;
  center: Vec3;
  velocity: Vec3;
  angularMomentum: Vec3;
  inertia: Matrix3;
  inverseInertia: Matrix3;
  anchored: boolean;
  radius: number;
};
type Contact<T extends RigidParcel3D> = {
  a: Body<T>;
  b: Body<T>;
  pa: T;
  pb: T;
  point: Vec3;
  normal: Vec3;
  tangent1: Vec3;
  tangent2: Vec3;
  normalImpulse: number;
  tangentImpulse: Vec3;
  target: number;
  friction: number;
  restitution: number;
  impact: boolean;
  physicalFriction: boolean;
  normalWork: number;
  frictionWork: number;
};
const omega = <T extends RigidParcel3D>(body: Body<T>) =>
  applyMatrix3(body.inverseInertia, body.angularMomentum);
const inverseMass = <T extends RigidParcel3D>(body: Body<T>) => (body.anchored ? 0 : 1 / body.mass);
const inverseTensor = <T extends RigidParcel3D>(body: Body<T>) =>
  body.anchored ? ZERO_MATRIX : body.inverseInertia;
const pointVelocity = <T extends RigidParcel3D>(body: Body<T>, point: Vec3) =>
  addVec3(body.velocity, crossVec3(omega(body), subtractVec3(point, body.center)));
const shape = (p: RigidParcel3D): OrientedCuboid => ({
  center: p.center,
  halfExtents: p.halfExtents,
  orientation: p.orientation,
});
function sync<T extends RigidParcel3D>(body: Body<T>): void {
  const angular = omega(body);
  for (const parcel of body.members) {
    parcel.velocity = pointVelocity(body, parcel.center);
    parcel.intrinsicAngularMomentum = applyMatrix3(
      tensor(parcel.orientation, parcel.principalInertia),
      angular,
    );
  }
}
function componentIds(
  parcels: readonly RigidParcel3D[],
  bonds: readonly RigidBond3D[],
): string[][] {
  const adjacency = new Map(parcels.map((p) => [p.id, [] as string[]]));
  for (const b of bonds) {
    adjacency.get(b.a)!.push(b.b);
    adjacency.get(b.b)!.push(b.a);
  }
  for (const neighbors of adjacency.values()) neighbors.sort(lexical);
  const seen = new Set<string>(),
    groups: string[][] = [];
  for (const { id } of parcels)
    if (!seen.has(id)) {
      const ids = [id];
      seen.add(id);
      for (let cursor = 0; cursor < ids.length; cursor++)
        for (const neighbor of adjacency.get(ids[cursor])!)
          if (!seen.has(neighbor)) {
            seen.add(neighbor);
            ids.push(neighbor);
          }
      groups.push(ids.sort(lexical));
    }
  return groups;
}
function axes(p: RigidParcel3D): Vec3[] {
  return BASIS.map((axis) => rotateVector(p.orientation, axis));
}
function projectionRadius(p: RigidParcel3D, directions: readonly Vec3[], axis: Vec3): number {
  return directions.reduce(
    (sum, direction, i) => sum + p.halfExtents[i] * Math.abs(dotVec3(direction, axis)),
    0,
  );
}
function pairAxes(a: RigidParcel3D, b: RigidParcel3D): { a: Vec3[]; b: Vec3[]; all: Vec3[] } {
  const aa = axes(a),
    bb = axes(b),
    all = [...aa, ...bb];
  for (const x of aa)
    for (const y of bb) {
      const n = crossVec3(x, y);
      if (lengthVec3(n) > 1e-12) all.push(normalizeVec3(n));
    }
  return { a: aa, b: bb, all };
}
/** Exact interval clipping for the constant-orientation, constant-velocity drift. */
function translationImpact(
  a: RigidParcel3D,
  b: RigidParcel3D,
  velocity: Vec3,
  duration: number,
  tolerance: number,
): number | null {
  const directions = pairAxes(a, b),
    offset = subtractVec3(b.center, a.center);
  let enter = 0,
    exit = duration;
  for (const axis of directions.all) {
    const radius =
      projectionRadius(a, directions.a, axis) + projectionRadius(b, directions.b, axis);
    const distance = dotVec3(offset, axis),
      speed = dotVec3(velocity, axis);
    if (speed === 0) {
      if (Math.abs(distance) > radius + tolerance) return null;
    } else {
      const low = (-radius - distance) / speed,
        high = (radius - distance) / speed;
      enter = Math.max(enter, Math.min(low, high));
      exit = Math.min(exit, Math.max(low, high));
      if (enter > exit || exit < 0) return null;
    }
  }
  if (enter > duration) return null;
  if (enter === 0) {
    const contact = contactWithinTolerance(a, b, tolerance);
    if (contact && dotVec3(velocity, contact.normal) >= -tolerance) return null;
  }
  return enter;
}
function corners(parcel: RigidParcel3D): Vec3[] {
  return Array.from({ length: 8 }, (_, bits) =>
    addVec3(
      parcel.center,
      rotateVector(
        parcel.orientation,
        parcel.halfExtents.map((value, axis) =>
          bits & (1 << axis) ? value : -value,
        ) as unknown as Vec3,
      ),
    ),
  );
}
/** Round fluid exclusion against a solid OBB; finite spin/inertia stays authoritative.
 * Particle-particle exclusion is supplied by pressure, not this contact kernel.
 */
function particleBoxGeometry(a: RigidParcel3D, b: RigidParcel3D, first: boolean) {
  const particle = first ? a : b,
    box = first ? b : a,
    q = box.orientation;
  const local = rotateVector(
    [-q[0], -q[1], -q[2], q[3]],
    subtractVec3(particle.center, box.center),
  );
  const closest = local.map((v, i) =>
    Math.max(-box.halfExtents[i], Math.min(box.halfExtents[i], v)),
  ) as unknown as Vec3;
  const offset = subtractVec3(local, closest),
    distance = lengthVec3(offset),
    radius = Math.min(...particle.halfExtents);
  let outward: Vec3,
    gap: number,
    surface = closest;
  if (distance > 0) {
    outward = scaleVec3(offset, 1 / distance);
    gap = distance - radius;
  } else {
    const margins = local.map((v, i) => box.halfExtents[i] - Math.abs(v));
    const axis = margins.indexOf(Math.min(...margins)),
      sign = local[axis] < 0 ? -1 : 1;
    outward = BASIS[axis].map((v) => v * sign) as unknown as Vec3;
    surface = local.map((v, i) => (i === axis ? sign * box.halfExtents[i] : v)) as unknown as Vec3;
    gap = -margins[axis] - radius;
  }
  outward = rotateVector(q, outward);
  const solidPoint = addVec3(box.center, rotateVector(q, surface));
  const point = scaleVec3(
    addVec3(solidPoint, subtractVec3(particle.center, scaleVec3(outward, radius))),
    0.5,
  );
  return { normal: scaleVec3(outward, first ? -1 : 1), gap, point };
}
function separationPlane(a: RigidParcel3D, b: RigidParcel3D): { normal: Vec3; gap: number } {
  const directions = pairAxes(a, b),
    offset = subtractVec3(b.center, a.center);
  let normal: Vec3 = [1, 0, 0],
    gap = -Infinity;
  for (const axis of directions.all) {
    const distance = dotVec3(offset, axis),
      candidate =
        Math.abs(distance) -
        projectionRadius(a, directions.a, axis) -
        projectionRadius(b, directions.b, axis);
    if (candidate > gap) {
      gap = candidate;
      normal = scaleVec3(axis, distance < 0 ? -1 : 1);
    }
  }
  return { normal, gap };
}
/**
 * A fixed separating plane stays valid independently of later support-feature
 * changes. Bound every corner-pair projection, including currently hidden corners.
 * The midpoint axis satisfies |omegaMid - omega0| <= A h, where
 * A = ||I^-1||F |omega0 cross L| / 2. This retains the exact zero bound
 * for principal-axis spin; a global |L|/Imin bound would stall slender rods.
 * Use A*duration as a velocity uncertainty and (|omega0|+A*duration)^2 R
 * as curvature, valid for every shorter drift and every support-feature switch.
 */
function rotationalAdvance<T extends RigidParcel3D>(
  a: Body<T>,
  b: Body<T>,
  pa: T,
  pb: T,
  duration: number,
  allowance: number,
  particleA = false,
  particleB = false,
): number {
  const plane =
    particleA || particleB ? particleBoxGeometry(pa, pb, particleA) : separationPlane(pa, pb);
  const changeBound = (body: Body<T>) =>
    body.anchored
      ? 0
      : 0.5 *
        Math.hypot(...body.inverseInertia) *
        lengthVec3(crossVec3(omega(body), body.angularMomentum));
  const aa = particleA ? 0 : changeBound(a),
    ab = particleB ? 0 : changeBound(b);
  const wa = particleA ? 0 : lengthVec3(omega(a)) + aa * duration,
    wb = particleB ? 0 : lengthVec3(omega(b)) + ab * duration;
  const curvature = finite(wa * wa * a.radius + wb * wb * b.radius);
  const uncertainSpeed = finite((aa * a.radius + ab * b.radius) * duration);
  let limit = duration;
  const xs = particleA
    ? [addVec3(pa.center, scaleVec3(plane.normal, Math.min(...pa.halfExtents)))]
    : corners(pa);
  const ys = particleB
    ? [subtractVec3(pb.center, scaleVec3(plane.normal, Math.min(...pb.halfExtents)))]
    : corners(pb);
  for (const x of xs)
    for (const y of ys) {
      const distance = dotVec3(subtractVec3(y, x), plane.normal) + allowance;
      if (!(distance > 0))
        throw Error('Rotating contact requires overlap projection before advancement.');
      const speed =
        dotVec3(
          subtractVec3(
            particleB ? b.velocity : pointVelocity(b, y),
            particleA ? a.velocity : pointVelocity(a, x),
          ),
          plane.normal,
        ) - uncertainSpeed;
      let bound = Infinity;
      if (curvature === 0) {
        if (speed < 0) bound = distance / -speed;
      } else {
        const root = Math.sqrt(speed * speed + 2 * curvature * distance);
        bound = speed < 0 ? (2 * distance) / (root - speed) : (speed + root) / curvature;
      }
      limit = Math.min(limit, bound);
    }
  if (!(limit > 0) || !Number.isFinite(limit))
    throw Error('Rotational advancement failed to make finite progress.');
  return limit;
}
function closestEdgePoint(a: RigidParcel3D, b: RigidParcel3D, normal: Vec3): Vec3 {
  const aa = axes(a),
    bb = axes(b);
  let ai = 0,
    bi = 0,
    alignment = -1;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      const cross = crossVec3(aa[i], bb[j]);
      if (lengthVec3(cross) < 1e-12) continue;
      const match = Math.abs(dotVec3(normalizeVec3(cross), normal));
      if (match > alignment) {
        alignment = match;
        ai = i;
        bi = j;
      }
    }
  const edge = (p: RigidParcel3D, directions: Vec3[], axis: number, facing: Vec3): [Vec3, Vec3] => {
    let center = p.center;
    for (let i = 0; i < 3; i++)
      if (i !== axis)
        center = addVec3(
          center,
          scaleVec3(
            directions[i],
            (dotVec3(directions[i], facing) < 0 ? -1 : 1) * p.halfExtents[i],
          ),
        );
    const delta = scaleVec3(directions[axis], p.halfExtents[axis]);
    return [subtractVec3(center, delta), addVec3(center, delta)];
  };
  const [p, q] = edge(a, aa, ai, normal),
    [r, t] = edge(b, bb, bi, scaleVec3(normal, -1));
  const d1 = subtractVec3(q, p),
    d2 = subtractVec3(t, r),
    offset = subtractVec3(p, r);
  const a1 = dotVec3(d1, d1),
    a2 = dotVec3(d2, d2),
    coupling = dotVec3(d1, d2),
    c = dotVec3(d1, offset),
    f = dotVec3(d2, offset);
  const clamp = (value: number) => Math.max(0, Math.min(1, value)),
    denominator = a1 * a2 - coupling * coupling;
  let u = denominator > 1e-14 * a1 * a2 ? clamp((coupling * f - c * a2) / denominator) : 0;
  let v = (coupling * u + f) / a2;
  if (v < 0) {
    v = 0;
    u = clamp(-c / a1);
  } else if (v > 1) {
    v = 1;
    u = clamp((coupling - c) / a1);
  }
  return scaleVec3(addVec3(addVec3(p, scaleVec3(d1, u)), addVec3(r, scaleVec3(d2, v))), 0.5);
}
/** Solver contact skin: a roundoff-sized positive gap still supports a resting body.
 * This never moves geometry; geometric projection continues to use actual overlap.
 */
function contactWithinTolerance(
  a: RigidParcel3D,
  b: RigidParcel3D,
  tolerance: number,
): { normal: Vec3; depth: number } | null {
  const overlap = orientedCuboidContact(shape(a), shape(b));
  if (overlap) return overlap;
  const directions = pairAxes(a, b),
    offset = subtractVec3(b.center, a.center);
  let depth = Infinity,
    normal: Vec3 = [1, 0, 0];
  for (const axis of directions.all) {
    const distance = dotVec3(offset, axis);
    const penetration =
      projectionRadius(a, directions.a, axis) +
      projectionRadius(b, directions.b, axis) -
      Math.abs(distance);
    if (penetration < -tolerance) return null;
    if (penetration < depth) {
      depth = penetration;
      normal = scaleVec3(axis, distance < 0 ? -1 : 1);
    }
  }
  return { normal, depth: Math.max(0, depth) };
}
function clipPolygon(points: Vec3[], center: Vec3, axis: Vec3, extent: number): Vec3[] {
  const result: Vec3[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    const da = dotVec3(subtractVec3(a, center), axis) - extent,
      db = dotVec3(subtractVec3(b, center), axis) - extent;
    if (da <= 0) result.push(a);
    if (da <= 0 !== db <= 0) result.push(addVec3(a, scaleVec3(subtractVec3(b, a), da / (da - db))));
  }
  return result;
}
/** Face clipping supplies the contact polygon; edge contacts use closest segments. */
function manifold(
  a: RigidParcel3D,
  b: RigidParcel3D,
  normal: Vec3,
  tolerance: number,
  sideTolerance = 0,
): Vec3[] {
  const aa = axes(a),
    bb = axes(b);
  const best = (directions: Vec3[]) =>
    directions.reduce(
      (index, axis, i) =>
        Math.abs(dotVec3(axis, normal)) > Math.abs(dotVec3(directions[index], normal)) ? i : index,
      0,
    );
  const ai = best(aa),
    bi = best(bb),
    useA = Math.abs(dotVec3(aa[ai], normal)) >= Math.abs(dotVec3(bb[bi], normal));
  const ref = useA ? a : b,
    incident = useA ? b : a,
    ra = useA ? aa : bb,
    ia = useA ? bb : aa,
    ri = useA ? ai : bi;
  if (Math.abs(dotVec3(ra[ri], normal)) < 1 - 1e-8) return [closestEdgePoint(a, b, normal)];
  const outward = useA ? normal : scaleVec3(normal, -1);
  const faceCenter = addVec3(ref.center, scaleVec3(outward, ref.halfExtents[ri]));
  const ii = ia.reduce(
    (index, axis, i) =>
      Math.abs(dotVec3(axis, outward)) > Math.abs(dotVec3(ia[index], outward)) ? i : index,
    0,
  );
  const incidentCenter = addVec3(
    incident.center,
    scaleVec3(ia[ii], (dotVec3(ia[ii], outward) > 0 ? -1 : 1) * incident.halfExtents[ii]),
  );
  const side = [0, 1, 2].filter((i) => i !== ii);
  let points = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([x, y]) =>
    addVec3(
      incidentCenter,
      addVec3(
        scaleVec3(ia[side[0]], x * incident.halfExtents[side[0]]),
        scaleVec3(ia[side[1]], y * incident.halfExtents[side[1]]),
      ),
    ),
  );
  for (const i of [0, 1, 2].filter((i) => i !== ri))
    for (const sign of [-1, 1])
      points = clipPolygon(
        points,
        ref.center,
        scaleVec3(ra[i], sign),
        ref.halfExtents[i] + sideTolerance,
      );
  return points
    .filter((p) => dotVec3(subtractVec3(p, faceCenter), outward) <= tolerance)
    .map((p) => addVec3(p, scaleVec3(outward, dotVec3(subtractVec3(faceCenter, p), outward) / 2)))
    .sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]);
}
/** Finite contact patch for transport laws. Edge/vertex touch has zero area.
 * The caller owns validated parcels; mechanical point contact remains separate.
 */
export function rigidContactPatchArea3D(a: RigidParcel3D, b: RigidParcel3D): number {
  const contact = orientedCuboidContact(shape(a), shape(b));
  if (!contact) return 0;
  const points = manifold(a, b, contact.normal, 1e-8);
  if (points.length < 3) return 0;
  const center = points.reduce<Vec3>(
    (sum, p) => addVec3(sum, scaleVec3(p, 1 / points.length)),
    ZERO,
  );
  const axis = BASIS.reduce((best, axis) =>
    Math.abs(dotVec3(axis, contact.normal)) < Math.abs(dotVec3(best, contact.normal)) ? axis : best,
  );
  const u = normalizeVec3(crossVec3(contact.normal, axis)),
    v = crossVec3(contact.normal, u);
  const ordered = points
    .map((p) => subtractVec3(p, center))
    .sort(
      (a, b) => Math.atan2(dotVec3(a, v), dotVec3(a, u)) - Math.atan2(dotVec3(b, v), dotVec3(b, u)),
    );
  const area =
    0.5 *
    Math.abs(
      ordered.reduce(
        (sum, p, i) =>
          sum + dotVec3(contact.normal, crossVec3(p, ordered[(i + 1) % ordered.length])),
        0,
      ),
    );
  return finite(area);
}
function effective<T extends RigidParcel3D>(contact: Contact<T>, direction: Vec3): Vec3 {
  const ra = subtractVec3(contact.point, contact.a.center),
    rb = subtractVec3(contact.point, contact.b.center);
  return addVec3(
    scaleVec3(direction, inverseMass(contact.a) + inverseMass(contact.b)),
    addVec3(
      crossVec3(applyMatrix3(inverseTensor(contact.a), crossVec3(ra, direction)), ra),
      crossVec3(applyMatrix3(inverseTensor(contact.b), crossVec3(rb, direction)), rb),
    ),
  );
}

/** Owns inputs immediately. No candidate state escapes through progress yields. */
export function createRigidStep3D<T extends RigidParcel3D>(
  rawParcels: readonly T[],
  rawBonds: readonly RigidBond3D[],
  rawAnchors: readonly string[],
  rawOptions: RigidStepOptions3D,
): Generator<RigidWork3D, RigidStepResult3D<T>, void> {
  if (
    !Array.isArray(rawParcels) ||
    rawParcels.length > 256 ||
    !Array.isArray(rawBonds) ||
    rawBonds.length > 1024 ||
    !Array.isArray(rawAnchors) ||
    rawAnchors.length > rawParcels.length
  )
    throw Error('Rigid candidate exceeds bounded input limits.');
  const ownedParcels = copyPortableValue(rawParcels as unknown as PortableValue) as unknown as T[];
  const parcels = ownedParcels.map(readParcel).sort((a, b) => lexical(a.id, b.id));
  const byId = new Map(parcels.map((p) => [p.id, p]));
  if (byId.size !== parcels.length) throw Error('Duplicate rigid parcel ID.');
  const bonds = copyPortableValue(rawBonds as unknown as PortableValue) as unknown as RigidBond3D[];
  const ownedAnchors = copyPortableValue(
    rawAnchors as unknown as PortableValue,
  ) as unknown as string[];
  const anchors = new Set(ownedAnchors);
  if (anchors.size !== rawAnchors.length || [...anchors].some((id) => !byId.has(id)))
    throw Error('Invalid rigid anchor IDs.');
  for (const bond of bonds) {
    if (
      !byId.has(bond.a) ||
      !byId.has(bond.b) ||
      bond.a === bond.b ||
      !Number.isFinite(bond.strength) ||
      bond.strength < 0 ||
      !Number.isFinite(bond.restLength) ||
      bond.restLength <= 0
    )
      throw Error('Invalid rigid bond.');
    if (lexical(bond.a, bond.b) > 0) [bond.a, bond.b] = [bond.b, bond.a];
  }
  bonds.sort((a, b) => lexical(a.a, b.a) || lexical(a.b, b.b));
  if (bonds.some((b, i) => i > 0 && b.a === bonds[i - 1].a && b.b === bonds[i - 1].b))
    throw Error('Duplicate rigid bond.');
  const input = copyPortableValue(
    rawOptions as unknown as PortableValue,
  ) as unknown as RigidStepOptions3D;
  const options = {
    gravity: ZERO,
    restitution: 0,
    friction: 0.5,
    solverIterations: 96,
    maxWork: 200000,
    maxEvents: 64,
    contactTolerance: 1e-8,
    velocityTolerance: 1e-8,
    maxPenetration: 1e-5,
    ...input,
  };
  assertFiniteVec3(options.gravity);
  if (
    !(options.dt > 0) ||
    !Number.isFinite(options.dt) ||
    ![
      options.restitution,
      options.friction,
      options.contactTolerance,
      options.velocityTolerance,
      options.maxPenetration,
    ].every(Number.isFinite) ||
    options.restitution < 0 ||
    options.restitution > 1 ||
    options.friction < 0 ||
    options.contactTolerance <= 0 ||
    options.velocityTolerance <= 0 ||
    options.maxPenetration < options.contactTolerance
  )
    throw Error('Invalid rigid step options.');
  for (const [value, maximum] of [
    [options.solverIterations, 1024],
    [options.maxWork, 1000000],
    [options.maxEvents, 1024],
  ])
    if (!Number.isInteger(value) || value < 1 || value > maximum)
      throw Error('Invalid rigid work bound.');
  const particleList = options.nonCollidingParticleIds ?? [];
  if (!Array.isArray(particleList) || particleList.length > parcels.length)
    throw Error('Invalid non-colliding particle list.');
  const particleIds = new Set(particleList);
  if (
    particleIds.size !== particleList.length ||
    particleList.some((id) => !byId.has(id)) ||
    bonds.some((b) => particleIds.has(b.a) || particleIds.has(b.b))
  )
    throw Error('Non-colliding particles require unique existing unbonded IDs.');
  const skipPair = (a: Body<T>, b: Body<T>) =>
    (a.anchored && b.anchored) ||
    (a.members.length === 1 &&
      b.members.length === 1 &&
      particleIds.has(a.members[0].id) &&
      particleIds.has(b.members[0].id));
  function contactGeometry(a: T, b: T, tolerance: number) {
    if (!particleIds.has(a.id) && !particleIds.has(b.id))
      return contactWithinTolerance(a, b, tolerance);
    const contact = particleBoxGeometry(a, b, particleIds.has(a.id));
    return contact.gap > tolerance ? null : { ...contact, depth: Math.max(0, -contact.gap) };
  }
  return run();

  function* run(): Generator<RigidWork3D, RigidStepResult3D<T>, void> {
    let work = 0,
      events = 0,
      contactCount = 0,
      supportConstraintEnergy = 0;
    let boundaryLinearImpulse: Vec3 = ZERO,
      boundaryAngularImpulse: Vec3 = ZERO;
    let gravityLinearImpulse: Vec3 = ZERO,
      gravityAngularImpulse: Vec3 = ZERO;
    const progress = (phase: RigidWork3D['phase']): RigidWork3D => {
      if (++work > options.maxWork) throw Error('Rigid work limit exceeded.');
      return { phase, work };
    };
    const external = new Map(parcels.map((p) => [p.id, { linear: ZERO, angular: ZERO }]));
    const initial = new Map(
      parcels.map((p) => [
        p.id,
        { momentum: scaleVec3(p.velocity, p.mass), spin: p.intrinsicAngularMomentum },
      ]),
    );
    const heat = new Map(parcels.map((p) => [p.id, { id: p.id, impact: 0, friction: 0 }]));
    const broken = new Set(bonds.filter((b) => b.strength === 0)),
      retained = () => bonds.filter((b) => !broken.has(b));
    const bodies: Body<T>[] = [];
    for (const ids of componentIds(parcels, retained())) {
      yield progress('assembly');
      const members = ids.map((id) => byId.get(id)!),
        anchored = ids.some((id) => anchors.has(id));
      const props = validateRigidAssemblyMotion3D(members, anchored);
      const body: Body<T> = {
        ...props,
        members,
        anchored,
        radius: Math.max(
          ...members.map(
            (p) => lengthVec3(subtractVec3(p.center, props.center)) + lengthVec3(p.halfExtents),
          ),
        ),
      };
      bodies.push(body);
    }
    const parcelEnergy = () =>
      finite(
        parcels.reduce(
          (sum, p) =>
            sum +
            0.5 * p.mass * dotVec3(p.velocity, p.velocity) +
            0.5 *
              dotVec3(
                p.intrinsicAngularMomentum,
                applyMatrix3(
                  invertTensor(tensor(p.orientation, p.principalInertia)),
                  p.intrinsicAngularMomentum,
                ),
              ) -
            p.mass * dotVec3(options.gravity, p.center),
          0,
        ),
      );
    const parcelMomentum = () => ({
      linear: parcels.reduce<Vec3>((sum, p) => addVec3(sum, scaleVec3(p.velocity, p.mass)), ZERO),
      angular: parcels.reduce<Vec3>(
        (sum, p) =>
          addVec3(
            sum,
            addVec3(p.intrinsicAngularMomentum, crossVec3(p.center, scaleVec3(p.velocity, p.mass))),
          ),
        ZERO,
      ),
    });
    const beforeEnergy = parcelEnergy(),
      beforeMomentum = parcelMomentum();
    assertFiniteVec3(beforeMomentum.linear, 'initial total momentum');
    assertFiniteVec3(beforeMomentum.angular, 'initial total angular momentum');
    function record(parcel: T, impulse: Vec3, point: Vec3): void {
      const row = external.get(parcel.id)!;
      row.linear = addVec3(row.linear, impulse);
      row.angular = addVec3(row.angular, crossVec3(subtractVec3(point, parcel.center), impulse));
    }
    function apply(body: Body<T>, parcel: T, impulse: Vec3, point: Vec3): void {
      record(parcel, impulse, point);
      if (body.anchored) {
        boundaryLinearImpulse = addVec3(boundaryLinearImpulse, impulse);
        boundaryAngularImpulse = addVec3(boundaryAngularImpulse, crossVec3(point, impulse));
      } else {
        body.velocity = addVec3(body.velocity, scaleVec3(impulse, 1 / body.mass));
        body.angularMomentum = addVec3(
          body.angularMomentum,
          crossVec3(subtractVec3(point, body.center), impulse),
        );
      }
    }
    function kick(dt: number): Map<Body<T>, { velocity: Vec3; angular: Vec3 }> {
      const prior = new Map(
        bodies.map((body) => [body, { velocity: body.velocity, angular: omega(body) }]),
      );
      for (const body of bodies) {
        if (!body.anchored) body.velocity = addVec3(body.velocity, scaleVec3(options.gravity, dt));
        for (const parcel of body.members) {
          const impulse = scaleVec3(options.gravity, parcel.mass * dt);
          record(parcel, impulse, parcel.center);
          gravityLinearImpulse = addVec3(gravityLinearImpulse, impulse);
          gravityAngularImpulse = addVec3(gravityAngularImpulse, crossVec3(parcel.center, impulse));
          if (body.anchored) {
            boundaryLinearImpulse = addVec3(boundaryLinearImpulse, impulse);
            boundaryAngularImpulse = addVec3(
              boundaryAngularImpulse,
              crossVec3(parcel.center, impulse),
            );
          }
        }
      }
      return prior;
    }
    function drift(dt: number): void {
      for (const body of bodies)
        if (!body.anchored) {
          const before = body.center,
            angular = omega(body);
          const half = integrateOrientation(IDENTITY_QUATERNION, angular, dt / 2);
          const midOmega = applyMatrix3(
            invertTensor(rotateTensor(body.inertia, half)),
            body.angularMomentum,
          );
          const rotation = integrateOrientation(IDENTITY_QUATERNION, midOmega, dt);
          body.center = addVec3(body.center, scaleVec3(body.velocity, dt));
          for (const parcel of body.members) {
            parcel.center = addVec3(
              body.center,
              rotateVector(rotation, subtractVec3(parcel.center, before)),
            );
            parcel.orientation = normalizeQuaternion(
              multiplyQuaternions(rotation, parcel.orientation),
            );
          }
          body.inertia = rotateTensor(body.inertia, rotation);
          body.inverseInertia = invertTensor(body.inertia);
        }
    }
    function* project(): Generator<RigidWork3D, void, void> {
      for (let iteration = 0; iteration < options.solverIterations; iteration++) {
        let changed = false;
        for (let i = 0; i < bodies.length; i++)
          for (let j = i + 1; j < bodies.length; j++) {
            const a = bodies[i],
              b = bodies[j];
            if (skipPair(a, b)) continue;
            for (const pa of a.members)
              for (const pb of b.members) {
                yield progress('contact');
                const contact = contactGeometry(pa, pb, 0);
                if (!contact || contact.depth <= options.contactTolerance) continue;
                if (contact.depth > options.maxPenetration)
                  throw Error('Rigid penetration exceeds geometric correction limit.');
                const total = inverseMass(a) + inverseMass(b);
                for (const [body, direction] of [
                  [a, -1],
                  [b, 1],
                ] as const)
                  if (!body.anchored) {
                    const shift = scaleVec3(
                      contact.normal,
                      (direction * contact.depth * inverseMass(body)) / total,
                    );
                    body.center = addVec3(body.center, shift);
                    for (const member of body.members)
                      member.center = addVec3(member.center, shift);
                  }
                changed = true;
              }
          }
        if (!changed) return;
      }
      throw Error('Rigid geometric projection did not converge.');
    }
    function* solve(
      impact: boolean,
      prior?: Map<Body<T>, { velocity: Vec3; angular: Vec3 }>,
    ): Generator<RigidWork3D, void, void> {
      const contacts: Contact<T>[] = [];
      for (let i = 0; i < bodies.length; i++)
        for (let j = i + 1; j < bodies.length; j++) {
          const a = bodies[i],
            b = bodies[j];
          if (skipPair(a, b)) continue;
          for (const pa of a.members)
            for (const pb of b.members) {
              yield progress('contact');
              const contact = contactGeometry(pa, pb, options.contactTolerance);
              if (!contact) continue;
              if (contact.depth > options.maxPenetration)
                throw Error('Rigid penetration exceeds correction-free candidate limit.');
              const particleBoundary = particleIds.has(pa.id) || particleIds.has(pb.id);
              const friction = particleBoundary ? 0 : options.friction,
                restitution = particleBoundary ? 0 : options.restitution;
              const n = contact.normal,
                tangent1 = normalizeVec3(
                  crossVec3(
                    n,
                    BASIS.reduce((best, axis) =>
                      Math.abs(dotVec3(n, axis)) < Math.abs(dotVec3(n, best)) ? axis : best,
                    ),
                  ),
                ),
                tangent2 = crossVec3(n, tangent1);
              const points = particleBoundary
                ? [particleBoxGeometry(pa, pb, particleIds.has(pa.id)).point]
                : manifold(pa, pb, n, options.contactTolerance, options.contactTolerance);
              if (points.length === 0)
                throw Error(`Unresolved contact manifold between ${pa.id} and ${pb.id}.`);
              for (const point of points) {
                const speed = dotVec3(
                  subtractVec3(pointVelocity(b, point), pointVelocity(a, point)),
                  n,
                );
                const beforeKickVelocity = (body: Body<T>) => {
                  const motion = prior?.get(body);
                  return motion
                    ? addVec3(
                        motion.velocity,
                        crossVec3(motion.angular, subtractVec3(point, body.center)),
                      )
                    : pointVelocity(body, point);
                };
                const previousRelative = subtractVec3(beforeKickVelocity(b), beforeKickVelocity(a));
                const previousTangent = subtractVec3(
                  previousRelative,
                  scaleVec3(n, dotVec3(previousRelative, n)),
                );
                contacts.push({
                  a,
                  b,
                  pa,
                  pb,
                  point,
                  normal: n,
                  tangent1,
                  tangent2,
                  normalImpulse: 0,
                  tangentImpulse: ZERO,
                  target: impact && speed < -options.velocityTolerance ? -restitution * speed : 0,
                  friction,
                  restitution,
                  impact: impact && speed < -options.velocityTolerance,
                  physicalFriction:
                    (impact && speed < -options.velocityTolerance) ||
                    lengthVec3(previousTangent) > options.velocityTolerance,
                  normalWork: 0,
                  frictionWork: 0,
                });
              }
            }
        }
      contactCount += contacts.length;
      if (contacts.length > 4096) throw Error('Rigid contact count exceeded.');
      if (contacts.length === 0) return;
      const kineticBefore = bodies.reduce(
        (sum, body) =>
          sum +
          0.5 * body.mass * dotVec3(body.velocity, body.velocity) +
          0.5 * dotVec3(body.angularMomentum, omega(body)),
        0,
      );
      const relative = (c: Contact<T>) =>
        subtractVec3(pointVelocity(c.b, c.point), pointVelocity(c.a, c.point));
      const impulse = (c: Contact<T>, j: Vec3) => {
        apply(c.a, c.pa, scaleVec3(j, -1), c.point);
        apply(c.b, c.pb, j, c.point);
      };
      for (let iteration = 0; iteration < options.solverIterations; iteration++) {
        for (const c of contacts) {
          yield progress('contact');
          const velocity = relative(c),
            denominator = dotVec3(c.normal, effective(c, c.normal));
          const next = Math.max(
            0,
            c.normalImpulse + (c.target - dotVec3(velocity, c.normal)) / denominator,
          );
          const delta = next - c.normalImpulse;
          c.normalImpulse = next;
          c.normalWork += delta * dotVec3(velocity, c.normal) + 0.5 * delta * delta * denominator;
          impulse(c, scaleVec3(c.normal, delta));
          if (c.friction === 0) continue;
          const current = relative(c),
            t1 = c.tangent1,
            t2 = c.tangent2;
          const k11 = dotVec3(t1, effective(c, t1)),
            k22 = dotVec3(t2, effective(c, t2)),
            k12 = dotVec3(t1, effective(c, t2));
          const determinant = k11 * k22 - k12 * k12;
          if (!(determinant > 0)) throw Error('Invalid tangent effective inertia.');
          const v1 = dotVec3(current, t1),
            v2 = dotVec3(current, t2);
          const old1 = dotVec3(c.tangentImpulse, t1),
            old2 = dotVec3(c.tangentImpulse, t2);
          const rhs1 = k11 * old1 + k12 * old2 - v1,
            rhs2 = k12 * old1 + k22 * old2 - v2;
          const diskSolution = (alpha: number) => {
            const determinant = (k11 + alpha) * (k22 + alpha) - k12 * k12;
            return [
              (rhs1 * (k22 + alpha) - rhs2 * k12) / determinant,
              (rhs2 * (k11 + alpha) - rhs1 * k12) / determinant,
            ];
          };
          const limit = c.friction * next;
          let solved = diskSolution(0);
          if (limit === 0) solved = [0, 0];
          else if (Math.hypot(...solved) > limit) {
            // Anisotropic tangent inertia needs the constrained quadratic solve;
            // radial clamping of an unconstrained impulse violates Coulomb KKT.
            let low = 0,
              high = Math.max(1, Math.hypot(rhs1, rhs2) / limit);
            for (let search = 0; search < 48; search++) {
              yield progress('contact');
              const middle = (low + high) / 2;
              if (Math.hypot(...diskSolution(middle)) > limit) low = middle;
              else high = middle;
            }
            solved = diskSolution(high);
          }
          const candidate = addVec3(scaleVec3(t1, solved[0]), scaleVec3(t2, solved[1]));
          const change = subtractVec3(candidate, c.tangentImpulse);
          c.tangentImpulse = candidate;
          c.frictionWork += dotVec3(change, current) + 0.5 * dotVec3(change, effective(c, change));
          impulse(c, change);
        }
        if (
          contacts.every((c) => {
            const speed = dotVec3(relative(c), c.normal) - c.target;
            const normalDone =
              c.normalImpulse > options.velocityTolerance
                ? Math.abs(speed) <= options.velocityTolerance
                : speed >= -options.velocityTolerance;
            if (!normalDone || c.friction === 0 || c.normalImpulse === 0) return normalDone;
            const v = relative(c),
              tangent = subtractVec3(v, scaleVec3(c.normal, dotVec3(v, c.normal)));
            const impulseLength = lengthVec3(c.tangentImpulse),
              limit = c.friction * c.normalImpulse;
            return impulseLength < limit - options.velocityTolerance
              ? lengthVec3(tangent) <= options.velocityTolerance
              : dotVec3(c.tangentImpulse, tangent) <= options.velocityTolerance &&
                  lengthVec3(crossVec3(c.tangentImpulse, tangent)) <=
                    options.velocityTolerance * Math.max(1, impulseLength);
          }) &&
          (contacts.every((c) => c.friction === 0) || iteration >= 3)
        )
          break;
        if (iteration + 1 === options.solverIterations)
          throw Error('Rigid contact solve did not converge.');
      }
      const normalWork = contacts.reduce((sum, c) => sum + (c.impact ? c.normalWork : 0), 0),
        frictionWork = contacts.reduce(
          (sum, c) => sum + (c.physicalFriction ? c.frictionWork : 0),
          0,
        );
      supportConstraintEnergy += contacts.reduce(
        (sum, c) => sum + (c.impact ? 0 : c.normalWork) + (c.physicalFriction ? 0 : c.frictionWork),
        0,
      );
      const roundoff =
        1e-8 * Math.max(1, kineticBefore, Math.abs(normalWork), Math.abs(frictionWork));
      if (frictionWork > roundoff || (impact && normalWork > roundoff))
        throw Error('Contact iteration generated unclassified energy.');
      if (
        impact &&
        contacts.every((c) => c.restitution === 1 && c.friction === 0) &&
        Math.abs(normalWork) > roundoff
      )
        throw Error('Elastic contact energy residual exceeds limit.');
      const impactLoss = impact ? Math.max(0, -normalWork) : 0,
        frictionLoss = Math.max(0, -frictionWork);
      const normalWeight = contacts.reduce((sum, c) => sum + (c.impact ? c.normalImpulse : 0), 0),
        frictionWeight = contacts.reduce(
          (sum, c) => sum + (c.physicalFriction ? lengthVec3(c.tangentImpulse) : 0),
          0,
        );
      for (const c of contacts)
        for (const parcel of [c.pa, c.pb]) {
          const row = heat.get(parcel.id)!;
          if (normalWeight > 0 && c.impact)
            row.impact += (0.5 * impactLoss * c.normalImpulse) / normalWeight;
          if (frictionWeight > 0 && c.physicalFriction)
            row.friction += (0.5 * frictionLoss * lengthVec3(c.tangentImpulse)) / frictionWeight;
        }
    }

    // Resolve authored impacts before gravity. Gravity support impulses are separate
    // from impact loss so a resting floor never creates heat from kick arithmetic.
    yield* project();
    yield* solve(true);
    const beforeFirstKick = kick(options.dt / 2);
    yield* solve(false, beforeFirstKick);
    let remaining = options.dt;
    while (remaining > 0) {
      let hit: number | null = null;
      for (let i = 0; i < bodies.length; i++)
        for (let j = i + 1; j < bodies.length; j++) {
          const a = bodies[i],
            b = bodies[j];
          if (skipPair(a, b)) continue;
          const swept = (body: Body<T>) => {
            const end = addVec3(body.center, scaleVec3(body.velocity, remaining));
            return {
              min: body.center.map(
                (v, axis) => Math.min(v, end[axis]) - body.radius,
              ) as unknown as Vec3,
              max: body.center.map(
                (v, axis) => Math.max(v, end[axis]) + body.radius,
              ) as unknown as Vec3,
            };
          };
          yield progress('sweep');
          if (!boundsOverlap(swept(a), swept(b))) continue;
          const rotating =
            lengthVec3(omega(a)) * remaining * a.radius > options.contactTolerance / 4 ||
            lengthVec3(omega(b)) * remaining * b.radius > options.contactTolerance / 4;
          for (const pa of a.members)
            for (const pb of b.members) {
              yield progress('sweep');
              const particleA = particleIds.has(pa.id),
                particleB = particleIds.has(pb.id);
              const time =
                rotating || particleA || particleB
                  ? rotationalAdvance(
                      a,
                      b,
                      pa,
                      pb,
                      remaining,
                      options.maxPenetration / 4,
                      particleA,
                      particleB,
                    )
                  : translationImpact(
                      pa,
                      pb,
                      subtractVec3(b.velocity, a.velocity),
                      remaining,
                      options.contactTolerance,
                    );
              if (time !== null && (hit === null || time < hit)) hit = time;
            }
        }
      if (hit === null) {
        drift(remaining);
        remaining = 0;
      } else {
        if (++events > options.maxEvents) throw Error('Rigid impact event limit exceeded.');
        if (hit < 0 || hit > remaining) throw Error('Invalid swept impact time.');
        drift(hit);
        remaining -= hit;
        yield* project();
        const previous = bodies.map((body) => [...body.velocity, ...body.angularMomentum]);
        yield* solve(true);
        if (
          hit === 0 &&
          bodies.every((body, i) =>
            [...body.velocity, ...body.angularMomentum].every((v, axis) => v === previous[i][axis]),
          )
        )
          throw Error('Unresolved zero-time swept contact.');
      }
    }
    const beforeLastKick = kick(options.dt / 2);
    yield* solve(false, beforeLastKick);
    for (const body of bodies) sync(body);

    // A declared graph model: each canonical spanning-tree cut is supported by
    // every original bond crossing that cut, including cycle edges. Demand combines
    // force and couple/rest-length. This is not continuum stress or elastic strain.
    for (const body of bodies) {
      const memberIds = new Set(body.members.map((p) => p.id)),
        localBonds = retained().filter((b) => memberIds.has(b.a) && memberIds.has(b.b));
      if (!localBonds.length) continue;
      const fixed = body.members.filter((p) => anchors.has(p.id));
      if (fixed.length) {
        // Each fixed parcel supports its own load locally. Share the remaining
        // force/couple equally between fixed parcels; each pin also fixes rotation.
        // This is a declared graph reaction convention, not elastic stress recovery.
        const free = body.members.filter((p) => !anchors.has(p.id));
        const force = free.reduce<Vec3>((sum, p) => addVec3(sum, external.get(p.id)!.linear), ZERO);
        const torque = free.reduce<Vec3>(
          (sum, p) =>
            addVec3(
              sum,
              addVec3(
                external.get(p.id)!.angular,
                crossVec3(subtractVec3(p.center, body.center), external.get(p.id)!.linear),
              ),
            ),
          ZERO,
        );
        for (const anchor of fixed) {
          const row = external.get(anchor.id)!;
          row.linear = scaleVec3(force, -1 / fixed.length);
          row.angular = subtractVec3(
            scaleVec3(torque, -1 / fixed.length),
            crossVec3(subtractVec3(anchor.center, body.center), row.linear),
          );
        }
      }
      const adjacency = new Map(body.members.map((p) => [p.id, [] as string[]]));
      for (const b of localBonds) {
        adjacency.get(b.a)!.push(b.b);
        adjacency.get(b.b)!.push(b.a);
      }
      for (const list of adjacency.values()) list.sort(lexical);
      const root = body.members[0].id,
        order = [root],
        parent = new Map<string, string>();
      for (let i = 0; i < order.length; i++)
        for (const next of adjacency.get(order[i])!)
          if (next !== root && !parent.has(next)) {
            parent.set(next, order[i]);
            order.push(next);
          }
      for (const child of order.slice(1)) {
        yield progress('fracture');
        const cut = new Set<string>([child]);
        for (const id of order) if (parent.has(id) && cut.has(parent.get(id)!)) cut.add(id);
        const crossing = localBonds.filter((b) => cut.has(b.a) !== cut.has(b.b));
        const pivot = scaleVec3(
          addVec3(byId.get(child)!.center, byId.get(parent.get(child)!)!.center),
          0.5,
        );
        let force: Vec3 = ZERO,
          torque: Vec3 = ZERO;
        for (const id of cut) {
          const p = byId.get(id)!,
            start = initial.get(id)!,
            applied = external.get(id)!;
          const demand = subtractVec3(
            subtractVec3(scaleVec3(p.velocity, p.mass), start.momentum),
            applied.linear,
          );
          force = addVec3(force, demand);
          torque = addVec3(
            torque,
            addVec3(
              crossVec3(subtractVec3(p.center, pivot), demand),
              subtractVec3(subtractVec3(p.intrinsicAngularMomentum, start.spin), applied.angular),
            ),
          );
        }
        const capacity = crossing.reduce((sum, b) => sum + b.strength, 0),
          lever = crossing.reduce((sum, b) => sum + b.restLength, 0) / crossing.length;
        if ((lengthVec3(force) + lengthVec3(torque) / lever) / options.dt > capacity)
          for (const b of crossing) broken.add(b);
      }
    }
    const afterEnergy = parcelEnergy(),
      afterMomentum = parcelMomentum();
    const numericalLinearMomentumResidual = addVec3(
      subtractVec3(subtractVec3(afterMomentum.linear, beforeMomentum.linear), gravityLinearImpulse),
      boundaryLinearImpulse,
    );
    const numericalAngularMomentumResidual = addVec3(
      subtractVec3(
        subtractVec3(afterMomentum.angular, beforeMomentum.angular),
        gravityAngularImpulse,
      ),
      boundaryAngularImpulse,
    );
    for (const vector of [
      afterMomentum.linear,
      afterMomentum.angular,
      gravityLinearImpulse,
      gravityAngularImpulse,
      boundaryLinearImpulse,
      boundaryAngularImpulse,
      numericalLinearMomentumResidual,
      numericalAngularMomentumResidual,
    ])
      assertFiniteVec3(vector, 'aggregate momentum receipt');
    const dissipatedEnergyByParcel = [...heat.values()].filter(
      (row) => row.impact > 0 || row.friction > 0,
    );
    const physicalHeat = dissipatedEnergyByParcel.reduce(
      (sum, row) => sum + row.impact + row.friction,
      0,
    );
    for (const parcel of parcels) readParcel(parcel);
    return {
      parcels,
      bonds: retained(),
      brokenBonds: bonds.filter((b) => broken.has(b)),
      components: componentIds(parcels, retained()),
      dissipatedEnergyByParcel,
      boundaryLinearImpulse,
      boundaryAngularImpulse,
      numericalEnergyResidual: finite(afterEnergy - beforeEnergy + physicalHeat),
      numericalLinearMomentumResidual,
      numericalAngularMomentumResidual,
      supportConstraintEnergy: finite(supportConstraintEnergy),
      report: { work, events, contacts: contactCount },
    };
  }
}
