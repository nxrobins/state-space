import { assertRecordFields } from '../../portable-data.js';
import { addVec3, assertFiniteVec3, type Vec3 } from './math.js';
import { isRigidMaterial3D, MULTIPHYSICS_RULES_3D, type MultiphysicsSnapshot3D } from './model.js';
import type { MultiphysicsProfiles3D } from './profiles.js';

/** External impulse through the center of one free solid. World edits own the inventory receipt. */
export function applyCenterImpulse3D(
  profiles: MultiphysicsProfiles3D,
  state: MultiphysicsSnapshot3D,
  edit: { kind: 'impulse'; id: string; impulse: Vec3 },
): void {
  if (state.rules !== MULTIPHYSICS_RULES_3D) throw Error('Unknown multiphysics edit.');
  assertRecordFields(edit, ['kind', 'id', 'impulse'], [], 'Invalid impulse edit.');
  if (!Array.isArray(edit.impulse)) throw Error('Impulse requires a finite 3-vector.');
  assertFiniteVec3(edit.impulse, 'impulse');
  const unit = state.parcels.find((p) => p.id === edit.id);
  if (
    !unit ||
    !isRigidMaterial3D(profiles, unit) ||
    state.anchors.includes(unit.id) ||
    state.bonds.some((b) => b.a === unit.id || b.b === unit.id)
  )
    throw Error('Impulse requires one free solid parcel.');
  const [x, y, z] = edit.impulse;
  unit.velocity = addVec3(unit.velocity, [x / unit.mass, y / unit.mass, z / unit.mass]);
  assertFiniteVec3(unit.velocity, 'resulting velocity');
}
