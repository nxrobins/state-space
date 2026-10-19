import {createStateSpaceStructuralWorld3DGPU} from '../../dist/sdk/state-space-structural-world-gpu.js';
import {MAT} from '../../dist/sdk/state-space-structural-world.js';
import {createStructuralLevel,fixtureEdits,scriptedInput} from '../structural-cavern/scene.js';
import {structuralStateDigest} from '../structural-cavern/state-evidence.js';
import {createFramePump,waitForDisplayBoundary} from '../../web/frame-pump.js';
const status=document.getElementById('status'),output=document.getElementById('report');
const check=(ok,text)=>{if(!ok)throw Error(text);};
const distribution=values=>{const a=[...values].sort((a,b)=>a-b);return{count:a.length,min:a[0],p50:a[Math.floor(a.length*.5)],p95:a[Math.ceil(a.length*.95)-1],p99:a[Math.ceil(a.length*.99)-1],worst:a.at(-1)};};
const pause=()=>new Promise(resolve=>setTimeout(resolve,0));
let report;
function progress(text){status.textContent=text;report.progress=text;output.textContent=JSON.stringify(report,null,2);}
function save(){output.textContent=JSON.stringify(report,null,2);}
async function replay(size,scenario,ticks){
 const level=createStructuralLevel(size,scenario),cpu=level.field,initial=cpu.snapshot(),digests=[await structuralStateDigest(initial)],checkpoints=new Map([[0,initial]]),actionTick=16;
 report={...report,size,scenario,ticks,actionTick,checks:[],runs:[]};save();
 const deck=Array.from({length:11},(_,x)=>Array.from({length:5},(_,z)=>[size/2-5+x,level.deckY,size/2-2+z])).flat();
 const at=([x,y,z])=>x+size*(y+size*z);
 for(let tick=1;tick<=ticks;tick++){
  cpu.step(1,{edits:fixtureEdits(level,tick,actionTick)});
  const state=cpu.snapshot();digests.push(await structuralStateDigest(state));
  if([3,actionTick-1].includes(tick))checkpoints.set(tick,state);
  if(tick===actionTick-1)check(deck.every(c=>(state.packedCells[at(c)]&255)===(scenario.startsWith('ice')?MAT.ICE:MAT.STONE)),'Positive control: bridge changed before action');
  if(tick===actionTick+4&&!scenario.endsWith('control')){report.supportFailure=deck.some(c=>(state.packedCells[at(c)]&255)!==(scenario.startsWith('ice')?MAT.ICE:MAT.STONE));check(report.supportFailure,'Support action did not detach or melt the span');}
  if(tick%8===0){progress('CPU '+size+'³ '+scenario+' '+tick+'/'+ticks);await pause();}
 }
 if(scenario.endsWith('control')){check(deck.every(c=>(cpu.snapshot().packedCells[at(c)]&255)===(scenario.startsWith('ice')?MAT.ICE:MAT.STONE)),'Intact control bridge failed');report.intactControl=true;}
 check(cpu.energyBalance().driftQ===0n,'CPU conservation failure');
 report.referenceFinalHash=digests.at(-1);report.referenceDigests=digests;save();
 for(const mode of ['dense','active']){
  const gpu=await createStateSpaceStructuralWorld3DGPU({width:size,height:size,depth:size,chunkSize:mode==='dense'?16:8,mode});
  try{
   check(gpu.backendInfo.isFallbackAdapter===false,'Hardware GPU required');report.backendInfo=gpu.backendInfo;
   for(const [start,end] of (ticks<16?[[0,ticks]]:[[0,ticks],[3,11],[actionTick-1,actionTick+5]])){
    await gpu.restore(checkpoints.get(start));
    for(let tick=start+1;tick<=end;tick++){
     await gpu.step(1,{edits:fixtureEdits(level,tick,actionTick)});
     const digest=await structuralStateDigest(await gpu.snapshot());
     check(digest===digests[tick],mode+' complete state differs at '+tick+' from restart '+start);
     report.checks.push({mode,start,tick,digest});
     if(tick%4===0||tick===end){progress(mode+' '+size+'³ '+scenario+' '+tick+'/'+end);await pause();}
    }
    check((await gpu.energyBalance()).driftQ===0n,'GPU conservation failure');
    report.runs.push({mode,start,end,exact:true});
   }
   const before=await gpu.snapshot();let rejected=false;
   try{await gpu.restore({...before,rulesVersion:'invalid'});}catch{rejected=true;}
   check(rejected&&JSON.stringify(before)===JSON.stringify(await gpu.snapshot()),'Invalid restore was not atomic');
  }finally{gpu.close();}
 }
 report.energyDriftQ='0';report.invalidRestoreAtomic=true;
}
async function structuralExact(){
 const probe=await import('../../dist/volume-m5/structural-probe.js');report.probes=[];
 for(const mode of ['dense','active']){
  progress('Tiny exact probes: '+mode);report.probes.push(await probe.verifyM5GpuTiny(mode));
  progress('Distant support probes: '+mode);report.probes.push(await probe.verifyM5DistantSupport(mode));
 }
 progress('Forced exact fallback');report.probes.push(await probe.verifyM5DistantSupport('active',1));
 progress('Reversed processing order');report.probes.push(await probe.verifyM5ProcessingOrder());
 check(report.probes.every(r=>r.passed&&r.backendInfo.isFallbackAdapter===false),'Exact probes require hardware GPU');
 progress('Profiled presentation, step and edit timestamps');
 const level=createStructuralLevel(32,'control');
 const gpu=await createStateSpaceStructuralWorld3DGPU({width:32,height:32,depth:32,chunkSize:4,mode:'active',profiling:true,gpuTiming:true});
 let renderer,driver;
 try{
  await gpu.restore(level.field.snapshot());renderer=await gpu.createRenderer(document.getElementById('world'));
  driver=await gpu.createGameplay(level.actor,level.rules);
  const presentation={renderer,camera:{forward:[1,0,0],right:[0,0,-1],up:[0,-1,0]}};
  await driver.present(presentation);await gpu.settleLatency();
  let records=gpu.inspectLatency().records;
  check(records.length>0&&records.every(r=>r.tick===0),'Zero-tick presentation trace differs');
  let cursor=records.at(-1).id;
  await driver.step(scriptedInput(level,1),{presentation});await gpu.settleLatency();
  records=gpu.inspectLatency(cursor).records;
  check(records.length>0&&records.every(r=>r.tick===1),'Step trace differs');cursor=records.at(-1).id;
  driver.close();driver=undefined;
  await gpu.edit([{kind:'energy',x:1,y:1,z:1,energyQ:0}]);await gpu.settleLatency();
  records=gpu.inspectLatency(cursor).records;
  check(records.length>0&&records.every(r=>r.tick===1),'Edit-only trace differs');
  check(gpu.inspectLatency().records.every(r=>['complete','unsupported'].includes(r.gpu.status)),'Incomplete GPU profile');
  report.profileTicksExact=true;report.gpuTimestamps=gpu.inspectLatency().gpuTimestamps;
 }finally{driver?.close();renderer?.close();gpu.close();}

}
async function frames(lightingMode){
 output.style.display='none';
 const size=32,level=createStructuralLevel(size,'cut'),initial=level.field.snapshot();delete level.field;
 const gpu=await createStateSpaceStructuralWorld3DGPU({width:size,height:size,depth:size,chunkSize:8,mode:'active'});
 let renderer,driver;
 report={...report,size,scenario:'cut',lightingMode,warmup:[],samples:[],targetHz:60,resolution:[1920,1080],scope:'Display callbacks through completed simulation, resident actor, rendering, transfers and GPU completion; browser mode recorded by the outer receipt; excludes OS scanout'};
 try{
  check(gpu.backendInfo.isFallbackAdapter===false,'Hardware GPU required');report.backendInfo=gpu.backendInfo;
  await gpu.restore(initial);renderer=await gpu.createRenderer(document.getElementById('world'));
  await renderer.setAppearance('naturalistic');await renderer.setHeatDistortion(true);await renderer.setLightingMode(lightingMode);
  driver=await gpu.createGameplay(level.actor,level.rules);
  const presentation={renderer,camera:{forward:[1,0,0],right:[0,0,-1],up:[0,-1,0]}};
  await driver.present(presentation);await waitForDisplayBoundary();
  report.initialHash=await structuralStateDigest(await gpu.snapshot());
  await new Promise((resolve,reject)=>{
   const pump=createFramePump(async(timestamp,interval)=>{
    const callbackAt=performance.now(),tick=gpu.tick+1,command=scriptedInput(level,tick),edits=fixtureEdits(level,tick);
    const commit=await driver.step(command,{edits,presentation});
    // Include application HUD/update work in the callback-to-completion sample.
    status.textContent='Frame '+tick+'/660 · '+commit.status;
    const completedAt=performance.now(),row={tick,timestamp,callbackAt,completedAt,interval:interval??null,workMs:completedAt-callbackAt,completionMs:completedAt-timestamp,submissions:commit.submissions,completionBoundaries:commit.completionBoundaries};
    (tick<=60?report.warmup:report.samples).push(row);
    if(row.workMs>1000){pump.stop();reject(Error('Single frame exceeded one-second responsiveness budget'));return;}
    if(tick%30===0){report.progress='Frames '+tick+'/660';save();}
    if(tick===660){pump.stop();report.pump=pump.statistics();resolve();}
   },{onError:reject});
  });
  report.work=distribution(report.samples.map(s=>s.workMs));report.completion=distribution(report.samples.map(s=>s.completionMs));
  report.missedDeadlines=report.samples.filter(s=>s.completionMs>1000/60).length;
  report.lostDisplaySlots=report.samples.slice(1).reduce((n,s,i)=>n+Math.max(0,Math.round((s.timestamp-report.samples[i].timestamp)/(1000/60))-1),0);
  report.physicsHz=599000/(report.samples.at(-1).completedAt-report.samples[0].completedAt);
  report.performancePassed=report.missedDeadlines===0&&report.lostDisplaySlots===0&&report.pump.coalesced===0&&report.physicsHz>=59.9;
  report.energyDriftQ=String((await gpu.energyBalance()).driftQ);check(report.energyDriftQ==='0','Frame conservation failure');
  report.finalHash=await structuralStateDigest(await gpu.snapshot());report.finalActor=driver.inspect();report.measuredFrames=report.samples.length;
 }finally{driver?.close();renderer?.close();gpu.close();}
}
async function lighting(){
 const probe=await import('../../dist/volume-m5/structural-probe.js');
 progress('Exact light source worklist');report.lightList=await probe.verifyLightList();
 progress('Reference versus compact lighting pixels');report.lightImages=await probe.verifyLightImages();
 const level=createStructuralLevel(32,'control'),initial=level.field.snapshot();
 const gpu=await createStateSpaceStructuralWorld3DGPU({width:32,height:32,depth:32,chunkSize:8,mode:'active'});let renderer,driver;
 try{
  check(gpu.backendInfo.isFallbackAdapter===false,'Hardware GPU required');await gpu.restore(initial);
  renderer=await gpu.createRenderer(document.getElementById('world'));await renderer.setAppearance('naturalistic');
  driver=await gpu.createGameplay(level.actor,level.rules);
  const presentation={renderer,camera:{forward:[1,0,0],right:[0,0,-1],up:[0,-1,0]}};
  await driver.present(presentation);const before=await gpu.snapshot();
  await renderer.setLightingMode('cached');await driver.present(presentation);
  check(JSON.stringify(await gpu.snapshot())===JSON.stringify(before),'Cached presentation mutated physics');
  await renderer.setLightingMode('reference');await driver.present(presentation);
  check(JSON.stringify(await gpu.snapshot())===JSON.stringify(before),'Reference A/B mutated physics');
  report.backendInfo=gpu.backendInfo;report.cacheCompiled=true;report.zeroTickIsolation=true;
 }finally{driver?.close();renderer?.close();gpu.close();}
}
window.macQualification={ready:true,run(stage){
 report={stage,passed:false,done:false,releaseAccepted:false,startedAt:new Date().toISOString()};
 void(async()=>{try{
  if(stage==='pilot')await replay(32,'cut',4);
  else if(stage==='structural-exact')await structuralExact();
  else if(stage==='replay-64-cut-long')await replay(64,'cut',1024);
  else if(/^replay-(32|64)-(control|cut|heat|ice-control|ice-heat)$/.test(stage)){const [,size,...parts]=stage.split('-');await replay(Number(size),parts.join('-'),Number(size)===32?1024:256);}
  else if(stage==='lighting')await lighting();
  else if(stage==='frames-reference'||stage==='frames-cached'||stage==='frames-visible')await frames(stage==='frames-visible'?'reference':stage.slice(7));
  else throw Error('Unknown fixed stage');
  report.passed=true;
 }catch(error){report.error=String(error.stack||error);}finally{report.done=true;report.finishedAt=new Date().toISOString();progress(report.passed?'Stage complete: '+stage:'Stage failed: '+report.error);}})();
 return true;
}};
