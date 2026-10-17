/** One bounded authored chamber stage; never invokes a legacy trajectory. */
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {guardNode,verificationYield} from './verification_guard.mjs';
import {createStructuralLevel,fixtureEdits} from '../examples/structural-cavern/scene.js';
import {structuralStateBytes} from '../examples/structural-cavern/state-evidence.js';
await guardNode('cpu',120);
const arg=(name,fallback)=>process.argv.includes(name)?process.argv[process.argv.indexOf(name)+1]:fallback;
const size=Number(arg('--size',32)),scenario=arg('--scene','control'),ticks=Number(arg('--ticks',32)),actionTick=Number(arg('--action-tick',16)),out=resolve(arg('--output','dist/volume-m5/level')),resume=arg('--resume',null);
assert([32,64].includes(size));assert(Number.isInteger(ticks)&&ticks>=1&&ticks<=1024);assert(Number.isInteger(actionTick)&&actionTick>=1&&actionTick<=ticks);
await mkdir(out,{recursive:true});const level=createStructuralLevel(size,scenario),field=level.field,initial=field.snapshot(),checkpoints=new Map([[0,initial]]),samples=[];let firstFall=null,supportMelt=null;
const [x,y,z]=level.center,material=field.sample(x,y,z).material;
const deck=[];for(let dz=-2;dz<=2;dz++)for(let dx=-6;dx<=6;dx++)deck.push({x:x+dx,y,z:z+dz,interior:Math.abs(dx)<6});
const index=c=>c.x+size*(c.y+size*c.z);
const digest=state=>createHash('sha256').update(structuralStateBytes(state)).digest('hex');
const report={passed:false,scope:'Authored structural CPU chamber; no GPU or frame gate',size,scenario,ticks,actionTick,checkpoints:{},stateDigests:[digest(initial)],firstFall:null,supportMelt:null,energyDriftQ:null};
report.fullDeckStableTicks=0;report.coherentFirstFallCells=0;
report.implementationHashes=Object.fromEntries(await Promise.all(['dist/sdk/state-space-structural-world.js','examples/structural-cavern/scene.js','examples/structural-cavern/state-evidence.js','scripts/verify_volume_m5_level.mjs'].map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')])));
let startTick=0;report.segments=[];
if(resume){
 const previous=JSON.parse(await readFile(join(resume,'report.json'),'utf8'));
 assert(previous.passed&&previous.size===size&&previous.scenario===scenario&&previous.actionTick===actionTick,'Continuation reference differs');
 assert.deepEqual(previous.implementationHashes,report.implementationHashes,'CPU reference implementation changed');
 assert.equal(previous.stateDigests[0],report.stateDigests[0],'Initial scene changed');
 startTick=previous.ticks;assert(startTick<ticks&&previous.stateDigests.length===startTick+1);
 report.stateDigests=previous.stateDigests;report.segments=previous.segments;firstFall=previous.firstFall;supportMelt=previous.supportMelt;
 report.fullDeckStableTicks=previous.fullDeckStableTicks;report.coherentFirstFallCells=previous.coherentFirstFallCells;
 for(const [tick,item] of Object.entries(previous.checkpoints)){
  const bytes=await readFile(join(resume,item.path));assert.equal(createHash('sha256').update(bytes).digest('hex'),item.sha256);
  await writeFile(join(out,item.path),bytes);report.checkpoints[tick]=item;
  if(Number(tick)===startTick){const state=JSON.parse(gunzipSync(bytes));assert.equal(digest(state),previous.stateDigests[startTick]);field.restore(state);}
 }
 assert.equal(field.tick,startTick,'Missing continuation checkpoint');
}
assert(size===32||ticks-startTick<=256,'64^3 CPU runs require segments of at most 256 ticks');
try{
 await writeFile(join(out,'commands.json'),JSON.stringify(Array.from({length:ticks},(_,i)=>({tick:i+1,edits:fixtureEdits(level,i+1,actionTick)}))));
 for(let tick=startTick+1;tick<=ticks;tick++){
  const start=performance.now();field.step(1,{edits:fixtureEdits(level,tick,actionTick)});samples.push(performance.now()-start);
  const center=field.sample(x,y,z);
  if(center.material!==material&&firstFall===null)firstFall=tick;
  if(scenario==='ice-heat'&&supportMelt===null&&level.supports.every(c=>field.sample(c.x,c.y,c.z).material!==material))supportMelt=tick;
  const state=field.snapshot();report.stateDigests.push(digest(state));
  if(scenario.endsWith('control')||tick<actionTick){
   for(const cell of deck){const i=index(cell);assert.equal(state.packedCells[i]&255,material,'Intact deck cell moved or transformed');assert.equal(state.structure[i],initial.structure[i],'Intact deck bonds or integrity changed');}
   report.fullDeckStableTicks++;
  }
  if(firstFall===tick){
   for(const cell of deck.filter(c=>c.interior))assert.equal(state.packedCells[index({...cell,y:y+1})]&255,material,'Detached span did not fall coherently');
   report.coherentFirstFallCells=deck.filter(c=>c.interior).length;
  }
  if([3,actionTick-1,actionTick,actionTick+1,actionTick+3,31,509,ticks].includes(tick)||tick%64===0)checkpoints.set(tick,state);
  if(tick%16===0){console.log(`${size}^3 ${scenario}: ${tick}/${ticks}; fall ${firstFall}; melt ${supportMelt}`);await verificationYield();}
 }
 assert.equal(field.energyBalance().driftQ,0n);report.energyDriftQ='0';report.segments.push({start:startTick,end:ticks,energyDriftQ:'0'});
 if(scenario.endsWith('control'))assert.equal(firstFall,null,'Intact crossing failed');
 else if(scenario==='ice-heat'){
  assert(supportMelt!==null&&supportMelt>=actionTick&&supportMelt<=actionTick+2,'Ice supports did not melt in fixture window');
  assert(firstFall>=actionTick+1&&firstFall<=actionTick+3,'Frozen crossing failed outside fixture window');
 }else assert.equal(firstFall,actionTick,'Cut/heated crossing failed outside fixture window');
 for(const [tick,state] of checkpoints){const name=`tick-${tick}.json.gz`,bytes=gzipSync(JSON.stringify(state));await writeFile(join(out,name),bytes);report.checkpoints[tick]={path:name,sha256:createHash('sha256').update(bytes).digest('hex')};}
 report.firstFall=firstFall;report.supportMelt=supportMelt;report.finalHash=createHash('sha256').update(JSON.stringify(field.snapshot())).digest('hex');report.passed=true;
}finally{report.firstFall=firstFall;report.supportMelt=supportMelt;report.tickMs=samples;await writeFile(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({passed:report.passed,size,scenario,firstFall,supportMelt,meanTickMs:samples.reduce((a,b)=>a+b,0)/samples.length}));
