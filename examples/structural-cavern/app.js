import {createStateSpaceStructuralWorld3DGPU,validateStructuralGameplayState3D} from '../../dist/sdk/state-space-structural-world-gpu.js';
import {MAT,MATERIALS_3D} from '../../dist/sdk/state-space-structural-world.js';
import {createStructuralLevel,structuralAction,fixtureEdits,scriptedInput,SCENE_VERSION} from './scene.js';
import {createFramePump} from '../../web/frame-pump.js';
import {FrameClock} from '../../web/frame-clock.js';
const $=id=>document.getElementById(id),canvas=$('world'),params=new URLSearchParams(location.search),keys=new Set(),clock=new FrameClock();
const names=new Map(MATERIALS_3D.map(m=>[m.id,m.name]));
let field,renderer,driver,level,initial,active=Promise.resolve(),pump,playing=false,exclusive=false,failed=false,pendingEdits=[];
let yaw=Math.PI/2,pitch=.1,orbit=false,orbitYaw=-.85,orbitPitch=.4,distance=13,drag=null,appearance='naturalistic',lightingMode=params.get('lighting')==='cached'?'cached':'reference',lastView='',lastCommit,remembered;
function controls(){
 for(const element of document.querySelectorAll('aside button, aside select, aside input'))element.disabled=exclusive||(failed&&element.id!=='reset');
 $('resume').disabled=exclusive||failed||!remembered;
 $('lighting').disabled=exclusive||failed||!renderer?.setLightingMode;
}
function checkpointText(){text('checkpoint-status',remembered?`Remembered tick ${remembered.field.tick}. Restore returns to this world and actor.`:'No remembered checkpoint.');}

$('size').value=params.get('size')??'32';$('scene').value=params.get('scene')??'control';
function basis(yaw,pitch){const forward=[Math.cos(pitch)*Math.sin(yaw),Math.sin(pitch),Math.cos(pitch)*Math.cos(yaw)],right=[Math.cos(yaw),0,-Math.sin(yaw)],up=[-Math.sin(pitch)*Math.sin(yaw),Math.cos(pitch),-Math.sin(pitch)*Math.cos(yaw)];return{forward,right,up:up.map(v=>-v)};}
// In a +Y-down world, camera up points toward negative Y.
function view(){return basis(yaw,pitch);}
function fail(error){playing=false;failed=true;pump?.stop();keys.clear();$('mode').textContent='PAUSED / ERROR';$('error').hidden=false;$('error').textContent=String(error.stack||error);controls();}
function startFrames(){pump?.stop();pump=createFramePump((now,interval)=>{active=frame(now,interval);return active;},{onError:fail});}
function notify(fn){return Promise.resolve().then(fn).catch(fail);}
function text(id,value){if($(id).textContent!==value)$(id).textContent=value;}
async function applyLightingMode(next){
 if(renderer.setLightingMode)await renderer.setLightingMode(next);
 else if(next!=='reference')throw Error('Cached lighting requires an SDK build with lighting-cache support.');
}
function hud(ms){
 text('tick',String(field.tick));text('mode',failed?'ERROR':playing?'PLAYING':'PAUSED');text('play',playing?'Pause':'Play');
 if(ms!==undefined)text('frame',`${ms.toFixed(2)} ms`);
 const solve=field.inspectSolve();text('solve',solve.planReused?'Exact cache':'Global solve');
 const hit=lastCommit?.target;text('target',hit?`${names.get(hit.material)} · ${hit.cell.join(' / ')} · E to ${$('tool').value}`:'Aim at terrain within five voxels.');
 if(lastCommit?.status==='lost')text('mode','FELL / RESET TO RETRY');
 if(lastCommit?.status==='won')text('mode','CROSSING COMPLETE');
}
function input(tick){
 const forward=(keys.has('KeyW')?1:0)-(keys.has('KeyS')?1:0),side=(keys.has('KeyD')?1:0)-(keys.has('KeyA')?1:0),scale=forward&&side?Math.SQRT1_2:1;
 return{tick,moveX:Math.round((Math.sin(yaw)*forward+Math.cos(yaw)*side)*256*scale),moveZ:Math.round((Math.cos(yaw)*forward-Math.sin(yaw)*side)*256*scale),jump:keys.has('Space'),tool:'none',look:view().forward.map(v=>Math.round(v*256))};
}
function targetEdit(){
 const hit=lastCommit?.target;if(!hit)return[];const [x,y,z]=hit.cell;
 if($('tool').value==='cut')return[{kind:'material',x,y,z,material:MAT.AIR,thermal:0}];
 return[{kind:'energy',x,y,z,energyQ:$('tool').value==='cool'?0:1000*256}];
}
async function present(){
 if(orbit){const center=[level.size/2,level.deckY+3,level.size/2],camera=basis(orbitYaw,orbitPitch);await renderer.render({...camera,eye:center.map((v,i)=>v-camera.forward[i]*distance)});}
 else lastCommit=await driver.present({renderer,camera:view()});hud();
}
async function advance(command=input(field.tick+1),edits=[]){
 const started=performance.now();
 lastCommit=await driver.step(command,{edits,presentation:orbit?undefined:{renderer,camera:view()}});
 if(orbit)await present();hud();const ms=performance.now()-started;text('frame',`${ms.toFixed(2)} ms`);return{ms,commit:lastCommit,solve:field.inspectSolve()};
}
async function frame(now,interval){
 if(exclusive||failed||!field)return;
 const ticks=clock.advance(now,!playing,interval);
 if(playing&&ticks){
  const tick=field.tick+1;if(tick>7200){playing=false;return;}
  const scripted=$('script').checked,command=scripted?scriptedInput(level,tick):input(tick);
  const edits=[...pendingEdits,...(scripted?fixtureEdits(level,tick):[])];pendingEdits=[];
  if(scripted){yaw=Math.PI/2;pitch=0;}
  await advance(command,edits);lastView='';return;
 }
 const key=[field.tick,yaw,pitch,orbit,orbitYaw,orbitPitch,distance,appearance,lightingMode].join(',');if(key!==lastView){await present();lastView=key;}
}
async function exclusiveOperation(fn){
 if(exclusive)throw Error('Another operation is in flight.');exclusive=true;playing=false;keys.clear();controls();
 try{await active.catch(error=>{if(!failed)throw error;});return await fn();}finally{exclusive=false;clock.reset();lastView='';controls();}
}
async function load(){
 driver?.close();renderer?.close();field?.close();field=renderer=driver=undefined;
 remembered=undefined;checkpointText();
 const size=Number($('size').value),scenario=$('scene').value;level=createStructuralLevel(size,scenario);initial=level.field.snapshot();
 // The setup oracle is not retained alongside the GPU world during play.
 delete level.field;
 field=await createStateSpaceStructuralWorld3DGPU({width:size,height:size,depth:size,chunkSize:initial.chunkSize,mode:'active'});
 await field.restore(initial);renderer=await field.createRenderer(canvas);await renderer.setAppearance(appearance);await renderer.setHeatDistortion(true);await applyLightingMode(lightingMode);
 $('lighting').disabled=!renderer.setLightingMode; text('lighting',renderer.setLightingMode?(lightingMode==='cached'?'Lighting B · Cached':'Lighting A · Reference'):'Lighting A · SDK update needed for B');
 driver=await field.createGameplay(level.actor,level.rules);yaw=Math.PI/2;pitch=.1;distance=13;orbit=false;text('camera','Orbit view');$('crosshair').hidden=false;pendingEdits=[];lastCommit=undefined;failed=false;$('error').hidden=true;
 text('dimension',`${size}³`);text('energy','Not inspected');
 text('expectation',scenario.endsWith('control')?'Control: the crossing should remain intact for 1,024 ticks.':scenario==='ice-heat'?'Script: melt supports at tick 180. The span should fall at ticks 181–183.':'Script: remove or overheat supports at tick 180. The detached span falls that tick.');
 await present();startFrames();
}
async function snapshot(){return{version:SCENE_VERSION,scenario:level.scenario,size:level.size,field:await field.snapshot(),actor:driver.inspect()};}
async function restore(value){
 if(!value||value.version!==SCENE_VERSION||value.size!==level.size||value.scenario!==level.scenario)throw Error('Checkpoint belongs to a different chamber.');
 // Validate actor before any terrain publication; terrain validates atomically.
 const actor=validateStructuralGameplayState3D(value.actor,[level.size,level.size,level.size]);
 await field.restore(value.field);await driver.restore(actor);failed=false;$('error').hidden=true;pendingEdits=[];await present();startFrames();
}
$('play').onclick=()=>{if(failed||exclusive)return;playing=!playing;clock.reset();hud();};
$('step').onclick=()=>notify(()=>exclusiveOperation(()=>advance(input(field.tick+1),pendingEdits.splice(0))));
for(const id of ['reset','scene','size'])$(id)[id==='reset'?'onclick':'onchange']=()=>notify(()=>exclusiveOperation(load));
for(const action of ['cut','heat','melt'])$(action).onclick=()=>notify(()=>exclusiveOperation(()=>advance(input(field.tick+1),structuralAction(level,action))));
$('appearance').onclick=()=>notify(()=>exclusiveOperation(async()=>{const next=appearance==='naturalistic'?'diagnostic':'naturalistic';await renderer.setAppearance(next);appearance=next;text('appearance',`A/B · ${appearance==='naturalistic'?'Naturalistic':'Diagnostic'}`);await present();}));
$('lighting').onclick=()=>notify(()=>exclusiveOperation(async()=>{const next=lightingMode==='reference'?'cached':'reference';await applyLightingMode(next);lightingMode=next;text('lighting',next==='cached'?'Lighting B · Cached':'Lighting A · Reference');await present();}));
$('camera').onclick=()=>{orbit=!orbit;text('camera',orbit?'First-person view':'Orbit view');$('crosshair').hidden=orbit;lastView='';};
$('inspect').onclick=()=>notify(()=>exclusiveOperation(async()=>{const balance=await field.energyBalance();text('energy',`${balance.driftQ} Q @ ${field.tick}`);}));
$('remember').onclick=()=>notify(()=>exclusiveOperation(async()=>{remembered=await snapshot();checkpointText();}));
$('resume').onclick=()=>notify(()=>exclusiveOperation(async()=>{if(!remembered)throw Error('Remember a checkpoint first.');await restore(remembered);checkpointText();}));
$('export').onclick=()=>notify(()=>exclusiveOperation(async()=>{const value=await snapshot(),url=URL.createObjectURL(new Blob([JSON.stringify(value)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=`m5-${level.scenario}-${field.tick}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}));
$('import').onclick=()=>$('file').click();$('file').onchange=()=>notify(()=>exclusiveOperation(async()=>{const file=$('file').files[0];if(file)await restore(JSON.parse(await file.text()));$('file').value='';}));
canvas.addEventListener('click',()=>{if(!orbit)void canvas.requestPointerLock();});
canvas.addEventListener('pointerdown',e=>{if(orbit)drag=[e.clientX,e.clientY];});window.addEventListener('pointerup',()=>{drag=null;});
window.addEventListener('pointermove',e=>{if(document.pointerLockElement===canvas){yaw+=e.movementX*.0025;pitch=Math.max(-1.3,Math.min(1.3,pitch+e.movementY*.0025));}else if(drag&&orbit){orbitYaw-=(e.clientX-drag[0])*.006;orbitPitch=Math.max(-1.2,Math.min(1.2,orbitPitch+(e.clientY-drag[1])*.006));drag=[e.clientX,e.clientY];}});
canvas.addEventListener('wheel',e=>{if(orbit){e.preventDefault();distance=Math.max(6,Math.min(level.size*.42,distance+e.deltaY*.025));}},{passive:false});
window.addEventListener('keydown',e=>{if(['INPUT','SELECT','BUTTON'].includes(document.activeElement?.tagName))return;keys.add(e.code);if(['Space','KeyE'].includes(e.code))e.preventDefault();if(e.code==='KeyE'&&!e.repeat&&!exclusive){pendingEdits.push(...targetEdit());if(!playing)notify(()=>exclusiveOperation(()=>advance(input(field.tick+1),pendingEdits.splice(0))));}});
window.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',()=>{keys.clear();playing=false;clock.reset();});
const api={get lightingMode(){return lightingMode;},get field(){return field;},get renderer(){return renderer;},get driver(){return driver;},get level(){return level;},advance,present,snapshot,restore,
 stop:async()=>{playing=false;pump?.stop();await active;},hud,view,ready:null};window.structuralCavern=api;
api.runBenchmark=()=>exclusiveOperation(async()=>{const {benchmarkStructuralGameplay}=await import('./benchmark.js');return benchmarkStructuralGameplay(api);});
api.runScaleProbe=()=>exclusiveOperation(async()=>{const {probeStructuralScale}=await import('./scale-probe.js');return probeStructuralScale(api);});
api.ready=exclusiveOperation(load);api.ready.catch(fail);
