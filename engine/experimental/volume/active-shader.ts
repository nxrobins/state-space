/** Conservative quiescence certificates; the ca-3d-m1 pass body is unchanged. */
import { chunkShaders } from './3d-shader.js';

export function activeShaders(edge: number, chunks: number, activeEdge = Math.min(edge, 8)) {
  const base = chunkShaders(edge);
  const declarations = `
@group(0) @binding(7) var<storage,read_write> activity:array<atomic<u32>>;
@group(0) @binding(8) var<storage,read_write> indirect:array<atomic<u32>>;
@group(0) @binding(9) var<storage,read_write> otherIndirect:array<atomic<u32>>;
const CHUNKS=${chunks}u;
const ACTIVE_EDGE=${activeEdge}u;
const WORK_CELLS=ACTIVE_EDGE*ACTIVE_EDGE*ACTIVE_EDGE;
const AWAKE=16u;
const CERT=AWAKE+CHUNKS;
const LIST=CERT+CHUNKS;
const REASON=LIST+CHUNKS;
// Rebuild canonically at tick boundaries. Within a tick, append each newly
// awake tile once; the existing dispatch prefix remains immutable.
const PLAN_DIRTY=10u;
fn wake(c:vec3i,reason:u32){
 let n=vec3i(p.shape.xyz/ACTIVE_EDGE);let k=c/i32(ACTIVE_EDGE);let local=vec3u(c)%ACTIVE_EDGE;
 let lo=-vec3i(select(vec3u(0),vec3u(1),local<vec3u(2)));
 let hi=vec3i(select(vec3u(0),vec3u(1),local+vec3u(2)>=vec3u(ACTIVE_EDGE)));
 for(var z=lo.z;z<=hi.z;z++){for(var y=lo.y;y<=hi.y;y++){for(var x=lo.x;x<=hi.x;x++){
  let t=k+vec3i(x,y,z);if(all(t>=vec3i(0))&&all(t<n)){
   let j=u32(t.x+n.x*(t.y+n.y*t.z));
   if(atomicLoad(&activity[AWAKE+j])==0u){
    if(atomicOr(&activity[AWAKE+j],1u)==0u){
     let slot=atomicAdd(&activity[3],1u);atomicStore(&activity[LIST+slot],j);
     atomicMax(&indirect[0],(slot+1u)*WORK_CELLS/64u);atomicStore(&activity[PLAN_DIRTY],1u);
    }
   }
   if((atomicLoad(&activity[REASON+j])&reason)!=reason){atomicOr(&activity[REASON+j],reason);}
  }
 }}}
}
fn activeIndex(c:vec3i)->u32{let n=p.shape.xyz/ACTIVE_EDGE;let k=vec3u(c)/ACTIVE_EDGE;return k.x+n.x*(k.y+n.y*k.z);}
fn workIndex(id:u32)->u32{
 let n=p.shape.xyz/ACTIVE_EDGE;let k=atomicLoad(&activity[LIST+id/WORK_CELLS]);let l=id%WORK_CELLS;
 return index(vec3i(vec3u(k%n.x,(k/n.x)%n.y,k/(n.x*n.y))*ACTIVE_EDGE+vec3u(l%ACTIVE_EDGE,(l/ACTIVE_EDGE)%ACTIVE_EDGE,l/(ACTIVE_EDGE*ACTIVE_EDGE))));
}
fn quiet(i:u32)->bool{
 let v=cells[i];let q=energies[i];let c=coordinate(i);let temp=temperature(v,q);let immovable=fixed(v);
 if(thermal(v,q)!=v||transition(v,q)!=(v&255u)){return false;}
 let normals=array<vec3i,6>(vec3i(-1,0,0),vec3i(1,0,0),vec3i(0,-1,0),vec3i(0,1,0),vec3i(0,0,-1),vec3i(0,0,1));
 for(var f=0u;f<6u;f++){
  let t=c+normals[f];if(!inside(t)){continue;}let j=index(t);let other=cells[j];
  // Test the exact exchange, including zero integer flux and saturated energies.
  if(((v&255u)!=(other&255u)||q!=energies[j])&&temp!=temperature(other,energies[j])&&pairEnergy(v,other,q,energies[j])!=q){return false;}
  if(immovable){continue;}
  if(f==2u){if(rise(i,j)||fall(j,i)){return false;}}
  else if(f==3u){if(fall(i,j)||rise(j,i)){return false;}}
  else{
   if(spread(i,j)||spread(j,i)){return false;}
   if(gas(v)&&gas(other)&&(((v&255u)!=0u&&((other&255u)==0u||rank(i)>rank(j)+16))||((other&255u)!=0u&&((v&255u)==0u||rank(j)>rank(i)+16)))){return false;}
  }
 }
 if(immovable){return true;}
 let horizontal=array<vec3i,4>(vec3i(-1,0,0),vec3i(1,0,0),vec3i(0,0,-1),vec3i(0,0,1));
 for(var f=0u;f<4u;f++){
  let down=c+horizontal[f]+vec3i(0,1,0);if(inside(down)&&fall(i,index(down))){return false;}
  let up=c+horizontal[f]-vec3i(0,1,0);if(inside(up)&&fall(index(up),i)){return false;}
 }
 return true;
}
// Pack 32 activity flags per lane, prefix only 64 lane counts, then scatter
// contiguous blocks in canonical tile order. No physical pair or rule changes.
const MASKS=(CHUNKS+31u)/32u;
var<workgroup> awakeMasks:array<u32,128>;
var<workgroup> laneCounts:array<u32,64>;
var<workgroup> laneOffsets:array<u32,64>;
var<workgroup> rebuildList:u32;
fn dispatchSize(count:u32){
 atomicStore(&indirect[0],count*WORK_CELLS/64u);atomicStore(&indirect[1],1u);atomicStore(&indirect[2],1u);
 atomicStore(&otherIndirect[0],count*WORK_CELLS/64u);atomicStore(&otherIndirect[1],1u);atomicStore(&otherIndirect[2],1u);
}
@compute @workgroup_size(64) fn collectWork(@builtin(local_invocation_index) lane:u32){
 if(lane==0u){rebuildList=atomicExchange(&activity[PLAN_DIRTY],0u);}
 let rebuild=workgroupUniformLoad(&rebuildList);
 if(rebuild==0u){
  if(lane==0u){
   let count=atomicLoad(&activity[3]);dispatchSize(count);atomicStore(&activity[6],0u);atomicAdd(&activity[9],1u);
  }
  return;
 }
 for(var word=lane;word<MASKS;word+=64u){
  var bits=0u;
  for(var bit=0u;bit<32u;bit++){
   let k=word*32u+bit;if(k>=CHUNKS){break;}
   if(atomicLoad(&activity[AWAKE+k])!=0u){bits|=1u<<bit;}
  }
  awakeMasks[word]=bits;
 }
 workgroupBarrier();
 let block=(MASKS+63u)/64u;let start=lane*block;let end=min(start+block,MASKS);
 var length=0u;for(var word=start;word<end;word++){length+=countOneBits(awakeMasks[word]);}
 laneCounts[lane]=length;
 workgroupBarrier();
 if(lane==0u){
  var count=0u;for(var k=0u;k<64u;k++){laneOffsets[k]=count;count+=laneCounts[k];}
  atomicStore(&activity[3],count);atomicStore(&activity[6],0u);
  atomicAdd(&activity[8],1u);
  dispatchSize(count);
 }
 workgroupBarrier();
 var slot=laneOffsets[lane];
 for(var word=start;word<end;word++){
  var bits=awakeMasks[word];
  while(bits!=0u){let bit=firstTrailingBit(bits);atomicStore(&activity[LIST+slot],word*32u+bit);slot++;bits&=bits-1u;}
 }
}
@compute @workgroup_size(64) fn certify(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=atomicLoad(&activity[3])*WORK_CELLS){return;}let i=workIndex(id.x);let k=activeIndex(coordinate(i));
 atomicAnd(&activity[CERT+k],1u);if(!quiet(i)){atomicOr(&activity[CERT+k],1u);}nextCells[i]=cells[i];nextEnergies[i]=energies[i];
}
@compute @workgroup_size(64) fn commitCert(@builtin(global_invocation_id) id:vec3u){
 let k=id.x;if(k>=CHUNKS){return;}
 // The following 26 passes reused/appended the prefix, without a planner dispatch.
 if(k==0u){atomicAdd(&activity[9],26u);}
 if(atomicLoad(&activity[CERT+k])==0u&&atomicExchange(&activity[AWAKE+k],0u)!=0u){atomicStore(&activity[PLAN_DIRTY],1u);}
 // Reset once after certification, rather than in all 27 work-list passes.
 // 2 means unvisited: a tile woken by the final phase must remain awake.
 atomicStore(&activity[CERT+k],2u);
 if(atomicLoad(&activity[AWAKE+k])==0u){atomicAdd(&activity[6],1u);}
}
`;
  function replace(code: string, from: string, to: string) {
    if (code.split(from).length !== 2)
      throw new Error('Sparse shader template differs from ca-3d-m1.');
    return code.replace(from, to);
  }
  let physics = replace(
    base.physics,
    '@compute @workgroup_size(64) fn main',
    declarations + '\n@compute @workgroup_size(64) fn main',
  );
  physics = replace(
    physics,
    'fn main(@builtin(global_invocation_id) id:vec3u)',
    'fn main(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u)',
  );
  // Never bind a writable argument buffer as this dispatch's indirect input.
  // Its partner grows monotonically; dispatch dimensions freeze this pass's
  // prefix even while wakes append entries for the next pass.
  physics = replace(
    physics,
    'let i=id.x; if(i>=p.shape.w){return;}',
    'if(id.x==0u){atomicMax(&indirect[0],groups.x);let count=groups.x*64u/WORK_CELLS;atomicAdd(&activity[4],count);atomicMax(&activity[5],count);}\nlet i=workIndex(id.x);',
  );
  // Neither side of a movement swap can be fixed. Heat and phase still run;
  // both output coordinates are copied even when movement is impossible.
  physics = replace(
    physics,
    'else {\n    let c=coordinate(i);',
    'else if(kind==5u||!fixed(v)) {\n    let c=coordinate(i);',
  );
  physics = replace(
    physics,
    'nextCells[i]=outV;nextEnergies[i]=outQ;',
    'if(v!=outV||q!=outQ){wake(coordinate(i),select(4u,select(2u,8u,kind==6u),(v&255u)!=(outV&255u)));}\n  nextCells[i]=outV;nextEnergies[i]=outQ;',
  );
  return { physics, access: base.access };
}
