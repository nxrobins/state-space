import {createStateSpaceStructuralWorld3DGPU} from '../../dist/sdk/state-space-structural-world-gpu.js';
import {structuralStateDigest} from './state-evidence.js';
import {verificationEvent} from './verification-events.js';
import {createStructuralLevel,observeStructuralLevel,expectedWindows,REACTIVE_SCENARIOS} from './scene.js';
import {loadStructuralCatalog} from './verify.js';

/** A single supervised trajectory; reference digests include every cell/tick. */
export async function verifyStructuralTrajectory({mode='active',base,part='all',catalog}={}){
 const reference=await(await fetch(`${base}/report.json`)).json();
 if(!reference.passed||reference.ticks!==1024||![32,64].includes(reference.size)||reference.stateDigests?.length!==1025)throw Error('Missing complete authored Node trajectory');
 // A reactive reference names its catalog; the replay binds the same registry and checks the
 // authored windows on the replayed states, exactly as the Node oracle checked them.
 if((reference.catalog??undefined)!==catalog)throw Error('Replay catalog differs from the authored reference');
 if(REACTIVE_SCENARIOS.includes(reference.scenario)!==(catalog!==undefined))throw Error('Reactive chambers need a catalog; legacy chambers refuse one');
 const registry=catalog===undefined?undefined:await loadStructuralCatalog(catalog);
 if(registry&&reference.materialCatalogHash!==registry.hash)throw Error('Authored reference binds a different catalog');
 const commands=await(await fetch(`${base}/commands.json`)).json();
 if(commands.length!==1024||commands.some((c,i)=>c.tick!==i+1))throw Error('Invalid command tape');
 const checkpoint=async tick=>{
  const item=reference.checkpoints[tick];if(!item)throw Error(`Missing checkpoint ${tick}`);
  const response=await fetch(`${base}/${item.path}`);if(!response.ok)throw Error('Missing checkpoint bytes');
  const bytes=await response.arrayBuffer(),digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
  if(digest!==item.sha256)throw Error('Checkpoint bytes differ from receipt');
  const state=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
  if(await structuralStateDigest(state)!==reference.stateDigests[tick])throw Error('Checkpoint state digest mismatch');
  return state;
 };
 // Node uses eight-cell chunks. Dense and active also exercise different storage partitions.
 const size=reference.size,chunkSize=mode==='dense'?16:8;
 const gpu=await createStateSpaceStructuralWorld3DGPU({width:size,height:size,depth:size,chunkSize,mode,...(registry?{registry}:{})});
 if(!['all','main','restarts'].includes(part))throw Error('Invalid replay part');
 const level=registry?createStructuralLevel(size,reference.scenario,undefined,registry):null;
 if(level)delete level.field;
 const checks=[],runs=[],tickMs=[];let finalHash,windows;
 const status=text=>{document.getElementById('status').textContent=text;};
 const label=registry?'M6':'M5';
 try{
  if(registry&&(gpu.rulesVersion!=='ca-3d-m6'||gpu.materialCatalogHash!==registry.hash))throw Error('GPU world does not bind the ca-3d-m6 catalog');
  const ranges=part==='main'?[[0,1024]]:part==='restarts'?[[3,31],[reference.actionTick-1,reference.actionTick+3],[509,1024]]:[[0,1024],[3,31],[reference.actionTick-1,reference.actionTick+3],[509,1024]];
  for(const [start,end] of ranges){
   await verificationEvent({kind:'status',text:`Restoring ${start} for range ${start}..${end}`});
   await gpu.restore(await checkpoint(start));
   await verificationEvent({kind:'range-start',start,end});
   const observer=level&&start===0&&end===1024?observeStructuralLevel(level,reference.actionTick):null;
   for(let tick=start+1;tick<=end;tick++){
    await verificationEvent({kind:'phase',tick,phase:'step'});
    const begin=performance.now();await gpu.step(1,{edits:commands[tick-1].edits});tickMs.push(performance.now()-begin);
    await verificationEvent({kind:'phase',tick,phase:'snapshot'});
    const state=await gpu.snapshot();
    await verificationEvent({kind:'phase',tick,phase:'hash'});
    const actual=await structuralStateDigest(state);
    if(actual!==reference.stateDigests[tick])throw Error(`${size}^3 ${reference.scenario} ${mode} restart ${start}: complete state differs at ${tick}`);
    observer?.tick(tick,state);
    checks.push({start,tick,digest:actual});
    await verificationEvent({kind:'verified',start,tick,digest:actual,stepMs:tickMs.at(-1)});
    status(`${label} ${size}³ ${reference.scenario} ${mode}: ${start}->${tick}/${end}`);
    await new Promise(r=>setTimeout(r,20));
   }
   if(observer)windows=observer.check();
   if((await gpu.energyBalance()).driftQ!==0n)throw Error('Accounted energy drift');
   runs.push({start,end,exact:true});
   await verificationEvent({kind:'range-end',end});
  }
  finalHash=await structuralStateDigest(await gpu.snapshot());
  status(`${label} ${size}³ ${reference.scenario} ${mode}: ${part} ranges exact`);
  return{passed:true,scope:'Authored chamber: Node versus GPU complete state digest at every committed tick in the listed ranges',part,size,scenario:reference.scenario,mode,chunkSize,ticks:1024,runs,checks,tickMs,finalHash,energyDriftQ:'0',backendInfo:gpu.backendInfo,
   rulesVersion:gpu.rulesVersion,materialCatalogHash:gpu.materialCatalogHash,...(registry?{catalog,actionTick:reference.actionTick,expected:expectedWindows(level,reference.actionTick),windows:windows??null}:{})};
 }finally{gpu.close();}
}
