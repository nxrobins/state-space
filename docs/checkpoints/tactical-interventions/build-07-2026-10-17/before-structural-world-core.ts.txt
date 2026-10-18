/** M5 CPU reference and public validation. Older 3D contracts remain unchanged. */
import { MAT, PHASE_SHIFT, buildColdTable } from '../generated/materials.js';
import { DEFAULT_REGISTRY } from '../registry.js';
import { checkedInteger, validatePackedCells, stateCopyTargets } from '../validation.js';
import { seedState, thermalView, temperatureQ, MAX_ENERGY_Q, energyLedger } from '../thermal.js';
import { activeWorldGeometry, type ActiveWorldOptions3D } from './active-world-core.js';
import { MATERIALS_3D, SCHEMA_VERSION_3D, RULES_VERSION_3D, MATERIAL_CATALOG_HASH_3D, validateVolumeSnapshot, volumeSchedule } from './3d-core.js';
import { ANCHOR_3D, BONDS_3D, COMPLETE_STRUCTURE_3D, FRESH_3D, INTEGRITY_3D,
  normalizeStructure3D, solveStructure3D, structuralEligible, structuralNeighbor,
  type StructuralGeometry, type StructuralState3D } from './structural-mechanics.js';
import { executeStructuralMaterialPass } from './structural-material.js';

export const STRUCTURAL_SCHEMA_VERSION_3D=2;
export const STRUCTURAL_RULES_VERSION_3D='ca-3d-m5';
export const STRUCTURAL_WORLD_VERSION_3D='finite-structural-1';
export type StructuralWorldOptions3D=ActiveWorldOptions3D;
export type StructuralSnapshot3D=StructuralGeometry & {
  schemaVersion:number; rulesVersion:string; worldVersion:string; materialCatalogHash:string;
  chunkSize:number; tick:number; packedCells:number[]; energyQ:number[]; structure:number[];
};
type CellPosition={x:number;y:number;z:number};
export type StructuralEdit3D=CellPosition & (
  {kind:'material';material:number;thermal?:number} | {kind:'energy';energyQ:number} |
  {kind:'integrity';integrity:number} | {kind:'anchor';anchored:boolean} |
  {kind:'bond';direction:number;bonded:boolean});
export type StructuralStepOptions3D={edits?:readonly StructuralEdit3D[]};
const cold=buildColdTable(),supported=new Set(MATERIALS_3D.map(m=>m.id));
const clone=(s:StructuralState3D):StructuralState3D=>({grid:s.grid.slice(),energyQ:s.energyQ.slice(),structure:s.structure.slice()});
const total=(s:StructuralState3D)=>{let q=0;for(const value of s.energyQ)q+=value;return BigInt(q);};
function position(p:CellPosition,g:StructuralGeometry):number {
  checkedInteger(p.x,0,g.width-1,'x');checkedInteger(p.y,0,g.height-1,'y');checkedInteger(p.z,0,g.depth-1,'z');
  return p.x+g.width*(p.y+g.height*p.z);
}
function placement(id:number,thermal?:number) {
  if(!Number.isInteger(id)||!supported.has(id))throw Error('Material is not supported by ca-3d-m5.');
  const record=DEFAULT_REGISTRY.material(id),t=thermal??record.default_thermal;
  checkedInteger(t,0,255,'thermal');
  return seedState([id|(t<<8)|(record.properties.default_phase<<PHASE_SHIFT)]);
}
/** State-independent validation and owned command encoding, shared by CPU/GPU. */
export function prepareStructuralEdits3D(edits:readonly StructuralEdit3D[],g:StructuralGeometry):Uint32Array {
  if(!Array.isArray(edits)||edits.length>65536)throw Error('Structural edits must be an array of at most 65536 entries.');
  const commands=new Uint32Array(edits.length*4);
  const expected={material:['kind,material,x,y,z','kind,material,thermal,x,y,z'],energy:['energyQ,kind,x,y,z'],integrity:['integrity,kind,x,y,z'],anchor:['anchored,kind,x,y,z'],bond:['bonded,direction,kind,x,y,z']};
  for(let k=0;k<edits.length;k++) {
    const edit:StructuralEdit3D=edits[k];
    if(!edit||typeof edit!=='object'||Array.isArray(edit)||!Object.hasOwn(expected,edit.kind)||!expected[edit.kind].includes(Object.keys(edit).sort().join(',')))throw Error('Invalid structural edit fields.');
    const i=position(edit,g);let kind=0,a=0,b=0;
    if(edit.kind==='material'){const seed=placement(edit.material,edit.thermal);a=seed.grid[0];b=seed.energyQ[0];}
    else if(edit.kind==='energy'){kind=1;a=checkedInteger(edit.energyQ,0,MAX_ENERGY_Q,'energyQ');}
    else if(edit.kind==='integrity'){kind=2;a=checkedInteger(edit.integrity,0,255,'integrity');}
    else if(edit.kind==='anchor'){kind=3;if(typeof edit.anchored!=='boolean')throw Error('Anchor state must be boolean.');a=Number(edit.anchored);}
    else {kind=4;a=checkedInteger(edit.direction,0,5,'bond direction');if(typeof edit.bonded!=='boolean')throw Error('Bond state must be boolean.');b=Number(edit.bonded);if(structuralNeighbor(i,a,g)<0)throw Error('Bond crosses the closed boundary.');}
    commands.set([i,kind,a,b],k*4);
  }
  return commands;
}
export function validateStructuralState3D(grid:ArrayLike<number>,energyQ:ArrayLike<number>,structure:ArrayLike<number>,g:StructuralGeometry):StructuralState3D {
  // Reuse the existing packed-cell/thermal validity law, not its stepping behavior.
  const state=validateVolumeSnapshot({schemaVersion:SCHEMA_VERSION_3D,rulesVersion:RULES_VERSION_3D,materialCatalogHash:MATERIAL_CATALOG_HASH_3D,
    width:g.width,height:g.height,depth:g.depth,tick:0,packedCells:grid as number[],energyQ:energyQ as number[]},128**3);
  const words=validatePackedCells(structure,state.grid.length);
  if(words.some(v=>(v&~COMPLETE_STRUCTURE_3D)!==0))throw Error('Reserved or pending structural bits in completed state.');
  const normalized=normalizeStructure3D(state.grid,words,g);
  if(words.some((v,i)=>v!==normalized[i]))throw Error('Invalid structural phase, boundary or reciprocal bond.');
  return{...state,structure:words};
}
export function validateStructuralSnapshot3D(s:StructuralSnapshot3D):StructuralState3D {
  const keys='chunkSize,depth,energyQ,height,materialCatalogHash,packedCells,rulesVersion,schemaVersion,structure,tick,width,worldVersion';
  if(!s||typeof s!=='object'||Object.keys(s).sort().join(',')!==keys)throw Error('Invalid structural snapshot fields.');
  if(s.schemaVersion!==STRUCTURAL_SCHEMA_VERSION_3D||s.rulesVersion!==STRUCTURAL_RULES_VERSION_3D||s.worldVersion!==STRUCTURAL_WORLD_VERSION_3D||s.materialCatalogHash!==MATERIAL_CATALOG_HASH_3D)throw Error('Incompatible structural snapshot version or catalog.');
  const g=activeWorldGeometry({width:s.width,height:s.height,depth:s.depth,chunkSize:s.chunkSize});
  checkedInteger(s.tick,0,Number.MAX_SAFE_INTEGER,'tick');
  return validateStructuralState3D(s.packedCells,s.energyQ,s.structure,g);
}

/** Ordered transaction. Temporary arrays are published only after every edit succeeds. */
export function applyStructuralEdits3D(input:StructuralState3D,edits:readonly StructuralEdit3D[],g:StructuralGeometry):{state:StructuralState3D;externalQ:bigint} {
  prepareStructuralEdits3D(edits,g);
  if(!edits.length)return{state:input,externalQ:0n};
  const state=clone(input);let externalQ=0n;
  const clearBonds=(i:number)=>{
    for(let dir=0;dir<6;dir++) {const j=structuralNeighbor(i,dir,g);if(j>=0)state.structure[j]&=~BONDS_3D[dir^1];}
    state.structure[i]&=INTEGRITY_3D|ANCHOR_3D;
  };
  for(let k=0;k<edits.length;k++) {
    const edit:StructuralEdit3D=edits[k];if(!edit||typeof edit!=='object'||Array.isArray(edit))throw Error('Invalid structural edit.');
    const keys=Object.keys(edit).sort().join(',');
    const expected={material:['kind,material,x,y,z','kind,material,thermal,x,y,z'],energy:['energyQ,kind,x,y,z'],integrity:['integrity,kind,x,y,z'],anchor:['anchored,kind,x,y,z'],bond:['bonded,direction,kind,x,y,z']};
    if(!Object.hasOwn(expected,edit.kind)||!expected[edit.kind].includes(keys))throw Error('Invalid structural edit fields.');
    const i=position(edit,g);
    if(edit.kind==='material') {
      const seed=placement(edit.material,edit.thermal);clearBonds(i);
      externalQ+=BigInt(seed.energyQ[0])-BigInt(state.energyQ[i]);state.grid[i]=seed.grid[0];state.energyQ[i]=seed.energyQ[0];
      state.structure[i]=structuralEligible(state.grid[i])?INTEGRITY_3D:0;
      if(state.structure[i])for(let dir=0;dir<6;dir++) {
        const j=structuralNeighbor(i,dir,g);
        if(j>=0&&(state.structure[j]&INTEGRITY_3D)) {state.structure[i]|=BONDS_3D[dir];state.structure[j]|=BONDS_3D[dir^1];}
      }
    } else if(edit.kind==='energy') {
      checkedInteger(edit.energyQ,0,MAX_ENERGY_Q,'energyQ');externalQ+=BigInt(edit.energyQ)-BigInt(state.energyQ[i]);
      state.energyQ[i]=edit.energyQ;state.grid[i]=thermalView(state.grid[i],edit.energyQ,cold);
    } else {
      if(!structuralEligible(state.grid[i]))throw Error('Mechanical edits require a cohesive solid/frozen cell.');
      if(edit.kind==='integrity') {
        checkedInteger(edit.integrity,0,255,'integrity');if(!edit.integrity)clearBonds(i);
        state.structure[i]=(state.structure[i]&~INTEGRITY_3D)|edit.integrity;
      } else if(edit.kind==='anchor') {
        if(typeof edit.anchored!=='boolean')throw Error('Anchor state must be boolean.');
        state.structure[i]=edit.anchored?state.structure[i]|ANCHOR_3D:state.structure[i]&~ANCHOR_3D;
      } else {
        checkedInteger(edit.direction,0,5,'bond direction');if(typeof edit.bonded!=='boolean')throw Error('Bond state must be boolean.');
        const j=structuralNeighbor(i,edit.direction,g);if(j<0)throw Error('Bond crosses the closed boundary.');
        if(edit.bonded) {
          if(!(state.structure[i]&INTEGRITY_3D)||!(state.structure[j]&INTEGRITY_3D))throw Error('Bond endpoints must both be intact.');
          state.structure[i]|=BONDS_3D[edit.direction];state.structure[j]|=BONDS_3D[edit.direction^1];
        } else {state.structure[i]&=~BONDS_3D[edit.direction];state.structure[j]&=~BONDS_3D[edit.direction^1];}
      }
    }
  }
  return{state,externalQ};
}

export class CpuStructuralWorld3D {
  readonly width:number;readonly height:number;readonly depth:number;readonly chunkSize:number;
  #state:StructuralState3D;#tick=0;#initial=0n;#external=0n;
  constructor(options:StructuralWorldOptions3D={}) {
    const g=activeWorldGeometry(options);this.width=g.width;this.height=g.height;this.depth=g.depth;this.chunkSize=g.chunkSize;
    const seed=placement(options.fillMaterial??MAT.AIR),n=g.width*g.height*g.depth;
    const grid=new Uint32Array(n).fill(seed.grid[0]),words=new Uint32Array(n).fill(structuralEligible(seed.grid[0])?INTEGRITY_3D|FRESH_3D:0);
    this.#state={grid,energyQ:new Uint32Array(n).fill(seed.energyQ[0]),structure:normalizeStructure3D(grid,words,g)};
    this.#initial=total(this.#state);
    for(const key of ['width','height','depth','chunkSize'])Object.defineProperty(this,key,{writable:false,configurable:false});
  }
  get tick(){return this.#tick;}
  get grid(){return this.#state.grid.slice();}
  get energyQ(){return this.#state.energyQ.slice();}
  get structure(){return this.#state.structure.slice();}
  edit(edits:readonly StructuralEdit3D[]) {const next=applyStructuralEdits3D(this.#state,edits,this);this.#state=next.state;this.#external+=next.externalQ;}
  setCell(x:number,y:number,z:number,material:number,thermal?:number){this.edit([{kind:'material',x,y,z,material,...(thermal===undefined?{}:{thermal})}]);}
  setEnergy(x:number,y:number,z:number,energyQ:number){this.edit([{kind:'energy',x,y,z,energyQ}]);}
  setAnchor(x:number,y:number,z:number,anchored:boolean){this.edit([{kind:'anchor',x,y,z,anchored}]);}
  setIntegrity(x:number,y:number,z:number,integrity:number){this.edit([{kind:'integrity',x,y,z,integrity}]);}
  setBond(x:number,y:number,z:number,direction:number,bonded:boolean){this.edit([{kind:'bond',x,y,z,direction,bonded}]);}
  step(ticks=1,options:StructuralStepOptions3D={}) {
    checkedInteger(ticks,0,32,'ticks per request');checkedInteger(this.#tick+ticks,0,Number.MAX_SAFE_INTEGER,'end tick');
    if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>k!=='edits'))throw Error('Invalid structural step options.');
    const edited=applyStructuralEdits3D(this.#state,options.edits===undefined?[]:options.edits,this);
    if(!ticks){this.#state=edited.state;this.#external+=edited.externalQ;return;}
    let input=edited.state;
    for(let t=0;t<ticks;t++) {
      // A complete tick is staged off-state. Failed solves cannot publish partial damage/motion.
      let state=solveStructure3D(input,this).state,spare=clone(state);
      for(const pass of volumeSchedule(this.#tick)) {
        executeStructuralMaterialPass(state,spare,this.width,this.height,this.depth,this.#tick,pass);[state,spare]=[spare,state];
      }
      state.structure=normalizeStructure3D(state.grid,state.structure,this);
      this.#state=state;this.#tick++;if(t===0)this.#external+=edited.externalQ;input=state;
    }
  }
  sample(x:number,y:number,z:number) {
    const i=position({x,y,z},this),v=this.#state.grid[i],q=this.#state.energyQ[i],s=this.#state.structure[i];
    return{material:v&255,materialName:DEFAULT_REGISTRY.material(v&255).name,phase:(v>>>PHASE_SHIFT)&15,thermal:(v>>>8)&255,
      energyQ:q,temperatureQ:temperatureQ(v,q,cold),structure:s,integrity:s&INTEGRITY_3D,anchored:Boolean(s&ANCHOR_3D),bonds:BONDS_3D.map(b=>Boolean(s&b))};
  }
  copyStateInto(target:StructuralState3D) {
    const arrays=stateCopyTargets(target,this.#state.grid.length);
    if(arrays.some(a=>!(a.buffer instanceof ArrayBuffer)))throw Error('State copy requires owned ArrayBuffers.');
    for(const [i,key] of (['grid','energyQ','structure'] as const).entries())Uint32Array.prototype.set.call(arrays[i],this.#state[key]);return this.#tick;
  }
  snapshot():StructuralSnapshot3D {
    return{schemaVersion:STRUCTURAL_SCHEMA_VERSION_3D,rulesVersion:STRUCTURAL_RULES_VERSION_3D,worldVersion:STRUCTURAL_WORLD_VERSION_3D,
      materialCatalogHash:MATERIAL_CATALOG_HASH_3D,width:this.width,height:this.height,depth:this.depth,chunkSize:this.chunkSize,tick:this.#tick,
      packedCells:Array.from(this.#state.grid),energyQ:Array.from(this.#state.energyQ),structure:Array.from(this.#state.structure)};
  }
  restore(snapshot:StructuralSnapshot3D) {
    const next=validateStructuralSnapshot3D(snapshot);
    if(snapshot.width!==this.width||snapshot.height!==this.height||snapshot.depth!==this.depth)throw Error('Structural snapshot geometry differs.');
    this.#state=next;this.#tick=snapshot.tick;this.#initial=total(next);this.#external=0n;
  }
  energyLedger(){return energyLedger(this.#state,cold);}
  energyBalance(){const currentQ=total(this.#state);return{initialQ:this.#initial,externalQ:this.#external,currentQ,driftQ:currentQ-this.#initial-this.#external};}
  inspectStructure(){return solveStructure3D(this.#state,this);}
}
export const createStateSpaceStructuralWorld3D=(options:StructuralWorldOptions3D={})=>new CpuStructuralWorld3D(options);
