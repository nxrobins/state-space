import {createStateSpaceStructuralWorld3DGPU} from '../../dist/sdk/state-space-structural-world-gpu.js';
import {createStructuralLevel,fixtureEdits,scriptedInput,observeStructuralLevel,expectedWindows,REACTIVE_SCENARIOS} from './scene.js';
const equal=(a,b,label)=>{for(const key of ['packedCells','energyQ','structure']){if(a[key].length!==b[key].length)throw Error(`${label}: ${key} length`);for(let i=0;i<a[key].length;i++)if(a[key][i]!==b[key][i])throw Error(`${label}: ${key}[${i}] ${a[key][i]} != ${b[key][i]}`);}if(a.tick!==b.tick)throw Error(`${label}: tick`);};
/** Reactive chambers bind the thermal pack; the catalog name is part of the receipt. */
export async function loadStructuralCatalog(name){
 if(name!=='thermal')throw Error('Unknown structural catalog');
 const {createThermalMaterialRegistry3D}=await import('../../dist/sdk/state-space-reactive-materials.js');
 return createThermalMaterialRegistry3D();
}
export async function verifyStructuralGameplay({size=32,scenario='cut',mode='active',appearance='naturalistic',frames=32,catalog}={}){
 if(![32,64].includes(size)||![16,32,64].includes(frames))throw Error('Pilot scope exceeded');
 const reactive=REACTIVE_SCENARIOS.includes(scenario);
 if(reactive!==(catalog!==undefined))throw Error('Reactive chambers need a catalog; legacy chambers refuse one');
 const registry=catalog===undefined?undefined:await loadStructuralCatalog(catalog),actionTick=16;
 const level=createStructuralLevel(size,scenario,undefined,registry),cpu=level.field,initial=cpu.snapshot();
 const gpu=await createStateSpaceStructuralWorld3DGPU({width:size,height:size,depth:size,chunkSize:initial.chunkSize,mode,...(registry?{registry}:{})});let renderer,driver;
 const status=text=>{document.getElementById('status').textContent=text;};
 try{
  if(registry&&(gpu.rulesVersion!=='ca-3d-m6'||gpu.materialCatalogHash!==registry.hash))throw Error('GPU world does not bind the ca-3d-m6 catalog');
  const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;canvas.style.width='100%';document.body.append(canvas);
  await gpu.restore(initial);renderer=await gpu.createRenderer(canvas);await renderer.setAppearance(appearance);driver=await gpu.createGameplay(level.actor,level.rules);
  const camera={forward:[1,0,0],right:[0,0,-1],up:[0,-1,0]},presentation={renderer,camera},timings=[],commits=[];let restart;
  // The CPU oracle is the window reference; the GPU must equal it at the checked ticks.
  const observer=registry?observeStructuralLevel(level,actionTick):null;
  for(let tick=1;tick<=frames;tick++){
   const command=scriptedInput(level,tick),edits=fixtureEdits(level,tick,actionTick);cpu.step(1,{edits});observer?.tick(tick,{grid:cpu.grid});
   const start=performance.now(),commit=await driver.step(command,{edits,presentation});timings.push(performance.now()-start);commits.push(commit);
   if([3,15,16,17,frames].includes(tick)){const state=await gpu.snapshot();equal(state,cpu.snapshot(),`Gameplay ${scenario} ${tick}`);if(tick===3)restart={field:state,actor:driver.inspect()};}
   if(tick%4===0){status(`${registry?'M6':'M5'} ${size}³ ${scenario} gameplay: ${tick}/${frames}`);await new Promise(r=>setTimeout(r,10));}
  }
  const windows=observer?.check();
  const final=await gpu.snapshot(),actor=driver.inspect();if((await gpu.energyBalance()).driftQ!==0n)throw Error('Gameplay energy drift');
  await renderer.setAppearance(appearance==='naturalistic'?'diagnostic':'naturalistic');
  await driver.present({renderer,camera:{forward:[0,0,-1],right:[-1,0,0],up:[0,-1,0]}});equal(await gpu.snapshot(),final,'Camera/A-B presentation changed physics');
  await gpu.restore(restart.field);await driver.restore(restart.actor);
  for(let tick=4;tick<=frames;tick++)await driver.step(scriptedInput(level,tick),{edits:fixtureEdits(level,tick,actionTick)});
  equal(await gpu.snapshot(),final,'Gameplay snapshot continuation');if(JSON.stringify(driver.inspect())!==JSON.stringify(actor))throw Error('Actor restart differs');
  await renderer.setAppearance(appearance);await driver.present(presentation);
  status(`${registry?'M6':'M5'} ${size}³ ${scenario} gameplay, restart and presentation isolation passed`);
  return{passed:true,scope:'Bounded gameplay pilot, not display-paced frame acceptance',size,scenario,mode,frames,resolution:[1920,1080],appearance,backendInfo:gpu.backendInfo,
   rulesVersion:gpu.rulesVersion,materialCatalogHash:gpu.materialCatalogHash,...(registry?{catalog,actionTick,expected:expectedWindows(level,actionTick),windows}:{}),
   physicsExact:true,actorRestartExact:true,presentationIsolated:true,energyDriftQ:'0',diagnosticFrameMs:timings,submissions:commits.map(c=>c.submissions),finalActor:actor};
 }finally{driver?.close();renderer?.close();gpu.close();}
}
