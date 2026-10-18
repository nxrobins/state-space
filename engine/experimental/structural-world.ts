/** Experimental M5 API: separate rules and snapshot envelope from M1-M4. */
export { createStateSpaceStructuralWorld3D, validateStructuralSnapshot3D, STRUCTURAL_SCHEMA_VERSION_3D,
  STRUCTURAL_RULES_VERSION_3D, STRUCTURAL_WORLD_VERSION_3D } from './structural-world-core.js';
export type { CpuStructuralWorld3D, StructuralWorldOptions3D, StructuralSnapshot3D, StructuralEdit3D, StructuralStepOptions3D } from './structural-world-core.js';
export { MAT, PHASE, MATERIALS_3D, ENERGY_SCALE, MAX_ENERGY_Q, MATERIAL_CATALOG_HASH_3D } from './3d.js';
export { INTEGRITY_3D, BONDS_3D, ANCHOR_3D } from './structural-mechanics.js';
export type { StructuralState3D, StructuralPlan3D } from './structural-mechanics.js';
export { MOTION_PATH_RULES_3D, MOTION_PATH_LIMITS_3D, readMotionPaths3D } from './motion-paths.js';
export type { MaterialMotionPaths3D, MaterialMotionPathsResult3D, MotionPathPass3D, MotionPathSegment3D, MotionPathOptions3D } from './motion-paths.js';
