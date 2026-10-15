import {createGpuActiveWorld3D} from '../../dist/sdk/state-space-active-world-gpu.js';
import {createStateSpaceActiveWorld3D,validateActiveWorldSnapshot} from '../../dist/sdk/state-space-active-world.js';
import {createStateSpaceField3D,MAT} from '../../dist/sdk/state-space-3d.js';
import {CrossingGame,CpuTerrain,commandFor} from '../first-person/game.js';
import {expectedMesh,readFixture} from '../cavern/verify.js';
import {GpuActiveCavernGame,actorState} from './gpu-game.js';

const equal=(a,b,m)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error(m);};
const check=(v,m)=>{if(!v)throw Error(m);};
const rejected=async fn=>{let failed=false;try{await fn();}catch{failed=true;}check(failed,'Invalid operation was accepted.');};
const progress=text=>{document.getElementById('status').textContent=text;};
const pause=()=>new Promise(r=>setTimeout(r,5));
const rules={goal:{minX:24*256,maxY:24*256+1,minZ:13*256,maxZ:18*256},fallY:28*256,toolCeiling:29};
const camera={forward:[1,0,0],right:[0,0,-1],up:[0,-1,0]};
const options={width:32,height:32,depth:32,chunkSize:32};
function chunked(flat){const s=createStateSpaceActiveWorld3D(options).snapshot();s.tick=flat.tick;s.chunks[0].packedCells=flat.packedCells;s.chunks[0].energyQ=flat.energyQ;return s;}
function fixture(name){
 const cpu=createStateSpaceField3D(32,32,32),game=new CrossingGame(new CpuTerrain(cpu));
 for(let z=0;z<32;z++)for(let x=0;x<32;x++)cpu.setCell(x,24,z,MAT.STONE,20);
 let commands;
 if(name==='tools'){
  for(let z=14;z<17;z++)for(let y=21;y<24;y++){cpu.setCell(8,y,z,MAT.STONE,20);cpu.setCell(9,y,z,MAT.WATER,20);cpu.setCell(10,y,z,MAT.ICE,0);}
  commands=Array.from({length:14},(_,i)=>({tool:i<6?'carve':'freeze',moveX:i>9?256:0}));
 }else if(name==='motion'){
  for(let y=20;y<24;y++)cpu.setCell(7,y,15,MAT.STONE);
  commands=[{moveX:256},{moveX:256},{moveX:256},{moveZ:-255,jump:true},{moveX:-181,moveZ:-181},{moveZ:255},{moveX:-255,jump:true},{}];
 }else if(name==='water'){
  for(let z=13;z<18;z++)for(let y=21;y<24;y++)for(let x=4;x<9;x++)cpu.setCell(x,y,z,MAT.WATER,20);
  commands=[{tool:'freeze',look:[0,256,0]},{jump:true,moveX:-255},{jump:true,moveZ:255},{},{}];
 }else if(name==='trapped'){
  for(let y=18;y<24;y++)cpu.setCell(6,y,15,MAT.STONE);commands=[{}, {tool:'carve'},{}];
 }else if(name==='depenetrate'){
  cpu.setCell(6,23,15,MAT.STONE);commands=[{moveX:-255},{jump:true},{moveZ:255}];
 }else if(name==='goal'){
  game.player.x=24*256;cpu.setCell(24,24,15,MAT.ICE,0);game.events=[{tick:0,type:'carved',cells:1,target:[8,22,15]}];commands=[{},{}];
 }else if(name==='boundary'){
  game.player.x=77;game.player.z=77;commands=[{moveX:-255,look:[-256,0,0]},{moveZ:-255,look:[0,0,-256]},{jump:true,look:[-181,-181,0]}];
 }else{
  game.player.y=28*256;game.player.grounded=false;commands=[{},{}];
 }
 const flat=cpu.snapshot();cpu.restore(flat);return{cpu,game,commands,flat};
}

export async function verifyGameplayProbe(){
 const results=[];let backendInfo;
 for(const execution of ['dense','sparse']){
  const field=await createGpuActiveWorld3D({...options,execution,profiling:true});backendInfo=field.backendInfo;
  const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;
  let driver;const renderer=await field.createRenderer(canvas),presentation={renderer,camera};
  try{
   for(const name of ['tools','motion','water','trapped','depenetrate','goal','boundary','fall']){
    progress(`Resident gameplay ${execution}: ${name}`);
    const {cpu,game,commands,flat}=fixture(name);await game.initialize();await field.restore(chunked(flat));
    if(driver)await driver.restore(actorState(game));else driver=await field.createGameplay(actorState(game),rules);
    const events=structuredClone(game.events);let eventCount=events.length,commit;
    for(const input of commands){
     const command=commandFor(input,field.tick+1);await game.step(command);
     // Count actual API calls, not the controller's declared contract values.
     const submit=GPUQueue.prototype.submit,done=GPUQueue.prototype.onSubmittedWorkDone,map=GPUBuffer.prototype.mapAsync;
     let submissions=0,boundaries=0;const bytes=[];
     GPUQueue.prototype.submit=function(...a){submissions++;return submit.apply(this,a);};
     GPUQueue.prototype.onSubmittedWorkDone=function(...a){boundaries++;return done.apply(this,a);};
     GPUBuffer.prototype.mapAsync=function(mode,offset=0,size=this.size-offset){bytes.push(size);return map.call(this,mode,offset,size);};
     try{commit=await driver.step(command,presentation);}finally{GPUQueue.prototype.submit=submit;GPUQueue.prototype.onSubmittedWorkDone=done;GPUBuffer.prototype.mapAsync=map;}
     check(submissions===1&&boundaries===1,'Gameplay crossed more than one submission/completion boundary.');equal(bytes,[512],'Gameplay read back its collision neighborhood.');
     equal({player:commit.player,look:commit.look,status:commit.status,carved:commit.carved,iceWalk:commit.iceWalk},actorState(game),`${execution}/${name}/${field.tick}: actor differs`);
     equal(commit.events,game.events.slice(eventCount),`${execution}/${name}/${field.tick}: events differ`);eventCount=game.events.length;
     equal(commit.target,game.target([256,0,0]),`${execution}/${name}/${field.tick}: target differs`);
     const actual=validateActiveWorldSnapshot(await field.snapshot()),expected=cpu.snapshot();
     equal(actual.packedCells,expected.packedCells,`${execution}/${name}/${field.tick}: packed state differs`);equal(actual.energyQ,expected.energyQ,`${execution}/${name}/${field.tick}: energy differs`);
     await pause();
    }
    const balance=await field.energyBalance(),expected=cpu.energyBalance();for(const k of Object.keys(expected))check(balance[k]===expected[k],`${name}: ${k} ledger differs`);
    const saved=await field.snapshot(),actor=actorState(game);
    for(const c of [undefined,null,{...commandFor({},field.tick+1),look:[256,,0]},{...commandFor({},field.tick+1),tick:0}])await rejected(()=>driver.step(c));
    await rejected(()=>driver.present());await rejected(()=>driver.step(commandFor({},field.tick+1),{renderer:{},camera}));
    await rejected(()=>driver.restore({...actor,player:{...actor.player,x:-1}}));
    await rejected(()=>driver.present({renderer,camera:{...camera,forward:[0,0,0]}}));
    equal(await field.snapshot(),saved,'Rejected gameplay input changed terrain.');
    const changedView={renderer,camera:{forward:[0,0,-1],right:[1,0,0],up:[0,-1,0]}};
    const view=await driver.present(changedView);equal(view.player,actor.player,'View changed player.');equal(await field.snapshot(),saved,'View changed terrain.');
    equal(view.target,game.target([0,0,-256]),'View-only target differs.');
    view.player.x=0;view.look[0]=0;if(view.target)view.target.cell[0]=-1;
    equal((await driver.present(presentation)).player,actor.player,'Commit leaked mutable actor state.');
    equal((await renderer.inspectMesh()).faces,expectedMesh(validateActiveWorldSnapshot(saved),32),'Resident dirty mesh differs from full face oracle.');
    const residentPixels=canvas.toDataURL(),target=game.target([256,0,0]);
    await renderer.render({...camera,eye:game.eye().map(v=>v/256),...(target?{target:target.cell[0]+32*(target.cell[1]+32*target.cell[2])}:{})});
    equal(canvas.toDataURL(),residentPixels,'Same-tick GPU eye/target differs from CPU camera rendering.');
    // Odd absolute ticks, both buffer banks, and external terrain mutations.
    await field.restore(saved);await rejected(()=>driver.step(commandFor({},field.tick+1)));await driver.restore(actor);
    const pending=driver.step(commandFor({},field.tick+1),presentation);await rejected(()=>driver.step(commandFor({},field.tick+1)));await rejected(()=>driver.close());await pending;
    await game.step({});equal((await driver.present(presentation)).player,game.player,'Actor restore continuation differs.');
    if(name==='trapped')check(game.events.some(e=>e.type==='trapped'),'Trapped fixture did not exercise its event.');
    if(name==='goal')check(game.events.some(e=>e.type==='crossed'),'Goal fixture did not exercise its event.');
    if(name==='fall')check(game.events.some(e=>e.type==='fell'),'Fall fixture did not exercise its event.');
    if(name==='tools')check(game.events.some(e=>e.type==='carved')&&game.events.some(e=>e.type==='cooled'),'Tool fixture must carve and cool.');
    results.push({execution,name,events:game.events.map(e=>e.type),ticks:commands.length,exact:true,oneSubmission:true,oneCompletion:true,actorReadbackBytes:512,ledgerExact:true,viewIsolated:true});
   }
   const committedTick=field.tick,done=GPUQueue.prototype.onSubmittedWorkDone;
   GPUQueue.prototype.onSubmittedWorkDone=function(){return done.call(this).then(()=>{throw Error('Injected completed-queue failure');});};
   try{await rejected(()=>driver.step(commandFor({},field.tick+1),presentation));}finally{GPUQueue.prototype.onSubmittedWorkDone=done;}
   check(field.tick===committedTick,'Failed frame committed a tick.');await rejected(()=>driver.present(presentation));
  }finally{field.close();}
 }
 return{passed:true,backendInfo,results,failedCompletionDoesNotCommit:true,sameTickCameraPixelsExact:true};
}

export async function verifyResident128(referenceUrl){
 const ref=await fetch(referenceUrl).then(r=>r.json());check(ref.passed&&ref.sourceUnchanged,'CPU reference required.');
 const initial=await readFixture(ref.fixtures.initial),final=await readFixture(ref.fixtures.final),commands=await readFixture(ref.fixtures.commands),results=[];let backendInfo;
 for(const execution of ['dense','sparse']){
  const field=await createGpuActiveWorld3D({execution});backendInfo=field.backendInfo;
  try{
   const game=new GpuActiveCavernGame(field);await game.restore(initial);
   const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const renderer=await field.createRenderer(canvas);
   for(const restart of execution==='sparse'?[0,3,31,509]:[0]){
    if(restart)await game.restore(await readFixture(ref.fixtures['game-'+restart]));
    for(const command of commands.slice(restart)){
     const start=performance.now();await game.step(command,{renderer,camera});
     if(performance.now()-start>100)throw Error('Resident continuation exceeded responsiveness budget.');
     if(command.tick%32===0)progress(`Resident 128³ ${execution} restart ${restart}: ${command.tick}/600`);await pause();
    }
    equal(await game.snapshot(),final,`Resident ${execution} restart ${restart} differs from complete CPU state.`);check((await field.energyBalance()).driftQ===0n,'Resident energy drift.');
    results.push({execution,restart,ticks:600-restart,completeStateExact:true,zeroDrift:true});
   }
   renderer.close();
  }finally{field.close();}
 }
 return{passed:true,backendInfo,results};
}
