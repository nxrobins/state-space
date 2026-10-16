import {createGpuActiveWorld3D} from '../../dist/sdk/state-space-active-world-gpu.js';
import {createStateSpaceActiveWorld3D,MAT} from '../../dist/sdk/state-space-active-world.js';
import {GpuActiveCavernGame} from './gpu-game.js';
import {readFixture} from '../cavern/verify.js';
const check=(v,m)=>{if(!v)throw Error(m);};
const same=(a,b,m)=>check(JSON.stringify(a)===JSON.stringify(b),m);
const progress=text=>{document.getElementById('status').textContent=text;};
const pause=()=>new Promise(r=>setTimeout(r,10));
const camera={eye:[4,14,8],forward:[1,0,0],right:[0,0,-1],up:[0,-1,0]};
const pixels=async canvas=>{const image=new Image();image.src=canvas.toDataURL();await image.decode();const copy=document.createElement('canvas');copy.width=canvas.width;copy.height=canvas.height;const context=copy.getContext('2d');context.drawImage(image,0,0);return context.getImageData(0,0,copy.width,copy.height).data;};
const centerLight=(data,w,h)=>{let sum=0;for(let y=h/2-8;y<h/2+8;y++)for(let x=w/2-8;x<w/2+8;x++){const i=(x+w*y)*4;sum+=data[i]+data[i+1]+data[i+2];}return sum;};

export async function verifyAppearanceProbe(){
 progress('Appearance: bounded 16³ material/light probe');
 const options={width:16,height:16,depth:16,chunkSize:8},cpu=createStateSpaceActiveWorld3D(options);
 for(let z=0;z<16;z++)for(let y=0;y<16;y++)cpu.setCell(12,y,z,MAT.STONE);
 for(let z=0;z<16;z++)for(let x=0;x<16;x++)cpu.setCell(x,15,z,MAT.STONE);
 cpu.setCell(7,14,13,MAT.LAVA,240);cpu.setCell(10,14,5,MAT.WATER);cpu.setCell(9,14,5,MAT.ICE,5);
 const initial=cpu.snapshot();cpu.restore(initial);
 const field=await createGpuActiveWorld3D({...options,profiling:true,gpuTiming:true});const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;document.body.append(canvas);
 let result;
 try{
  await field.restore(initial);const renderer=await field.createRenderer(canvas);
  await renderer.render(camera);const diagnostic=canvas.toDataURL();const before=await field.snapshot(),balance=await field.energyBalance();
  await renderer.setAppearance('naturalistic');await renderer.render(camera);const natural=canvas.toDataURL(),lit=centerLight(await pixels(canvas),320,180);
  check(natural!==diagnostic,'Appearance switch made no visible difference');
  for(const value of [null,undefined,'invalid',0]){let rejected=false;try{await renderer.setAppearance(value);}catch{rejected=true;}check(rejected,'Invalid appearance accepted');}
  same(await field.snapshot(),before,'Appearance mutated physical state');
  for(const [k,v] of Object.entries(balance))check((await field.energyBalance())[k]===v,'Appearance changed ledger');
  await renderer.setAppearance('diagnostic');await renderer.render(camera);check(canvas.toDataURL()===diagnostic,'Diagnostic rendering changed after A/B');
  await renderer.setAppearance('naturalistic');await renderer.render(camera);check(canvas.toDataURL()===natural,'Paused naturalistic view is unstable');
  // The emitter is outside the center sample; this measures light on stone.
  await field.setCell(7,14,13,MAT.AIR);await renderer.render(camera);const unlit=centerLight(await pixels(canvas),320,180);check(lit>unlit+300,`Lava failed to illuminate the nearby stone receiver: ${lit} vs ${unlit}`);
  await field.restore(initial);await renderer.render(camera);check(canvas.toDataURL()===natural,'Restoring emitter failed to restore lighting');
  const wall=[];for(let z=10;z<=14;z++)for(let y=11;y<=14;y++)wall.push({x:9,y,z,material:MAT.STONE,thermal:20});
  await field.step(0,{edits:wall});await renderer.render(camera);const occluded=centerLight(await pixels(canvas),320,180);check(occluded<lit-300,'Opaque terrain failed to shadow the lava light');
  await field.restore(initial);
  const target=[...camera.eye];await renderer.render({...camera,eye:[4,13,8]});same(await field.snapshot(),initial,'Camera changed physical state');
  await renderer.render({...camera,eye:target});
  progress('Appearance: exact CPU/GPU ticks, edits and odd restart');
  let checkpoint,final;
  for(let tick=1;tick<=12;tick++){
   const edits=tick===6?[{x:8,y:13,z:7,material:MAT.SAND,thermal:20}]:[];
   cpu.step(1,{edits});await field.step(1,{edits});await renderer.setAppearance(tick%2?'naturalistic':'diagnostic');await renderer.render(camera);
   same(await field.snapshot(),cpu.snapshot(),`Appearance CPU/GPU mismatch at ${tick}`);
   if(tick===3)checkpoint=await field.snapshot();await pause();
  }
  final=await field.snapshot();await field.restore(checkpoint);
  for(let tick=4;tick<=12;tick++){await field.step(1,{edits:tick===6?[{x:8,y:13,z:7,material:MAT.SAND,thermal:20}]:[]});await renderer.setAppearance('naturalistic');await renderer.render(camera);await pause();}
  same(await field.snapshot(),final,'Appearance odd-tick restart differs');check((await field.energyBalance()).driftQ===0n,'Energy drift');
  await field.settleLatency();const latency=field.inspectLatency();check(latency.records.every(r=>r.gpu.status!=='error'),'GPU timing failed');
  result={passed:true,backendInfo:field.backendInfo,diagnosticRoundTrip:true,pausedPixelsStable:true,invalidAppearanceAtomic:true,viewIsolated:true,emitterRestored:true,stoneReceiver:{lit,unlit,occluded},cpuGpuTicks:12,restart:3,energyDriftQ:'0',latency};
 }finally{field.close();}
 return result;
}

export async function verifyAppearanceReplay(referenceUrl){
 const reference=await fetch(referenceUrl).then(r=>r.json());check(reference.passed&&reference.sourceUnchanged,'Passing CPU reference required');
 const commands=await readFixture(reference.fixtures.commands),field=await createGpuActiveWorld3D({profiling:true});
 const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;document.body.append(canvas);
 const results=[];
 try{
  const game=new GpuActiveCavernGame(field),renderer=await field.createRenderer(canvas);
  for(const [start,end] of [[3,31],[509,600]]){
   progress(`Appearance 128³: exact restart ${start} → ${end}`);await game.restore(await readFixture(reference.fixtures['game-'+start]));
   for(const command of commands.slice(start,end)){
    await renderer.setAppearance(command.tick%2?'naturalistic':'diagnostic');
    const submit=GPUQueue.prototype.submit,done=GPUQueue.prototype.onSubmittedWorkDone;let submissions=0,boundaries=0;
    GPUQueue.prototype.submit=function(...args){submissions++;return submit.apply(this,args);};GPUQueue.prototype.onSubmittedWorkDone=function(...args){boundaries++;return done.apply(this,args);};
    const started=performance.now();
    try{await game.step(command,{renderer,camera:{forward:camera.forward,right:camera.right,up:camera.up}});}finally{GPUQueue.prototype.submit=submit;GPUQueue.prototype.onSubmittedWorkDone=done;}
    check(submissions===1&&boundaries===1,'Appearance added a submission/completion boundary');check(performance.now()-started<100,`Appearance replay exceeded responsiveness budget at tick ${command.tick}: ${performance.now()-started} ms; ${JSON.stringify(field.inspectLatency().records.at(-1))}`);
    if(command.tick===start+2){const drawn=canvas.toDataURL();await game.present({renderer,camera:{forward:camera.forward,right:camera.right,up:camera.up}});check(canvas.toDataURL()===drawn,'Resident step and present use different optical ticks');}
    if(command.tick%16===0)progress(`Appearance restart ${start}: ${command.tick}/${end}`);await pause();
   }
   same(await game.snapshot(),await readFixture(reference.fixtures[end===600?'final':'game-'+end]),'Complete gameplay restart differs from CPU oracle');check((await field.energyBalance()).driftQ===0n,'Restart energy drift');results.push({start,end,completeStateExact:true,oneSubmission:true,oneCompletion:true,zeroDrift:true});
  }
  return{passed:true,backendInfo:field.backendInfo,results};
 }finally{field.close();}
}

export async function verifyOpticsProbe(){
 progress('Optics: bounded 16³ reflection, transmission and frozen-water fixture');
 const cpu=createStateSpaceActiveWorld3D({width:16,height:16,depth:16,chunkSize:8});
 for(let z=0;z<16;z++)for(let x=0;x<16;x++)cpu.setCell(x,14,z,MAT.STONE);
 const pool=[];for(let z=3;z<=13;z++)for(let y=10;y<14;y++)for(let x=3;x<=12;x++){
  cpu.setCell(x,y,z,MAT.WATER);pool.push({x,y,z,material:MAT.ICE,thermal:5});
 }
 const emitters=[];for(let x=6;x<=9;x++)for(let y=4;y<=6;y++){
  cpu.setCell(x,y,14,MAT.LAVA,240);emitters.push({x,y,z:14,material:MAT.AIR,thermal:20});
 }
 const initial=cpu.snapshot(),field=await createGpuActiveWorld3D({width:16,height:16,depth:16,chunkSize:8,profiling:true});
 const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;canvas.style.display='none';document.body.append(canvas);
 const style=document.createElement('style');style.textContent='body{background:#0e1820;color:#ccdce4;font:15px system-ui;padding:24px}figure{display:inline-block;vertical-align:top;width:320px;margin:12px}figcaption{padding:10px;min-height:44px}';document.head.append(style);
 const length=Math.hypot(5,6),view={eye:[8,5,2],forward:[0,5/length,6/length],right:[1,0,0],up:[0,-6/length,5/length]};
 // Every emitter corner is above the primary vertical frustum. Only its
 // reflection can occupy the center receiver pixels.
 for(const y of [4,7])for(const z of [14,15]){const d=[0,y-view.eye[1],z-view.eye[2]];const depth=d.reduce((s,v,i)=>s+v*view.forward[i],0),up=d.reduce((s,v,i)=>s+v*view.up[i],0);check(up>depth*Math.tan(Math.PI/6),'Reflection fixture emitter must be offscreen');}
 const rgb=data=>{const sum=[0,0,0];for(let y=84;y<96;y++)for(let x=154;x<166;x++)for(let c=0;c<3;c++)sum[c]+=data[(x+320*y)*4+c]/144;return sum;};
 const distance=(a,b)=>a.reduce((sum,v,i)=>sum+Math.abs(v-b[i]),0);
 try{
  await field.restore(initial);const renderer=await field.createRenderer(canvas);await renderer.setAppearance('naturalistic');
  const render=async(label,camera=view)=>{await renderer.render(camera);const data=await pixels(canvas);const image=document.createElement('img');image.src=canvas.toDataURL();image.width=320;image.alt=label;image.title=label;const figure=document.createElement('figure'),caption=document.createElement('figcaption');caption.textContent=label;figure.append(image,caption);document.body.append(figure);return{data,rgb:rgb(data),png:canvas.toDataURL()};};
  const water=await render('Water: lava reflected above a submerged stone floor');
  await renderer.render(view);check(canvas.toDataURL()===water.png,'Paused water ripples changed');
  await field.step(0,{edits:emitters});const noEmitter=await render('Water: reflected emitter removed');
  check(water.rgb[0]>noEmitter.rgb[0]+2,`Offscreen lava reflection missing: ${water.rgb} vs ${noEmitter.rgb}`);
  await field.restore(initial);
  const blocker=[];for(let x=5;x<=10;x++)for(let y=7;y<=9;y++)blocker.push({x,y,z:11,material:MAT.STONE,thermal:20});
  await field.step(0,{edits:blocker});const shadow=await render('Opaque geometry blocks the reflected emitter');
  check(shadow.rgb[0]<water.rgb[0]-2,`Reflection leaked through opaque terrain: ${shadow.rgb} vs ${water.rgb}`);
  await field.restore(initial);
  const floor=[];for(let z=10;z<=13;z++)for(let x=5;x<=10;x++)floor.push({x,y:14,z,material:MAT.SAND,thermal:20});
  await field.step(0,{edits:floor});const refracted=await render('Submerged sand is visible through refracted water');
  check(distance(refracted.rgb,water.rgb)>3,`Submerged terrain did not affect water transmission: ${refracted.rgb} vs ${water.rgb}`);
  for(const edit of pool)cpu.setCell(edit.x,edit.y,edit.z,edit.material,edit.thermal);await field.restore(cpu.snapshot());const iceState=await field.snapshot();const ice=await render('Ice: transmission, reflection and frozen inclusions');
  check(distance(ice.rgb,water.rgb)>1,'Frozen water has no optical distinction');
  await field.step(0,{edits:floor});const iceFloor=await render('Submerged sand through ice');
  check(distance(iceFloor.rgb,ice.rgb)>1,'Ice transmission does not reveal submerged terrain');
  await field.restore(iceState);await renderer.render(view);check(canvas.toDataURL()===ice.png,'Ice snapshot visual continuation differs');
  await field.restore(initial);await renderer.render(view);check(canvas.toDataURL()===water.png,'Water snapshot visual continuation differs');
  const under={eye:[6,10.1,8],forward:[.99503719,-.099503719,0],right:[0,0,-1],up:[-.099503719,-.99503719,0]};
  const underwater=await render('Underwater grazing view exercises total internal reflection',under);
  check(underwater.data.every((v,i)=>i%4!==3||v===255),'Underwater rendering produced invalid alpha');
  same(await field.snapshot(),initial,'Optical views mutated the physical grid');check((await field.energyBalance()).driftQ===0n,'Optics energy drift');
  progress('Optics: completed-tick ripples in resident gameplay');
  const actor={player:{x:8*256,y:5*256+400,z:2*256,vy:0,grounded:false,wet:false,jumpHeld:false,cooldown:0,blocked:false},look:[0,164,197],status:'won',carved:false,iceWalk:false};
  const rules={goal:{minX:14*256,maxY:15*256,minZ:0,maxZ:15*256},fallY:15*256,toolCeiling:15};
  const driver=await field.createGameplay(actor,rules),presentation={renderer,camera:{forward:view.forward,right:view.right,up:view.up}};
  const commit=await driver.step({tick:1,moveX:0,moveZ:0,jump:false,tool:'none',look:actor.look},presentation),drawn=canvas.toDataURL();
  await driver.present(presentation);check(canvas.toDataURL()===drawn,'Water uses a different tick in step and present');
  cpu.restore(initial);cpu.step();same(await field.snapshot(),cpu.snapshot(),'Optical gameplay changed the CPU/GPU state');
  const saved=await field.snapshot();await field.restore(saved);await driver.restore({player:commit.player,look:commit.look,status:commit.status,carved:commit.carved,iceWalk:commit.iceWalk});await driver.present(presentation);
  check(canvas.toDataURL()===drawn,'Water animation does not resume exactly from a snapshot');
  return{passed:true,backendInfo:field.backendInfo,reflection:{offscreen:true,lit:water.rgb,removed:noEmitter.rgb,occluded:shadow.rgb},refraction:{stone:water.rgb,sand:refracted.rgb},ice:{stone:ice.rgb,sand:iceFloor.rgb},pausedStable:true,snapshotPixelsExact:true,viewStateExact:true,underwaterFinite:true,residentTickPixelsExact:true,cpuGpuStateExact:true,energyDriftQ:'0'};
 }finally{field.close();}
}


export async function verifyHazeProbe(){
 progress('Haze: bounded 16³ steam, lava scattering and terrain occlusion');
 const options={width:16,height:16,depth:16,chunkSize:8},cpu=createStateSpaceActiveWorld3D(options);
 for(let z=0;z<16;z++)for(let x=0;x<16;x++)cpu.setCell(x,15,z,MAT.STONE);
 for(let z=6;z<=10;z++)for(let y=6;y<=9;y++)for(let x=6;x<=9;x++)cpu.setCell(x,y,z,MAT.STEAM,110);
 cpu.setCell(14,7,6,MAT.LAVA,240);
 const initial=cpu.snapshot(),field=await createGpuActiveWorld3D({...options,profiling:true,gpuTiming:true});
 const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;canvas.style.display='none';document.body.append(canvas);
 const style=document.createElement('style');style.textContent='body{background:#0e1820;color:#ccdce4;font:15px system-ui;padding:24px}figure{display:inline-block;vertical-align:top;width:320px;margin:12px}figcaption{padding:10px;min-height:44px}';document.head.append(style);
 const view={eye:[8,8,2],forward:[0,0,1],right:[1,0,0],up:[0,-1,0]};
 // Every emitter corner lies beyond the horizontal frustum. Center pixels
 // contain air/steam and distant background, never a luminous surface.
 for(const x of [14,15])for(const z of [6,7])check(x-8>(z-2)*Math.tan(Math.PI/6)*320/180,'Haze emitter must be offscreen');
 const rgb=data=>{const sum=[0,0,0];for(let y=82;y<98;y++)for(let x=152;x<168;x++)for(let c=0;c<3;c++)sum[c]+=data[(x+320*y)*4+c]/256;return sum;};
 const difference=(a,b)=>a.reduce((sum,v,i)=>sum+Math.abs(v-b[i]),0);
 try{
  await field.restore(initial);const renderer=await field.createRenderer(canvas);await renderer.setAppearance('naturalistic');
  const render=async label=>{await renderer.render(view);const data=await pixels(canvas),png=canvas.toDataURL();const image=document.createElement('img');image.src=png;image.width=320;image.alt=label;const figure=document.createElement('figure'),caption=document.createElement('figcaption');caption.textContent=label;figure.append(image,caption);document.body.append(figure);return{data,rgb:rgb(data),png};};
  const lit=await render('Steam catches light from lava outside the view');
  await renderer.render(view);check(canvas.toDataURL()===lit.png,'Paused haze changed');
  await field.setCell(14,7,6,MAT.AIR);const unlit=await render('Same steam without the lava emitter');
  check(lit.rgb[0]>unlit.rgb[0]+5,`Lava failed to illuminate steam: ${lit.rgb} vs ${unlit.rgb}`);
  await field.restore(initial);
  for(let z=6;z<=10;z++)for(let y=6;y<=9;y++)for(let x=6;x<=9;x++)cpu.setCell(x,y,z,MAT.AIR);
  const clearState=cpu.snapshot();await field.restore(clearState);const fog=await render('Cavern fog without physical steam');
  check(difference(lit.rgb,fog.rgb)>5,`Steam occupancy has no visible contribution: ${lit.rgb} vs ${fog.rgb}`);
  cpu.restore(initial);
  for(let z=3;z<=13;z++)for(let y=3;y<=12;y++)cpu.setCell(12,y,z,MAT.STONE);
  await field.restore(cpu.snapshot());const shadow=await render('Stone blocks the lava-to-steam light path');
  check(shadow.rgb[0]<lit.rgb[0]-5,`Lava glow leaked through stone: ${shadow.rgb} vs ${lit.rgb}`);
  // A wall in front of steam must hide all of its contribution. The emitter
  // remains unchanged so this tests depth termination, not light extraction.
  cpu.restore(initial);for(let y=0;y<15;y++)for(let x=0;x<16;x++)cpu.setCell(x,y,4,MAT.STONE);
  await field.restore(cpu.snapshot());const wall=await render('Foreground wall terminates the volume ray');
  for(let z=6;z<=10;z++)for(let y=6;y<=9;y++)for(let x=6;x<=9;x++)cpu.setCell(x,y,z,MAT.AIR);
  await field.restore(cpu.snapshot());await renderer.render(view);check(canvas.toDataURL()===wall.png,'Steam behind opaque wall leaked into image');
  await field.restore(initial);await renderer.render(view);check(canvas.toDataURL()===lit.png,'Haze restore changed image');
  await renderer.setAppearance('diagnostic');await renderer.render(view);const diagnostic=canvas.toDataURL();check(diagnostic!==lit.png,'Haze A/B identical');
  // Resize while diagnostic, then return to the old naturalistic dimensions:
  // the terrain depth texture has a new identity even when width is unchanged.
  canvas.width=321;canvas.height=181;await renderer.render(view);canvas.width=320;canvas.height=180;await renderer.setAppearance('naturalistic');await renderer.render(view);check(canvas.toDataURL()===lit.png,'Haze depth bindings stale after diagnostic resize');
  canvas.width=323;canvas.height=183;await renderer.render({...view,eye:[7,8,2]});canvas.width=320;canvas.height=180;await renderer.render(view);check(canvas.toDataURL()===lit.png,'Odd canvas resize changed haze');
  same(await field.snapshot(),initial,'Haze camera or appearance mutated physics');
  progress('Haze: exact CPU/GPU steam evolution and odd-tick restart');
  cpu.restore(initial);let checkpoint,final;
  for(let tick=1;tick<=12;tick++){
   cpu.step();await field.step();await renderer.render(view);same(await field.snapshot(),cpu.snapshot(),`Steam CPU/GPU differs at ${tick}`);
   if(tick===3)checkpoint=await field.snapshot();await pause();
  }
  final=await field.snapshot();const finalPixels=canvas.toDataURL();await field.restore(checkpoint);
  for(let tick=4;tick<=12;tick++){await field.step();await renderer.render(view);await pause();}
  same(await field.snapshot(),final,'Steam odd restart differs');check(canvas.toDataURL()===finalPixels,'Steam image continuation differs');check((await field.energyBalance()).driftQ===0n,'Haze energy drift');
  await field.settleLatency();const latency=field.inspectLatency();check(latency.records.every(r=>r.gpu.status!=='error'),'Haze timestamp failure');check(latency.records.some(r=>r.gpu.ms.volumetrics>=0),'Volumetric timing absent');
  return{passed:true,backendInfo:field.backendInfo,steam:lit.rgb,unlit:unlit.rgb,fogOnly:fog.rgb,shadow:shadow.rgb,offscreenEmitter:true,opaqueDepthClipping:true,pausedPixelsStable:true,restoredPixelsExact:true,diagnosticResizeExact:true,oddResizeExact:true,viewIsolated:true,cpuGpuTicks:12,restart:3,energyDriftQ:'0',latency};
 }finally{field.close();}
}


export async function verifyHeatProbe(){
 progress('Heat: bounded 16³ plume, cold control and foreground rejection');
 const options={width:16,height:16,depth:16,chunkSize:8},cpu=createStateSpaceActiveWorld3D(options);
 for(let z=0;z<16;z++)for(let x=0;x<16;x++)cpu.setCell(x,13,z,MAT.STONE);
 for(let y=0;y<13;y++)for(let x=0;x<16;x++)cpu.setCell(x,y,14,(x+y)%2?MAT.STONE:MAT.GLASS);
 cpu.setCell(8,12,8,MAT.LAVA,240);
 const initial=cpu.snapshot(),field=await createGpuActiveWorld3D({...options,profiling:true,gpuTiming:true});
 const view={eye:[8,7,3],forward:[0,0,1],right:[1,0,0],up:[0,-1,0]};
 const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;canvas.style.display='none';document.body.append(canvas);
 const style=document.createElement('style');style.textContent='body{background:#0e1820;color:#ccdce4;font:15px system-ui;padding:24px}figure{display:inline-block;vertical-align:top;width:420px;margin:12px}figcaption{padding:10px;min-height:44px}';document.head.append(style);
 const diff=(a,b,x0=0,y0=0,x1=640,y1=360)=>{let changed=0,total=0,max=0;for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){let d=0;for(let c=0;c<3;c++)d+=Math.abs(a[(x+640*y)*4+c]-b[(x+640*y)*4+c]);if(d)changed++;total+=d;max=Math.max(max,d);}return{changed,total,max};};
 try{
  await field.restore(initial);const renderer=await field.createRenderer(canvas);await renderer.setAppearance('naturalistic');
  const render=async(enabled,label)=>{await renderer.setHeatDistortion(enabled);await renderer.render(view);const data=await pixels(canvas),png=canvas.toDataURL();if(label){const image=document.createElement('img');image.src=png;image.width=420;image.alt=label;const figure=document.createElement('figure'),caption=document.createElement('figcaption');caption.textContent=label;figure.append(image,caption);document.body.append(figure);}return{data,png};};
  const off=await render(false,'Hot lava · shimmer disabled');const on=await render(true,'Same exact state · heat shimmer enabled');
  const distortion=diff(off.data,on.data,220,60,420,280);check(distortion.changed>100,`Lava plume has no visible distortion: ${JSON.stringify(distortion)}`);
  check(diff(off.data,on.data,0,0,80,300).changed===0,'Shimmer escaped its local plume');
  check((await render(true)).png===on.png,'Paused heat shimmer is unstable');
  for(const invalid of [null,undefined,1,'true',{}]){let rejected=false;try{await renderer.setHeatDistortion(invalid);}catch{rejected=true;}check(rejected,'Invalid heat toggle accepted');}
  await renderer.render(view);check(canvas.toDataURL()===on.png,'Invalid toggle changed the image');same(await field.snapshot(),initial,'Heat toggle changed physics');
  const pending=field.step();let busyRejected=false;try{await renderer.setHeatDistortion(false);}catch{busyRejected=true;}await pending;check(busyRejected,'Heat toggle bypassed the field operation boundary');await field.restore(initial);await renderer.render(view);check(canvas.toDataURL()===on.png,'Rejected busy toggle changed the setting');
  // The only time-varying presentation here is heat (no water or steam).
  const later=structuredClone(initial);later.tick=41;await field.restore(later);
  const offLater=await render(false);const onLater=await render(true,'Tick 41 · plume motion follows the completed tick');
  check(offLater.png===off.png,'The heat control changed unrelated shading');check(onLater.png!==on.png,'Heat shimmer does not animate across ticks');
  await field.restore(initial);check((await render(true)).png===on.png,'Heat image failed exact snapshot continuation');
  await field.setCell(8,12,8,MAT.STONE,20);const coldOff=await render(false);const coldOn=await render(true,'Cold source · no heat shimmer');check(coldOff.png===coldOn.png,'Cold terrain distorts air');
  cpu.restore(initial);for(let z=3;z<=13;z++)for(let x=2;x<=14;x++)cpu.setCell(x,10,z,MAT.STONE);
  await field.restore(cpu.snapshot());const blockedOff=await render(false);const blockedOn=await render(true,'A stone ceiling blocks the rising visual plume');
  check(diff(blockedOff.data,blockedOn.data,220,60,420,230).changed===0,'Heat plume passed through stone ceiling');
  cpu.restore(initial);for(let y=0;y<13;y++)for(let x=0;x<16;x++)cpu.setCell(x,y,5,MAT.STONE);
  await field.restore(cpu.snapshot());const wallOff=await render(false);const wallOn=await render(true,'Foreground stone stays sharp in front of the plume');check(wallOff.png===wallOn.png,'Heat behind the foreground distorted its surface');
  await field.restore(initial);await renderer.setAppearance('diagnostic');const a=await render(false);const b=await render(true);check(a.png===b.png,'Heat altered diagnostic rendering');
  await renderer.setAppearance('naturalistic');canvas.width=643;canvas.height=363;await renderer.render({...view,eye:[7,7,3]});canvas.width=640;canvas.height=360;check((await render(true)).png===on.png,'Heat resize/camera round trip differs');
  same(await field.snapshot(),initial,'Heat view mutated state');
  progress('Heat: exact CPU/GPU evolution, odd restart and resident presentation');
  cpu.restore(initial);let checkpoint;
  for(let tick=1;tick<=12;tick++){cpu.step();await field.step();await renderer.render(view);same(await field.snapshot(),cpu.snapshot(),`Heat CPU/GPU differs at ${tick}`);if(tick===3)checkpoint=await field.snapshot();await pause();}
  const final=await field.snapshot(),finalImage=canvas.toDataURL();await field.restore(checkpoint);
  for(let tick=4;tick<=12;tick++){await field.step();await renderer.render(view);await pause();}
  same(await field.snapshot(),final,'Heat odd restart differs');check(canvas.toDataURL()===finalImage,'Heat restart pixels differ');check((await field.energyBalance()).driftQ===0n,'Heat energy drift');
  await field.restore(initial);
  const actor={player:{x:8*256,y:7*256+400,z:3*256,vy:0,grounded:false,wet:false,jumpHeld:false,cooldown:0,blocked:false},look:[0,0,256],status:'won',carved:false,iceWalk:false};
  const driver=await field.createGameplay(actor,{goal:{minX:14*256,maxY:15*256,minZ:0,maxZ:15*256},fallY:15*256,toolCeiling:15});const presentation={renderer,camera:{forward:view.forward,right:view.right,up:view.up}};
  await driver.step({tick:1,moveX:0,moveZ:0,jump:false,tool:'none',look:actor.look},presentation);const committed=canvas.toDataURL();await driver.present(presentation);check(canvas.toDataURL()===committed,'Resident heat uses a different tick during present');
  cpu.restore(initial);cpu.step();same(await field.snapshot(),cpu.snapshot(),'Resident heat changed physical state');
  await field.settleLatency();const latency=field.inspectLatency();check(latency.records.every(r=>r.gpu.status!=='error'),'Heat timestamp error');
  return{passed:true,backendInfo:field.backendInfo,distortion,localityExact:true,pausedStable:true,tickAnimation:true,coldControlExact:true,ceilingBlocksPlume:true,foregroundExact:true,diagnosticExact:true,invalidToggleAtomic:true,busyToggleRejected:true,resizeExact:true,viewStateExact:true,cpuGpuTicks:12,restart:3,snapshotPixelsExact:true,residentTickPixelsExact:true,energyDriftQ:'0',latency};
 }finally{field.close();}
}
