import { describe, expect, test } from 'vitest';
import {
  type Vec3,
  type Quat,
  IDENTITY_QUATERNION as I,
  addVec3,
  subtractVec3,
  scaleVec3,
  dotVec3,
  crossVec3,
  lengthVec3,
  normalizeVec3,
  normalizeQuaternion,
  multiplyQuaternions,
  rotateVector,
  integrateOrientation,
  cuboidMassProperties,
  applyWorldInverseInertia,
} from './math.js';
import {
  type OrientedCuboid,
  orientedCuboidContact,
  cuboidBounds,
  boundsOverlap,
  sweptCuboidBounds,
} from './collision.js';

const box = (
  center: Vec3 = [0, 0, 0],
  halfExtents: Vec3 = [1, 1, 1],
  orientation: Quat = I,
): OrientedCuboid => ({ center, halfExtents, orientation });
function close(actual: readonly number[], expected: readonly number[], digits = 12): void {
  expect(actual.length).toBe(expected.length);
  actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i], digits));
}
const rotation = (axis: Vec3, angle: number) => integrateOrientation(I, axis, angle);

// These are scalar reference kernels, not a world driver or runtime qualification.
describe('mechanical reference algebra', () => {
  test('right-handed vectors preserve the cross/dot identity without mutating inputs', () => {
    const a: Vec3 = Object.freeze([1, 2, 3]),
      b: Vec3 = Object.freeze([4, -2, 1]);
    expect(addVec3(a, b)).toEqual([5, 0, 4]);
    expect(subtractVec3(a, b)).toEqual([-3, 4, 2]);
    expect(scaleVec3(a, 2)).toEqual([2, 4, 6]);
    expect(dotVec3(a, b)).toBe(3);
    expect(crossVec3(a, b)).toEqual([8, 11, -10]);
    expect(dotVec3(crossVec3(a, b), a)).toBe(0);
    expect(dotVec3(crossVec3(a, b), b)).toBe(0);
    close(normalizeVec3([3, 0, 4]), [0.6, 0, 0.8]);
    close(normalizeVec3([1e308, 0, 1e308]), [Math.SQRT1_2, 0, Math.SQRT1_2]);
    expect(lengthVec3(a)).toBeCloseTo(Math.sqrt(14), 14);
    expect(a).toEqual([1, 2, 3]);
  });

  test('quaternion composition uses local-to-world orientation and world angular velocity', () => {
    const z90 = rotation([0, 0, 1], Math.PI / 2),
      x90 = rotation([1, 0, 0], Math.PI / 2);
    close(rotateVector(z90, [1, 0, 0]), [0, 1, 0]);
    close(rotateVector(multiplyQuaternions(z90, x90), [0, 1, 0]), [0, 0, 1]);
    // A world-X rotation takes the already world-Y local X axis to world Z.
    close(rotateVector(integrateOrientation(z90, [1, 0, 0], Math.PI / 2), [1, 0, 0]), [0, 0, 1]);
    close(normalizeQuaternion([0, 0, -1e308, -1e308]), [0, 0, Math.SQRT1_2, Math.SQRT1_2]);
    close(rotateVector([0, 0, -2, -2], [1, 0, 0]), [0, 1, 0]);
    expect(integrateOrientation([0, 0, 0, -2], [1, 0, 0], 0)).toEqual(I);
    expect(integrateOrientation(I, [0, 0, 0], 1)).toEqual(I);
    let stepped: Quat = I;
    for (let step = 0; step < 20; step++) stepped = integrateOrientation(stepped, [0, 0, 3], 0.025);
    close(stepped, integrateOrientation(I, [0, 0, 3], 0.5));
    expect(Math.hypot(...stepped)).toBeCloseTo(1, 14);
  });

  test('cuboid moments and rotated inverse tensor agree with analytical principal axes', () => {
    const body = cuboidMassProperties([1, 2, 3], 2);
    expect(body.mass).toBe(96);
    expect(body.inertia).toEqual([416, 320, 160]);
    close(body.inverseInertia, [1 / 416, 1 / 320, 1 / 160]);
    const z90 = rotation([0, 0, 1], Math.PI / 2);
    close(applyWorldInverseInertia(z90, body.inverseInertia, [320, 416, 160]), [1, 1, 1]);
    const z45 = rotation([0, 0, 1], Math.PI / 4);
    close(applyWorldInverseInertia(z45, [2, 4, 8], [1, 0, 0]), [3, -1, 0]);
    expect(applyWorldInverseInertia(I, [0, 0, 0], [1, 2, 3])).toEqual([0, 0, 0]);
    const doubled = cuboidMassProperties([2, 4, 6], 2);
    expect(doubled.mass).toBe(8 * body.mass);
    close(doubled.inertia, scaleVec3(body.inertia, 32));
  });

  test('invalid, zero and unrepresentable physical parameters fail explicitly', () => {
    for (const vector of [
      [0, 0, 0],
      [NaN, 0, 0],
      [Infinity, 1, 1],
    ] as Vec3[]) {
      expect(() => normalizeVec3(vector)).toThrow();
    }
    expect(() => normalizeVec3(new Array(3) as unknown as Vec3)).toThrow();
    expect(() => normalizeQuaternion(new Array(4) as unknown as Quat)).toThrow();
    for (const quaternion of [
      [0, 0, 0, 0],
      [0, NaN, 0, 1],
      [0, 0, 1, Infinity],
    ] as Quat[]) {
      expect(() => normalizeQuaternion(quaternion)).toThrow();
      expect(() => integrateOrientation(quaternion, [0, 0, 0], 0)).toThrow();
    }
    for (const dt of [-1, NaN, Infinity])
      expect(() => integrateOrientation(I, [0, 1, 0], dt)).toThrow();
    expect(() => integrateOrientation(I, [0, Infinity, 0], 0)).toThrow();
    expect(() => integrateOrientation(I, [1e308, 1e308, 1e308], 10)).toThrow();
    for (const density of [0, -1, NaN, Infinity])
      expect(() => cuboidMassProperties([1, 1, 1], density)).toThrow();
    for (const halfExtents of [
      [0, 1, 1],
      [-1, 1, 1],
      [1e308, 1, 1],
      [1e-300, 1e-300, 1e-300],
    ] as Vec3[]) {
      expect(() => cuboidMassProperties(halfExtents, 1)).toThrow();
    }
    expect(() => applyWorldInverseInertia(I, [-1, 1, 1], [1, 0, 0])).toThrow();
  });
});

describe('oriented cuboid reference contact', () => {
  test('separation, face contact, penetration and containment have analytical depths', () => {
    expect(orientedCuboidContact(box(), box([2.01, 0, 0]))).toBeNull();
    const touching = orientedCuboidContact(box(), box([2, 0, 0]))!;
    expect(touching.normal).toEqual([1, 0, 0]);
    expect(touching.depth).toBe(0);
    close(touching.point, [1, 0, 0]);
    const contact = orientedCuboidContact(box(), box([1.5, 0.8, 0]))!;
    close(contact.normal, [1, 0, 0]);
    expect(contact.depth).toBe(0.5);
    close(contact.point, [0.75, 0.4, 0]);
    const contained = orientedCuboidContact(box(), box([0, 0, 0], [0.25, 0.5, 0.75]))!;
    expect(contained.depth).toBe(1.25);
    expect(contained.normal).toEqual([1, 0, 0]);
    close(contained.point, [0, 0, 0]);
    // A support-face-center average alone would lie outside this small upper box.
    const unequal = orientedCuboidContact(box([0, 0, 0], [1, 10, 1]), box([1.5, 9, 0]))!;
    expect(unequal.point[1]).toBeGreaterThanOrEqual(8);
    expect(unequal.point[1]).toBeLessThanOrEqual(10);
  });

  test('argument reversal and quaternion sign preserve contact geometry', () => {
    const a = box([0, 0, 0], [1.5, 0.5, 0.8], rotation([0, 0, 1], Math.PI / 5));
    const b = box([1.4, 0.7, 0.1], [0.7, 0.9, 0.6], rotation([0, 1, 0], Math.PI / 7));
    const ab = orientedCuboidContact(a, b)!,
      ba = orientedCuboidContact(b, a)!;
    expect(ab).not.toBeNull();
    expect(ba).not.toBeNull();
    close(ab.normal, scaleVec3(ba.normal, -1));
    expect(ab.depth).toBeCloseTo(ba.depth, 13);
    expect(ab.point).toEqual(ba.point);
    const flipped = { ...b, orientation: b.orientation.map((value) => -value) as unknown as Quat };
    expect(orientedCuboidContact(a, flipped)).toEqual(ab);
    // Geometric coincidence has no meaningful A→B direction; its canonical tie is explicit.
    expect(orientedCuboidContact(box(), box())!.normal).toEqual([1, 0, 0]);
  });

  test('edge cross axes detect skew separation that all six face axes miss', () => {
    const q = multiplyQuaternions(
      rotation([0, 0, 1], Math.PI / 4),
      rotation([0, 1, 0], Math.PI / 4),
    );
    const a = box([0, 0, 0], [2, 0.1, 0.1]);
    const separation = scaleVec3([0, Math.sqrt(2 / 3), Math.sqrt(1 / 3)], 0.4);
    const b = box(separation, [2, 0.1, 0.2], q);
    expect(boundsOverlap(cuboidBounds(a), cuboidBounds(b))).toBe(true);
    const axes = ([I, q] as Quat[]).flatMap((orientation) =>
      (
        [
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
        ] as Vec3[]
      ).map((axis) => rotateVector(orientation, axis)),
    );
    // Independent face projection by enumerating vertices, not the SAT radius formula.
    const corners = (shape: OrientedCuboid): Vec3[] =>
      Array.from({ length: 8 }, (_, bits) =>
        addVec3(
          shape.center,
          rotateVector(
            shape.orientation,
            shape.halfExtents.map((v, i) => (bits & (1 << i) ? v : -v)) as unknown as Vec3,
          ),
        ),
      );
    for (const axis of axes) {
      const pa = corners(a).map((v) => dotVec3(v, axis)),
        pb = corners(b).map((v) => dotVec3(v, axis));
      expect(
        Math.min(Math.max(...pa), Math.max(...pb)) - Math.max(Math.min(...pa), Math.min(...pb)),
      ).toBeGreaterThan(0);
    }
    expect(orientedCuboidContact(a, b)).toBeNull();
    expect(orientedCuboidContact(a, { ...b, center: scaleVec3(separation, 0.5) })).not.toBeNull();
  });

  test('bounds cover rotation and the swept bound covers intermediate orientations', () => {
    const body = box([2, 3, 4], [2, 1, 0.5], rotation([0, 0, 1], Math.PI / 2));
    close(cuboidBounds(body).min, [1, 1, 3.5]);
    close(cuboidBounds(body).max, [3, 5, 4.5]);
    const end: Vec3 = [8, -1, 5],
      swept = sweptCuboidBounds(body, end);
    const middle = box(
      scaleVec3(addVec3(body.center, end), 0.5),
      body.halfExtents,
      rotation([1, 0, 0], Math.PI / 4),
    );
    for (const pose of [body, { ...body, center: end }, middle]) {
      const bounds = cuboidBounds(pose);
      bounds.min.forEach((v, i) => expect(v).toBeGreaterThanOrEqual(swept.min[i]));
      bounds.max.forEach((v, i) => expect(v).toBeLessThanOrEqual(swept.max[i]));
    }
    expect(() => boundsOverlap({ min: [1, 0, 0], max: [0, 1, 1] }, cuboidBounds(body))).toThrow();
    for (const invalid of [
      box([NaN, 0, 0]),
      box([0, 0, 0], [0, 1, 1]),
      box([0, 0, 0], [1, 1, 1], [0, 0, 0, 0]),
    ]) {
      expect(() => orientedCuboidContact(body, invalid)).toThrow();
      expect(() => cuboidBounds(invalid)).toThrow();
      expect(() => sweptCuboidBounds(invalid, end)).toThrow();
    }
  });
});
