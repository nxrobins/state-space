import {
  type Vec3,
  type Quat,
  addVec3,
  subtractVec3,
  scaleVec3,
  dotVec3,
  crossVec3,
  normalizeVec3,
  assertFiniteVec3,
  normalizeQuaternion,
  rotateVector,
} from './math.js';

export type OrientedCuboid = { center: Vec3; halfExtents: Vec3; orientation: Quat };
export type AxisAlignedBounds = { min: Vec3; max: Vec3 };
export type CuboidContact = {
  /** From a toward b. Coincident centers use a canonical axis sign. */
  normal: Vec3;
  depth: number;
  /** Representative overlap point, not a contact manifold or impulse constraint. */
  point: Vec3;
};
type PreparedCuboid = OrientedCuboid & { axes: readonly [Vec3, Vec3, Vec3] };

function prepare(shape: OrientedCuboid): PreparedCuboid {
  assertFiniteVec3(shape.center, 'center');
  assertFiniteVec3(shape.halfExtents, 'half extents');
  if (shape.halfExtents.some((value) => value <= 0))
    throw new Error('Cuboid half extents must be positive.');
  const orientation = normalizeQuaternion(shape.orientation);
  return {
    ...shape,
    orientation,
    axes: [
      rotateVector(orientation, [1, 0, 0]),
      rotateVector(orientation, [0, 1, 0]),
      rotateVector(orientation, [0, 0, 1]),
    ],
  };
}

function radius(shape: PreparedCuboid, axis: Vec3): number {
  return shape.axes.reduce(
    (sum, local, i) => sum + Math.abs(dotVec3(axis, local)) * shape.halfExtents[i],
    0,
  );
}

function canonicalAxis(axis: Vec3): Vec3 {
  const unit = normalizeVec3(axis),
    sign = (unit[0] || unit[1] || unit[2]) < 0 ? -1 : 1;
  return unit.map((value) => (value === 0 ? 0 : sign * value)) as unknown as Vec3;
}

function comparePoints(a: Vec3, b: Vec3): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

function vertices(shape: PreparedCuboid): Vec3[] {
  return Array.from({ length: 8 }, (_, bits) =>
    shape.axes.reduce<Vec3>(
      (point, axis, i) =>
        addVec3(point, scaleVec3(axis, (bits & (1 << i) ? 1 : -1) * shape.halfExtents[i])),
      shape.center,
    ),
  );
}

/** Clip one box edge to the other box. Both endpoints are inside the intersection. */
function clippedEdge(start: Vec3, end: Vec3, target: PreparedCuboid): Vec3[] {
  const offset = subtractVec3(start, target.center),
    direction = subtractVec3(end, start);
  let enter = 0,
    exit = 1;
  for (let i = 0; i < 3; i++) {
    const origin = dotVec3(offset, target.axes[i]),
      speed = dotVec3(direction, target.axes[i]);
    const extent = target.halfExtents[i];
    if (speed === 0) {
      if (Math.abs(origin) > extent) return [];
    } else {
      const t0 = (-extent - origin) / speed,
        t1 = (extent - origin) / speed;
      enter = Math.max(enter, Math.min(t0, t1));
      exit = Math.min(exit, Math.max(t0, t1));
      if (enter > exit) return [];
    }
  }
  return [addVec3(start, scaleVec3(direction, enter)), addVec3(start, scaleVec3(direction, exit))];
}

function representativePoint(a: PreparedCuboid, b: PreparedCuboid, normal: Vec3): Vec3 {
  const points: Vec3[] = [];
  for (const [source, target] of [
    [a, b],
    [b, a],
  ]) {
    const corners = vertices(source);
    for (let bits = 0; bits < 8; bits++)
      for (let axis = 0; axis < 3; axis++) {
        if (!(bits & (1 << axis)))
          points.push(...clippedEdge(corners[bits], corners[bits | (1 << axis)], target));
      }
  }
  // Sorting makes the arithmetic order independent of argument order. The convex
  // average lies in the intersection; it is not the physical contact patch centroid.
  points.sort(comparePoints);
  if (points.length)
    return points.reduce<Vec3>(
      (sum, p) => addVec3(sum, scaleVec3(p, 1 / points.length)),
      [0, 0, 0],
    );
  // SAT admits roundoff-scale gaps as touching. Such boxes may have no intersection.
  return addVec3(
    scaleVec3(a.center, 0.5),
    addVec3(
      scaleVec3(b.center, 0.5),
      scaleVec3(normal, (radius(a, normal) - radius(b, normal)) / 2),
    ),
  );
}

/**
 * Reference 15-axis SAT. Stable axis ties are independent of argument order.
 * Roundoff-scale gaps count as touching. This supplies one overlap point only:
 * stacks need a persistent clipped manifold, and fast bodies need a time-of-impact solver.
 */
export function orientedCuboidContact(a: OrientedCuboid, b: OrientedCuboid): CuboidContact | null {
  const first = prepare(a),
    second = prepare(b),
    offset = subtractVec3(b.center, a.center);
  assertFiniteVec3(offset, 'relative center');
  const axes = [...first.axes, ...second.axes];
  for (const x of first.axes)
    for (const y of second.axes) {
      const axis = crossVec3(x, y);
      if (axis.some((value) => value !== 0)) axes.push(axis);
    }
  const candidates = axes.map(canonicalAxis).sort((x, y) => comparePoints(y, x));
  let depth = Infinity,
    normal: Vec3 = [1, 0, 0];
  for (const axis of candidates) {
    const distance = dotVec3(offset, axis),
      reach = radius(first, axis) + radius(second, axis);
    if (!Number.isFinite(distance) || !Number.isFinite(reach))
      throw new Error('Cuboid projection overflow.');
    const overlap = reach - Math.abs(distance),
      tolerance = 64 * Number.EPSILON * Math.max(1, reach, Math.abs(distance));
    if (overlap < -tolerance) return null;
    if (overlap < depth - tolerance) {
      depth = Math.max(0, overlap);
      const sign = (distance || offset[0] || offset[1] || offset[2]) < 0 ? -1 : 1;
      normal = scaleVec3(axis, sign);
    }
  }
  const point = representativePoint(first, second, normal);
  assertFiniteVec3(point, 'contact point');
  return { normal, depth, point };
}

export function cuboidBounds(shape: OrientedCuboid): AxisAlignedBounds {
  const body = prepare(shape),
    extent: Vec3 = [radius(body, [1, 0, 0]), radius(body, [0, 1, 0]), radius(body, [0, 0, 1])];
  const bounds = { min: subtractVec3(body.center, extent), max: addVec3(body.center, extent) };
  validateBounds(bounds);
  return bounds;
}

function validateBounds(bounds: AxisAlignedBounds): void {
  assertFiniteVec3(bounds.min, 'minimum bounds');
  assertFiniteVec3(bounds.max, 'maximum bounds');
  if (bounds.min.some((value, i) => value > bounds.max[i])) throw new Error('Inverted bounds.');
}

export function boundsOverlap(a: AxisAlignedBounds, b: AxisAlignedBounds): boolean {
  validateBounds(a);
  validateBounds(b);
  return a.min.every((value, i) => value <= b.max[i] && a.max[i] >= b.min[i]);
}

/** Conservative broadphase bound for linear center travel and arbitrary rotation.
 * The circumscribed sphere encloses every orientation, but gives no time of impact.
 */
export function sweptCuboidBounds(shape: OrientedCuboid, endCenter: Vec3): AxisAlignedBounds {
  prepare(shape);
  assertFiniteVec3(endCenter, 'end center');
  const radius = Math.hypot(...shape.halfExtents);
  const bounds: AxisAlignedBounds = {
    min: shape.center.map((value, i) => Math.min(value, endCenter[i]) - radius) as unknown as Vec3,
    max: shape.center.map((value, i) => Math.max(value, endCenter[i]) + radius) as unknown as Vec3,
  };
  validateBounds(bounds);
  return bounds;
}
