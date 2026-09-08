/** Supported browser/Node package entry point. */
export { createStateSpaceField, packVoxel, unpackVoxel, defaultPhase, defaultThermal, materialName } from './browser_state_space.js';
export type { StateSpaceField, FieldSample, VoxelState } from './browser_state_space.js';
export { createGpuField } from './webgpu_field.js';
export type { GpuStateSpaceField, GpuFieldOptions } from './webgpu_field.js';
export { DEFAULT_REGISTRY, createMaterialRegistry } from './registry.js';
export type { MaterialRegistry, MaterialCatalog, MaterialDefinition } from './registry.js';
export { validateSnapshot } from './contracts.js';
export type { PackedSnapshot } from './contracts.js';
export type { PassReport, CellChange, StepOptions } from './inspection.js';
export { ENERGY_SCALE, MAX_ENERGY_Q } from './thermal.js';
export type { StructuralPlan, ComponentReport, StructuralState } from './structure.js';
export { createPhysicsState } from './structure.js';
export { MAT, PHASE, FLAG, SCHEMA_VERSION, RULES_VERSION } from './generated/materials.js';
export { STRUCTURE_BOND_LEFT_MASK, STRUCTURE_BOND_RIGHT_MASK, STRUCTURE_BOND_UP_MASK, STRUCTURE_BOND_DOWN_MASK } from './generated/materials.js';
