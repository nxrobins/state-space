/** M4 resident worlds. Dense execution is an exact diagnostic reference. */
import { checkedInteger } from '../validation.js';
import { createResidentVolume,type GpuVolume3D } from './3d-gpu-core.js';
import { activeWorldGeometry,activeReferenceVolume,validateActiveWorldFlat,validateActiveWorldSnapshot,activeChunkSnapshot,
  type ActiveWorldOptions3D,type ActiveWorldSnapshot3D } from './active-world-core.js';
export type { LatencyRecord, LatencySnapshot, Activity3D, TerrainCamera, TerrainRenderer, TerrainAppearance, TerrainLightingMode, RegionRequest3D, Region3D, VolumeEdit3D, GpuStepOptions3D } from './3d-gpu-core.js';
export type { GameplayState3D, GameplayRules3D, GameplayCommand3D, GameplayPresentation3D, GameplayCommit3D, ResidentGameplay3D } from './gameplay-view.js';
export type ActiveGpuWorldOptions3D=ActiveWorldOptions3D&{execution?:'dense'|'sparse';activityReadbackInterval?:number;profiling?:boolean;gpuTiming?:boolean};
export interface GpuActiveWorld3D extends Omit<GpuVolume3D,'snapshot'|'restore'|'inspectPass'> {
  readonly chunkSize:number;readonly execution:'dense'|'sparse';
  snapshot():Promise<ActiveWorldSnapshot3D>;restore(snapshot:ActiveWorldSnapshot3D):Promise<void>;inspectPass(index:number):Promise<ActiveWorldSnapshot3D>;
}
export async function createGpuActiveWorld3D(options:ActiveGpuWorldOptions3D={}):Promise<GpuActiveWorld3D>{
  const {execution='sparse',activityReadbackInterval=0,profiling,gpuTiming,...shape}=options;if(!['dense','sparse'].includes(execution))throw new Error('Invalid world execution mode.');
  if(profiling!==undefined&&typeof profiling!=='boolean')throw new Error('Invalid profiling option.');
  if(gpuTiming!==undefined&&typeof gpuTiming!=='boolean')throw new Error('Invalid GPU timing option.');
  checkedInteger(activityReadbackInterval,0,3600,'activity readback interval');
  const g=activeWorldGeometry(shape),field=await createResidentVolume(activeReferenceVolume(g.width,g.height,g.depth,shape.fillMaterial).snapshot(),{chunkSize:g.chunkSize,sparse:execution==='sparse',activityReadbackInterval,profiling,gpuTiming,cpu:activeReferenceVolume,validate:validateActiveWorldFlat});
  return Object.freeze({
    ...g,execution,get tick(){return field.tick;},backendInfo:field.backendInfo,
    step:async(ticks=1,options={})=>{checkedInteger(ticks,0,32,'world ticks per request');return field.step(ticks,options);},queryRegion:field.queryRegion.bind(field),sample:field.sample.bind(field),setCell:field.setCell.bind(field),setEnergy:field.setEnergy.bind(field),energyBalance:field.energyBalance.bind(field),
    snapshot:async()=>activeChunkSnapshot(await field.snapshot(),g),restore:async(value:ActiveWorldSnapshot3D)=>{await field.restore(validateActiveWorldSnapshot(value));},
    inspectPass:async(index:number)=>activeChunkSnapshot(await field.inspectPass(index),g),inspectLatency:field.inspectLatency.bind(field),settleLatency:field.settleLatency.bind(field),inspectActivity:field.inspectActivity.bind(field),createRenderer:field.createRenderer.bind(field),createGameplay:field.createGameplay.bind(field),close:field.close.bind(field),
  });
}
