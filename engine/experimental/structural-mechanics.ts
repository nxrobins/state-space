/** M5 dense CPU oracle. Global x-major indices, no storage-partition assumptions. */
import { buildColdTable, COLD_STRIDE, COLD_DENSITY, COLD_COHESION, COLD_SOFTENING,
  PHASE_SHIFT, PHASE_SOLID, PHASE_FROZEN } from '../generated/materials.js';
import { temperatureQ, ENERGY_SCALE } from '../thermal.js';

export const INTEGRITY_3D = 255;
export const BONDS_3D = Object.freeze([1 << 8, 1 << 9, 1 << 10, 1 << 11, 1 << 12, 1 << 13]);
export const ANCHOR_3D = 1 << 14;
export const FRESH_3D = 1 << 15;
export const COMPLETE_STRUCTURE_3D = 0x7fff;
export type StructuralGeometry = { width:number; height:number; depth:number };
export type StructuralState3D = { grid:Uint32Array; energyQ:Uint32Array; structure:Uint32Array };
const cold = buildColdTable();
export const structuralDensity = (v:number) => cold[(v & 255) * COLD_STRIDE + COLD_DENSITY];
export function structuralEligible(v:number):boolean {
  const phase = (v >>> PHASE_SHIFT) & 15;
  return (phase === PHASE_SOLID || phase === PHASE_FROZEN) && cold[(v & 255) * COLD_STRIDE + COLD_COHESION] > 0;
}
/** Directions -X,+X,-Y,+Y,-Z,+Z. Return -1 at a closed boundary. */
export function structuralNeighbor(i:number, direction:number, g:StructuralGeometry):number {
  const {width:w,height:h,depth:d} = g, layer = w*h;
  const x=i%w, y=Math.floor(i/w)%h, z=Math.floor(i/layer);
  switch(direction) {
    case 0:return x ? i-1 : -1;
    case 1:return x+1<w ? i+1 : -1;
    case 2:return y ? i-w : -1;
    case 3:return y+1<h ? i+w : -1;
    case 4:return z ? i-layer : -1;
    case 5:return z+1<d ? i+layer : -1;
    default:throw Error('Invalid structural direction.');
  }
}

/** Internal normalization accepts FRESH; completed public state never does. */
export function normalizeStructure3D(grid:Uint32Array, words:Uint32Array, g:StructuralGeometry):Uint32Array {
  const out=new Uint32Array(grid.length);
  for(let i=0;i<out.length;i++) if(structuralEligible(grid[i])) out[i]=words[i] & (INTEGRITY_3D|ANCHOR_3D);
  for(let i=0;i<out.length;i++) {
    if(!(out[i]&INTEGRITY_3D)) continue;
    for(const dir of [1,3,5]) {
      const j=structuralNeighbor(i,dir,g);
      if(j<0 || !(out[j]&INTEGRITY_3D)) continue;
      if(((words[i]&BONDS_3D[dir]) && (words[j]&BONDS_3D[dir^1])) || ((words[i]|words[j])&FRESH_3D)) {
        out[i]|=BONDS_3D[dir]; out[j]|=BONDS_3D[dir^1];
      }
    }
  }
  return out;
}

export function structuralCapacity(v:number,q:number,integrity:number):number {
  const at=(v&255)*COLD_STRIDE, nominal=cold[at+COLD_COHESION]*16, softening=cold[at+COLD_SOFTENING];
  const remaining=softening ? Math.max(0,Math.min(64*ENERGY_SCALE,(softening+64)*ENERGY_SCALE-temperatureQ(v,q,cold))) : 64*ENERGY_SCALE;
  // Explicit two-stage rounding is part of ca-3d-m5. Products fit in u32.
  return Math.floor(Math.floor(nominal*integrity/255)*remaining/(64*ENERGY_SCALE));
}

export type StructuralPlan3D = {
  state:StructuralState3D; sources:Uint32Array; distances:Int32Array; loads:Uint32Array;
  capacities:Uint32Array; reactions:Uint32Array; componentIds:Int32Array; moving:Uint8Array;
  supportedWeight:number; brokenCells:number; movedCells:number;
};

/** Trusted internal input. Public entry points validate and isolate all coordinates. */
export function solveStructure3D(input:StructuralState3D,g:StructuralGeometry):StructuralPlan3D {
  const {grid,energyQ,structure}=input,n=grid.length;
  const active=(i:number,words=structure)=>i>=0 && (words[i]&INTEGRITY_3D)!==0;
  const obstructed=(i:number,j:number)=>(structure[j]&ANCHOR_3D)!==0 || structuralDensity(grid[i])<=structuralDensity(grid[j]);
  const distances=new Int32Array(n).fill(-1),loads=new Uint32Array(n),reactions=new Uint32Array(n),queue=new Uint32Array(n);
  let length=0;
  for(let i=0;i<n;i++) if(active(i)) {
    const below=structuralNeighbor(i,3,g);
    if((structure[i]&ANCHOR_3D) || below<0 || (!active(below)&&obstructed(i,below))) {
      distances[i]=0; queue[length++]=i;
    }
  }
  // BFS reaches completion; no radius/iteration horizon or chunk-local roots.
  for(let head=0;head<length;head++) {
    const i=queue[head];
    for(let dir=0;dir<6;dir++) {
      const j=structuralNeighbor(i,dir,g);
      if(active(j) && distances[j]<0 && ((structure[i]&BONDS_3D[dir]) || dir===2)) {
        distances[j]=distances[i]+1; queue[length++]=j;
      }
    }
  }
  let supportedWeight=0;
  for(let k=0;k<length;k++) { const i=queue[k];loads[i]=Math.max(1,Math.ceil(structuralDensity(grid[i])/64));supportedWeight+=loads[i]; }
  const supports:number[]=[];
  for(let k=length-1;k>=0;k--) {
    const i=queue[k];
    if(distances[i]===0) {reactions[i]=loads[i];continue;}
    supports.length=0;
    for(let dir=0;dir<6;dir++) {
      const j=structuralNeighbor(i,dir,g);
      if(active(j) && distances[j]===distances[i]-1 && ((structure[i]&BONDS_3D[dir]) || dir===3)) supports.push(j);
    }
    supports.sort((a,b)=>a-b);
    if(!supports.length) throw Error('Incomplete structural support solve.');
    const share=Math.floor(loads[i]/supports.length),remainder=loads[i]%supports.length;
    for(let r=0;r<supports.length;r++) loads[supports[r]]+=share+(r<remainder?1:0);
  }
  let reactionTotal=0; for(const r of reactions) reactionTotal+=r;
  if(reactionTotal!==supportedWeight) throw Error('Structural reactions do not balance supported weight.');
  const capacities=new Uint32Array(n),damaged=structure.slice(); let brokenCells=0;
  for(let i=0;i<n;i++) if(active(i)) {
    const integrity=structure[i]&INTEGRITY_3D,nominal=cold[(grid[i]&255)*COLD_STRIDE+COLD_COHESION]*16;
    const capacity=structuralCapacity(grid[i],energyQ[i],integrity);capacities[i]=capacity;
    const loss=capacity===0?integrity:loads[i]>capacity?Math.min(integrity,Math.max(1,Math.floor((loads[i]-capacity)*255/nominal))):0;
    damaged[i]=(damaged[i]&~INTEGRITY_3D)|(integrity-loss);if(loss===integrity) brokenCells++;
  }
  const edges=normalizeStructure3D(grid,damaged,g),ids=new Int32Array(n).fill(-1);
  // Independent flood-fill component construction, canonical minimum source index.
  const members:number[][]=[],roots:number[]=[];
  for(let root=0;root<n;root++) if(active(root,edges)&&ids[root]<0) {
    const cells=[root];ids[root]=root;
    for(let head=0;head<cells.length;head++) {
      const i=cells[head];
      for(let dir=0;dir<6;dir++) if(edges[i]&BONDS_3D[dir]) {
        const j=structuralNeighbor(i,dir,g);
        if(j<0||!active(j,edges)) throw Error('Broken structural adjacency.');
        if(ids[j]<0){ids[j]=root;cells.push(j);}
      }
    }
    roots.push(root);members.push(cells);
  }
  const blocked=new Uint8Array(n),dependents=new Map<number,Set<number>>();length=0;
  for(let k=0;k<roots.length;k++) {
    const root=roots[k];
    for(const i of members[k]) {
      const below=structuralNeighbor(i,3,g);
      if((edges[i]&ANCHOR_3D)||below<0||(!active(below,edges)&&obstructed(i,below))) blocked[root]=1;
      else if(ids[below]>=0&&ids[below]!==root) {
        let above=dependents.get(ids[below]);if(!above){above=new Set();dependents.set(ids[below],above);}above.add(root);
      }
    }
    if(blocked[root]) queue[length++]=root;
  }
  for(let head=0;head<length;head++) for(const above of dependents.get(queue[head])??[]) {
    if(!blocked[above]){blocked[above]=1;queue[length++]=above;}
  }
  const moving=new Uint8Array(n);let movedCells=0;
  for(let i=0;i<n;i++) if(ids[i]>=0&&!blocked[ids[i]]) {moving[i]=1;movedCells++;}
  const sources=Uint32Array.from({length:n},(_,i)=>i);
  for(let z=0;z<g.depth;z++) for(let x=0;x<g.width;x++) {
    let top=-1;
    for(let y=0;y<g.height;y++) {
      const i=x+g.width*(y+g.height*z);
      if(moving[i]) {
        if(y+1===g.height) throw Error('Structural motion crossed the closed floor.');
        if(top<0) top=i;sources[i+g.width]=i;
      } else if(top>=0) {sources[top]=i;top=-1;}
    }
  }
  const state={grid:new Uint32Array(n),energyQ:new Uint32Array(n),structure:new Uint32Array(n)},visited=new Uint8Array(n);
  for(let i=0;i<n;i++) {
    const source=sources[i];if(visited[source])throw Error('Structural motion is not a permutation.');visited[source]=1;
    state.grid[i]=grid[source];state.energyQ[i]=energyQ[source];state.structure[i]=edges[source];
  }
  return{state,sources,distances,loads,capacities,reactions,componentIds:ids,moving,supportedWeight,brokenCells,movedCells};
}
