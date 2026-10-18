export { createSlabController } from './controller.js';
export { createSlabInitial, createSlabSession, createSlabPolicy, prepareSlabCommand, readSlabCommand, readSlabRequest, inspectSlab,
  SLAB_RULES, SLAB_WORLD, SLAB_HOLD, SLAB_LIMITS, SLAB_AIR_IMPULSES } from './scenario.js';
export type { SlabCommand, SlabGame, SlabSnapshot, SlabAirCommand, SlabWindCommand } from './scenario.js';
export { installSlabWorker } from './worker.js';
export { prepareSlabScene } from './presentation.js';
export { createSlabUIModel, parseSlabSave, SLAB_SAVE_BYTES } from './ui-model.js';
export type { SlabUIModel, SlabClient } from './ui-model.js';
export { createSlabRuntimeGuard, createSlabFramePump, slabOrbitCamera } from './ui-runtime.js';
export { openSlabUIRuntime } from './ui-host.js';
export { mountSlabUI } from './ui-app.js';
