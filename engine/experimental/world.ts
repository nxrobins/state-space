/** Finite world SDK. Physics and storage implementation helpers stay private. */
export {
  MAT,
  PHASE,
  MATERIALS_3D,
  MAX_ENERGY_Q,
  RULES_VERSION_3D,
  WORLD_VERSION_3D,
  MAX_WORLD_CELLS_3D,
  createStateSpaceWorld3D,
  validateWorldSnapshot,
  CpuWorld3D,
} from './world-core.js';
export type {
  WorldOptions3D,
  WorldGeometry3D,
  WorldChunk3D,
  WorldSnapshot3D,
} from './world-core.js';
