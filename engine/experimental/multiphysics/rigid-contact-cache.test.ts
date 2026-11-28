import { expect, test } from 'vitest';
import { cacheRigidContactGeometry } from './rigid-contact-cache.js';
import type { Quat, Vec3 } from './math.js';

test('only an identical ordered pair, owned pose and tolerance can reuse contact geometry', () => {
  const parcels = Array.from({ length: 32 }, () => ({
    center: [0, 0, 0] as Vec3,
    orientation: [0, 0, 0, 1] as Quat,
    halfExtents: [1, 1, 1] as Vec3,
  }));
  const [a, b] = parcels;
  let calls = 0;
  const box = cacheRigidContactGeometry(parcels, (x, y, tolerance) => {
    calls++;
    return tolerance === 0 ? null : { normal: x.center, depth: y.center[0] };
  });
  expect(box(a, b, 0)).toBeNull();
  expect(box(a, b, 0)).toBeNull();
  const hit = box(a, b, 1e-8);
  expect(box(a, b, 1e-8)).toBe(hit);
  expect(box(a, b, 0)).toBeNull();
  expect(calls).toBe(2);
  expect(box(b, a, 1e-8)).not.toBe(hit);
  expect(box(a, b, 2e-8)).not.toBe(hit);
  for (const parcel of [a, b]) {
    let old = box(a, b, 1e-8);
    parcel.center = [-0, 0, 0];
    expect(box(a, b, 1e-8)).not.toBe(old);
    old = box(a, b, 1e-8);
    parcel.orientation = [0, 0, 1, 0];
    expect(box(a, b, 1e-8)).not.toBe(old);
    old = box(a, b, 1e-8);
    parcel.halfExtents = [2, 1, 1];
    expect(box(a, b, 1e-8)).not.toBe(old);
  }
  // Pair 513 collides with pair 1 at capacity. Even shared pose arrays cannot alias a pair.
  const other = parcels[16];
  Object.assign(other, a);
  const before = box(a, b, 1e-8);
  expect(box(other, b, 1e-8)).not.toBe(before);
  expect(box(a, b, 1e-8)).not.toBe(before);
});
