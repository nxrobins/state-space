/** Experimental M1/M2 bounded-volume API. World internals are deliberately separate. */
export { MAT, PHASE, ENERGY_SCALE, MAX_ENERGY_Q, SCHEMA_VERSION_3D, RULES_VERSION_3D,
  MAX_CELLS_3D, MATERIAL_CATALOG_HASH_3D, MATERIALS_3D, volumeSchedule, runVolumePass,
  createStateSpaceField3D } from './3d-core.js';
export type { VolumeState, VolumeSnapshot, VolumeSample, StateSpaceField3D, VolumePass } from './3d-core.js';
import { validateVolumeSnapshot as validate } from './3d-core.js';
import type { VolumeSnapshot } from './3d-core.js';
export function validateVolumeSnapshot(value: VolumeSnapshot) { return validate(value); }
