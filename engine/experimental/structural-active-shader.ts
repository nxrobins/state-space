/** M5 local-pass activity. Structural dependencies solve globally to completion. */
export function structuralActivityShaders(physics:string,edge:number,chunks:number){
  const declarations=`
const M5_CHUNKS=${chunks}u;
const M5_AWAKE=M5_CHUNKS;
const M5_LIST=M5_AWAKE+M5_CHUNKS;
const M5_COUNT=M5_LIST+M5_CHUNKS;
fn wakeLocal(c:vec3i){
 let n=vec3i(SHAPE.xyz/EDGE);let k=c/i32(EDGE);let local=vec3u(c)%EDGE;
 let lo=-vec3i(select(vec3u(0),vec3u(1),local<vec3u(2)));
 let hi=vec3i(select(vec3u(0),vec3u(1),local+vec3u(2)>=vec3u(EDGE)));
 for(var z=lo.z;z<=hi.z;z++){for(var y=lo.y;y<=hi.y;y++){for(var x=lo.x;x<=hi.x;x++){
  let t=k+vec3i(x,y,z);if(all(t>=vec3i(0))&&all(t<n)){atomicStore(&dirty[M5_AWAKE+u32(t.x+n.x*(t.y+n.y*t.z))],1u);}
 }}}
}
// Every parity/direction is considered. Tick order alone cannot awaken a tile.
fn locallyQuiet(i:u32)->bool{
 let v=cells[i];let q=energies[i];let c=coordinate(i);let immovable=bound(i);
 if(thermal(v,q)!=v||transition(v,q)!=(v&255u)){return false;}
 for(var f=0u;f<6u;f++){
  let t=c+NORMALS[f];if(!inside(t)){continue;}let j=index(t);let other=cells[j];
  if(((v&255u)!=(other&255u)||q!=energies[j])&&pairEnergy(v,other,q,energies[j])!=q){return false;}
  if(immovable){continue;}
  if(f==2u){if(rise(i,j)||fall(j,i)){return false;}}
  else if(f==3u){if(fall(i,j)||rise(j,i)){return false;}}
  else{
   if(spread(i,j)||spread(j,i)){return false;}
   if(gas(v)&&gas(other)&&(((v&255u)!=0u&&((other&255u)==0u||rank(i)>rank(j)+16))||((other&255u)!=0u&&((v&255u)==0u||rank(j)>rank(i)+16)))){return false;}
  }
 }
 if(immovable){return true;}
 for(var f=0u;f<6u;f++){
  if(f==2u||f==3u){continue;}
  let down=c+NORMALS[f]+vec3i(0,1,0);if(inside(down)&&fall(i,index(down))){return false;}
  let up=c+NORMALS[f]-vec3i(0,1,0);if(inside(up)&&fall(index(up),i)){return false;}
 }
 return true;
}
@compute @workgroup_size(64) fn certifyLocal(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=SHAPE.w){return;}if(!locallyQuiet(i)){wakeLocal(coordinate(i));}
}
@group(0) @binding(12) var<storage,read_write> localDispatch:array<u32>;
@compute @workgroup_size(1) fn collectLocal(){
 var count=0u;
 for(var k=0u;k<M5_CHUNKS;k++){if(atomicLoad(&dirty[M5_AWAKE+k])!=0u){atomicStore(&dirty[M5_LIST+count],k);count++;}}
 atomicStore(&dirty[M5_COUNT],count);atomicAdd(&dirty[M5_COUNT+1u],count);atomicMax(&dirty[M5_COUNT+2u],count);
 localDispatch[0]=count*EDGE*EDGE*EDGE/64u;localDispatch[1]=1u;localDispatch[2]=1u;
}
`;
  const marker='@compute @workgroup_size(64) fn main';
  const prefix=physics.slice(0,physics.indexOf(marker)),planning=prefix+declarations;
  const body=physics.slice(physics.indexOf(marker))
    .replace('let i=id.x; if(i>=SHAPE.w){return;}','let i=atomicLoad(&dirty[M5_LIST+id.x/(EDGE*EDGE*EDGE)])*EDGE*EDGE*EDGE+id.x%(EDGE*EDGE*EDGE);')
    .replace('nextCells[i]=outV;nextEnergies[i]=outQ;nextStructures[i]=outS;',
      'if(v!=outV||q!=outQ||structures[i]!=outS){wakeLocal(coordinate(i));}\n  nextCells[i]=outV;nextEnergies[i]=outQ;nextStructures[i]=outS;');
  if(!body.includes('let i=atomicLoad'))throw Error('M5 active template differs.');
  // Only the planner writes the work list/dispatch. Main wakes the next pass.
  return{physics:planning+body,planning,edge};
}
