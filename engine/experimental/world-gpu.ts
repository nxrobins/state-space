/** Public finite-world factory. No writable GPU buffers cross this boundary. */
import { checkedInteger } from '../validation.js';
import { createResidentVolume, type GpuVolume3D } from './3d-gpu-core.js';
import { worldGeometry, referenceVolume, validateWorldFlat, validateWorldSnapshot, chunkSnapshot,
  type WorldOptions3D, type WorldSnapshot3D } from './world-core.js';
export type { TerrainCamera, TerrainRenderer, RegionRequest3D, Region3D, VolumeEdit3D, GpuStepOptions3D } from './3d-gpu-core.js';
export interface GpuWorld3D extends Omit<GpuVolume3D,'snapshot'|'restore'|'inspectPass'> {
  readonly chunkSize:number;
  snapshot():Promise<WorldSnapshot3D>;
  restore(snapshot:WorldSnapshot3D):Promise<void>;
  inspectPass(passIndex:number):Promise<WorldSnapshot3D>;
}
export async function createGpuWorld3D(options:WorldOptions3D={}):Promise<GpuWorld3D>{
  const g=worldGeometry(options),field=await createResidentVolume(referenceVolume(g.width,g.height,g.depth,options.fillMaterial).snapshot(),{chunkSize:g.chunkSize,cpu:referenceVolume,validate:validateWorldFlat});
  return Object.freeze({
    ...g,get tick(){return field.tick;},backendInfo:field.backendInfo,
    step:async(ticks=1,options={})=>{checkedInteger(ticks,0,32,'world ticks per request');return field.step(ticks,options);},queryRegion:field.queryRegion.bind(field),sample:field.sample.bind(field),setCell:field.setCell.bind(field),setEnergy:field.setEnergy.bind(field),energyBalance:field.energyBalance.bind(field),
    snapshot:async()=>chunkSnapshot(await field.snapshot(),g),
    restore:async(value:WorldSnapshot3D)=>{const flat=validateWorldSnapshot(value);await field.restore(flat);},
    inspectPass:async(index:number)=>chunkSnapshot(await field.inspectPass(index),g),
    createRenderer:field.createRenderer.bind(field),close:field.close.bind(field),
  });
}
