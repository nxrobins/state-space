import { InputLatency, FrameLatencyCollector, textIfChanged, classIfChanged } from '../../web/frame-latency.js';
import { createGpuActiveWorld3D } from '../../dist/sdk/state-space-active-world-gpu.js';
import { MATERIALS_3D } from '../../dist/sdk/state-space-3d.js';
import { GpuActiveCavernGame } from './gpu-game.js';
import { ActiveCavernGame, GAME_VERSION, commandFor, routeInput, Q, MAX_TICKS } from './game.js';
import { createLevel, DEFAULT_SEED } from './scene.js';
import { createFramePump, waitForDisplayBoundary } from '../../web/frame-pump.js';
import { FrameClock } from '../../web/frame-clock.js';

const residentGameplay=new URLSearchParams(location.search).get('gameplay')==='gpu',Game=residentGameplay?GpuActiveCavernGame:ActiveCavernGame;
let heatDistortion=true;
let appearance=new URLSearchParams(location.search).get('appearance')??'naturalistic';
if(!['diagnostic','naturalistic'].includes(appearance))throw new Error('Invalid terrain appearance.');
const seedText=new URLSearchParams(location.search).get('seed'),seed=seedText===null?DEFAULT_SEED:Number(seedText);
if(!Number.isInteger(seed)||seed<0||seed>0xffffffff)throw new Error('Seed must be an unsigned 32-bit integer.');
const elements=new Map(),$=id=>{if(!elements.has(id))elements.set(id,document.getElementById(id));return elements.get(id);};
const canvas=$('world'),clock=new FrameClock(),keys=new Set();
let field,renderer,game,initial,recordingInitial,lastCheckpoint,pump,active=Promise.resolve(),exclusive=false,playing=false,auto=false,failed=false,benchmarking=false,cancelled=false;
let lastResidentView='',lastView='',activityTick=-1,activity=null,activityText='';
const inputLatency=new InputLatency();let lastInput=null,controllerCompletedAt=0,renderInputSampledAt=0;
const names=new Map(MATERIALS_3D.map(m=>[m.id,m.name.toUpperCase()]));
let yaw=Math.PI/2,pitch=.10,tool='carve',mouse=false,drag=null;
async function pack(value){const raw=new TextEncoder().encode(JSON.stringify(value));const zipped=new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());let binary='';for(let i=0;i<zipped.length;i+=8192)binary+=String.fromCharCode(...zipped.subarray(i,i+8192));return{encoding:'gzip-base64',data:btoa(binary)};}
const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(v=>v.toString(16).padStart(2,'0')).join('');
const dist=a=>{const s=[...a].sort((a,b)=>a-b);return{count:s.length,min:s[0],median:s[Math.floor(s.length/2)],p95:s[Math.ceil(s.length*.95)-1],p99:s[Math.ceil(s.length*.99)-1],max:s.at(-1)};};
function download(value,name){const url=URL.createObjectURL(new Blob([JSON.stringify(value)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
function fatal(error){failed=true;playing=false;auto=false;keys.clear();mouse=false;$('mode').textContent='PAUSED / ERROR';$('error').hidden=false;$('error').textContent=String(error.message||error);$('status').textContent='Paused. Reset to the initial checkpoint to recover.';}
function notify(fn){void Promise.resolve().then(fn).then(()=>{if(!failed)$('error').hidden=true;}).catch(error=>{$('error').hidden=false;$('error').textContent=String(error.message||error);});}
function directions(){const forward=[Math.cos(pitch)*Math.sin(yaw),Math.sin(pitch),Math.cos(pitch)*Math.cos(yaw)],right=[Math.cos(yaw),0,-Math.sin(yaw)],up=[right[1]*forward[2]-right[2]*forward[1],right[2]*forward[0]-right[0]*forward[2],right[0]*forward[1]-right[1]*forward[0]];return{forward,right,up};}
function input(){
  const dz=(keys.has('KeyW')?1:0)-(keys.has('KeyS')?1:0),dx=(keys.has('KeyD')?1:0)-(keys.has('KeyA')?1:0),scale=dx&&dz?Math.SQRT1_2:1;
  return{moveX:Math.round((Math.sin(yaw)*dz+Math.cos(yaw)*dx)*Q*scale),moveZ:Math.round((Math.cos(yaw)*dz-Math.sin(yaw)*dx)*Q*scale),jump:keys.has('Space'),tool:mouse||keys.has('KeyE')?tool:'none',look:directions().forward.map(v=>Math.round(v*Q))};
}
function follow(look=game.look){const [x,y,z]=look;yaw=Math.atan2(x,z);pitch=Math.atan2(y,Math.hypot(x,z));}
function frameTime(ms){textIfChanged($('frame'),`${ms.toFixed(2)} ms`);}
function hud(ms,target=game.target(directions().forward.map(v=>Math.round(v*Q)))){
  textIfChanged($('tick'),String(field.tick));textIfChanged($('seed'),String(game.seed));textIfChanged($('mode'),benchmarking?'MEASURING':failed?'ERROR':playing?'PLAYING':game.status==='won'?'CROSSED':'PAUSED');
  textIfChanged($('position'),[game.player.x,game.player.y,game.player.z].map(v=>(v/Q).toFixed(1)).join(' / '));if(ms!==undefined)frameTime(ms);
  classIfChanged($('mission-carve'),'done',game.events.some(e=>e.type==='carved'));classIfChanged($('mission-freeze'),'done',game.events.some(e=>e.type==='cooled'));classIfChanged($('mission-cross'),'done',game.status==='won');
  textIfChanged($('target'),target?`${names.get(target.material)} / ${target.cell.join(' · ')}`:'Aim at terrain within five voxels');
  textIfChanged($('play'),playing?'Pause':'Play');if(activity)textIfChanged($('activity'),activityText);
}
function activityMap(){
 if(!activity)return;const map=$('activity-map'),ctx=map.getContext('2d'),n=128/activity.activityChunkSize,y=Number($('activity-layer').value),cell=map.width/n;
 for(let z=0;z<n;z++)for(let x=0;x<n;x++){const k=x+n*(y+n*z),r=activity.wakeReasons[k];ctx.fillStyle=!activity.awake[k]?'#18252d':r&16?'#59d9db':r&8?'#b994ff':r&4?'#f18066':'#edcc7a';ctx.fillRect(x*cell,z*cell,cell-1,cell-1);}
 textIfChanged($('activity-slice'),`Y ${y*activity.activityChunkSize}..${(y+1)*activity.activityChunkSize-1} | X right, Z down`);
}
async function updateActivity(){
 if(field.tick!==activityTick&&(field.tick%60===0||activity===null)){activity=await field.inspectActivity();activityTick=field.tick;activityText=`${activity.totalChunks-activity.sleepingChunks} active / ${activity.sleepingChunks} sleeping tiles @ tick ${activity.tick} | ${activity.dispatchedChunks}/${activity.denseChunks} physics tiles | ${activity.terrainDirty?.filter(v=>v).length??0} dirty terrain chunks`;activityMap();}
}
async function draw(){
 if(residentGameplay){
  renderInputSampledAt=performance.now();lastResidentView=[field.tick,yaw,pitch].join(',');
  await game.present({renderer,camera:directions()});await updateActivity();hud(undefined,game.target());return;
 }
 await updateActivity();const {forward,right,up}=directions(),target=game.target(forward.map(v=>Math.round(v*Q)));renderInputSampledAt=performance.now();hud(undefined,target);await renderer.render({eye:game.eye().map(v=>v/Q),forward,right,up,...(target?{target:target.cell[0]+128*(target.cell[1]+128*target.cell[2])}:{})});
}
async function advance(command,following){
 if(residentGameplay){
  if(following)follow(command.look??[256,0,0]);
  renderInputSampledAt=performance.now();lastResidentView=[field.tick+1,yaw,pitch].join(',');
  await game.step(command,{renderer,camera:directions()});controllerCompletedAt=performance.now();await updateActivity();hud(undefined,game.target());
 }else{await game.step(command);controllerCompletedAt=performance.now();if(following)follow();}
}

async function frame(now,interval){if(exclusive||benchmarking||failed)return;
  const started=performance.now();
  if(keys.has('ArrowLeft'))yaw+=.025;if(keys.has('ArrowRight'))yaw-=.025;if(keys.has('ArrowUp'))pitch=Math.max(-1.35,pitch-.02);if(keys.has('ArrowDown'))pitch=Math.min(1.35,pitch+.02);
  const ticks=clock.advance(now,!playing,interval);
  for(let n=0;n<ticks;n++){if(field.tick>=MAX_TICKS){playing=false;break;}lastInput=inputLatency.sample(auto);await advance(auto?routeInput(game):input(),auto);if(auto){if(game.status!=='playing'){playing=false;auto=false;$('status').textContent=game.status==='won'?'Crossing complete. The recorded inputs reproduce both player and terrain exactly.':'Route stopped.';break;}}}
  const viewKey=[field.tick,yaw,pitch].join(',');if(!ticks&&viewKey===lastView)return;
  if(!residentGameplay||!ticks)await draw();lastView=residentGameplay?lastResidentView:viewKey;frameTime(performance.now()-started);
}
async function pausedOperation(fn){if(exclusive||benchmarking)throw new Error('Another operation is in flight.');exclusive=true;playing=false;auto=false;keys.clear();mouse=false;
  try{await active.catch(error=>{if(!failed)throw error;});clock.reset();return await fn();}finally{lastView='';activity=null;activityTick=-1;exclusive=false;}
}
async function reset(){
  const recovering=failed;activity=null;activityTick=-1;
  if(recovering){pump?.stop();renderer?.close();field?.close();active=Promise.resolve();field=await createGpuActiveWorld3D({activityReadbackInterval:60,profiling:true,gpuTiming:new URLSearchParams(location.search).get('gpuTiming')==='1'});renderer=await field.createRenderer(canvas);await renderer.setAppearance(appearance);await renderer.setHeatDistortion(heatDistortion);game=new Game(field,seed);window.activeCavern.game=game;}
  // These baselines stay private and are never mutated. Public tape reads clone
  // them at the boundary; resetting need not allocate two more full worlds.
  await game.restore(initial);recordingInitial=initial;lastCheckpoint=initial;yaw=Math.PI/2;pitch=.10;failed=false;$('error').hidden=true;$('status').textContent='Carve the dam ahead and left, then cool the channel to make your crossing.';await draw();
  if(recovering)pump=createFramePump((n,i)=>{active=frame(n,i);return active;},{onError:fatal});
}
async function replay(saved){
  saved=structuredClone(saved);
  if(!saved||saved.version!==GAME_VERSION||!Array.isArray(saved.commands)||saved.commands.length>MAX_TICKS||!saved.initial)throw new Error('Invalid replay file.');
  // Validate the whole input tape before restoring anything.
  for (let i=0;i<saved.commands.length;i++) {
    const command=saved.commands[i];
    if (!command || typeof command !== 'object') throw new Error('Invalid replay command.');
    commandFor(command,saved.initial.field.tick+i+1);
  }
  await game.restore(saved.initial);recordingInitial=structuredClone(saved.initial);for(const c of saved.commands)await game.step(c);follow();return game.snapshot();
}
async function runBenchmark(){
  if(benchmarking||exclusive||failed)throw new Error('Benchmark unavailable while another operation is active.');exclusive=true;playing=false;auto=false;
  try{await active;}catch(error){exclusive=false;fatal(error);throw error;}
  pump.stop();benchmarking=true;cancelled=false;$('cancel').hidden=false;$('receipt').hidden=true;
  const report={appearance,heatDistortion,appearanceVersion:'cavern-heat-1',version:residentGameplay?2:1,gameplayBackend:residentGameplay?'gpu':'cpu',scope:'Complete seeded 128³ gameplay: input, bounded GPU edits, all 27 physics passes, 16³ collision readback, integer controller, HUD, dirty chunk mesh updates and culled GPU terrain, uploads, draw, validation and GPU completion. Excludes setup, warmup reset, snapshots, reference replay, source hashing and OS scanout.',resolution:[1920,1080],viewport:[innerWidth,innerHeight],devicePixelRatio,dimensions:[128,128,128],targetHz:60,warmup:[],samples:[],backendInfo:field.backendInfo,userAgent:navigator.userAgent,recordedAt:new Date().toISOString(),cancelled:false};
  if(residentGameplay)report.scope='Complete 128³ GPU-resident gameplay: command upload, cached tool targeting, exact physics, resident collision/controller, same-tick camera, terrain mesh/draw, compact readback, HUD, validation and one GPU completion boundary. Excludes setup, snapshots, hashing and OS scanout.';
  window.activeCavern.benchmarkResult=report;const traceCollector=new FrameLatencyCollector();report.setupHandoffFrames=2;
  async function measure(count,rows){return new Promise((resolve,reject)=>{let loop;loop=createFramePump(async(timestamp,interval)=>{
    if(cancelled){loop.stop();resolve();return;}
    const start=performance.now(),tick=field.tick+1,wasPlaying=game.status==='playing',command=routeInput(game);
    lastInput=inputLatency.sample(true);await advance(command,true);const physicsDone=performance.now();if(!residentGameplay)await draw();frameTime(performance.now()-start);traceCollector.capture(field);
    if((rows.length+1)%60===0)$('status').textContent=`${rows===report.warmup?'Warmup':'Measured'} ${rows.length+1} / ${count} frames`;
    const done=performance.now();
    const sample={tick,timestamp,callbackAt:start,completedAt:done,callbackInterval:interval??null,callbackDelayMs:start-timestamp,...(residentGameplay?{gameplayAndRenderMs:controllerCompletedAt-start,postCommitHudMs:done-controllerCompletedAt,submissions:game.lastCommit.submissions,completionBoundaries:game.lastCommit.completionBoundaries,actorReadbackBytes:game.lastCommit.actorReadbackBytes}:{physicsAndQueryMs:physicsDone-start,renderAndHudMs:done-physicsDone}),workMs:done-start,completionMs:done-timestamp,activeGameplay:wasPlaying,tool:command.tool??'none',input:lastInput,controllerCompletedAt,renderInputSampledAt};
    rows.push(sample);
    if(done-start>100||done-timestamp>250){report.abortedFrame={phase:rows===report.warmup?'warmup':'measured',...sample};throw new Error(`Verification frame exceeded the responsiveness budget: ${sample.workMs.toFixed(1)} ms work, ${sample.completionMs.toFixed(1)} ms completion; measurement stopped.`);}
    if(rows.length>=count){loop.stop();report.pump=loop.statistics();resolve();}
  },{onError:error=>{loop.stop();reject(error);}});});}
  try{
    canvas.width=1920;canvas.height=1080;await reset();report.initial=await game.snapshot();await waitForDisplayBoundary();traceCollector.reset(field);await measure(60,report.warmup);
    if(!cancelled){await reset();await waitForDisplayBoundary();traceCollector.reset(field);await measure(600,report.samples);report.latency=await traceCollector.finish(field);report.final=await game.snapshot();report.commands=structuredClone(game.commands);report.initialHash=await hash(report.initial);report.finalHash=await hash(report.final);report.energyBalance=Object.fromEntries(Object.entries(await field.energyBalance()).map(([k,v])=>[k,String(v)]));report.activity=await field.inspectActivity();report.finalStatus=report.final.status;report.finalTick=report.final.field.tick;report.initialCompressed=await pack(report.initial);report.finalCompressed=await pack(report.final);delete report.initial;delete report.final;}
    report.cancelled=cancelled;report.complete=!cancelled&&report.samples.length===600;
    const rows=report.samples;if(rows.length){const first=rows[0],last=rows.at(-1),activeRows=rows.filter(r=>r.activeGameplay);report.work=dist(rows.map(r=>r.workMs));report.completion=dist(rows.map(r=>r.completionMs));if(residentGameplay){report.gameplayAndRender=dist(rows.map(r=>r.gameplayAndRenderMs));report.postCommitHud=dist(rows.map(r=>r.postCommitHudMs));report.sub8msTargetPassed=report.complete&&report.completion.p95<8;report.framesAtOrAbove8ms=rows.filter(r=>r.completionMs>=8).length;}else{report.physicsAndQuery=dist(rows.map(r=>r.physicsAndQueryMs));report.renderAndHud=dist(rows.map(r=>r.renderAndHudMs));}report.missedDeadlines=rows.filter(r=>r.completionMs>1000/60).length;report.lostDisplaySlots=rows.slice(1).reduce((n,r)=>n+Math.max(0,Math.round(r.callbackInterval/(1000/60))-1),0);report.physicsHz=(rows.length-1)*1000/(last.completedAt-first.completedAt);report.callbackHz=(rows.length-1)*1000/(last.timestamp-first.timestamp);report.activeGameplay={count:activeRows.length,completion:dist(activeRows.map(r=>r.completionMs)),missedDeadlines:activeRows.filter(r=>r.completionMs>1000/60).length};report.performancePassed=report.complete&&report.missedDeadlines===0&&report.lostDisplaySlots===0&&report.pump.coalesced===0&&Math.abs(report.physicsHz-60)<=.1&&Math.abs(report.callbackHz-60)<=.1;}
    $('status').textContent=report.complete?`Measured 600 frames · ${report.physicsHz.toFixed(2)} Hz · ${report.missedDeadlines} deadline misses · ${report.performancePassed?'60 Hz gate passed':'60 Hz gate not met'}`:'Measurement cancelled; partial receipt retained.';
  }catch(error){report.error=String(error.stack||error);fatal(error);}
  finally{if(!report.complete)delete report.initial;report.finishedAt=new Date().toISOString();benchmarking=false;exclusive=false;$('cancel').hidden=true;$('receipt').hidden=false;$('receipt').href='#';$('receipt').onclick=e=>{e.preventDefault();download(report,'cavern-frames.json');};clock.reset();pump=createFramePump((n,i)=>{active=frame(n,i);return active;},{onError:fatal});}
  return report;
}
function appearanceLabel(){
 $('heat-distortion').checked=heatDistortion;$('heat-distortion').disabled=appearance!=='naturalistic';
 $('appearance-toggle').textContent=appearance==='naturalistic'?'B · Naturalistic':'A · Diagnostic';
 $('appearance-toggle').setAttribute('aria-pressed',String(appearance==='naturalistic'));
 $('appearance-label').textContent=appearance==='naturalistic'?'BASALT / SURVEY LIGHT':'MATERIAL / DIAGNOSTIC';
}
async function setHeatDistortion(value){return pausedOperation(async()=>{
 await renderer.setHeatDistortion(value);heatDistortion=value;appearanceLabel();await draw();return heatDistortion;
});}
async function setAppearance(value){return pausedOperation(async()=>{
 if(!['diagnostic','naturalistic'].includes(value))throw new Error('Invalid terrain appearance.');
 await renderer.setAppearance(value);appearance=value;appearanceLabel();await draw();return appearance;
});}
async function main(){
 appearanceLabel();$('heat-distortion').onchange=()=>notify(async()=>{try{await setHeatDistortion($('heat-distortion').checked);}finally{appearanceLabel();}});$('appearance-toggle').onclick=()=>notify(()=>setAppearance(appearance==='naturalistic'?'diagnostic':'naturalistic'));
 $('study-view').onchange=()=>notify(()=>pausedOperation(async()=>{const views={crossing:[Math.PI/2,.10],lava:[-.09,.06],ice:[1.04,.06]};[yaw,pitch]=views[$('study-view').value];await draw();}));
  $('gameplay-backend').value=residentGameplay?'gpu':'cpu';$('gameplay-backend').onchange=()=>{const url=new URL(location.href);url.searchParams.set('gameplay',$('gameplay-backend').value);location.assign(url);};
  field=await createGpuActiveWorld3D({activityReadbackInterval:60,profiling:true,gpuTiming:new URLSearchParams(location.search).get('gpuTiming')==='1'});await field.restore(createLevel(seed).snapshot());renderer=await field.createRenderer(canvas);await renderer.setAppearance(appearance);await renderer.setHeatDistortion(heatDistortion);game=new Game(field,seed);await game.initialize();initial=await game.snapshot();recordingInitial=initial;lastCheckpoint=initial;
  const select=name=>{tool=name;for(const id of ['carve','freeze']){$(id).classList.toggle('selected',id===name);$(id).setAttribute('aria-pressed',String(id===name));}};
  $('carve').onclick=()=>select('carve');$('freeze').onclick=()=>select('freeze');
  $('activity-layer').oninput=activityMap;
  $('play').onclick=()=>{if(exclusive||benchmarking||failed)return;playing=!playing;auto=false;clock.reset();hud();};
  $('step').onclick=()=>notify(()=>pausedOperation(async()=>{await advance(input(),false);if(!residentGameplay)await draw();}));
  $('reset').onclick=()=>notify(()=>pausedOperation(reset));$('route').onclick=()=>notify(async()=>{await pausedOperation(reset);auto=true;playing=true;clock.reset();});
  $('capture').onclick=()=>{canvas.focus();notify(async()=>{await canvas.requestPointerLock();});};
  canvas.addEventListener('pointerdown',e=>{inputLatency.capture(e);canvas.focus();if(e.button===0)mouse=true;if(e.button===2){drag=[e.clientX,e.clientY];canvas.setPointerCapture(e.pointerId);}});
  canvas.addEventListener('contextmenu',e=>e.preventDefault());canvas.addEventListener('pointermove',e=>{inputLatency.capture(e);if(document.pointerLockElement===canvas){yaw-=e.movementX*.0025;pitch=Math.max(-1.35,Math.min(1.35,pitch+e.movementY*.0025));}else if(drag){yaw-=(e.clientX-drag[0])*.004;pitch=Math.max(-1.35,Math.min(1.35,pitch+(e.clientY-drag[1])*.004));drag=[e.clientX,e.clientY];}});
  window.addEventListener('pointerup',e=>{inputLatency.capture(e);mouse=false;drag=null;});window.addEventListener('blur',()=>{keys.clear();mouse=false;drag=null;});
  window.addEventListener('keydown',e=>{if(e.target instanceof HTMLInputElement||e.target instanceof HTMLSelectElement)return;inputLatency.capture(e);if(['Space','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.code))e.preventDefault();keys.add(e.code);if(e.code==='Digit1')select('carve');if(e.code==='Digit2')select('freeze');});window.addEventListener('keyup',e=>{inputLatency.capture(e);keys.delete(e.code);});
  $('export').onclick=()=>notify(()=>pausedOperation(async()=>{if(!failed)lastCheckpoint=await game.snapshot();download(lastCheckpoint,`cavern-tick-${lastCheckpoint.field.tick}.json`);}));
  $('replay-export').onclick=()=>notify(()=>pausedOperation(async()=>download({version:GAME_VERSION,initial:recordingInitial,commands:structuredClone(game.commands)},'cavern-replay.json')));
  $('import').onclick=()=>$('file').click();$('file').onchange=()=>notify(async()=>{const file=$('file').files[0];if(!file)return;if(file.size>64*1024*1024)throw new Error('Import exceeds 64 MiB.');const saved=JSON.parse(await file.text());await pausedOperation(async()=>{if(saved.commands)await replay(saved);else{await game.restore(saved);recordingInitial=await game.snapshot();}lastCheckpoint=await game.snapshot();follow();hud();});$('file').value='';});
  $('benchmark').onclick=()=>notify(runBenchmark);$('cancel').onclick=()=>{cancelled=true;};document.addEventListener('visibilitychange',()=>{if(document.hidden){playing=false;cancelled=true;keys.clear();mouse=false;clock.reset();}});
  // API operations use the same exclusive boundary as UI mutations.
  window.activeCavern={ready:false,get appearance(){return appearance;},setAppearance,get heatDistortion(){return heatDistortion;},setHeatDistortion,gameplayBackend:residentGameplay?'gpu':'cpu',backendInfo:field.backendInfo,benchmarkResult:null,game,get operationInFlight(){return exclusive||benchmarking||game.busy;},
    suspend:()=>pausedOperation(async()=>{pump.stop();return game.snapshot();}),
    latency:()=>({engine:field.inspectLatency(),input:lastInput?structuredClone(lastInput):null,controllerCompletedAt,renderInputSampledAt}),
    snapshot:()=>pausedOperation(()=>game.snapshot()),step:(c={})=>pausedOperation(async()=>{await game.step(c);return game.snapshot();}),
    reset:()=>pausedOperation(async()=>{await reset();return game.snapshot();}),
    restore:s=>pausedOperation(async()=>{await game.restore(s);recordingInitial=await game.snapshot();return game.snapshot();}),
    replay:r=>pausedOperation(()=>replay(r)),runBenchmark,cancelBenchmark:()=>{cancelled=true;},
    replayTape:()=>({version:GAME_VERSION,initial:structuredClone(recordingInitial),commands:structuredClone(game.commands)}),
    view:v=>pausedOperation(async()=>{if(v.yaw!==undefined){if(!Number.isFinite(v.yaw))throw new Error('Invalid yaw.');yaw=v.yaw;}if(v.pitch!==undefined){if(!Number.isFinite(v.pitch)||Math.abs(v.pitch)>1.35)throw new Error('Invalid pitch.');pitch=v.pitch;}await draw();}),
  };
  $('status').textContent='Carve the dam ahead and left, then cool the channel. Watch the route for a complete demonstration.';await draw();pump=createFramePump((n,i)=>{active=frame(n,i);return active;},{onError:fatal});
  window.activeCavern.ready=true;window.addEventListener('pagehide',()=>{cancelled=true;pump.stop();});
}
main().catch(fatal);
