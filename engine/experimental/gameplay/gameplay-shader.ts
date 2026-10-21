import { VOLUME_SHADER } from '../volume/3d-shader.js';
import { MAT } from '../../generated/materials.js';
import type { GameplayRules3D } from './gameplay-view.js';

/** Same integer controller/order as the CPU examples; terrain law is untouched. */
export function gameplayShader(
  shape: readonly number[],
  edge: number,
  sparse: boolean,
  rules: GameplayRules3D,
  air: readonly number[],
) {
  const [w, h, d] = shape,
    active = Math.min(edge, 8),
    tiles = (w * h * d) / active ** 3;
  const thermal = VOLUME_SHADER.slice(
    VOLUME_SHADER.indexOf('fn prop('),
    VOLUME_SHADER.indexOf('fn phase('),
  );
  return `
const SHAPE=vec3i(${w},${h},${d});const EDGE=${edge}u;const ACTIVE=${active}u;
const MAX_Q=0x3fffffffu;
@group(0) @binding(0) var<storage,read_write> cells:array<u32>;
@group(0) @binding(1) var<storage,read_write> energies:array<u32>;
@group(0) @binding(2) var<storage,read> cold:array<u32>;
// player[0..8], status[9], event flags[10], look[11..13], cache origin[14..16].
@group(0) @binding(3) var<storage,read_write> actor:array<i32>;
@group(0) @binding(4) var<storage,read_write> cache:array<u32>;
@group(0) @binding(5) var<storage,read_write> result:array<u32>;
struct Command {controls:vec4i,lookTick:vec4i,view:vec4i}
@group(0) @binding(6) var<uniform> command:Command;
@group(0) @binding(7) var<storage,read_write> dirty:array<atomic<u32>>;
${sparse ? '@group(0) @binding(8) var<storage,read_write> activity:array<atomic<u32>>;' : ''}
${thermal}
fn index(c:vec3i)->u32{let u=vec3u(c);let n=vec3u(SHAPE)/EDGE;let k=u/EDGE;let l=u%EDGE;return (k.x+n.x*(k.y+n.y*k.z))*EDGE*EDGE*EDGE+l.x+EDGE*(l.y+EDGE*l.z);}
// WGSL signed division truncates; voxel coordinates require mathematical floor.
fn floorQ(v:i32)->i32{return select((v-255)/256,v/256,v>=0);}
fn floorVector(v:vec3i)->vec3i{return vec3i(floorQ(v.x),floorQ(v.y),floorQ(v.z));}
fn origin()->vec3i{return vec3i(actor[14],actor[15],actor[16]);}
fn eye()->vec3i{return vec3i(actor[0],actor[1]-400,actor[2]);}
fn cachedCell(c:vec3i)->u32{
 if(any(c<vec3i(0))||any(c>=SHAPE)){return 1u;}
 let l=c-origin();if(any(l<vec3i(0))||any(l>=vec3i(16))){result[25]=1u;return 1u;}
 return cache[u32(l.x+16*(l.y+16*l.z))];
}
fn ray(look:vec3i)->vec4i{
 var previous=vec3i(-1000000);
 for(var n=0;n<=160;n++){
  let c=floorVector(eye()+look*n/32);if(all(c==previous)){continue;}previous=c;
  if(any(c<vec3i(0))||any(c>=SHAPE)||any(c<origin())||any(c>=origin()+vec3i(16))){return vec4i(0,0,0,-1);}
  let m=i32(cachedCell(c)&255u);if(m!=0&&m!=9){return vec4i(c,m);}
 }
 return vec4i(0,0,0,-1);
}
fn solid(v:u32)->bool{let p=(v>>24u)&15u;return p==0u||p==1u||p==6u;}
fn overlaps(p:vec3i)->bool{
 let lo=floorVector(p-vec3i(77,448,77));let hi=floorVector(p+vec3i(76,-1,76));
 for(var z=lo.z;z<=hi.z;z++){for(var y=lo.y;y<=hi.y;y++){for(var x=lo.x;x<=hi.x;x++){if(solid(cachedCell(vec3i(x,y,z)))){return true;}}}}
 return false;
}
fn position()->vec3i{return vec3i(actor[0],actor[1],actor[2]);}
fn sweep(axis:u32,velocity:i32)->bool{
 let direction=sign(velocity);var remaining=abs(velocity);
 // Speeds are bounded by 150 Q; retain the CPU's segmented sweep semantics.
 while(remaining>0){
  let distance=min(remaining,256);let start=actor[axis];actor[axis]=start+distance*direction;
  if(overlaps(position())){
   var low=0;var high=distance;
   while(low+1<high){let mid=(low+high)/2;actor[axis]=start+mid*direction;if(overlaps(position())){high=mid;}else{low=mid;}}
   actor[axis]=start+low*direction;return true;
  }
  remaining-=distance;
 }
 return false;
}
fn emit(kind:u32,count:u32,location:vec3i){
 let slot=result[14];if(slot>=4u){result[25]=2u;return;}let base=32u+slot*8u;
 result[base]=kind;result[base+1u]=u32(command.lookTick.w);result[base+2u]=count;
 result[base+3u]=u32(location.x);result[base+4u]=u32(location.y);result[base+5u]=u32(location.z);result[14]=slot+1u;
}
fn mark(c:vec3i){let n=vec3u(SHAPE)/EDGE;let k=vec3u(c)/EDGE;atomicStore(&dirty[k.x+n.x*(k.y+n.y*k.z)],1u);}
fn changed(c:vec3i){
 mark(c);for(var a=0u;a<3u;a++){for(var sign=-1;sign<=1;sign+=2){var t=c;t[a]+=sign;
  if(all(t>=vec3i(0))&&all(t<SHAPE)&&(u32(c[a])/EDGE!=u32(t[a])/EDGE)){mark(t);}
 }}
}
fn wakeEdit(c:vec3i){${
    sparse
      ? `
 let n=SHAPE/i32(ACTIVE);let k=c/i32(ACTIVE);let l=vec3u(c)%ACTIVE;
 let lo=-vec3i(select(vec3u(0),vec3u(1),l<vec3u(2)));let hi=vec3i(select(vec3u(0),vec3u(1),l+vec3u(2)>=vec3u(ACTIVE)));
 atomicStore(&activity[10],1u);
 for(var z=lo.z;z<=hi.z;z++){for(var y=lo.y;y<=hi.y;y++){for(var x=lo.x;x<=hi.x;x++){
  let t=k+vec3i(x,y,z);if(all(t>=vec3i(0))&&all(t<n)){let j=u32(t.x+n.x*(t.y+n.y*t.z));atomicStore(&activity[16u+j],1u);atomicOr(&activity[${16 + 3 * tiles}u+j],16u);}
 }}}
 `
      : ''
  }}
fn beginFrame(){for(var k=0u;k<128u;k++){result[k]=0u;}if(actor[7]>0){actor[7]--;}}
// A known no-tool command must not acquire write access to the terrain or activity buffers.
@compute @workgroup_size(1) fn noTools(){beginFrame();}
@compute @workgroup_size(1) fn tools(){
 beginFrame();
 if(command.controls.w==0||actor[7]!=0||actor[9]==2){return;}
 let hit=ray(command.lookTick.xyz);if(hit.w<0){return;}
 var count=0u;
 for(var z=hit.z-1;z<=hit.z+1;z++){for(var y=hit.y-1;y<=hit.y+1;y++){for(var x=hit.x-1;x<=hit.x+1;x++){
  let c=vec3i(x,y,z);if(any(c<vec3i(1))||x>=SHAPE.x-1||z>=SHAPE.z-1||y>=${rules.toolCeiling}){continue;}
  let m=cachedCell(c)&255u;let carve=command.controls.w==1&&(m==${MAT.STONE}u||m==${MAT.GLASS}u||m==${MAT.SAND}u||m==${MAT.ICE}u);
  let freeze=command.controls.w==2&&(m==${MAT.WATER}u||m==${MAT.ICE}u);if(!carve&&!freeze){continue;}
  let i=index(c);let old=energies[i];var q=0u;
  if(carve){cells[i]=${air[0]}u;q=${air[1]}u;changed(c);}else{cells[i]=thermal(cells[i],0u);}
  energies[i]=q;result[64u+count*2u]=old;result[65u+count*2u]=q;count++;wakeEdit(c);
 }}}
 result[15]=count;
 if(count>0u){actor[7]=6;if(command.controls.w==1){actor[10]|=1;}emit(u32(command.controls.w),count,hit.xyz);}
}
@compute @workgroup_size(64) fn cacheRegion(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=4096u){return;}
 // Every lane derives the same origin from immutable position coordinates.
 // Only lane zero stores metadata; no lane reads it during this dispatch.
 let o=clamp(floorVector(position()-vec3i(0,224,0))-vec3i(8),vec3i(0),SHAPE-vec3i(16));
 if(id.x==0u){actor[14]=o.x;actor[15]=o.y;actor[16]=o.z;}
 let c=o+vec3i(i32(id.x%16u),i32((id.x/16u)%16u),i32(id.x/256u));cache[id.x]=cells[index(c)];
}
fn output(){
 for(var k=0u;k<14u;k++){result[k]=bitcast<u32>(actor[k]);}
 let e=vec3f(eye())/256.0;result[16]=bitcast<u32>(e.x);result[17]=bitcast<u32>(e.y);result[18]=bitcast<u32>(e.z);result[19]=0u;
 let hit=ray(command.view.xyz);result[20]=0xffffffffu;
 if(hit.w>=0){result[20]=u32(hit.x+SHAPE.x*(hit.y+SHAPE.y*hit.z));result[21]=u32(hit.w);result[22]=u32(hit.x);result[23]=u32(hit.y);result[24]=u32(hit.z);}
}
@compute @workgroup_size(1) fn locomotion(){
 actor[11]=command.lookTick.x;actor[12]=command.lookTick.y;actor[13]=command.lookTick.z;
 if(actor[9]!=2){
  if(overlaps(position())){
   var freed=false;for(var d=1;d<=3;d++){if(!overlaps(position()-vec3i(0,d*256,0))){actor[1]-=d*256;actor[3]=0;freed=true;break;}}
   if(!freed){actor[9]=2;emit(3u,0u,vec3i(0));}
  }
  if(actor[9]!=2){
   let wet=(cachedCell(floorVector(position()-vec3i(0,128,0)))&255u)==2u;actor[5]=i32(wet);
   if(command.controls.z!=0&&((actor[4]!=0&&actor[6]==0)||wet)){actor[3]=select(-115,-65,wet);}
   actor[3]=min(select(150,45,wet),actor[3]+select(8,4,wet));let speed=select(48,28,wet);
   let blockedX=sweep(0u,command.controls.x*speed/256);let blockedZ=sweep(2u,command.controls.y*speed/256);actor[8]=i32(blockedX||blockedZ);
   let hit=sweep(1u,actor[3]);let falling=actor[3]>0;if(hit){actor[3]=0;}
   actor[4]=i32((hit&&falling)||overlaps(position()+vec3i(0,1,0)));
   let under=cachedCell(floorVector(position()))&255u;
   if(actor[4]!=0&&under==${MAT.ICE}u&&(actor[10]&2)==0){actor[10]|=2;emit(4u,0u,vec3i(0));}
   if(actor[9]==0&&actor[0]>=${rules.goal.minX}&&actor[1]<=${rules.goal.maxY}&&actor[2]>=${rules.goal.minZ}&&actor[2]<=${rules.goal.maxZ}&&(actor[10]&3)==3){actor[9]=1;emit(5u,0u,vec3i(0));}
   if(actor[1]>${rules.fallY}){actor[9]=2;emit(6u,0u,vec3i(0));}
  }
 }
 actor[6]=command.controls.z;output();
}
@compute @workgroup_size(1) fn present(){for(var k=0u;k<128u;k++){result[k]=0u;}output();}
`;
}
