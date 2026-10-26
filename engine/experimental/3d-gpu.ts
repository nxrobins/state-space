/** Experimental M2 volume factory; world storage is a separate entry point. */
import { createStateSpaceField3D, validateVolumeSnapshot } from './3d.js';
import { createResidentVolume } from './volume/3d-gpu-core.js';
export type {
  LatencyRecord,
  LatencySnapshot,
  RegionRequest3D,
  Region3D,
  VolumeEdit3D,
  GpuStepOptions3D,
  GpuVolume3D,
  TerrainCamera,
  TerrainRenderer,
  TerrainAppearance,
  TerrainLightingMode,
  TerrainStyleOptions,
  TerrainStyleSettings,
  TerrainStyleProfile,
  TerrainStyleColor,
} from './volume/3d-gpu-core.js';
export async function createGpuField3D(
  width: number,
  height: number,
  depth: number,
  fillMaterial: number = 0,
  options: { profiling?: boolean; gpuTiming?: boolean } = {},
) {
  if (options.profiling !== undefined && typeof options.profiling !== 'boolean')
    throw new Error('Invalid profiling option.');
  if (options.gpuTiming !== undefined && typeof options.gpuTiming !== 'boolean')
    throw new Error('Invalid GPU timing option.');
  const initial = createStateSpaceField3D(width, height, depth, fillMaterial).snapshot();
  return createResidentVolume(initial, {
    chunkSize: 0,
    profiling: options.profiling,
    gpuTiming: options.gpuTiming,
    cpu: createStateSpaceField3D,
    validate: validateVolumeSnapshot,
  });
}
