import {createStateSpaceStructuralWorld3DGPU} from '../../dist/sdk/state-space-structural-world-gpu.js';
import {createStructuralLevel,fixtureEdits,scriptedInput} from './scene.js';
const equal=(a,b,label)=>{for(const key of ['packedCells','energyQ','structure']){if(a[key].length!==b[key].length)throw Error(`${label}: ${key} length`);for(let i=0;i<a[key].length;i++)if(a[key][i]!==b[key][i])throw Error(`${label}: ${key}[${i}] ${a[key][i]} != ${b[key][i]}`);}if(a.tick!==b.tick)throw Error(`${label}: tick`);};
export async function verifyStructuralGameplay({size=32,scenario='cut',mode='active',appearance='naturalistic',frames=32}={}){
 if(![32,64].includes(size)||![16,32,64].includes(frames))throw Error('Pilot scope exceeded');
 const level=createStructuralLevel(size,scenario),cpu=level.field,initial=cpu.snapshot();
 const gpu=await createStateSpaceStructuralWorld3DGPU({width:size,height:size,depth:size,chunkSize:initial.chunkSize,mode});let renderer,driver;
 const status=text=>{document.getElementById('status').textContent=text;};
 try{
  const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;canvas.style.width='100%';document.body.append(canvas);
  await gpu.restore(initial);renderer=await gpu.createRenderer(canvas);await renderer.setAppearance(appearance);driver=await gpu.createGameplay(level.actor,level.rules);
  const camera={forward:[1,0,0],right:[0,0,-1],up:[0,-1,0]},presentation={renderer,camera},timings=[],commits=[];let restart;
  for(let tick=1;tick<=frames;tick++){
   const command=scriptedInput(level,tick),edits=fixtureEdits(level,tick,16);cpu.step(1,{edits});
   const start=performance.now(),commit=await driver.step(command,{edits,presentation});timings.push(performance.now()-start);commits.push(commit);
   if([3,15,16,17,frames].includes(tick)){const state=await gpu.snapshot();equal(state,cpu.snapshot(),`Gameplay ${scenario} ${tick}`);if(tick===3)restart={field:state,actor:driver.inspect()};}
   if(tick%4===0){status(`M5 ${size}³ ${scenario} gameplay: ${tick}/${frames}`);await new Promise(r=>setTimeout(r,10));}
  }
  const final=await gpu.snapshot(),actor=driver.inspect();if((await gpu.energyBalance()).driftQ!==0n)throw Error('Gameplay energy drift');
  await renderer.setAppearance(appearance==='naturalistic'?'diagnostic':'naturalistic');
  await driver.present({renderer,camera:{forward:[0,0,-1],right:[-1,0,0],up:[0,-1,0]}});equal(await gpu.snapshot(),final,'Camera/A-B presentation changed physics');
  await gpu.restore(restart.field);await driver.restore(restart.actor);
  for(let tick=4;tick<=frames;tick++)await driver.step(scriptedInput(level,tick),{edits:fixtureEdits(level,tick,16)});
  equal(await gpu.snapshot(),final,'Gameplay snapshot continuation');if(JSON.stringify(driver.inspect())!==JSON.stringify(actor))throw Error('Actor restart differs');
  await renderer.setAppearance(appearance);await driver.present(presentation);
  status(`M5 ${size}³ ${scenario} gameplay, restart and presentation isolation passed`);
  return{passed:true,scope:'Bounded gameplay pilot, not display-paced frame acceptance',size,scenario,mode,frames,resolution:[1920,1080],appearance,backendInfo:gpu.backendInfo,
   physicsExact:true,actorRestartExact:true,presentationIsolated:true,energyDriftQ:'0',diagnosticFrameMs:timings,submissions:commits.map(c=>c.submissions),finalActor:actor};
 }finally{driver?.close();renderer?.close();gpu.close();}
}
