import {createGpuWorld3D} from '../../dist/sdk/state-space-world-gpu.js';
import {createStateSpaceWorld3D,validateWorldSnapshot,MATERIALS_3D,MAX_ENERGY_Q,MAT} from '../../dist/sdk/state-space-world.js';
import {runVolumePass} from '../../dist/sdk/state-space-3d.js';
import {CavernGame} from './game.js';
const equal=(a,b,label)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error(label);};
const check=(v,label)=>{if(!v)throw new Error(label);};
const progress=s=>document.getElementById('status').textContent=s;
const yieldCheck=()=>new Promise(resolve=>setTimeout(resolve,5));
async function safeStep(field,options={}){const start=performance.now();await field.step(1,options);if(performance.now()-start>100)throw new Error('Conformance tick exceeded responsiveness budget.');await yieldCheck();}
async function rejected(fn){let error;try{await fn();}catch(e){error=e;}check(error,'Expected rejection.');}
/** Small standalone regression: no live game, rendering, or long GPU batches. */
export async function verifyWorldEditBatches(){
  const geometry={width:8,height:8,depth:8,chunkSize:4},cpu=createStateSpaceWorld3D(geometry),gpu=await createGpuWorld3D(geometry);
  try{
    cpu.setCell(3,1,3,MAT.WATER);cpu.setCell(4,2,4,MAT.SAND);cpu.setEnergy(2,1,2,123456);cpu.step(3);
    await gpu.restore(cpu.snapshot());cpu.restore(cpu.snapshot());
    // Keep a nonzero external ledger, so validation must preserve accounting too.
    cpu.setEnergy(2,1,2,654321);await gpu.setEnergy(2,1,2,654321);
    const before=cpu.snapshot(),balance=cpu.energyBalance();
    const sameBalance=async field=>{
      const current=await field.energyBalance();
      for(const key of ['initialQ','externalQ','currentQ','driftQ'])check(current[key]===balance[key],`Edit validation changed ${key}.`);
    };
    let rejections=0;
    for(const ticks of [0,1])for(const edits of [null,false,0,'',{},new Array(1)]){
      for(const field of [cpu,gpu]){
        await rejected(()=>field.step(ticks,{edits}));equal(await field.snapshot(),before,'Invalid edit batch changed state or tick.');await sameBalance(field);rejections++;
      }
      await yieldCheck();
    }
    for(const options of [{},{edits:undefined},{edits:[]}]){
      cpu.step(1,options);await safeStep(gpu,options);
      equal(await gpu.snapshot(),cpu.snapshot(),'Valid edit defaults differ across CPU/GPU.');
      const actual=await gpu.energyBalance(),expected=cpu.energyBalance();
      for(const key of ['initialQ','externalQ','currentQ','driftQ'])check(actual[key]===expected[key],`Valid edit default ${key} differs.`);
    }
    return{passed:true,dimensions:[8,8,8],backendInfo:gpu.backendInfo,rejections,invalidTicks:[0,1],stateTickAndLedgerUnchanged:true,validDefaults:['omitted','undefined','empty'],validDefaultsExact:true};
  }finally{gpu.close();}
}
const bytesHash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
export async function readFixture(reference){
  const raw=await fetch('/'+reference.path).then(r=>{if(!r.ok)throw new Error('Missing reference.');return r.arrayBuffer();});check(await bytesHash(raw)===reference.compressedSha256,'Compressed fixture hash mismatch.');
  const bytes=await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();check(await bytesHash(bytes)===reference.sha256,'Reference hash mismatch.');return JSON.parse(new TextDecoder().decode(bytes));
}
export function expectedMesh(flat,edge){
  const w=flat.width,h=flat.height,d=flat.depth,groups=Array.from({length:w*h*d/edge**3},()=>[]),offsets=[[-1,0,0],[1,0,0],[0,-1,0],[0,1,0],[0,0,-1],[0,0,1]];
  for(let z=0;z<d;z++)for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const m=flat.packedCells[x+w*(y+h*z)]&255;if(!m)continue;
    const k=Math.floor(x/edge)+w/edge*(Math.floor(y/edge)+h/edge*Math.floor(z/edge)),i=k*edge**3+x%edge+edge*(y%edge+edge*(z%edge));
    for(let f=0;f<6;f++){const [a,b,c]=offsets[f].map((v,j)=>v+[x,y,z][j]),n=a<0||b<0||c<0||a>=w||b>=h||c>=d?0:flat.packedCells[a+w*(b+h*c)]&255;if(m===9||n===0||n===9)groups[k].push(i*6+f);}
  }
  return groups.map(a=>a.sort((a,b)=>a-b));
}
export async function verifyCavern(expected){
  check(expected.passed&&expected.sourceUnchanged,'Fresh Node reference required.');await window.cavern.suspend();const checks=[];
  checks.push({editBatchConsistency:await verifyWorldEditBatches()});
  for(const edge of [2,4]){
    const cpu=createStateSpaceWorld3D({width:8,height:8,depth:8,chunkSize:edge}),gpu=await createGpuWorld3D({width:8,height:8,depth:8,chunkSize:edge});
    try{
      for(let z=0;z<8;z++)for(let y=0;y<8;y++)for(let x=0;x<8;x++){
        const i=x+8*(y+8*z);cpu.setCell(x,y,z,MATERIALS_3D[(i*7+Math.floor(i/3))%9].id,i*43%256);if(i%3===0)cpu.setEnergy(x,y,z,i%2?MAX_ENERGY_Q:0);
      }
      for(const tick of [0,1,3,4294967297,Number.MAX_SAFE_INTEGER-1024]){
        const s={...cpu.snapshot(),tick};await gpu.restore(s);const flat=validateWorldSnapshot(s);
        for(let pass=0;pass<27;pass++){
          const ref=runVolumePass({grid:new Uint32Array(flat.packedCells),energyQ:new Uint32Array(flat.energyQ)},8,8,8,tick,pass),actual=validateWorldSnapshot(await gpu.inspectPass(pass));
          equal(actual.packedCells,[...ref.grid],`Chunk ${edge} pass ${pass} cells`);equal(actual.energyQ,[...ref.energyQ],`Chunk ${edge} pass ${pass} energy`);
        }
        equal(await gpu.snapshot(),s,'Pass inspection mutated world.');
      }
      // Full execution also crosses pair dependencies, rather than inspecting isolated passes only.
      cpu.restore({...cpu.snapshot(),tick:3});await gpu.restore(cpu.snapshot());for(let n=0;n<32;n++)cpu.step();await gpu.step(32);equal(await gpu.snapshot(),cpu.snapshot(),'Composed global schedule differs.');
      checks.push({edge,passComparisons:135,composedTicks:32,exact:true});progress(`Chunk ${edge}: all global passes and composed schedule exact`);
    }finally{gpu.close();}
  }
  const meshWorld=await createGpuWorld3D({width:8,height:8,depth:8,chunkSize:4,fillMaterial:MAT.STONE});
  try{
    const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const renderer=await meshWorld.createRenderer(canvas),camera={eye:[2,2,2],forward:[1,0,0],right:[0,0,-1],up:[0,-1,0]};
    async function mesh(){await renderer.render(camera);const actual=await renderer.inspectMesh();equal(actual.faces,expectedMesh(validateWorldSnapshot(await meshWorld.snapshot()),4),'Cached face lists differ from complete oracle.');return actual;}
    equal((await mesh()).rebuilt,Array(8).fill(1),'Initial meshes missing.');equal((await mesh()).rebuilt,Array(8).fill(0),'Stable geometry rebuilt.');
    await meshWorld.setCell(1,1,1,MAT.AIR);equal((await mesh()).rebuilt,[1,0,0,0,0,0,0,0],'Interior edit invalidation.');
    await meshWorld.setCell(3,3,3,MAT.AIR);equal((await mesh()).rebuilt,[1,1,1,0,1,0,0,0],'Corner edit must invalidate face neighbors.');
    await meshWorld.setEnergy(2,2,2,123456);equal((await mesh()).rebuilt,Array(8).fill(0),'Thermal view rebuilt geometry.');
    await meshWorld.setCell(3,3,3,MAT.WATER);await meshWorld.step(3);await mesh();
    const before=await meshWorld.snapshot();await renderer.render({...camera,eye:[50,50,50],forward:[-1,0,0]});equal(await meshWorld.snapshot(),before,'Camera changed physics.');
    await rejected(()=>renderer.render({...camera,eye:[2,,2]}));await rejected(()=>meshWorld.createRenderer(canvas));
    checks.push({cachedMeshesExact:true,interiorAndCornerInvalidation:true,thermalGeometryReuse:true,cameraIsolated:true});
  }finally{meshWorld.close();}
  const gpu=await createGpuWorld3D();
  try{
    const initial=await readFixture(expected.fixtures['world-initial']);await gpu.restore(initial);
    const advance=async tick=>{while(gpu.tick<tick){await safeStep(gpu);if(gpu.tick%32===0)progress(`World replay ${gpu.tick}/${tick}`);}};
    for(const tick of [3,31,32,509,1024]){await advance(tick);equal(await gpu.snapshot(),await readFixture(expected.fixtures[`world-${tick}`]),`64³ world tick ${tick}`);progress(`64³ complete state exact at ${tick}`);}
    for(const tick of [3,31,32,509]){await gpu.restore(await readFixture(expected.fixtures[`world-${tick}`]));await advance(1024);equal(await gpu.snapshot(),await readFixture(expected.fixtures['world-1024']),`64³ restart ${tick}`);check((await gpu.energyBalance()).driftQ===0n,'World drift.');progress(`64³ restart ${tick}: exact`);}
    const game=new CavernGame(gpu),gameInitial=await readFixture(expected.fixtures['game-initial']),commands=await readFixture(expected.fixtures.commands),final=await readFixture(expected.fixtures['game-final']);await game.restore(gameInitial);
    for(const c of commands){await game.step(c);await yieldCheck();if(c.tick%32===0)progress(`Gameplay replay ${c.tick}/600`);}equal(await game.snapshot(),final,'GPU player/terrain/events differ.');equal(game.commands,commands,'Tape changed.');check((await gpu.energyBalance()).driftQ===0n,'Game energy drift.');
    for(const tick of [3,31,32,157,509]){await game.restore(await readFixture(expected.fixtures[`game-${tick}`]));for(const c of commands.slice(tick)){await game.step(c);await yieldCheck();if(c.tick%32===0)progress(`Gameplay restart ${tick}: ${c.tick}/600`);}equal(await game.snapshot(),final,`Gameplay restart ${tick}`);check((await gpu.energyBalance()).driftQ===0n,'Restart drift.');progress(`Gameplay restart ${tick}: exact`);}
    const before=await gpu.snapshot();for(const fn of [()=>gpu.step(33),()=>gpu.step(1,{edits:new Array(1)}),()=>gpu.step(1,{edits:[{x:31,y:31,z:31,material:1},{x:64,y:0,z:0,energyQ:0}]}),()=>gpu.queryRegion({origin:[31,31,31],size:[16,,16]}),()=>gpu.restore({...before,width:undefined}),()=>gpu.restore({...before,chunks:new Array(8)})]){await rejected(fn);equal(await gpu.snapshot(),before,'Rejected world input mutated state.');}
    const running=gpu.step();await rejected(()=>gpu.step());await running;
    await gpu.restore(before);const cpu=createStateSpaceWorld3D();cpu.restore(before);const edits=[{x:31,y:31,z:31,energyQ:123456},{x:32,y:32,z:32,material:MAT.ICE,thermal:5}];cpu.step(1,{edits});await gpu.step(1,{edits});equal(await gpu.snapshot(),cpu.snapshot(),'Seam edit/energy differs.');
    equal(Object.fromEntries(Object.entries(await gpu.energyBalance()).map(([k,v])=>[k,String(v)])),Object.fromEntries(Object.entries(cpu.energyBalance()).map(([k,v])=>[k,String(v)])),'External accounting differs.');
    const region=await gpu.queryRegion({origin:[28,28,28],size:[8,8,8]});equal([...region.grid],[...cpu.queryRegion({origin:[28,28,28],size:[8,8,8]}).grid],'Corner query differs.');region.grid.fill(0);equal(await gpu.snapshot(),cpu.snapshot(),'Region is not isolated.');
    checks.push({worldTicks:1024,worldRestarts:[3,31,32,509],gameTicks:600,gameRestarts:[3,31,32,157,509],exact:true,invalidInputsAtomic:true,ledgerExact:true,queriesIsolated:true,concurrencyRejected:true});
  }finally{gpu.close();}
  const live=window.cavern;await live.reset();const initial=await live.snapshot();await live.step({moveX:256});check((await live.snapshot()).field.tick===1,'Public step.');await live.restore(initial);await live.view({yaw:.3,pitch:.2});equal(await live.snapshot(),initial,'View changed live state.');
  const commands=await readFixture(expected.fixtures.commands);await live.replay({version:initial.version,initial,commands});equal(await live.snapshot(),await readFixture(expected.fixtures['game-final']),'Public replay differs.');
  const saved=await live.snapshot();for(const value of [{...saved,look:[256,,0]},{...saved,seed:-1},{...saved,field:{...saved.field,worldVersion:'other'}}]){await rejected(()=>live.restore(value));equal(await live.snapshot(),saved,'Invalid live save mutated world.');}
  await rejected(()=>live.replay({version:initial.version,initial,commands:new Array(1)}));equal(await live.snapshot(),saved,'Bad tape mutated game.');
  await live.reset();checks.push({publicStepRestoreReplay:true,liveInputsAtomic:true,viewIsolated:true});progress('M3 exact world, gameplay, meshes and restarts passed.');return{passed:true,checks};
}
