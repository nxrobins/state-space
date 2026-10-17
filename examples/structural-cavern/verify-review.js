import {createStateSpaceStructuralWorld3D,MAT} from '../../dist/sdk/state-space-structural-world.js';
import {createStateSpaceStructuralWorld3DGPU} from '../../dist/sdk/state-space-structural-world-gpu.js';
import {structuralStateDigest} from './state-evidence.js';

/** One tiny supervised GPU regression; no legacy level or benchmark workload. */
export async function verifyStructuralReview(){
 const results=[];let backendInfo;
 const check=(ok,message)=>{if(!ok)throw Error(message);};
 for(const mode of ['dense','active']){
  const cpu=createStateSpaceStructuralWorld3D({width:16,height:16,depth:16,chunkSize:4}),edits=[];
  for(let z=0;z<16;z++)for(let x=0;x<16;x++)edits.push({kind:'material',x,y:10,z,material:MAT.STONE,thermal:20},{kind:'anchor',x,y:10,z,anchored:true});
  cpu.edit(edits);const initial=cpu.snapshot();
  const gpu=await createStateSpaceStructuralWorld3DGPU({width:16,height:16,depth:16,chunkSize:4,mode});let driver,renderer;
  const canvas=document.createElement('canvas');canvas.width=canvas.height=64;
  try{
   backendInfo=gpu.backendInfo;await gpu.restore(initial);
   const actor={player:{x:9*256-180,y:10*256,z:8*256,vy:0,grounded:true,wet:false,jumpHeld:false,cooldown:0,blocked:false},look:[256,0,0],status:'playing',carved:false,iceWalk:false};
   const rules={goal:{minX:9*256,maxY:10*256,minZ:7*256,maxZ:9*256},fallY:14*256,toolCeiling:15};
   driver=await gpu.createGameplay(actor,rules);renderer=await gpu.createRenderer(canvas);
   const presentation={renderer,camera:{forward:[1,0,0],right:[0,0,-1],up:[0,-1,0]}},commands=[],actors=[],events=[],digests=[];let restart;
   for(let tick=1;tick<=8;tick++){
    const command={tick,moveX:256,moveZ:0,jump:false,tool:'none',look:[256,0,0]};commands.push(command);
    cpu.step();const commit=await driver.step(command,{presentation}),state=await gpu.snapshot(),digest=await structuralStateDigest(state);
    check(digest===await structuralStateDigest(cpu.snapshot()),`${mode}: physics differs at ${tick}`);
    check(commit.status===(tick<4?'playing':'won'),`${mode}: crossing status at ${tick}`);
    check(!commit.carved&&!commit.iceWalk,`${mode}: legacy flags were fabricated`);
    check(JSON.stringify(commit.events)===JSON.stringify(tick===4?[{tick:4,type:'crossed'}]:[]),`${mode}: crossing events at ${tick}`);
    actors.push(driver.inspect());events.push(commit.events);digests.push(digest);
    if(tick===3)restart={field:state,actor:driver.inspect()};
   }
   await gpu.restore(restart.field);await driver.restore(restart.actor);
   for(let tick=4;tick<=8;tick++){
    const commit=await driver.step(commands[tick-1]);
    check(JSON.stringify(driver.inspect())===JSON.stringify(actors[tick-1])&&JSON.stringify(commit.events)===JSON.stringify(events[tick-1]),`${mode}: actor/event restart at ${tick}`);
    check(await structuralStateDigest(await gpu.snapshot())===digests[tick-1],`${mode}: terrain restart at ${tick}`);
   }
   // Being inside the goal while paused must not synthesize a transition.
   await driver.restore({...actor,player:{...actor.player,x:rules.goal.minX}});
   const before=await structuralStateDigest(await gpu.snapshot()),paused=await driver.present(presentation);
   check(paused.status==='playing'&&paused.events.length===0&&before===await structuralStateDigest(await gpu.snapshot()),`${mode}: presentation changed state`);
   for(const [label,patch,expected] of [['outside Z',{player:{...actor.player,x:rules.goal.minX,z:6*256}},'playing'],['lost',{player:{...actor.player,x:rules.goal.minX},status:'lost'},'lost']]){
    await driver.restore({...actor,...patch});const commit=await driver.step({...commands[0],tick:gpu.tick+1,moveX:0});
    check(commit.status===expected&&!commit.events.some(e=>e.type==='crossed'),`${mode}: ${label} actor incorrectly won`);
   }
   check((await gpu.energyBalance()).driftQ===0n,`${mode}: energy drift`);
   results.push({mode,ticks:8,crossedAt:4,restart:3,physicsExact:true,actorEventsExact:true,presentationIsolated:true,goalBounds:true,lossPreserved:true,energyDriftQ:'0',stateDigests:digests});
   document.getElementById('status').textContent=`M5 review: ${mode} crossing, restart and exact terrain passed`;
  }finally{driver?.close();renderer?.close();gpu.close();}
 }
 return{passed:true,scope:'16 cubed M5 crossing regression, eight ticks per mode plus odd restart and boundary cases',backendInfo,results};
}
