/** Finite, globally clocked 3D worlds. Chunks are storage, never simulation islands. */
import { CpuVolume, validateVolumeSnapshot as validateFlat, type VolumeSnapshot, type StateSpaceField3D } from './3d-core.js';
import { checkedInteger } from '../validation.js';
import type { GpuStepOptions3D, Region3D, RegionRequest3D, VolumeEdit3D } from './3d-gpu-core.js';
export { MAT, PHASE, MATERIALS_3D, MAX_ENERGY_Q, RULES_VERSION_3D } from './3d.js';
export const WORLD_VERSION_3D='finite-chunks-1';
export const MAX_WORLD_CELLS_3D=64**3;
export type WorldOptions3D={width?:number;height?:number;depth?:number;chunkSize?:number;fillMaterial?:number};
export type WorldGeometry3D={width:number;height:number;depth:number;chunkSize:number};
export type WorldChunk3D={origin:number[];packedCells:number[];energyQ:number[]};
export type WorldSnapshot3D={schemaVersion:number;worldVersion:string;rulesVersion:string;materialCatalogHash:string;
  width:number;height:number;depth:number;chunkSize:number;tick:number;chunks:WorldChunk3D[]};
export function worldGeometry(options:WorldOptions3D={}):WorldGeometry3D {
  if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!['width','height','depth','chunkSize','fillMaterial'].includes(k)))throw new Error('Invalid world options.');
  const {width=64,height=64,depth=64,chunkSize=32}=options;
  for(const n of [width,height,depth])checkedInteger(n,1,64,'world dimension');
  checkedInteger(chunkSize,1,32,'chunk size');
  if((chunkSize&(chunkSize-1))||[width,height,depth].some(n=>n%chunkSize)||width*height*depth/chunkSize**3>64)throw new Error('World requires power-of-two chunks, complete chunks and at most 64 chunks.');
  return {width,height,depth,chunkSize};
}
/** Internal monolithic oracle uses precisely the shipped volume law and global schedule. */
export const referenceVolume=(w:number,h:number,d:number,fill=0):StateSpaceField3D=>new CpuVolume(w,h,d,fill,MAX_WORLD_CELLS_3D);
export const validateWorldFlat=(value:VolumeSnapshot)=>validateFlat(value,MAX_WORLD_CELLS_3D);
export function chunkSnapshot(flat:VolumeSnapshot,geometry:WorldGeometry3D):WorldSnapshot3D {
  const {width:w,height:h,depth:d,chunkSize:e}=geometry,chunks:WorldChunk3D[]=[];
  for(let z=0;z<d;z+=e)for(let y=0;y<h;y+=e)for(let x=0;x<w;x+=e){
    const packedCells:number[]=[],energyQ:number[]=[];
    for(let cz=z;cz<z+e;cz++)for(let cy=y;cy<y+e;cy++)for(let cx=x;cx<x+e;cx++){const i=cx+w*(cy+h*cz);packedCells.push(flat.packedCells[i]);energyQ.push(flat.energyQ[i]);}
    chunks.push({origin:[x,y,z],packedCells,energyQ});
  }
  const {schemaVersion,rulesVersion,materialCatalogHash,tick}=flat;
  return {schemaVersion,worldVersion:WORLD_VERSION_3D,rulesVersion,materialCatalogHash,...geometry,tick,chunks};
}
/** Returns an owned, canonical monolithic copy, after validating the complete world. */
export function validateWorldSnapshot(value:WorldSnapshot3D):VolumeSnapshot {
  const keys='chunkSize,chunks,depth,height,materialCatalogHash,rulesVersion,schemaVersion,tick,width,worldVersion';
  if(!value||typeof value!=='object'||Object.keys(value).sort().join(',')!==keys||value.worldVersion!==WORLD_VERSION_3D)throw new Error('Incompatible world snapshot.');
  for(const n of [value.width,value.height,value.depth,value.chunkSize])checkedInteger(n,1,64,'snapshot dimension');
  const {width:w,height:h,depth:d,chunkSize:e}=worldGeometry({width:value.width,height:value.height,depth:value.depth,chunkSize:value.chunkSize});
  const template=referenceVolume(1,1,1).snapshot(),packedCells=new Array<number>(w*h*d),energyQ=new Array<number>(w*h*d);
  if(!Array.isArray(value.chunks)||value.chunks.length!==w*h*d/e**3)throw new Error('Missing world chunks.');
  let k=0;
  for(let z=0;z<d;z+=e)for(let y=0;y<h;y+=e)for(let x=0;x<w;x+=e){
    const c=value.chunks[k++];
    if(!c||Object.keys(c).sort().join(',')!=='energyQ,origin,packedCells'||!Array.isArray(c.origin)||c.origin.length!==3||c.origin[0]!==x||c.origin[1]!==y||c.origin[2]!==z||!Array.isArray(c.packedCells)||!Array.isArray(c.energyQ)||c.packedCells.length!==e**3||c.energyQ.length!==e**3)throw new Error('Invalid or noncanonical world chunk.');
    let j=0;for(let cz=z;cz<z+e;cz++)for(let cy=y;cy<y+e;cy++)for(let cx=x;cx<x+e;cx++){const i=cx+w*(cy+h*cz);packedCells[i]=c.packedCells[j];energyQ[i]=c.energyQ[j++];}
  }
  const flat={...template,width:w,height:h,depth:d,tick:value.tick,schemaVersion:value.schemaVersion,rulesVersion:value.rulesVersion,materialCatalogHash:value.materialCatalogHash,packedCells,energyQ};
  validateWorldFlat(flat);return flat;
}
export function checkedWorldRegion(request:RegionRequest3D,geometry:WorldGeometry3D):RegionRequest3D {
  if(!request||!Array.isArray(request.origin)||!Array.isArray(request.size)||request.origin.length!==3||request.size.length!==3)throw new Error('Region needs three origin and size coordinates.');
  const shape=[geometry.width,geometry.height,geometry.depth],origin:number[]=[],size:number[]=[];
  for(let i=0;i<3;i++){size.push(checkedInteger(request.size[i],1,shape[i],'region size'));origin.push(checkedInteger(request.origin[i],0,shape[i]-size[i],'region origin'));}
  checkedInteger(size[0]*size[1]*size[2],1,4096,'region cell count');return{origin,size};
}
export class CpuWorld3D {
  readonly width:number;readonly height:number;readonly depth:number;readonly chunkSize:number;
  #field:StateSpaceField3D;
  constructor(options:WorldOptions3D={}){
    const g=worldGeometry(options);this.width=g.width;this.height=g.height;this.depth=g.depth;this.chunkSize=g.chunkSize;
    this.#field=referenceVolume(this.width,this.height,this.depth,options.fillMaterial);
    for(const k of ['width','height','depth','chunkSize'])Object.defineProperty(this,k,{writable:false,configurable:false});
  }
  get tick(){return this.#field.tick;}
  get grid(){return this.#field.grid;}
  get energyQ(){return this.#field.energyQ;}
  sample(x:number,y:number,z:number){return this.#field.sample(x,y,z);}
  setCell(x:number,y:number,z:number,material:number,thermal?:number){this.#field.setCell(x,y,z,material,thermal);}
  setEnergy(x:number,y:number,z:number,q:number){this.#field.setEnergy(x,y,z,q);}
  copyStateInto(target:Parameters<StateSpaceField3D['copyStateInto']>[0]){return this.#field.copyStateInto(target);}
  energyLedger(){return this.#field.energyLedger();}
  energyBalance(){return this.#field.energyBalance();}
  snapshot(){return chunkSnapshot(this.#field.snapshot(),this);}
  restore(value:WorldSnapshot3D){
    const flat=validateWorldSnapshot(value);
    if(flat.width!==this.width||flat.height!==this.height||flat.depth!==this.depth)throw new Error('World geometry differs.');
    this.#field.restore(flat); // Partition can change; the physics cannot.
  }
  queryRegion(request:RegionRequest3D):Region3D {
    const {origin,size}=checkedWorldRegion(request,this),grid=new Uint32Array(size[0]*size[1]*size[2]),source=this.#field.grid;let k=0;
    for(let z=0;z<size[2];z++)for(let y=0;y<size[1];y++)for(let x=0;x<size[0];x++)grid[k++]=source[x+origin[0]+this.width*(y+origin[1]+this.height*(z+origin[2]))];
    return{origin:[...origin],size:[...size],grid,tick:this.tick};
  }
  step(ticks=1,options:GpuStepOptions3D={}):Region3D|undefined {
    checkedInteger(ticks,0,32,'world ticks per request');checkedInteger(this.tick+ticks,0,Number.MAX_SAFE_INTEGER,'end tick');
    if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!['edits','region'].includes(k)))throw new Error('Invalid world step options.');
    const region=options.region===undefined?undefined:checkedWorldRegion(options.region,this),edits=options.edits===undefined?[]:options.edits;
    if(!Array.isArray(edits))throw new Error('Invalid edits.');checkedInteger(edits.length,0,64,'edit count');
    const seen=new Set<number>(),seed=referenceVolume(1,1,1),owned:VolumeEdit3D[]=[];
    for(let k=0;k<edits.length;k++){
      const e=edits[k];if(!e||typeof e!=='object')throw new Error('Invalid edit.');
      checkedInteger(e.x,0,this.width-1,'x');checkedInteger(e.y,0,this.height-1,'y');checkedInteger(e.z,0,this.depth-1,'z');
      const i=e.x+this.width*(e.y+this.height*e.z);if(seen.has(i))throw new Error('Duplicate edit.');seen.add(i);
      const keys=Object.keys(e).sort().join(',');
      if('material'in e){if(!['material,x,y,z','material,thermal,x,y,z'].includes(keys))throw new Error('Invalid placement.');seed.setCell(0,0,0,e.material,e.thermal);}
      else{if(keys!=='energyQ,x,y,z')throw new Error('Invalid energy edit.');seed.setEnergy(0,0,0,e.energyQ);}
      owned.push({...e});
    }
    for(const e of owned)if('material'in e)this.setCell(e.x,e.y,e.z,e.material,e.thermal);else this.setEnergy(e.x,e.y,e.z,e.energyQ);
    this.#field.step(ticks);return region?this.queryRegion(region):undefined;
  }
}
export function createStateSpaceWorld3D(options:WorldOptions3D={}){return new CpuWorld3D(options);}
