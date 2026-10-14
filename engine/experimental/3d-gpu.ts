/** Experimental M2 volume factory; world storage is a separate entry point. */
import { createStateSpaceField3D, validateVolumeSnapshot } from './3d.js';
import { createResidentVolume } from './3d-gpu-core.js';
export type { RegionRequest3D, Region3D, VolumeEdit3D, GpuStepOptions3D, GpuVolume3D, TerrainCamera, TerrainRenderer } from './3d-gpu-core.js';
export async function createGpuField3D(width:number,height:number,depth:number,fillMaterial:number=0) {
  const initial=createStateSpaceField3D(width,height,depth,fillMaterial).snapshot();
  return createResidentVolume(initial,{chunkSize:0,cpu:createStateSpaceField3D,validate:validateVolumeSnapshot});
}
