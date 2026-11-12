// Private benchmark bridge. Building this module never evaluates it.
// It is deliberately absent from package exports and ordinary test discovery.
export {
  createRigidStep3D,
  rigidAssemblyMassProperties3D,
  validateRigidAssemblyMotion3D,
} from '../../engine/experimental/multiphysics/rigid.js';
export { cuboidMassProperties, rotateVector } from '../../engine/experimental/multiphysics/math.js';
export { createMultiphysicsProfiles3D } from '../../engine/experimental/multiphysics/profiles.js';
export { seedThermalParcel3D } from '../../engine/experimental/multiphysics/thermal.js';
export { createMultiphysicsSnapshot3D } from '../../engine/experimental/multiphysics/model.js';
export { createMultiphysicsWorld3D } from '../../engine/experimental/multiphysics/world.js';
