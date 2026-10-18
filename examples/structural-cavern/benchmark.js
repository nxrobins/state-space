import {createFramePump,waitForDisplayBoundary} from '../../web/frame-pump.js';
import {fixtureEdits,scriptedInput} from './scene.js';
const T=1000/60;
const distribution=values=>{const a=[...values].sort((a,b)=>a-b);return{count:a.length,min:a[0],p50:a[Math.floor(a.length*.5)],p95:a[Math.ceil(a.length*.95)-1],p99:a[Math.ceil(a.length*.99)-1],worst:a.at(-1)};};
const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),v=>v.toString(16).padStart(2,'0')).join('');
export async function benchmarkStructuralGameplay(api,{warmup=60,frames=600}={}){
 if(warmup!==60||frames!==600)throw Error('M5 benchmark requires 60 warmup and 600 measured frames.');
 await api.stop();document.body.classList.add('benchmark');
 const report={passed:false,complete:false,lightingMode:api.lightingMode??'reference',scope:'Full display-paced gameplay: scripted input/edit generation, exact structural/material physics, resident integer controller, mesh invalidation and uploads, all naturalistic effects, draw, HUD update, validation and GPU queue completion. Excludes initial setup and retained snapshot compression.',
  size:api.level.size,scenario:api.level.scenario,execution:api.field.mode,resolution:[1920,1080],viewport:[innerWidth,innerHeight],appearance:'naturalistic',heatDistortion:true,targetHz:60,warmup:[],samples:[],userAgent:navigator.userAgent,backendInfo:api.field.backendInfo,startedAt:new Date().toISOString()};
 let cancelled=false;api.cancelBenchmark=()=>{cancelled=true;};
 const visible=()=>{if(document.hidden)cancelled=true;};document.addEventListener('visibilitychange',visible);
 async function measure(count,rows){
  await waitForDisplayBoundary();
  return new Promise((resolve,reject)=>{
   const pump=createFramePump(async(timestamp,interval)=>{
    if(cancelled){pump.stop();resolve(pump.statistics());return;}
    const callbackAt=performance.now(),tick=api.field.tick+1,command=scriptedInput(api.level,tick),edits=fixtureEdits(api.level,tick);
    globalThis.__stateSpaceVerification?.check();
    const result=await api.advance(command,edits);
    document.getElementById('mode').textContent=`${rows===report.warmup?'WARMUP':'MEASURED'} ${rows.length+1}/${count}`;
    const completedAt=performance.now();
    const row={tick,timestamp,callbackAt,completedAt,callbackInterval:interval??null,callbackDelayMs:callbackAt-timestamp,workMs:completedAt-callbackAt,completionMs:completedAt-timestamp,
     command,editCount:edits.length,submissions:result.commit.submissions,completionBoundaries:result.commit.completionBoundaries,actorStatus:result.commit.status,player:result.commit.player,solve:result.solve,
     latency:result.commit.latency,jsHeapBytes:performance.memory?.usedJSHeapSize??null};
    rows.push(row);
    // Bounded background persistence does not insert an artificial wait between
    // measured frames. Overflow or an unflushed tail fails the entire receipt.
    if(globalThis.__stateSpaceVerification)void globalThis.__stateSpaceVerification.emit({kind:'frame',tick,
     workMs:row.workMs,completionMs:row.completionMs}).catch(()=>{cancelled=true;});
    if(row.workMs>150||row.completionMs>250){report.abortedFrame=row;throw Error(`M5 responsiveness limit exceeded (${row.workMs.toFixed(1)} ms work).`);}
    if(rows.length===count){pump.stop();resolve(pump.statistics());}
   },{onError:error=>{pump.stop();reject(error);}});
  });
 }
 try{
  if(api.field.tick!==0)throw Error('Benchmark requires the initial checkpoint.');
  if(innerWidth!==1920||innerHeight!==1080)throw Error('Benchmark viewport must be 1920 × 1080.');
  await api.renderer.setAppearance('naturalistic');await api.renderer.setHeatDistortion(true);
  report.initialHash=await hash(await api.snapshot());
  report.warmupPump=await measure(warmup,report.warmup);
  if(!cancelled)report.measuredPump=await measure(frames,report.samples);
  report.cancelled=cancelled;report.complete=!cancelled&&report.samples.length===frames;
  if(report.complete){
   await globalThis.__stateSpaceVerification?.flush();
   const final=await api.snapshot();report.finalHash=await hash(final);report.finalTick=api.field.tick;
   const data=new Blob([JSON.stringify(final)]).stream().pipeThrough(new CompressionStream('gzip'));
   const bytes=new Uint8Array(await new Response(data).arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));report.finalCheckpoint={encoding:'gzip-base64',data:btoa(binary)};
   report.energyBalance=Object.fromEntries(Object.entries(await api.field.energyBalance()).map(([k,v])=>[k,String(v)]));
   const a=report.samples;report.work=distribution(a.map(r=>r.workMs));report.completion=distribution(a.map(r=>r.completionMs));
   report.missedDeadlines=a.filter(r=>r.completionMs>T).length;report.callbackGapSlots=a.slice(1).reduce((sum,r)=>sum+Math.max(0,Math.round(r.callbackInterval/T)-1),0);
   report.lostDisplaySlots=a.slice(1).reduce((sum,r,i)=>sum+Math.max(0,Math.round((r.timestamp-a[i].timestamp)/T)-1),0);
   report.physicsHz=(a.length-1)*1000/(a.at(-1).completedAt-a[0].completedAt);report.callbackHz=(a.length-1)*1000/(a.at(-1).timestamp-a[0].timestamp);
   report.performancePassed=report.physicsHz>=59.9&&report.missedDeadlines===0&&report.lostDisplaySlots===0&&report.measuredPump.coalesced===0;
   report.passed=report.complete&&report.energyBalance.driftQ==='0'&&(api.level.size===128||report.performancePassed);
  }
 }catch(error){report.passed=false;report.complete=false;report.error=String(error.stack||error);}
 finally{document.removeEventListener('visibilitychange',visible);report.finishedAt=new Date().toISOString();api.cancelBenchmark=undefined;document.getElementById('mode').textContent=report.complete?`MEASURED · ${report.physicsHz.toFixed(2)} Hz · ${report.missedDeadlines} MISSES`:'MEASUREMENT STOPPED';}
 return report;
}
