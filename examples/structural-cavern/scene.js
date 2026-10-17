import {createStateSpaceStructuralWorld3D,MAT,PHASE,INTEGRITY_3D,BONDS_3D,ANCHOR_3D} from '../../dist/sdk/state-space-structural-world.js';
export const SCENE_VERSION='structural-chambers-1';
export const SCENARIOS=['control','cut','heat','ice-control','ice-heat'];
export function createStructuralLevel(size=32,scenario='control',chunkSize=size===128?16:8){
 if(![32,64,128].includes(size)||!SCENARIOS.includes(scenario))throw Error('Choose a 32/64/128 structural chamber and known scenario.');
 const ice=scenario.startsWith('ice'),cx=size/2,cz=size/2,deckY=size/2-2,left=cx-6,right=cx+6;
 const field=createStateSpaceStructuralWorld3D({width:size,height:size,depth:size,chunkSize}),snapshot=field.snapshot(),palette=new Map();
 for(const material of [MAT.AIR,MAT.STONE,MAT.ICE,MAT.WATER,MAT.LAVA, MAT.GLASS]){
  const sample=createStateSpaceStructuralWorld3D({width:4,height:4,depth:4,chunkSize:4});
  sample.setCell(0,0,0,material,material===MAT.LAVA?255:material===MAT.WATER?25:0);
  if(material===MAT.LAVA)sample.setEnergy(0,0,0,1000*256);
  const s=sample.snapshot();palette.set(material,[s.packedCells[0],s.energyQ[0]]);
 }
 const at=(x,y,z)=>x+size*(y+size*z),put=(x,y,z,material,anchor=false)=>{
  const i=at(x,y,z),[v,q]=palette.get(material);snapshot.packedCells[i]=v;snapshot.energyQ[i]=q;
  snapshot.structure[i]=([PHASE.SOLID,PHASE.FROZEN].includes((v>>>24)&15)?INTEGRITY_3D:0)|(anchor?ANCHOR_3D:0);
 };
 snapshot.packedCells.fill(palette.get(MAT.AIR)[0]);snapshot.energyQ.fill(0);
 // Finite stone chamber. The floor and outer walls are explicit world anchors.
 for(let z=0;z<size;z++)for(let x=0;x<size;x++)put(x,size-1,z,MAT.STONE,true);
 for(let y=Math.max(0,deckY-7);y<size-1;y++)for(let p=0;p<size;p++){
  put(0,y,p,MAT.STONE,true);put(size-1,y,p,MAT.STONE,true);put(p,y,0,MAT.STONE,true);put(p,y,size-1,MAT.STONE,true);
 }
 // Abutments have anchored undersides; the five-voxel-wide deck is bonded to
 // their inner edges. Cutting/melting both end bands detaches the whole span.
 for(let z=cz-5;z<=cz+5;z++)for(let y=deckY;y<=deckY+3;y++)for(let x=1;x<size-1;x++)
  if(x<left||x>right)put(x,y,z,MAT.STONE,y===deckY+3);
 for(let z=cz-2;z<=cz+2;z++)for(let x=left;x<=right;x++)put(x,deckY,z,ice?MAT.ICE:MAT.STONE);
 const supports=[];for(const x of [left,right])for(let z=cz-2;z<=cz+2;z++)supports.push({x,y:deckY,z});
 // A closed, finite basin is far enough below the deck for an intact control.
 for(let z=cz-4;z<=cz+4;z++)for(let x=cx-7;x<=cx+7;x++)for(let y=deckY+9;y<=deckY+13;y++){
  const wall=y===deckY+13||x===cx-7||x===cx+7||z===cz-4||z===cz+4;
  if(wall)put(x,y,z,MAT.STONE,true);
  else if(y>=deckY+10)put(x,y,z,ice?MAT.WATER:MAT.LAVA);
 }
 // Establish reciprocal placement bonds canonically. Contact during simulation
 // never calls this constructor and cannot weld fragments back together.
 for(let z=0;z<size;z++)for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const i=at(x,y,z);if(!(snapshot.structure[i]&INTEGRITY_3D))continue;
  for(const [dir,j,inside] of [[1,i+1,x+1<size],[3,i+size,y+1<size],[5,i+size*size,z+1<size]])
   if(inside&&(snapshot.structure[j]&INTEGRITY_3D)){snapshot.structure[i]|=BONDS_3D[dir];snapshot.structure[j]|=BONDS_3D[dir^1];}
 }
 field.restore(snapshot);
 const player={x:(cx-9)*256,y:deckY*256,z:cz*256,vy:0,grounded:true,wet:false,jumpHeld:false,cooldown:0,blocked:false};
 return{field,size,scenario,version:SCENE_VERSION,deckY,center:[cx,deckY,cz],supports,
  actor:{player,look:[256,0,0],status:'playing',carved:false,iceWalk:false},
  rules:{goal:{minX:(cx+9)*256,maxY:deckY*256+1,minZ:(cz-2)*256,maxZ:(cz+2)*256},fallY:(deckY+10)*256,toolCeiling:size-1},
  expected:{stableThrough:scenario.endsWith('control')?1024:179,failureWindow:scenario.endsWith('control')?null:scenario==='ice-heat'?[181,183]:[180,180]},
 };
}
export function structuralAction(level,action){
 if(!['cut','heat','melt'].includes(action))throw Error('Unknown structural action.');
 return level.supports.map(c=>action==='cut'?{kind:'material',...c,material:MAT.AIR,thermal:0}:{kind:'energy',...c,energyQ:(action==='melt'?60:1000)*256});
}
export function fixtureEdits(level,tick,actionTick=180){
 if(tick!==actionTick)return[];
 return level.scenario==='cut'?structuralAction(level,'cut'):level.scenario==='heat'?structuralAction(level,'heat'):level.scenario==='ice-heat'?structuralAction(level,'melt'):[];
}
export function scriptedInput(level,tick){
 // Walk onto the span during warmup, hold for its failure, then try to finish.
 const moveX=tick<=44||tick>=240&&tick<350?256:0;
 return{tick,moveX,moveZ:0,jump:false,tool:'none',look:[256,0,0]};
}
