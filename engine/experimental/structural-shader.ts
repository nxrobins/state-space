/** M5 integer GPU rules. Global convergence is verified before committing a tick. */
import { chunkShaders } from './3d-shader.js';

// These stages only inspect intact structure (or its supported-distance DAG).
// Damage can remove members during a solve, but cannot create new members.
export const STRUCTURAL_LIST_STAGES=['supportRelax','supportSummary','loadLevel','loadInit','loadRelax','loadSummary','componentInit','componentRelax','blockInit','blockRelax'] as const;
export const STRUCTURAL_RELAX_STAGES=['supportRelax','loadRelax','componentRelax','blockRelax'] as const;

export function structuralShaders(edge:number,shape:readonly number[]) {
  const base=chunkShaders(edge).physics;
  const replace=(source:string,from:string,to:string)=>{
    if(source.split(from).length!==2)throw Error('M5 material template differs from the frozen M1 law.');
    return source.replace(from,to);
  };
  const mechanical=`
@group(0) @binding(7) var<storage,read> structures:array<u32>;
@group(0) @binding(8) var<storage,read_write> nextStructures:array<u32>;
const INTEGRITY=255u;const ANCHOR=16384u;const FRESH=32768u;const INF=0xffffffffu;
const NORMALS=array<vec3i,6>(vec3i(-1,0,0),vec3i(1,0,0),vec3i(0,-1,0),vec3i(0,1,0),vec3i(0,0,-1),vec3i(0,0,1));
fn eligible(v:u32)->bool{return fixed(v)&&prop(v,22u)>0u;}
fn bound(i:u32)->bool{return (structures[i]&(INTEGRITY|ANCHOR))!=0u;}
fn intact(i:u32)->bool{return (structures[i]&INTEGRITY)!=0u;}
fn bit(dir:u32)->u32{return 1u<<(8u+dir);}
fn neighbor(i:u32,dir:u32)->u32{let c=coordinate(i)+NORMALS[dir];if(!inside(c)){return INF;}return index(c);}
fn storageOf(canonical:u32)->u32{return index(vec3i(vec3u(canonical%p.shape.x,(canonical/p.shape.x)%p.shape.y,canonical/(p.shape.x*p.shape.y))));}
`;
  let physics=replace(base,'@compute @workgroup_size(64) fn main',mechanical+'\n@compute @workgroup_size(64) fn main');
  physics=replace(physics,'fn falling(v:u32)->bool{return phase(v)==1u||liquid(v);}','fn falling(v:u32)->bool{return phase(v)==1u||liquid(v)||eligible(v);}') ;
  physics=replace(physics,'!fixed(cells[s])&&!fixed(cells[t])','!bound(s)&&!bound(t)');
  physics=replace(physics,'var outV=v;var outQ=q;','var outV=v;var outQ=q;var outS=structures[i];');
  physics=replace(physics,'outV=thermal((v&0xf0ff0000u)|m|(prop(m,20u)<<24u),q);','outV=thermal((v&0xf0ff0000u)|m|(prop(m,20u)<<24u),q);outS=select(0u,INTEGRITY|FRESH,eligible(outV));');
  physics=replace(physics,'outV=cells[other];outQ=energies[other];','outV=cells[other];outQ=energies[other];outS=structures[other];');
  physics=replace(physics,'nextCells[i]=outV;nextEnergies[i]=outQ;','nextCells[i]=outV;nextEnergies[i]=outQ;nextStructures[i]=outS;');

  const prefix=base.slice(0,base.indexOf('@compute'))+mechanical;
  const mechanics=prefix+`
// Header: changed, maxDistance, error, reserved, supportedWeight, reactionTotal.
// Planes: support distance, load, component root, blocked root, all members,
// non-root support members, and load receivers. Planes 2/3 cache DAG masks
// during load relaxation; componentInit replaces them for all listed members.
@group(0) @binding(9) var<storage,read_write> work:array<atomic<u32>>;
@group(0) @binding(10) var<storage,read> commands:array<vec4u>;
@group(0) @binding(11) var<storage,read_write> receipts:array<vec2u>;
@group(0) @binding(13) var<storage,read_write> queryWords:array<vec4u>;
@group(0) @binding(14) var<storage,read_write> solveDispatch:array<u32>;
@compute @workgroup_size(1) fn relaxStart(){
 atomicStore(&work[0],0u);solveDispatch[0]=select(0u,1u,atomicLoad(&work[13])!=0u);solveDispatch[1]=1u;solveDispatch[2]=1u;solveDispatch[3]=0u;
}
@compute @workgroup_size(1) fn relaxAdvance(){
 if(solveDispatch[0]!=0u){solveDispatch[3]++;}if(atomicExchange(&work[0],0u)==0u){solveDispatch[0]=0u;}
}
@compute @workgroup_size(1) fn relaxEnd(){
 // A nonzero budget flag rejects the attempt. The host resumes with the
 // general convergent solver; no fixed-iteration approximation is committed.
 if(solveDispatch[0]!=0u){atomicOr(&work[8],p.rule.x);}
 atomicStore(&work[8u+p.rule.y],solveDispatch[3]);
}
@compute @workgroup_size(64) fn queryCells(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;let size=p.rule.xyz;if(i>=size.x*size.y*size.z){return;}
 let c=p.tick.xyz+vec3u(i%size.x,(i/size.x)%size.y,i/(size.x*size.y));let j=index(vec3i(c));
 queryWords[i]=vec4u(cells[j],energies[j],structures[j],0u);
}
fn clearEditedBonds(i:u32){
 for(var dir=0u;dir<6u;dir++){let j=neighbor(i,dir);if(j!=INF){nextStructures[j]&=~bit(dir^1u);}}
 nextStructures[i]&=INTEGRITY|ANCHOR;
}
// One invocation applies an ordered bounded batch to a scratch bank. Host-side
// validation rejects malformed commands; state-dependent errors discard the bank.
@compute @workgroup_size(1) fn editBatch(){
 if(atomicLoad(&work[2])!=0u){return;}
 for(var k=p.tick.y;k<p.tick.z;k++){
  let e=commands[k];let i=storageOf(e.x);let old=nextEnergies[i];
  if(e.y==0u){
   clearEditedBonds(i);nextCells[i]=e.z;nextEnergies[i]=e.w;
   nextStructures[i]=select(0u,INTEGRITY,eligible(e.z));
   if(nextStructures[i]!=0u){for(var dir=0u;dir<6u;dir++){
    let j=neighbor(i,dir);if(j!=INF&&(nextStructures[j]&INTEGRITY)!=0u){nextStructures[i]|=bit(dir);nextStructures[j]|=bit(dir^1u);}
   }}
   changed(coordinate(i));
  }else if(e.y==1u){nextCells[i]=thermal(nextCells[i],e.z);nextEnergies[i]=e.z;}
  else{
   if(!eligible(nextCells[i])){atomicStore(&work[2],3u);return;}
   if(e.y==2u){if(e.z==0u){clearEditedBonds(i);}nextStructures[i]=(nextStructures[i]&~INTEGRITY)|e.z;}
   else if(e.y==3u){nextStructures[i]=select(nextStructures[i]&~ANCHOR,nextStructures[i]|ANCHOR,e.z!=0u);}
   else{
    let j=neighbor(i,e.z);if(j==INF){atomicStore(&work[2],4u);return;}
    if(e.w!=0u){
     if((nextStructures[i]&INTEGRITY)==0u||(nextStructures[j]&INTEGRITY)==0u){atomicStore(&work[2],5u);return;}
     nextStructures[i]|=bit(e.z);nextStructures[j]|=bit(e.z^1u);
    }else{nextStructures[i]&=~bit(e.z);nextStructures[j]&=~bit(e.z^1u);}
   }
  }
  receipts[k]=vec2u(old,nextEnergies[i]);
 }
}
fn address(plane:u32,i:u32)->u32{return 16u+plane*p.shape.w+i;}
fn planRead(plane:u32,i:u32)->u32{return atomicLoad(&work[address(plane,i)]);}
fn planWrite(plane:u32,i:u32,value:u32){atomicStore(&work[address(plane,i)],value);}
// Bond reachability plus downward contacts is exactly the component-blocking
// fixed point when damage/normalization preserve the graph and root predicates.
fn reachabilityPlan()->bool{return atomicLoad(&work[7])==0u;}
fn sameSupportGraph(a:u32,b:u32)->bool{return ((a^b)&(ANCHOR|16128u))==0u&&((a&INTEGRITY)==0u)==((b&INTEGRITY)==0u);}
fn weight(i:u32)->u32{return max(1u,(prop(cells[i],0u)+63u)/64u);}
fn strength(v:u32,q:u32,s:u32)->u32{
 let nominal=prop(v,22u)*16u;let soft=prop(v,23u);var remaining=16384u;
 if(soft!=0u){remaining=u32(clamp(i32((soft+64u)*256u)-i32(temperature(v,q)),0,16384));}
 return(nominal*(s&INTEGRITY)/255u)*remaining/16384u;
}
// An exact whole-world certificate, not a hash or spatial wake radius. Retain
// the global plan only if its graph/weights are unchanged and next tick's
// thermal damage is provably zero. Any changed dependency invalidates it all.
@compute @workgroup_size(64) fn certifyPlan(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=p.shape.w){return;}let s=nextStructures[i];
 let wasIntact=(structures[i]&INTEGRITY)!=0u;let isIntact=(s&INTEGRITY)!=0u;
 if(wasIntact!=isIntact){atomicAdd(&work[14],select(0xffffffffu,1u,isIntact));}
 if(structures[i]!=s){atomicStore(&work[6],1u);return;}
 if((s&INTEGRITY)!=0u){
  // Only intact cells contribute weight. Moving fluid elsewhere cannot change
  // the support graph. At contacts, compare the actual root predicate exactly.
  if(prop(cells[i],0u)!=prop(nextCells[i],0u)){atomicStore(&work[6],1u);return;}
  let below=neighbor(i,3u);
  if(below!=INF&&!intact(below)&&(structures[below]&ANCHOR)==0u){
   let before=prop(cells[i],0u)<=prop(cells[below],0u);
   let after=prop(nextCells[i],0u)<=prop(nextCells[below],0u);
   if(before!=after){atomicStore(&work[6],1u);return;}
  }
  let capacity=strength(nextCells[i],nextEnergies[i],s);if(capacity==0u||planRead(1u,i)>capacity){atomicStore(&work[6],1u);}
 }
}
fn obstacle(i:u32,j:u32)->bool{return (structures[j]&ANCHOR)!=0u||prop(cells[i],0u)<=prop(cells[j],0u);}
fn rootSupport(i:u32)->bool{
 let below=neighbor(i,3u);if((structures[i]&ANCHOR)!=0u||below==INF){return true;}
 return !intact(below)&&obstacle(i,below);
}
@compute @workgroup_size(64) fn supportInit(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=p.shape.w){return;}
 var d=INF;if(intact(i)&&rootSupport(i)){d=0u;}planWrite(0u,i,d);planWrite(1u,i,0u);
 // Every intact cell is appended exactly once. The list remains a superset
 // after damage; removed cells are rejected by the unchanged stage predicates.
 if(intact(i)){let ordinal=atomicAdd(&work[13],1u);planWrite(4u,ordinal,i);
  if(d!=0u){let support=atomicAdd(&work[15],1u);planWrite(5u,support,i);}
 }
}
@compute @workgroup_size(64) fn supportRelax(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=p.shape.w||!intact(i)){return;}var best=planRead(0u,i);if(best==0u){return;}
 for(var dir=0u;dir<6u;dir++){
  let j=neighbor(i,dir);if(j==INF||!intact(j)){continue;}
  if((structures[i]&bit(dir))!=0u||dir==3u){let d=planRead(0u,j);if(d!=INF){best=min(best,d+1u);}}
 }
 if(atomicMin(&work[address(0u,i)],best)>best){atomicStore(&work[0],1u);}
}
@compute @workgroup_size(64) fn supportSummary(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=p.shape.w){return;}let d=planRead(0u,i);
 if(d!=INF){atomicMax(&work[1],d);atomicAdd(&work[4],weight(i));}
}
// Each dispatch owns one support-distance level. Gather immutable child loads;
// canonical coordinate rank decides integer remainders independently of layout.
@compute @workgroup_size(64) fn loadLevel(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=p.shape.w||planRead(0u,i)!=p.tick.y){return;}var load=weight(i);let canonical=linear(coordinate(i));
 for(var dir=0u;dir<6u;dir++){
  let child=neighbor(i,dir);if(child==INF||!intact(child)||planRead(0u,child)!=p.tick.y+1u){continue;}
  if((structures[i]&bit(dir))==0u&&dir!=2u){continue;}
  var count=0u;var rank=0u;
  for(var side=0u;side<6u;side++){
   let parent=neighbor(child,side);if(parent==INF||!intact(parent)||planRead(0u,parent)!=p.tick.y){continue;}
   if((structures[child]&bit(side))!=0u||side==3u){count++;if(linear(coordinate(parent))<canonical){rank++;}}
  }
  if(count==0u){atomicStore(&work[2],1u);return;}
  let childLoad=planRead(1u,child);load+=childLoad/count+select(0u,1u,rank<childLoad%count);
 }
 planWrite(1u,i,load);if(p.tick.y==0u){atomicAdd(&work[5],load);}
}
@compute @workgroup_size(64) fn loadInit(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=p.shape.w){return;}let level=planRead(0u,i);planWrite(1u,i,select(weight(i),0u,level==INF));
 // Cache the fixed DAG in scratch planes that componentInit later replaces.
 // A leaf has its final own weight immediately; it never needs load relaxation.
 var parents=0u;var children=0u;
 if(level!=INF){for(var side=0u;side<6u;side++){
  let other=neighbor(i,side);if(other==INF||!intact(other)){continue;}
  let distance=planRead(0u,other);let bonded=(structures[i]&bit(side))!=0u;
  if(level>0u&&distance==level-1u&&(bonded||side==3u)){parents|=1u<<side;}
  if(distance==level+1u&&(bonded||side==2u)){children|=1u<<side;}
 }}
 planWrite(2u,i,parents);planWrite(3u,i,children);
 if(children!=0u){let receiver=atomicAdd(&work[3],1u);planWrite(6u,receiver,i);}
}
// On the fixed support-distance DAG, each predecessor's integer share is
// monotone in the child's load. Atomic maxima converge to the same exact load
// as the independent CPU reverse-BFS reduction, regardless of invocation order.
@compute @workgroup_size(64) fn loadRelax(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=p.shape.w){return;}let children=planRead(3u,i);if(children==0u){return;}
 var load=weight(i);
 for(var dir=0u;dir<6u;dir++){
  if((children&(1u<<dir))==0u){continue;}let child=neighbor(i,dir);
  // Canonical order is -Z, -Y, -X, +X, +Y, +Z in every supported shape.
  // These masks select the parent directions ordered before this receiver.
  let earlier=array<u32,6>(20u,21u,16u,23u,0u,31u);
  let parents=planRead(2u,child);let count=countOneBits(parents);
  let rank=countOneBits(parents&earlier[dir^1u]);
  if(count==0u){atomicStore(&work[2],1u);return;}
  let childLoad=planRead(1u,child);load+=childLoad/count+select(0u,1u,rank<childLoad%count);
 }
 if(atomicMax(&work[address(1u,i)],load)<load){atomicStore(&work[0],1u);}
}
@compute @workgroup_size(64) fn loadSummary(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i<p.shape.w&&planRead(0u,i)==0u){atomicAdd(&work[5],planRead(1u,i));}
}
@compute @workgroup_size(64) fn damage(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=p.shape.w){return;}let s=structures[i];let integrity=s&INTEGRITY;var result=s;
 if(integrity!=0u){
  let v=cells[i];let nominal=prop(v,22u)*16u;
  let capacity=strength(v,energies[i],s);let load=planRead(1u,i);var loss=0u;
  if(capacity==0u){loss=integrity;}else if(load>capacity){loss=min(integrity,max(1u,(load-capacity)*255u/nominal));}
  result=(s&~INTEGRITY)|(integrity-loss);
 }
 if(!sameSupportGraph(s,result)){atomicStore(&work[7],1u);}nextStructures[i]=result;
}
fn normalizedStructure(i:u32)->u32{
 var s=0u;
 if(eligible(cells[i])){
  s=structures[i]&(INTEGRITY|ANCHOR);
  if((s&INTEGRITY)!=0u){for(var dir=0u;dir<6u;dir++){
   let j=neighbor(i,dir);if(j==INF||!eligible(cells[j])||!intact(j)){continue;}
   if(((structures[i]&bit(dir))!=0u&&(structures[j]&bit(dir^1u))!=0u)||((structures[i]|structures[j])&FRESH)!=0u){s|=bit(dir);}
  }}
 }
 return s;
}
@compute @workgroup_size(64) fn normalize(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=p.shape.w){return;}nextStructures[i]=normalizedStructure(i);
}
@compute @workgroup_size(64) fn normalizePlan(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=p.shape.w){return;}let s=normalizedStructure(i);
 if(!sameSupportGraph(structures[i],s)){atomicStore(&work[7],1u);}nextStructures[i]=s;
}
@compute @workgroup_size(64) fn componentInit(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=p.shape.w||reachabilityPlan()){return;}planWrite(2u,i,select(INF,linear(coordinate(i)),intact(i)));planWrite(3u,i,0u);
}
@compute @workgroup_size(64) fn componentRelax(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=p.shape.w||!intact(i)){return;}var root=planRead(2u,i);
 let previousRoot=root;
 for(var dir=0u;dir<6u;dir++){if((structures[i]&bit(dir))!=0u){root=min(root,planRead(2u,neighbor(i,dir)));}}
 // Pointer compression accelerates long components without changing the fixed point.
 root=min(root,planRead(2u,storageOf(root)));
 // Hook the previous representative too. Both labels belong to this bonded
 // component, and every write strictly decreases a canonical index. This
 // accelerates propagation through large anchored floors without merging
 // unbonded contacts or changing the unique minimum-index fixed point.
 if(atomicMin(&work[address(2u,storageOf(previousRoot))],root)>root){atomicStore(&work[0],1u);}
 if(atomicMin(&work[address(2u,i)],root)>root){atomicStore(&work[0],1u);}
}
@compute @workgroup_size(64) fn blockInit(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=p.shape.w||!intact(i)){return;}
 if(rootSupport(i)){atomicStore(&work[address(3u,storageOf(planRead(2u,i)))],1u);}
}
@compute @workgroup_size(64) fn blockRelax(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=p.shape.w||!intact(i)){return;}let below=neighbor(i,3u);
 if(below==INF||!intact(below)){return;}let root=storageOf(planRead(2u,i));let lower=storageOf(planRead(2u,below));
 if(root!=lower&&planRead(3u,lower)!=0u&&atomicOr(&work[address(3u,root)],1u)==0u){atomicStore(&work[0],1u);}
}
fn moving(i:u32)->bool{if(!intact(i)){return false;}if(reachabilityPlan()){return planRead(0u,i)==INF;}return planRead(3u,storageOf(planRead(2u,i)))==0u;}
@compute @workgroup_size(64) fn applyMotion(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=p.shape.w){return;}let above=neighbor(i,2u);var source=i;
 if(above!=INF&&moving(above)){source=above;}
 else if(moving(i)){
  // Only a run's vacated top receives its displaced bottom cell.
  var found=false;
  for(var y=1u;y<p.shape.y;y++){
   let c=coordinate(i)+vec3i(0,i32(y),0);if(!inside(c)){break;}
   let j=index(c);if(!moving(j)){source=j;found=true;break;}
  }
  if(!found){atomicStore(&work[2],2u);return;}
 }
 nextCells[i]=cells[source];nextEnergies[i]=energies[source];nextStructures[i]=structures[source];
 if((cells[i]&255u)!=(cells[source]&255u)){changed(coordinate(i));}
}
`;
  let compact=mechanics;
  for(const stage of STRUCTURAL_LIST_STAGES){
    const prefix=`@compute @workgroup_size(64) fn ${stage}(@builtin(global_invocation_id) id:vec3u){\n let i=id.x;`;
    const sleeping=((STRUCTURAL_RELAX_STAGES as readonly string[]).includes(stage)?'if(solveDispatch[0]==0u){return;}':'')+(['componentRelax','blockInit','blockRelax'].includes(stage)?'if(reachabilityPlan()){return;}':'');
    const [header,plane]=stage==='supportRelax'?[15,5]:stage==='loadRelax'?[3,6]:[13,4];
    compact=replace(compact,prefix,prefix.replace('@workgroup_size(64)','@workgroup_size(256)').replace('let i=id.x;',
      sleeping+`let ordinal=id.x;if(ordinal>=atomicLoad(&work[${header}])){return;}let i=planRead(${plane}u,ordinal);`));
  }
  const specialize=(source:string)=>`const SHAPE=vec4u(${shape.join('u,')}u,${shape.reduce((a,b)=>a*b,1)}u);\n`+source.replaceAll('p.shape','SHAPE');
  return{physics:specialize(physics),mechanics:specialize(compact)};
}
