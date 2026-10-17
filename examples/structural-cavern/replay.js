import {createStateSpaceStructuralWorld3DGPU} from '../../dist/sdk/state-space-structural-world-gpu.js';
import {structuralStateDigest} from './state-evidence.js';

/** A single supervised trajectory; reference digests include every cell/tick. */
export async function verifyStructuralTrajectory({mode='active',base,part='all'}={}){
 const reference=await(await fetch(`${base}/report.json`)).json();
 if(!reference.passed||reference.ticks!==1024||![32,64].includes(reference.size)||reference.stateDigests?.length!==1025)throw Error('Missing complete authored Node trajectory');
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
 const gpu=await createStateSpaceStructuralWorld3DGPU({width:size,height:size,depth:size,chunkSize,mode});
 if(!['all','main','restarts'].includes(part))throw Error('Invalid replay part');
 const checks=[],runs=[],tickMs=[];let finalHash;
 const status=text=>{document.getElementById('status').textContent=text;};
 try{
  const ranges=part==='main'?[[0,1024]]:part==='restarts'?[[3,31],[reference.actionTick-1,reference.actionTick+3],[509,1024]]:[[0,1024],[3,31],[reference.actionTick-1,reference.actionTick+3],[509,1024]];
  for(const [start,end] of ranges){
   await gpu.restore(await checkpoint(start));
   for(let tick=start+1;tick<=end;tick++){
    const begin=performance.now();await gpu.step(1,{edits:commands[tick-1].edits});tickMs.push(performance.now()-begin);
    const state=await gpu.snapshot(),actual=await structuralStateDigest(state);
    if(actual!==reference.stateDigests[tick])throw Error(`${size}^3 ${reference.scenario} ${mode} restart ${start}: complete state differs at ${tick}`);
    checks.push({start,tick,digest:actual});
    if(tick%16===0){status(`M5 ${size}³ ${reference.scenario} ${mode}: ${start}->${tick}/${end}`);await new Promise(r=>setTimeout(r,5));}
   }
   if((await gpu.energyBalance()).driftQ!==0n)throw Error('Accounted energy drift');
   runs.push({start,end,exact:true});
  }
  finalHash=await structuralStateDigest(await gpu.snapshot());
  status(`M5 ${size}³ ${reference.scenario} ${mode}: ${part} ranges exact`);
  return{passed:true,scope:'Authored chamber: Node versus GPU complete state digest at every committed tick in the listed ranges',part,size,scenario:reference.scenario,mode,chunkSize,ticks:1024,runs,checks,tickMs,finalHash,energyDriftQ:'0',backendInfo:gpu.backendInfo};
 }finally{gpu.close();}
}
