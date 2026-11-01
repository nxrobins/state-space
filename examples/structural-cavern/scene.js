import {createStateSpaceStructuralWorld3D,MAT,PHASE,INTEGRITY_3D,BONDS_3D,ANCHOR_3D} from '../../dist/sdk/state-space-structural-world.js';
export const SCENE_VERSION='structural-chambers-1';
export const SCENARIOS=['control','cut','heat','ice-control','ice-heat'];
/** Reactive chambers bind a validated catalog (ca-3d-m6). They never share the legacy identity or its receipts. */
export const REACTIVE_SCENE_VERSION='structural-chambers-reactive-1';
export const REACTIVE_SCENARIOS=['burning-bridge','thermal-valve','thermal-valve-ceramic'];
export const ACTION_TICK=180;
/** Ticks the valve's copper rod is held at its source temperature, from the action tick on. */
export const VALVE_SOURCE_TICKS=32;
const isReactive=scenario=>REACTIVE_SCENARIOS.includes(scenario);
/** Pack IDs come from the bound catalog by name, never from a hard-coded ID. */
function catalogId(catalog,name){
 const id=catalog.materialIds.find(id=>catalog.material(id).name===name);
 if(id===undefined)throw Error(`The catalog does not define ${name}.`);return id;
}
export function createStructuralLevel(size=32,scenario='control',chunkSize=size===128?16:8,catalog){
 if(![32,64,128].includes(size)||!(SCENARIOS.includes(scenario)||isReactive(scenario)))throw Error('Choose a 32/64/128 structural chamber and known scenario.');
 const reactive=isReactive(scenario);
 if(reactive&&!(catalog&&typeof catalog==='object'&&typeof catalog.hash==='string'&&typeof catalog.material==='function'))throw Error('Reactive chambers require a validated reactive material catalog.');
 if(!reactive&&catalog!==undefined)throw Error('Legacy chambers keep their catalog-free identity.');
 const registry=reactive?{registry:catalog}:{};
 // Legacy chambers start at thermal 0 with a lava basin that melts its own walls and drains to the
 // chamber floor before tick 25. Reactive chambers start at the catalog's ambient (20) with a water
 // basin, so the plug's water stays liquid, the basin still exists at tick 180 and the wooden span
 // sinks to a floor at a fixed depth.
 const ice=scenario.startsWith('ice'),ambient=reactive?20:0,cx=size/2,cz=size/2,deckY=size/2-2,left=cx-6,right=cx+6;
 const field=createStateSpaceStructuralWorld3D({width:size,height:size,depth:size,chunkSize,...registry}),snapshot=field.snapshot(),palette=new Map();
 const pack=reactive?{WOOD:MAT.WOOD,COPPER:catalogId(catalog,'copper'),CERAMIC:catalogId(catalog,'ceramic'),WAX:catalogId(catalog,'wax')}:{};
 for(const material of [MAT.AIR,MAT.STONE,MAT.ICE,MAT.WATER,MAT.LAVA, MAT.GLASS,...Object.values(pack)]){
  const sample=createStateSpaceStructuralWorld3D({width:4,height:4,depth:4,chunkSize:4,...registry});
  sample.setCell(0,0,0,material,material===MAT.LAVA?255:material===MAT.WATER&&!reactive?25:ambient);
  if(material===MAT.LAVA)sample.setEnergy(0,0,0,1000*256);
  const s=sample.snapshot();palette.set(material,[s.packedCells[0],s.energyQ[0]]);
 }
 const at=(x,y,z)=>x+size*(y+size*z),put=(x,y,z,material,anchor=false)=>{
  const i=at(x,y,z),[v,q]=palette.get(material);snapshot.packedCells[i]=v;snapshot.energyQ[i]=q;
  snapshot.structure[i]=([PHASE.SOLID,PHASE.FROZEN].includes((v>>>24)&15)?INTEGRITY_3D:0)|(anchor?ANCHOR_3D:0);
 };
 snapshot.packedCells.fill(palette.get(MAT.AIR)[0]);snapshot.energyQ.fill(palette.get(MAT.AIR)[1]);
 // Finite stone chamber. The floor and outer walls are explicit world anchors.
 for(let z=0;z<size;z++)for(let x=0;x<size;x++)put(x,size-1,z,MAT.STONE,true);
 for(let y=Math.max(0,deckY-7);y<size-1;y++)for(let p=0;p<size;p++){
  put(0,y,p,MAT.STONE,true);put(size-1,y,p,MAT.STONE,true);put(p,y,0,MAT.STONE,true);put(p,y,size-1,MAT.STONE,true);
 }
 // Abutments have anchored undersides; the five-voxel-wide deck is bonded to
 // their inner edges. Cutting/melting both end bands detaches the whole span.
 for(let z=cz-5;z<=cz+5;z++)for(let y=deckY;y<=deckY+3;y++)for(let x=1;x<size-1;x++)
  if(x<left||x>right)put(x,y,z,MAT.STONE,y===deckY+3);
 // The burning bridge is a wooden span whose end bands are pinned; the bands beside them are
 // its supports, consumed by fire. Every other chamber keeps the legacy stone or ice deck.
 const wooden=scenario==='burning-bridge',deckMaterial=wooden?MAT.WOOD:ice?MAT.ICE:MAT.STONE;
 for(let z=cz-2;z<=cz+2;z++)for(let x=left;x<=right;x++)put(x,deckY,z,deckMaterial,wooden&&(x===left||x===right));
 const supports=[];for(const x of wooden?[left+1,right-1]:[left,right])for(let z=cz-2;z<=cz+2;z++)supports.push({x,y:deckY,z});
 // A closed, finite basin is far enough below the deck for an intact control.
 for(let z=cz-4;z<=cz+4;z++)for(let x=cx-7;x<=cx+7;x++)for(let y=deckY+9;y<=deckY+13;y++){
  const wall=y===deckY+13||x===cx-7||x===cx+7||z===cz-4||z===cz+4;
  if(wall)put(x,y,z,MAT.STONE,true);
  else if(y>=deckY+10)put(x,y,z,ice||reactive?MAT.WATER:MAT.LAVA);
 }
 // The thermal valve: a ceramic-walled water column over the basin, held by a wax plug at the
 // deck's level. A three-cell copper rod enters the column beside the plug; its far cell is the
 // sustained source. The ceramic toggle replaces the rod's middle cell, blocking the heat path.
 let valve;
 if(scenario.startsWith('thermal-valve')){
  const vx=cx+4,vz=cz+3,plugY=deckY+1,height=size/8,top=plugY-height,ceramicRod=scenario==='thermal-valve-ceramic';
  const column=[],walls=[];
  for(let y=top;y<=plugY;y++)for(const [x,z] of [[vx-1,vz],[vx+1,vz],[vx,vz-1],[vx,vz+1]])if(!(y===plugY&&x===vx-1))walls.push([x,y,z]);
  for(const [x,y,z] of walls)put(x,y,z,pack.CERAMIC,true);
  for(let y=top;y<plugY;y++){put(vx,y,vz,MAT.WATER);column.push([vx,y,vz]);}
  put(vx,plugY,vz,pack.WAX);
  const rod=[[vx-1,plugY,vz],[vx-2,plugY,vz],[vx-3,plugY,vz]];
  for(const [k,[x,y,z]] of rod.entries())put(x,y,z,k===1&&ceramicRod?pack.CERAMIC:pack.COPPER,true);
  valve={column,walls,plug:[vx,plugY,vz],plugMaterial:pack.WAX,rod,source:rod[2],ceramicRod};
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
 const level={field,size,scenario,version:reactive?REACTIVE_SCENE_VERSION:SCENE_VERSION,deckY,center:[cx,deckY,cz],supports,
  actor:{player,look:[256,0,0],status:'playing',carved:false,iceWalk:false},
  rules:{goal:{minX:(cx+9)*256,maxY:deckY*256+1,minZ:(cz-2)*256,maxZ:(cz+2)*256},fallY:(deckY+10)*256,toolCeiling:size-1},
  expected:{stableThrough:scenario.endsWith('control')?1024:179,failureWindow:scenario.endsWith('control')?null:scenario==='ice-heat'?[181,183]:[180,180]},
 };
 if(!reactive)return level;
 level.rulesVersion=field.rulesVersion;level.catalogHash=catalog.hash;level.deckMaterial=deckMaterial;
 level.ignitionEnergyQ=(catalog.material(MAT.WOOD).properties.fuel_energy+300)*256;
 if(wooden){
  const deck=[];for(let z=cz-2;z<=cz+2;z++)for(let x=left+1;x<right;x++)deck.push([x,deckY,z]);
  level.span={cells:deck,pinnedX:[left,right],restY:deckY+12};
  level.expected=reactiveExpectations('burning-bridge');
 }else{level.valve=valve;level.expected=reactiveExpectations(scenario);}
 return level;
}
/** The authored trajectory length; hold-through windows equal to it span the whole run and never move. */
export const TRAJECTORY_TICKS=1024;
/** Deterministic windows measured on the CPU oracle with the action at tick 180 (32^3 and 64^3 agree); see the M6 checkpoint. */
function reactiveExpectations(scenario){
 const actionTick=ACTION_TICK;
 if(scenario==='burning-bridge')return{stableThrough:actionTick-1,failureWindow:[actionTick,actionTick],ignitionTick:actionTick,firstReactionTick:actionTick,spanOnFloorTick:actionTick+11};
 const hold=scenario==='thermal-valve-ceramic';
 return{stableThrough:TRAJECTORY_TICKS,failureWindow:null,sourceWindow:[actionTick,actionTick+VALVE_SOURCE_TICKS-1],
  ...(hold?{plugSolidThrough:TRAJECTORY_TICKS,waterHeldThrough:TRAJECTORY_TICKS}:{plugSolidThrough:actionTick+10,plugMeltTick:actionTick+11,waterHeldThrough:actionTick+11,waterReleaseTick:actionTick+12})};
}
/** The same windows for a pilot whose action lands on another tick: every window tied to the action moves with it. */
export function expectedWindows(level,actionTick=ACTION_TICK){
 const shift=actionTick-ACTION_TICK,moved={};
 for(const [key,value] of Object.entries(level.expected))moved[key]=Array.isArray(value)?value.map(v=>v+shift):typeof value==='number'&&value!==TRAJECTORY_TICKS?value+shift:value;
 return moved;
}
export function structuralAction(level,action){
 if(!['cut','heat','melt'].includes(action))throw Error('Unknown structural action.');
 if(level.valve){
  const [x,y,z]=level.valve.plug,[sx,sy,sz]=level.valve.source;
  return action==='cut'?[{kind:'material',x,y,z,material:MAT.AIR,thermal:0}]:[{kind:'energy',x:sx,y:sy,z:sz,energyQ:115*256}];
 }
 const heatQ=level.span?level.ignitionEnergyQ:1000*256;
 return level.supports.map(c=>action==='cut'?{kind:'material',...c,material:MAT.AIR,thermal:0}:{kind:'energy',...c,energyQ:action==='melt'?60*256:heatQ});
}
export function fixtureEdits(level,tick,actionTick=ACTION_TICK){
 if(level.valve)return tick>=actionTick&&tick<actionTick+VALVE_SOURCE_TICKS?structuralAction(level,'heat'):[];
 if(tick!==actionTick)return[];
 return level.scenario==='cut'?structuralAction(level,'cut'):level.scenario==='heat'||level.span?structuralAction(level,'heat'):level.scenario==='ice-heat'?structuralAction(level,'melt'):[];
}
export function scriptedInput(level,tick){
 // Walk onto the span during warmup, hold for its failure, then try to finish.
 const moveX=tick<=44||tick>=240&&tick<350?256:0;
 return{tick,moveX,moveZ:0,jump:false,tool:'none',look:[256,0,0]};
}
/** Feeds complete committed states in tick order; check() throws on the first violated window.
 * progress() is plain data a later segment resumes from, so bounded CPU segments observe one trajectory. */
export function observeStructuralLevel(level,actionTick=ACTION_TICK,resume){
 const size=level.size,at=([x,y,z])=>x+size*(y+size*z),yOf=i=>Math.floor(i/size)%size,expected=expectedWindows(level,actionTick);
 const cells=state=>state.packedCells??state.grid,center=at(level.center),deckMaterial=level.deckMaterial??(level.scenario.startsWith('ice')?MAT.ICE:MAT.STONE);
 const span=level.span?level.span.cells.map(at):null,column=level.valve?level.valve.column.map(at):null,plug=level.valve?at(level.valve.plug):-1,plugY=level.valve?level.valve.plug[1]:-1,plugMaterial=level.valve?level.valve.plugMaterial:-1;
 let {last=0,firstFall=-1,firstReaction=-1,spanOnFloorFrom=-1,plugSolidThrough=0,plugMelt=-1,waterHeldThrough=0,waterRelease=-1,stableThrough=0}=resume??{};
 return{
  progress(){return{last,firstFall,firstReaction,spanOnFloorFrom,plugSolidThrough,plugMelt,waterHeldThrough,waterRelease,stableThrough};},
  tick(tick,state){
   if(tick!==last+1)throw Error(`${level.scenario} ${size}: ticks must be observed in order`);last=tick;
   const grid=cells(state),m=i=>grid[i]&255;
   if(firstFall<0&&m(center)!==deckMaterial)firstFall=tick;
   if(firstFall<0&&stableThrough===tick-1)stableThrough=tick;
   if(span){
    let ash=false,onFloor=true;
    for(let i=0;i<grid.length;i++)if(m(i)===MAT.ASH){ash=true;break;}
    for(let i=0;i<grid.length;i++)if(m(i)===MAT.WOOD&&yOf(i)<level.span.restY){const x=i%size;if(!(yOf(i)===level.deckY&&level.span.pinnedX.includes(x))){onFloor=false;break;}}
    if(ash&&firstReaction<0)firstReaction=tick;
    spanOnFloorFrom=onFloor?(spanOnFloorFrom<0?tick:spanOnFloorFrom):-1;
   }
   if(column){
    const solid=m(plug)===plugMaterial;
    if(solid&&plugSolidThrough===tick-1)plugSolidThrough=tick;
    if(!solid&&plugMelt<0)plugMelt=tick;
    let held=column.every(i=>m(i)===MAT.WATER),released=false;
    for(let i=0;i<grid.length;i++)if(m(i)===MAT.WATER&&yOf(i)>plugY&&yOf(i)<level.deckY+10){if(column.includes(i))continue;released=true;break;}
    if(held&&!released&&waterHeldThrough===tick-1)waterHeldThrough=tick;
    if(released&&waterRelease<0)waterRelease=tick;
   }
  },
  windows(){return{firstFall:firstFall<0?null:firstFall,stableThrough,firstReaction:firstReaction<0?null:firstReaction,spanOnFloorFrom:spanOnFloorFrom<0?null:spanOnFloorFrom,plugSolidThrough,plugMelt:plugMelt<0?null:plugMelt,waterHeldThrough,waterRelease:waterRelease<0?null:waterRelease,observedThrough:last};},
  check(){
   const e=expected,w=this.windows(),label=`${level.scenario} ${size}^3 (action ${actionTick})`,fail=what=>{throw Error(`${label}: ${what}`);};
   const through=Math.min(last,e.stableThrough);
   if(stableThrough<through)fail(`deck center changed at tick ${firstFall}, expected stable through ${e.stableThrough}`);
   if(e.failureWindow&&last>=e.failureWindow[0]&&(firstFall<e.failureWindow[0]||firstFall>e.failureWindow[1]))fail(`first fall at tick ${firstFall}, expected within ${e.failureWindow.join('..')}`);
   if(e.firstReactionTick!==undefined&&last>=e.firstReactionTick&&firstReaction!==e.firstReactionTick)fail(`first reaction at tick ${firstReaction}, expected ${e.firstReactionTick}`);
   if(e.spanOnFloorTick!==undefined&&last>=e.spanOnFloorTick&&spanOnFloorFrom!==e.spanOnFloorTick)fail(`span rests on the basin from tick ${spanOnFloorFrom}, expected ${e.spanOnFloorTick}`);
   if(e.plugSolidThrough!==undefined&&plugSolidThrough<Math.min(last,e.plugSolidThrough))fail(`plug solid only through tick ${plugSolidThrough}, expected ${e.plugSolidThrough}`);
   if(e.plugMeltTick!==undefined&&last>=e.plugMeltTick&&plugMelt!==e.plugMeltTick)fail(`plug melted at tick ${plugMelt}, expected ${e.plugMeltTick}`);
   if(e.waterHeldThrough!==undefined&&waterHeldThrough<Math.min(last,e.waterHeldThrough))fail(`water held only through tick ${waterHeldThrough}, expected ${e.waterHeldThrough}`);
   if(e.waterReleaseTick!==undefined&&last>=e.waterReleaseTick&&waterRelease!==e.waterReleaseTick)fail(`water released at tick ${waterRelease}, expected ${e.waterReleaseTick}`);
   return w;
  },
 };
}
