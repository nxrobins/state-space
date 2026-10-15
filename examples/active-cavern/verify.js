import {createGpuActiveWorld3D} from '../../dist/sdk/state-space-active-world-gpu.js';
import {createStateSpaceActiveWorld3D,validateActiveWorldSnapshot,MAT,MATERIALS_3D,MAX_ENERGY_Q,ACTIVE_WORLD_VERSION_3D} from '../../dist/sdk/state-space-active-world.js';
import {createGpuWorld3D} from '../../dist/sdk/state-space-world-gpu.js';
import {createGpuField3D} from '../../dist/sdk/state-space-3d-gpu.js';
import {createStateSpaceField3D,runVolumePass,volumeSchedule} from '../../dist/sdk/state-space-3d.js';
import {validateWorldSnapshot} from '../../dist/sdk/state-space-world.js';
import {readFixture,expectedMesh} from '../cavern/verify.js';
import {ActiveCavernGame,routeInput} from './game.js';
import {createLevel,DEFAULT_SEED} from './scene.js';
const equal=(a,b,message)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error(message);};
const check=(v,message)=>{if(!v)throw Error(message);};
const progress=text=>{document.getElementById('status').textContent=text;};
const pause=()=>new Promise(r=>setTimeout(r,5));
async function step(field,options={}){const started=performance.now();await field.step(1,options);const ms=performance.now()-started;if(ms>100)throw Error('M4 tick exceeded the 100 ms responsiveness budget.');return ms;}
const summary=values=>{const v=[...values].sort((a,b)=>a-b);return{count:v.length,median:v[Math.floor(v.length/2)],p95:v[Math.ceil(v.length*.95)-1],max:v.at(-1)};};
async function ledger(a,b){const x=await a.energyBalance(),y=await b.energyBalance();for(const k of Object.keys(x))check(x[k]===y[k],`Ledger ${k} differs.`);check(x.driftQ===0n,'Energy drift.');}
async function verifyKernelPasses(){
 const checks=[];
 for(const [shape,mode] of [[[1,1,1],'volume'],[[1,5,3],'volume'],[[3,5,7],'volume'],[[7,1,5],'volume'],[[8,8,8],'dense'],[[8,8,8],'sparse']]){
  progress(`Kernel pass conformance: ${shape.join('×')} ${mode}`);
  const cpu=createStateSpaceField3D(...shape),gpu=mode==='volume'?await createGpuField3D(...shape):await createGpuActiveWorld3D({width:8,height:8,depth:8,chunkSize:4,execution:mode});
  try{
   for(let z=0;z<shape[2];z++)for(let y=0;y<shape[1];y++)for(let x=0;x<shape[0];x++){
    const i=x+shape[0]*(y+shape[1]*z);cpu.setCell(x,y,z,MATERIALS_3D[(i*7+Math.floor(i/3))%9].id,i*43%256);if(i%3===0)cpu.setEnergy(x,y,z,i%2?MAX_ENERGY_Q:0);
   }
   const state={grid:cpu.grid,energyQ:cpu.energyQ};
   const ticks=[0,3,4294967297,Number.MAX_SAFE_INTEGER-1024];
   for(const tick of ticks){
    let initial;
    if(mode==='volume')initial={...cpu.snapshot(),tick};
    else{const seed=createStateSpaceActiveWorld3D({width:8,height:8,depth:8,chunkSize:4});for(let z=0;z<8;z++)for(let y=0;y<8;y++)for(let x=0;x<8;x++){const c=cpu.sample(x,y,z);seed.setCell(x,y,z,c.material,c.thermal);seed.setEnergy(x,y,z,c.energyQ);}initial={...seed.snapshot(),tick};}
    await gpu.restore(initial);
    for(let pass=0;pass<27;pass++){
     const expected=runVolumePass(state,...shape,tick,pass),snapshot=await gpu.inspectPass(pass);
     const actual=mode==='volume'?snapshot:validateActiveWorldSnapshot(snapshot);
     equal(actual.packedCells,[...expected.grid],`Kernel material mismatch ${mode}/${shape}/${tick}/${pass}`);
     equal([...actual.energyQ],[...expected.energyQ],`Kernel energy mismatch ${mode}/${shape}/${tick}/${pass}`);
    }
    equal(await gpu.snapshot(),initial,'Pass inspection changed committed state.');await pause();
   }
   checks.push({shape,mode,passes:27*ticks.length,ticks,exact:true});
  }finally{gpu.close();}
 }
 return checks;
}
// Exercise tile scheduling while heat is live, then wake neighbouring tiles
// via edits, melting, freezing, odd restarts and multi-tick bank alternation.
async function verifyThermalTileWakes(){
 const cases=[];
 for(const [size,edge] of [[8,4],[16,16]]){
  const options={width:size,height:size,depth:size,chunkSize:edge,fillMaterial:MAT.STONE};
  const cpu=createStateSpaceActiveWorld3D(options),gpu=await createGpuActiveWorld3D(options);
  try{
   const mid=size/2;
   for(let z=0;z<size;z++)for(let y=0;y<size;y++)for(let x=0;x<size;x++)cpu.setCell(x,y,z,MAT.STONE,x<mid?20:180);
   cpu.setCell(mid-1,mid-1,mid-1,MAT.ICE,0);
   await gpu.restore(cpu.snapshot());cpu.restore(cpu.snapshot());
   for(let tick=1;tick<=7;tick++){cpu.step();await step(gpu);equal(await gpu.snapshot(),cpu.snapshot(),'Fixed heat certificate skipped a phase/energy update.');await pause();}
   const saved=cpu.snapshot();await gpu.restore(saved);cpu.restore(saved);
   for(const ticks of [3,2]){cpu.step(ticks);await gpu.step(ticks);equal(await gpu.snapshot(),cpu.snapshot(),'Fixed certificate restart/bank parity differs.');}
   const edits=[{x:mid-1,y:mid-1,z:mid-1,material:MAT.SAND,thermal:20},{x:mid-1,y:mid,z:mid-1,material:MAT.AIR},{x:mid,y:mid,z:mid,material:MAT.WATER,thermal:0}];
   cpu.step(0,{edits});await gpu.step(0,{edits});cpu.step(3);await gpu.step(3);
   equal(await gpu.snapshot(),cpu.snapshot(),'A placement retained a stale fixed certificate.');
   const energy=[{x:mid+1,y:mid,z:mid,energyQ:MAX_ENERGY_Q},{x:mid,y:mid,z:mid,energyQ:0}];
   cpu.step(2,{edits:energy});await gpu.step(2,{edits:energy});
   equal(await gpu.snapshot(),cpu.snapshot(),'Energy edit/melting retained a stale fixed certificate.');
   await ledger(cpu,gpu);cases.push({size,edge,ticks:cpu.tick,exact:true});
  }finally{gpu.close();}
 }
 return cases;
}
export async function verifyM4Probe(){
 const thermalTileWakes=await verifyThermalTileWakes();
 const kernelPasses=await verifyKernelPasses();
 const pair=createStateSpaceField3D(2,1,1),pairGpu=await createGpuField3D(2,1,1);let equalHeatPairs=0;
 try{
  const heat=volumeSchedule(0).findIndex(p=>p.kind==='heat'&&p.axis===0&&p.parity===0);
  for(const m of MATERIALS_3D)for(const q of [0,1,255,256,65536,MAX_ENERGY_Q]){
   for(const x of [0,1]){pair.setCell(x,0,0,m.id);pair.setEnergy(x,0,0,q);}
   const initial=pair.snapshot();await pairGpu.restore(initial);
   const expected=runVolumePass({grid:pair.grid,energyQ:pair.energyQ},2,1,1,0,heat),actual=await pairGpu.inspectPass(heat);
   equal(actual.packedCells,[...expected.grid],'Equal-energy heat pair changed material/thermal bits.');equal(actual.energyQ,[...expected.energyQ],'Equal-energy heat pair changed energy.');
   equal(await pairGpu.snapshot(),initial,'Heat inspection changed committed state.');equalHeatPairs++;
  }
 }finally{pairGpu.close();}
 const options={width:8,height:8,depth:8,chunkSize:4},cpu=createStateSpaceActiveWorld3D(options),sparse=await createGpuActiveWorld3D({...options,profiling:true,gpuTiming:true}),dense=await createGpuActiveWorld3D({...options,execution:'dense'});
 try{
  for(let z=0;z<8;z++)for(let y=0;y<8;y++)for(let x=0;x<8;x++){const i=x+8*(y+8*z);cpu.setCell(x,y,z,MATERIALS_3D[(i*7+Math.floor(i/3))%9].id,i*43%256);if(i%3===0)cpu.setEnergy(x,y,z,i%2?MAX_ENERGY_Q:0);}
  const initial=cpu.snapshot();await sparse.restore(initial);await dense.restore(initial);cpu.restore(initial);
  for(let n=1;n<=32;n++){cpu.step();await step(sparse);await step(dense);equal(await sparse.snapshot(),cpu.snapshot(),'Sparse tiny state differs.');equal(await dense.snapshot(),cpu.snapshot(),'Dense tiny state differs.');await pause();}
  await ledger(cpu,sparse);await ledger(cpu,dense);progress('Tiny mixed materials: dense/sparse/CPU exact');
  const quiet=createStateSpaceActiveWorld3D({...options,fillMaterial:MAT.STONE});quiet.setEnergy(3,3,3,quiet.sample(3,3,3).energyQ+1);quiet.restore(quiet.snapshot());await sparse.restore(quiet.snapshot());await dense.restore(quiet.snapshot());
  for(let n=0;n<3;n++){quiet.step();await step(sparse);await step(dense);equal(await sparse.snapshot(),quiet.snapshot(),'Sleeping world differs.');}
  const sleeping=await sparse.inspectActivity();check(sleeping.sleepingChunks===8&&sleeping.dispatchedChunks===0,'Uniform world did not sleep.');
  check(sleeping.plannerBuilds===0&&sleeping.plannerReuses===27,'Sleeping world rebuilt an unchanged work list.');
  const edits=[];for(let z=2;z<=5;z++)for(let y=2;y<=5;y++)for(let x=3;x<=4;x++)edits.push({x,y,z,material:MAT.AIR});
  quiet.step(0,{edits});await sparse.step(0,{edits});await dense.step(0,{edits});
  const thermal=[{x:3,y:2,z:3,material:MAT.STEAM,thermal:180},{x:4,y:2,z:4,material:MAT.SAND},{x:3,y:4,z:3,material:MAT.WATER}];
  quiet.step(0,{edits:thermal});await sparse.step(0,{edits:thermal});await dense.step(0,{edits:thermal});
  // Edits invalidate the cached list; repeated pass/tick reuse must still agree
  // with dense execution through wake, sleep and both bank parities.
  const encoderPrototype=GPUComputePassEncoder.prototype,setPipeline=encoderPrototype.setPipeline,dispatch=encoderPrototype.dispatchWorkgroups;
  const selected=new WeakMap();let plannerDispatches=0;
  encoderPrototype.setPipeline=function(p){selected.set(this,p.label);return setPipeline.call(this,p);};
  encoderPrototype.dispatchWorkgroups=function(...args){if(selected.get(this)==='active-collectWork')plannerDispatches++;return dispatch.apply(this,args);};
  try{quiet.step(3);await sparse.step(3);await dense.step(3);}finally{encoderPrototype.setPipeline=setPipeline;encoderPrototype.dispatchWorkgroups=dispatch;}
  check(plannerDispatches===3,'Sparse work planning ran more than once per tick.');
  equal(await sparse.snapshot(),quiet.snapshot(),'Cached work list missed edited tiles.');
  equal(await dense.snapshot(),quiet.snapshot(),'Dense batched wake differs.');
  const planned=await sparse.inspectActivity();
  check(planned.plannerBuilds>0&&planned.plannerReuses>0&&planned.plannerBuilds+planned.plannerReuses===81,'Planner reuse accounting differs.');
  const write=GPUQueue.prototype.writeBuffer;let uploaded=0;
  GPUQueue.prototype.writeBuffer=function(buffer,offset,data,...rest){uploaded+=data.byteLength;return write.call(this,buffer,offset,data,...rest);};
  try{
   quiet.step();await sparse.step();
   check(uploaded===29*256,'Ordinary sparse tick uploaded activity clears.');
   equal(await sparse.snapshot(),quiet.snapshot(),'GPU activity clears changed physics.');
  }finally{GPUQueue.prototype.writeBuffer=write;}
  await dense.step();
  const changed=[{x:3,y:3,z:3,material:MAT.STEAM,thermal:180}];quiet.step(1,{edits:changed});await sparse.step(1,{edits:changed});await dense.step(1,{edits:changed});
  equal(await sparse.snapshot(),quiet.snapshot(),'GPU clear erased an edit wake.');
  check((await sparse.inspectActivity()).wakeReasons.some(v=>v&16),'GPU clear erased the external edit reason.');
  for(let n=0;n<32;n++){quiet.step();await step(sparse);await step(dense);equal(await sparse.snapshot(),quiet.snapshot(),'Wake or halo state differs.');equal(await dense.snapshot(),quiet.snapshot(),'Dense wake state differs.');await pause();}
  await ledger(quiet,sparse);const saved=await sparse.snapshot();await sparse.restore(saved);quiet.restore(saved);
  for(let n=0;n<17;n++){quiet.step();await step(sparse);await pause();}equal(await sparse.snapshot(),quiet.snapshot(),'Sparse restart differs.');
  for(const ticks of [0,1]){const before=await sparse.snapshot();let rejected=false;try{await sparse.step(ticks,{edits:null});}catch{rejected=true;}check(rejected,'Null edits accepted.');equal(await sparse.snapshot(),before,'Null edits mutated sparse state.');}
  // Activity tiles can be smaller than storage chunks; both bank coordinates stay exact.
  const tiledOptions={width:16,height:16,depth:16,chunkSize:16},tiledCpu=createStateSpaceActiveWorld3D({...tiledOptions,fillMaterial:MAT.STONE}),tiled=await createGpuActiveWorld3D(tiledOptions);
  try{
   for(let z=5;z<11;z++)for(let y=4;y<12;y++)for(let x=6;x<10;x++)tiledCpu.setCell(x,y,z,MAT.AIR);
   tiledCpu.setCell(7,4,7,MAT.WATER);tiledCpu.setCell(8,4,8,MAT.SAND);tiledCpu.setCell(7,10,7,MAT.STEAM,180);
   await tiled.restore(tiledCpu.snapshot());tiledCpu.restore(tiledCpu.snapshot());
   for(let n=0;n<32;n++){tiledCpu.step();await step(tiled);if(n%4===3)equal(await tiled.snapshot(),tiledCpu.snapshot(),'Subchunk activity differs.');await pause();}
   const a=await tiled.inspectActivity();check(a.storageChunks===1&&a.activityChunkSize===8&&a.totalChunks===8,'Activity/storage geometry differs.');
   await ledger(tiledCpu,tiled);
  }finally{tiled.close();}
  const meshes=[];
  for(const [size,edge] of [[8,2],[8,4],[16,8],[32,32]]){
   const legacy=edge===2,field=await (legacy?createGpuWorld3D:createGpuActiveWorld3D)({width:size,height:size,depth:size,chunkSize:edge,fillMaterial:MAT.STONE});
   try{
    const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;
    const renderer=await field.createRenderer(canvas),camera={eye:[2,2,2],forward:[1,0,0],right:[0,0,-1],up:[0,-1,0]},chunks=(size/edge)**3;
    async function mesh(expected){
     const before=await field.snapshot();await renderer.render(camera);const actual=await renderer.inspectMesh();
     equal(actual.faces,expectedMesh((legacy?validateWorldSnapshot:validateActiveWorldSnapshot)(before),edge),'Indirect mesh differs from full face oracle.');
     equal(actual.meshDispatch,[Math.ceil(edge**3/64),expected,1],'Mesh dispatch includes clean chunks.');
     equal(actual.rebuilt.filter(Boolean).length,expected,'Dirty chunk count differs.');
     equal(await field.snapshot(),before,'Meshing changed physics.');
    }
    await mesh(chunks);await mesh(0);
    await field.setCell(0,0,0,MAT.AIR);await mesh(1);
    await field.setCell(edge-1,edge-1,edge-1,MAT.STEAM,180);await mesh(Math.min(4,chunks));
    await field.setEnergy(0,0,0,12345);await mesh(0);
    const saved=await field.snapshot();await field.restore(saved);await mesh(chunks);await mesh(0);
    renderer.close();meshes.push({size,edge,facesExact:true,zeroCleanWork:true,cornerAndRestoreExact:true});
   }finally{field.close();}
  }
  progress('Indirect dirty-chunk meshes match the full face oracle');
  const sampled=await createGpuActiveWorld3D({...options,fillMaterial:MAT.STONE,activityReadbackInterval:2,profiling:true,gpuTiming:true});
  try{
   const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;
   const renderer=await sampled.createRenderer(canvas),camera={eye:[2,2,2],forward:[1,0,0],right:[0,0,-1],up:[0,-1,0]};
   const before=await sampled.snapshot(),region=await sampled.step(2,{region:{origin:[0,0,0],size:[8,8,8]}});
   check(region.tick===2&&region.grid.length===512,'Batched activity damaged the collision readback.');
   const cpu=createStateSpaceActiveWorld3D({...options,fillMaterial:MAT.STONE});cpu.restore(before);cpu.step(2);equal(await sampled.snapshot(),cpu.snapshot(),'Batched activity changed physics.');
   const submit=GPUQueue.prototype.submit;let submissions=0;GPUQueue.prototype.submit=function(...args){submissions++;return submit.apply(this,args);};
   try{
    const first=await sampled.inspectActivity(),expected=structuredClone(first);
    first.awake.fill(99);first.wakeReasons.fill(99);first.terrainDirty.fill(99);
    equal(await sampled.inspectActivity(),expected,'Cached activity reads share mutable arrays.');check(submissions===0,'Scheduled activity required another GPU submission.');
    await renderer.render(camera);submissions=0;const rendered=await sampled.inspectActivity();check(submissions===1&&rendered.terrainDirty.every(v=>v===0),'Rendering retained stale dirty diagnostics.');
    await sampled.setCell(0,0,0,MAT.AIR);submissions=0;check((await sampled.inspectActivity()).terrainDirty.some(Boolean)&&submissions===1,'Edits retained stale diagnostics.');
    await sampled.restore(before);submissions=0;check((await sampled.inspectActivity()).tick===0&&submissions===1,'Restore retained stale diagnostics.');
   }finally{GPUQueue.prototype.submit=submit;}
   renderer.close();
  }finally{sampled.close();}
  await sparse.settleLatency();
  const latency=sparse.inspectLatency();check(latency.enabled&&latency.records.length<=32,'Latency history is not bounded.');
  check(latency.records.every(r=>r.gpu.status===(latency.gpuTimestamps?'complete':'unsupported')),'GPU timestamps failed.');
  const cloned=structuredClone(latency);latency.records[0].cpu.startedAt=-1;equal(sparse.inspectLatency(),cloned,'Latency snapshots alias internal diagnostics.');
  const query={origin:[0,0,0],size:[8,8,8]},bindings=GPUDevice.prototype.createBindGroup;let created=0;
  GPUDevice.prototype.createBindGroup=function(...args){created++;return bindings.apply(this,args);};
  try{
   // Grow uniforms, then alternate parity and query-only requests using cached bindings.
   await sparse.step(3,{region:query});const saved=await sparse.snapshot();quiet.restore(saved);created=0;
   for(const ticks of [0,1,2,0,1]){quiet.step(ticks);const region=await sparse.step(ticks,{region:query,edits:[]});check(region.tick===quiet.tick,'Reused query parameters have a stale tick.');}
   equal(await sparse.snapshot(),quiet.snapshot(),'Reused parameter storage or binding parity changed state.');
   check(created===0,'Steady-state access recreated bind groups.');
  }finally{GPUDevice.prototype.createBindGroup=bindings;}
  progress('Activity piggyback readback is isolated and invalidates on render/edit/restore');
  return{passed:true,backendInfo:sparse.backendInfo,thermalTileWakes,kernelPasses,equalHeatPairs,mixedTicks:32,wakeTicks:37,restartTicks:17,zeroWorkSleep:true,crossCornerWake:true,ledgerExact:true,meshes,activityReadbackBatched:true,latencyBoundedAndIsolated:true,accessBindingsReused:true,plannerReuse:{sleeping,edited:planned,plannerDispatchesForThreeTicks:plannerDispatches},activityClears:{ordinaryTickUploadBytes:uploaded,externalEditReasonPreserved:true}};
 }finally{sparse.close();dense.close();}
}
export async function verify64Gate(){
 const options={width:64,height:64,depth:64,chunkSize:32},cpu=createStateSpaceActiveWorld3D({...options,fillMaterial:MAT.STONE}),sparse=await createGpuActiveWorld3D(options),dense=await createGpuActiveWorld3D({...options,execution:'dense'});
 try{
  for(let z=8;z<21;z++)for(let y=8;y<25;y++)for(let x=8;x<21;x++)cpu.setCell(x,y,z,MAT.AIR,20);
  for(let z=10;z<15;z++)for(let y=8;y<14;y++)for(let x=10;x<15;x++)cpu.setCell(x,y,z,MAT.WATER,20);
  const initial=cpu.snapshot();await sparse.restore(initial);await dense.restore(initial);cpu.restore(initial);const sparseMs=[],denseMs=[];let dispatched=0,denseChunks=0;
  for(let n=1;n<=96;n++){
   cpu.step();const a=await step(dense),b=await step(sparse);if(n>32){denseMs.push(a);sparseMs.push(b);const info=await sparse.inspectActivity();dispatched+=info.dispatchedChunks;denseChunks+=info.denseChunks;}
   if(n%16===0){equal(await sparse.snapshot(),cpu.snapshot(),'64 sparse/CPU differs.');equal(await dense.snapshot(),cpu.snapshot(),'64 dense/CPU differs.');progress(`64³ dense/sparse/CPU ${n}/96`);}await pause();
  }
  check(dispatched<denseChunks,'Sparse gate did not reduce physics work.');await ledger(cpu,sparse);
  // The original complete 64³ CPU trajectory independently binds the shipped law.
  const reference=await fetch('/docs/checkpoints/volume-m3/node.json').then(r=>r.json()),convert=s=>({...s,worldVersion:ACTIVE_WORLD_VERSION_3D});
  const first=convert(await readFixture(reference.fixtures['world-initial']));await sparse.restore(first);await dense.restore(first);
  for(let n=1;n<=1024;n++){
   await step(dense);await step(sparse);if(n%32===0)progress(`64³ full cavern equivalence ${n}/1024`);
   if([3,31,32,509,1024].includes(n)){const expected=convert(await readFixture(reference.fixtures[`world-${n}`]));equal(await sparse.snapshot(),expected,`64 sparse tick ${n}`);equal(await dense.snapshot(),expected,`64 dense tick ${n}`);}await pause();
  }
  await ledger(dense,sparse);
  for(const tick of [3,31,509]){
   await sparse.restore(convert(await readFixture(reference.fixtures[`world-${tick}`])));
   while(sparse.tick<1024){await step(sparse);if(sparse.tick%32===0)progress(`64³ restart ${tick}: ${sparse.tick}/1024`);await pause();}
   equal(await sparse.snapshot(),convert(await readFixture(reference.fixtures['world-1024'])),`64 restart ${tick}`);
  }
  return{passed:true,backendInfo:sparse.backendInfo,dimensions:[64,64,64],cpuDenseSparseTicks:96,fullCpuReferenceTicks:1024,restarts:[3,31,509],energyDriftQ:'0',sparseWork:{dispatchedChunks:dispatched,denseChunks,reduction:1-dispatched/denseChunks},diagnosticCompleteTickMs:{dense:summary(denseMs),sparse:summary(sparseMs)}};
 }finally{sparse.close();dense.close();}
}
export async function packSnapshot(value){
 const bytes=new Uint8Array(await new Response(new Blob([JSON.stringify(value)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return{encoding:'gzip-base64',data:btoa(binary)};
}
export async function verify128Replay(){
 const field=await createGpuActiveWorld3D();
 try{
  await field.restore(createLevel().snapshot());const game=new ActiveCavernGame(field,DEFAULT_SEED);await game.initialize();const initial=await game.snapshot(),checkpoints={},timings=[],activity=[];
  for(let n=1;n<=600;n++){
   const start=performance.now();await game.step(routeInput(game));const ms=performance.now()-start;if(ms>100)throw Error('128 replay tick exceeded responsiveness budget.');timings.push(ms);
   if([3,31,509].includes(n))checkpoints[n]=await packSnapshot(await game.snapshot());
   if(n%32===0)progress(`128³ recorded GPU gameplay ${n}/600`);if(n%60===0)activity.push(await field.inspectActivity());await pause();
  }
  const final=await game.snapshot(),balance=await field.energyBalance();check(final.status==='won','128 cavern route did not win.');check(balance.driftQ===0n,'128 energy drift.');
  return{passed:true,backendInfo:field.backendInfo,seed:DEFAULT_SEED,initialCompressed:await packSnapshot(initial),finalCompressed:await packSnapshot(final),checkpointsCompressed:checkpoints,commands:game.commands,wonAt:final.events.find(e=>e.type==='crossed').tick,energyBalance:Object.fromEntries(Object.entries(balance).map(([k,v])=>[k,String(v)])),diagnosticTickMs:summary(timings),activity};
 }finally{field.close();}
}
export async function verify128Continuation(referenceUrl){
 const ref=await fetch(referenceUrl).then(r=>r.json());check(ref.passed&&ref.sourceUnchanged,'Passing CPU reference required.');
 const initial=await readFixture(ref.fixtures.initial),final=await readFixture(ref.fixtures.final),commands=await readFixture(ref.fixtures.commands),results=[];let backendInfo;
 for(const execution of ['dense','sparse']){
  const field=await createGpuActiveWorld3D({execution,activityReadbackInterval:60,profiling:true,gpuTiming:true});backendInfo=field.backendInfo;
  try{
   const game=new ActiveCavernGame(field);await game.restore(initial);
   for(const c of commands){const start=performance.now();await game.step(c);if(performance.now()-start>100)throw Error('128 continuation exceeded responsiveness budget.');if(c.tick%32===0)progress(`128³ ${execution} exact replay ${c.tick}/600`);await pause();}
   equal(await game.snapshot(),final,`128 ${execution} final state differs.`);check((await field.energyBalance()).driftQ===0n,'128 replay drift.');
   if(execution==='sparse'){
    for(const tick of [3,31,509]){
     await game.restore(await readFixture(ref.fixtures['game-'+tick]));
     for(const c of commands.slice(tick)){await game.step(c);if(c.tick%32===0)progress(`128³ sparse restart ${tick}: ${c.tick}/600`);await pause();}
     equal(await game.snapshot(),final,`128 sparse restart ${tick}`);check((await field.energyBalance()).driftQ===0n,'128 restart drift.');
    }
    const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const renderer=await field.createRenderer(canvas),before=await field.snapshot();
    await renderer.render({eye:[54,62,63],forward:[1,0,0],right:[0,0,-1],up:[0,-1,0]});await renderer.render({eye:[22,60,106],forward:[0,0,-1],right:[1,0,0],up:[0,-1,0]});equal(await field.snapshot(),before,'128 camera changed physics.');renderer.close();
   }
   results.push({execution,ticks:600,exact:true,restarts:execution==='sparse'?[3,31,509]:[],zeroDrift:true});
  }finally{field.close();}
 }
 return{passed:true,backendInfo,results,cameraIsolated:true,activityReadbackInterval:60};
}
