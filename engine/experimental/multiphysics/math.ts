/** Float64 reference primitives. Elementary vector operations trust finite inputs. */
export type Vec3 = readonly [number, number, number];
/** Quaternion component order is x, y, z, w; orientation maps local to world space. */
export type Quat = readonly [number, number, number, number];
export const IDENTITY_QUATERNION: Quat = Object.freeze([0, 0, 0, 1]);

export const addVec3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const subtractVec3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scaleVec3 = (v: Vec3, scale: number): Vec3 => [
  v[0] * scale,
  v[1] * scale,
  v[2] * scale,
];
export const dotVec3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const crossVec3 = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const lengthVec3 = (v: Vec3): number => Math.hypot(...v);

export function assertFiniteVec3(v: Vec3, name = 'vector'): void {
  if (v.length !== 3 || ![v[0], v[1], v[2]].every(Number.isFinite))
    throw new Error(`Invalid finite ${name}.`);
}

export function normalizeVec3(v: Vec3): Vec3 {
  assertFiniteVec3(v);
  const scale = Math.max(...v.map(Math.abs));
  if (scale === 0) throw new Error('Cannot normalize a zero vector.');
  const scaled: Vec3 = [v[0] / scale, v[1] / scale, v[2] / scale];
  return scaleVec3(scaled, 1 / lengthVec3(scaled));
}

/** Normalize without overflow, and choose one representative of q and -q. */
export function normalizeQuaternion(q: Quat): Quat {
  if (q.length !== 4 || ![q[0], q[1], q[2], q[3]].every(Number.isFinite))
    throw new Error('Invalid finite quaternion.');
  const scale = Math.max(...q.map(Math.abs));
  if (scale === 0) throw new Error('Cannot normalize a zero quaternion.');
  const scaled = q.map((value) => value / scale);
  const sign = (scaled[3] || scaled[0] || scaled[1] || scaled[2]) < 0 ? -1 : 1;
  const norm = Math.hypot(...scaled);
  return scaled.map((value) => (value === 0 ? 0 : (sign * value) / norm)) as unknown as Quat;
}

/** Hamilton product: b acts first, followed by a. No implicit normalization. */
export function multiplyQuaternions(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a,
    [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function rotateVector(orientation: Quat, v: Vec3): Vec3 {
  assertFiniteVec3(v);
  const q = normalizeQuaternion(orientation),
    axis: Vec3 = [q[0], q[1], q[2]];
  const twiceCross = scaleVec3(crossVec3(axis, v), 2);
  const rotated = addVec3(v, addVec3(scaleVec3(twiceCross, q[3]), crossVec3(axis, twiceCross)));
  assertFiniteVec3(rotated, 'rotated vector');
  return rotated;
}

/** Exact constant-world-angular-velocity rotation, not a torque or rigid-body integrator. */
export function integrateOrientation(orientation: Quat, angularVelocity: Vec3, dt: number): Quat {
  const q = normalizeQuaternion(orientation);
  assertFiniteVec3(angularVelocity, 'angular velocity');
  if (!Number.isFinite(dt) || dt < 0) throw new Error('Invalid nonnegative time step.');
  if (dt === 0 || angularVelocity.every((value) => value === 0)) return q;
  const angle = lengthVec3(angularVelocity) * dt;
  if (!Number.isFinite(angle)) throw new Error('Angular displacement overflow.');
  const axis = normalizeVec3(angularVelocity),
    sine = Math.sin(angle / 2);
  const delta: Quat = [axis[0] * sine, axis[1] * sine, axis[2] * sine, Math.cos(angle / 2)];
  return normalizeQuaternion(multiplyQuaternions(delta, q));
}

export type CuboidMassProperties = {
  mass: number;
  /** Principal moments about the center of mass, in local axes. */
  inertia: Vec3;
  inverseInertia: Vec3;
};

export function cuboidMassProperties(halfExtents: Vec3, density: number): CuboidMassProperties {
  assertFiniteVec3(halfExtents, 'half extents');
  if (halfExtents.some((value) => value <= 0) || !Number.isFinite(density) || density <= 0) {
    throw new Error('Cuboid half extents and density must be positive.');
  }
  const [x, y, z] = halfExtents,
    mass = 8 * x * y * z * density;
  const inertia: Vec3 = [
    (mass * (y * y + z * z)) / 3,
    (mass * (x * x + z * z)) / 3,
    (mass * (x * x + y * y)) / 3,
  ];
  const inverseInertia: Vec3 = [1 / inertia[0], 1 / inertia[1], 1 / inertia[2]];
  if (
    ![mass, ...inertia, ...inverseInertia].every((value) => Number.isFinite(value) && value > 0)
  ) {
    throw new Error('Cuboid mass or inertia is outside the finite representable range.');
  }
  return { mass, inertia, inverseInertia };
}

/** R I^-1 R^T v. Zero principal inverse moments represent locked angular axes. */
export function applyWorldInverseInertia(orientation: Quat, inverseInertia: Vec3, v: Vec3): Vec3 {
  assertFiniteVec3(inverseInertia, 'inverse inertia');
  if (inverseInertia.some((value) => value < 0)) throw new Error('Negative inverse inertia.');
  const q = normalizeQuaternion(orientation);
  const local = rotateVector([-q[0], -q[1], -q[2], q[3]], v);
  return rotateVector(q, [
    local[0] * inverseInertia[0],
    local[1] * inverseInertia[1],
    local[2] * inverseInertia[2],
  ]);
}
