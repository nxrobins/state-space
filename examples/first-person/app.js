import { createGpuField3D } from '../../dist/sdk/state-space-3d-gpu.js';
import { MATERIALS_3D } from '../../dist/sdk/state-space-3d.js';
import { CrossingGame, GAME_VERSION, commandFor, routeInput, Q, MAX_TICKS } from './game.js';
import { createLevel } from './scene.js';
import { createFramePump } from '../../web/frame-pump.js';
import { FrameClock } from '../../web/frame-clock.js';

const $=id=>document.getElementById(id),canvas=$('world'),clock=new FrameClock(),keys=new Set();
let field,renderer,game,initial,recordingInitial,lastCheckpoint,pump,active=Promise.resolve(),exclusive=false,playing=false,auto=false,failed=false,benchmarking=false,cancelled=false;
let yaw=Math.PI/2,pitch=.10,tool='carve',mouse=false,drag=null;
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
function follow(){const [x,y,z]=game.look;yaw=Math.atan2(x,z);pitch=Math.atan2(y,Math.hypot(x,z));}
function hud(ms){
  $('tick').textContent=String(field.tick);$('mode').textContent=benchmarking?'MEASURING':failed?'ERROR':playing?'PLAYING':game.status==='won'?'CROSSED':'PAUSED';
  $('position').textContent=[game.player.x,game.player.y,game.player.z].map(v=>(v/Q).toFixed(1)).join(' / ');if(ms!==undefined)$('frame').textContent=`${ms.toFixed(2)} ms`;
  $('mission-carve').classList.toggle('done',game.events.some(e=>e.type==='carved'));$('mission-freeze').classList.toggle('done',game.events.some(e=>e.type==='cooled'));$('mission-cross').classList.toggle('done',game.status==='won');
  const target=game.target(directions().forward.map(v=>Math.round(v*Q)));$('target').textContent=target?`${MATERIALS_3D.find(m=>m.id===target.material)?.name.toUpperCase()} / ${target.cell.join(' · ')}`:'Aim at terrain within five voxels';
  $('play').textContent=playing?'Pause':'Play';
}
async function draw(){hud();const {forward,right,up}=directions(),target=game.target(forward.map(v=>Math.round(v*Q)));await renderer.render({eye:game.eye().map(v=>v/Q),forward,right,up,...(target?{target:target.cell[0]+32*(target.cell[1]+32*target.cell[2])}:{})});}
async function frame(now,interval){if(exclusive||benchmarking||failed)return;
  const started=performance.now();
  if(keys.has('ArrowLeft'))yaw+=.025;if(keys.has('ArrowRight'))yaw-=.025;if(keys.has('ArrowUp'))pitch=Math.max(-1.35,pitch-.02);if(keys.has('ArrowDown'))pitch=Math.min(1.35,pitch+.02);
  const ticks=clock.advance(now,!playing,interval);
  for(let n=0;n<ticks;n++){if(field.tick>=MAX_TICKS){playing=false;break;}await game.step(auto?routeInput(game):input());if(auto){follow();if(game.status!=='playing'){playing=false;auto=false;$('status').textContent=game.status==='won'?'Crossing complete. The recorded inputs reproduce both player and terrain exactly.':'Route stopped.';break;}}}
  await draw();hud(performance.now()-started);
}
async function pausedOperation(fn){if(exclusive||benchmarking)throw new Error('Another operation is in flight.');exclusive=true;playing=false;auto=false;keys.clear();mouse=false;
  try{await active.catch(error=>{if(!failed)throw error;});clock.reset();return await fn();}finally{exclusive=false;}
}
async function reset(){
  const recovering=failed;
  if(recovering){pump?.stop();renderer?.close();field?.close();active=Promise.resolve();field=await createGpuField3D(32,32,32);renderer=await field.createRenderer(canvas);game=new CrossingGame(field);window.crossing.game=game;}
  await game.restore(initial);recordingInitial=structuredClone(initial);lastCheckpoint=structuredClone(initial);yaw=Math.PI/2;pitch=.10;failed=false;$('error').hidden=true;$('status').textContent='Carve the dam ahead and left, then cool the channel to make your crossing.';hud();
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
  const report={version:1,scope:'Complete 1080p gameplay: input, bounded GPU edits, all 27 physics passes, 16³ collision readback, integer controller, HUD, GPU face compaction, uploads, draw, validation and GPU completion. Excludes setup, warmup reset, snapshots, reference replay, source hashing and OS scanout.',resolution:[1920,1080],dimensions:[32,32,32],targetHz:60,warmup:[],samples:[],backendInfo:field.backendInfo,userAgent:navigator.userAgent,recordedAt:new Date().toISOString(),cancelled:false};
  window.crossing.benchmarkResult=report;
  async function measure(count,rows){return new Promise((resolve,reject)=>{let loop;loop=createFramePump(async(timestamp,interval)=>{
    if(cancelled){loop.stop();resolve();return;}
    const start=performance.now(),tick=field.tick+1,wasPlaying=game.status==='playing',command=routeInput(game);
    await game.step(command);follow();const physicsDone=performance.now();await draw();const done=performance.now();
    rows.push({tick,timestamp,callbackAt:start,completedAt:done,callbackInterval:interval??null,callbackDelayMs:start-timestamp,physicsAndQueryMs:physicsDone-start,renderAndHudMs:done-physicsDone,workMs:done-start,completionMs:done-timestamp,activeGameplay:wasPlaying,tool:command.tool??'none'});
    hud(done-start);if(rows.length%60===0)$('status').textContent=`${rows===report.warmup?'Warmup':'Measured'} ${rows.length} / ${count} frames`;
    if(rows.length>=count){loop.stop();report.pump=loop.statistics();resolve();}
  },{onError:error=>{loop.stop();reject(error);}});});}
  try{
    canvas.width=1920;canvas.height=1080;await reset();await measure(60,report.warmup);
    if(!cancelled){await reset();report.initial=await game.snapshot();await measure(600,report.samples);report.final=await game.snapshot();report.commands=structuredClone(game.commands);report.initialHash=await hash(report.initial);report.finalHash=await hash(report.final);report.energyBalance=Object.fromEntries(Object.entries(await field.energyBalance()).map(([k,v])=>[k,String(v)]));}
    report.cancelled=cancelled;report.complete=!cancelled&&report.samples.length===600;
    const rows=report.samples;if(rows.length){const first=rows[0],last=rows.at(-1),activeRows=rows.filter(r=>r.activeGameplay);report.work=dist(rows.map(r=>r.workMs));report.completion=dist(rows.map(r=>r.completionMs));report.physicsAndQuery=dist(rows.map(r=>r.physicsAndQueryMs));report.renderAndHud=dist(rows.map(r=>r.renderAndHudMs));report.missedDeadlines=rows.filter(r=>r.completionMs>1000/60).length;report.lostDisplaySlots=rows.slice(1).reduce((n,r)=>n+Math.max(0,Math.round(r.callbackInterval/(1000/60))-1),0);report.physicsHz=(rows.length-1)*1000/(last.completedAt-first.completedAt);report.callbackHz=(rows.length-1)*1000/(last.timestamp-first.timestamp);report.activeGameplay={count:activeRows.length,completion:dist(activeRows.map(r=>r.completionMs)),missedDeadlines:activeRows.filter(r=>r.completionMs>1000/60).length};report.performancePassed=report.complete&&report.missedDeadlines===0&&report.lostDisplaySlots===0&&report.pump.coalesced===0&&Math.abs(report.physicsHz-60)<=.1&&Math.abs(report.callbackHz-60)<=.1;}
    $('status').textContent=report.complete?`Measured 600 frames · ${report.physicsHz.toFixed(2)} Hz · ${report.missedDeadlines} deadline misses · ${report.performancePassed?'60 Hz gate passed':'60 Hz gate not met'}`:'Measurement cancelled; partial receipt retained.';
  }catch(error){report.error=String(error.stack||error);fatal(error);}
  finally{report.finishedAt=new Date().toISOString();benchmarking=false;exclusive=false;$('cancel').hidden=true;$('receipt').hidden=false;$('receipt').href='#';$('receipt').onclick=e=>{e.preventDefault();download(report,'crossing-frames.json');};clock.reset();pump=createFramePump((n,i)=>{active=frame(n,i);return active;},{onError:fatal});}
  return report;
}
async function main(){
  field=await createGpuField3D(32,32,32);await field.restore(createLevel().snapshot());renderer=await field.createRenderer(canvas);game=new CrossingGame(field);await game.initialize();initial=await game.snapshot();recordingInitial=structuredClone(initial);lastCheckpoint=structuredClone(initial);
  const select=name=>{tool=name;for(const id of ['carve','freeze']){$(id).classList.toggle('selected',id===name);$(id).setAttribute('aria-pressed',String(id===name));}};
  $('carve').onclick=()=>select('carve');$('freeze').onclick=()=>select('freeze');
  $('play').onclick=()=>{if(exclusive||benchmarking||failed)return;playing=!playing;auto=false;clock.reset();hud();};
  $('step').onclick=()=>notify(()=>pausedOperation(async()=>{await game.step(input());await draw();}));
  $('reset').onclick=()=>notify(()=>pausedOperation(reset));$('route').onclick=()=>notify(async()=>{await pausedOperation(reset);auto=true;playing=true;clock.reset();});
  $('capture').onclick=()=>{canvas.focus();notify(async()=>{await canvas.requestPointerLock();});};
  canvas.addEventListener('pointerdown',e=>{canvas.focus();if(e.button===0)mouse=true;if(e.button===2){drag=[e.clientX,e.clientY];canvas.setPointerCapture(e.pointerId);}});
  canvas.addEventListener('contextmenu',e=>e.preventDefault());canvas.addEventListener('pointermove',e=>{if(document.pointerLockElement===canvas){yaw-=e.movementX*.0025;pitch=Math.max(-1.35,Math.min(1.35,pitch+e.movementY*.0025));}else if(drag){yaw-=(e.clientX-drag[0])*.004;pitch=Math.max(-1.35,Math.min(1.35,pitch+(e.clientY-drag[1])*.004));drag=[e.clientX,e.clientY];}});
  window.addEventListener('pointerup',()=>{mouse=false;drag=null;});window.addEventListener('blur',()=>{keys.clear();mouse=false;drag=null;});
  window.addEventListener('keydown',e=>{if(e.target instanceof HTMLInputElement)return;if(['Space','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.code))e.preventDefault();keys.add(e.code);if(e.code==='Digit1')select('carve');if(e.code==='Digit2')select('freeze');});window.addEventListener('keyup',e=>keys.delete(e.code));
  $('export').onclick=()=>notify(()=>pausedOperation(async()=>{if(!failed)lastCheckpoint=await game.snapshot();download(lastCheckpoint,`crossing-tick-${lastCheckpoint.field.tick}.json`);}));
  $('replay-export').onclick=()=>notify(()=>pausedOperation(async()=>download({version:GAME_VERSION,initial:recordingInitial,commands:structuredClone(game.commands)},'crossing-replay.json')));
  $('import').onclick=()=>$('file').click();$('file').onchange=()=>notify(async()=>{const file=$('file').files[0];if(!file)return;if(file.size>12*1024*1024)throw new Error('Import exceeds 12 MiB.');const saved=JSON.parse(await file.text());await pausedOperation(async()=>{if(saved.commands)await replay(saved);else{await game.restore(saved);recordingInitial=await game.snapshot();}lastCheckpoint=await game.snapshot();follow();hud();});$('file').value='';});
  $('benchmark').onclick=()=>notify(runBenchmark);$('cancel').onclick=()=>{cancelled=true;};document.addEventListener('visibilitychange',()=>{if(document.hidden){playing=false;cancelled=true;keys.clear();mouse=false;clock.reset();}});
  // API operations use the same exclusive boundary as UI mutations.
  window.crossing={ready:true,backendInfo:field.backendInfo,benchmarkResult:null,game,
    snapshot:()=>pausedOperation(()=>game.snapshot()),step:(c={})=>pausedOperation(async()=>{await game.step(c);return game.snapshot();}),
    reset:()=>pausedOperation(async()=>{await reset();return game.snapshot();}),
    restore:s=>pausedOperation(async()=>{await game.restore(s);recordingInitial=await game.snapshot();return game.snapshot();}),
    replay:r=>pausedOperation(()=>replay(r)),runBenchmark,cancelBenchmark:()=>{cancelled=true;},
    replayTape:()=>({version:GAME_VERSION,initial:structuredClone(recordingInitial),commands:structuredClone(game.commands)}),
    view:v=>pausedOperation(async()=>{if(v.yaw!==undefined){if(!Number.isFinite(v.yaw))throw new Error('Invalid yaw.');yaw=v.yaw;}if(v.pitch!==undefined){if(!Number.isFinite(v.pitch)||Math.abs(v.pitch)>1.35)throw new Error('Invalid pitch.');pitch=v.pitch;}await draw();}),
  };
  $('status').textContent='Carve the dam ahead and left, then cool the channel. Watch the route for a complete demonstration.';await draw();pump=createFramePump((n,i)=>{active=frame(n,i);return active;},{onError:fatal});
  window.addEventListener('pagehide',()=>{cancelled=true;pump.stop();});
}
main().catch(fatal);
