/** Tiny M5 trajectories only. Larger CPU/GPU and gameplay gates are separate. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { guardNode } from './verification_guard.mjs';
import { createStateSpaceStructuralWorld3D, MAT, ENERGY_SCALE } from '../dist/sdk/state-space-structural-world.js';

await guardNode('cpu',120);
const arg=name=>process.argv[process.argv.indexOf(name)+1];
const scene=arg('--scene'),out=resolve(arg('--output'));
assert(['control','cut','heat','ice'].includes(scene),'Choose one bounded M5 fixture');
await mkdir(out,{recursive:true});
const create=chunkSize=>createStateSpaceStructuralWorld3D({width:8,height:8,depth:8,chunkSize});
const field=create(4),material=scene==='ice'?MAT.ICE:MAT.STONE;
// A cold finite chamber isolates structural support from ambient heating.
const cold=field.snapshot();cold.packedCells=cold.packedCells.map(v=>v&0xffff00ff);cold.energyQ.fill(0);field.restore(cold);
for(let x=1;x<=6;x++)field.setCell(x,3,3,material,0);
field.setAnchor(1,3,3,true);field.setAnchor(6,3,3,true);
const initial=field.snapshot();field.restore(initial);
const commands=Array.from({length:1024},(_,i)=>({tick:i+1,edits:i===8&&scene!=='control'?[1,6].map(x=>scene==='cut'
  ?{kind:'material',x,y:3,z:3,material:MAT.AIR,thermal:0}
  :{kind:'energy',x,y:3,z:3,energyQ:(scene==='ice'?100:1000)*ENERGY_SCALE}):[]}));
const checkpoints=new Map([[0,initial]]),hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const normalized=s=>({...s,chunkSize:4});
const report={passed:false,scope:'8^3 CPU foundation only; not M5 GPU or gameplay acceptance',scene,dimensions:[8,8,8],ticks:1024,checkpoints:{},restarts:[],partitionExact:false};
async function progress(label,tick){if(tick%64===0){console.log(`${scene}: ${label} ${tick}/1024`);await new Promise(r=>setTimeout(r,10));}}
try{
 for(const command of commands){
  field.step(1,{edits:command.edits});
  if([3,8,9,31,509,1024].includes(command.tick)||command.tick%64===0)checkpoints.set(command.tick,field.snapshot());
  if(command.tick<=8||scene==='control'){
   assert.deepEqual(field.structure,Uint32Array.from(initial.structure),'Intact structural control changed');
   assert.deepEqual(field.grid,Uint32Array.from(initial.packedCells),'Intact material control changed');
  }
  if(command.tick===9&&scene!=='control')assert.equal(field.sample(3,4,3).material,material,'Detached bridge failed to fall on the specified tick');
  if(command.tick%64===0)assert.equal(field.energyBalance().driftQ,0n);
  await progress('uninterrupted',command.tick);
 }
 const final=field.snapshot(),repeat=create(8);repeat.restore(initial);
 for(const command of commands){repeat.step(1,{edits:command.edits});await progress('repartitioned repeat',command.tick);}
 assert.deepEqual(normalized(repeat.snapshot()),final);assert.equal(repeat.energyBalance().driftQ,0n);report.partitionExact=true;
 for(const [start,end] of [[3,31],[31,509],[509,1024]]){
  repeat.restore(checkpoints.get(start));
  for(const command of commands.slice(start,end)){repeat.step(1,{edits:command.edits});await progress(`restart ${start}`,command.tick);}
  assert.deepEqual(normalized(repeat.snapshot()),checkpoints.get(end));assert.equal(repeat.energyBalance().driftQ,0n);report.restarts.push({start,end,exact:true});
 }
 for(const [tick,snapshot] of checkpoints){const name=`tick-${tick}.json.gz`;const bytes=gzipSync(JSON.stringify(snapshot));await writeFile(join(out,name),bytes);report.checkpoints[tick]={path:name,sha256:createHash('sha256').update(bytes).digest('hex'),stateHash:hash(snapshot)};}
 await writeFile(join(out,'commands.json'),JSON.stringify(commands));
 report.failureTick=scene==='control'?null:9;report.controlStableThrough=scene==='control'?1024:8;report.energyDriftQ='0';report.finalHash=hash(final);report.passed=true;
}finally{await writeFile(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({scene,passed:report.passed,finalHash:report.finalHash}));
