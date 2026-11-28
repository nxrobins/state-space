import type { Quat, Vec3 } from './math.js';

type Pose = { center: Vec3; orientation: Quat; halfExtents: Vec3 };
type Contact = { normal: Vec3; depth: number } | null;
type Entry = {
  pair: number;
  tolerance: number;
  centerA: Vec3;
  centerB: Vec3;
  rotationA: Quat;
  rotationB: Quat;
  extentsA: Vec3;
  extentsB: Vec3;
  contact: Contact;
};

/** The rigid step owns these parcels. Projection and drift replace pose arrays;
 * velocity, impulses and solver iterations do not change contact geometry.
 * Slots are bounded even when a large step visits every possible pair. */
export function cacheRigidContactGeometry<T extends Pose>(
  parcels: readonly T[],
  compute: (a: T, b: T, tolerance: number) => Contact,
): (a: T, b: T, tolerance: number) => Contact {
  const index = new Map(parcels.map((parcel, i) => [parcel, i]));
  const slots: Entry[] = [];
  return (a, b, tolerance) => {
    const pair = index.get(a)! * parcels.length + index.get(b)!;
    // Keep projection (zero tolerance) and the contact skin in separate slots.
    const slot = (2 * pair + Number(tolerance !== 0)) % 1024;
    const last = slots[slot];
    if (
      last &&
      last.pair === pair &&
      last.tolerance === tolerance &&
      last.centerA === a.center &&
      last.centerB === b.center &&
      last.rotationA === a.orientation &&
      last.rotationB === b.orientation &&
      last.extentsA === a.halfExtents &&
      last.extentsB === b.halfExtents
    )
      return last.contact;
    const contact = compute(a, b, tolerance);
    slots[slot] = {
      pair,
      tolerance,
      centerA: a.center,
      centerB: b.center,
      rotationA: a.orientation,
      rotationB: b.orientation,
      extentsA: a.halfExtents,
      extentsB: b.halfExtents,
      contact,
    };
    return contact;
  };
}
