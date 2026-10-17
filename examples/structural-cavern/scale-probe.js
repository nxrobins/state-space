import {fixtureEdits,scriptedInput} from './scene.js';
/** Eight frames only, required before a separately supervised 128³ benchmark. */
export async function probeStructuralScale(api){
 await api.stop();if(api.field.tick!==0||api.level.size!==128)throw Error('Scale probe requires an initial 128³ chamber');
 const frames=[];await api.renderer.setAppearance('naturalistic');await api.renderer.setHeatDistortion(true);
 for(let tick=1;tick<=8;tick++){
  const start=performance.now(),commit=await api.advance(scriptedInput(api.level,tick),fixtureEdits(api.level,tick,4));
  const ms=performance.now()-start;frames.push({tick,ms,solve:commit.solve,latency:commit.commit.latency});
  if(ms>(tick===1?500:150))throw Error(`128³ pilot responsiveness bound exceeded at ${tick}: ${ms.toFixed(1)} ms`);
  document.getElementById('mode').textContent=`128³ SCALE PROBE ${tick}/8`;
  await new Promise(r=>setTimeout(r,30));
 }
 const balance=await api.field.energyBalance();if(balance.driftQ!==0n)throw Error('Scale probe energy drift');
 return{passed:true,scope:'128³ eight-frame responsiveness and energy probe, not a replay or full-frame acceptance gate',size:128,scenario:api.level.scenario,frames,
  resolution:[1920,1080],appearance:'naturalistic',heatDistortion:true,energyDriftQ:'0',backendInfo:api.field.backendInfo};
}
