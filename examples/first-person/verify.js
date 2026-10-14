import { createGpuField3D } from '../../dist/sdk/state-space-3d-gpu.js';
import { createStateSpaceField3D, MATERIALS_3D, MAX_ENERGY_Q, runVolumePass } from '../../dist/sdk/state-space-3d.js';
import { CrossingGame } from './game.js';
const equal=(a,b,message)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error(message);};
const check=(value,message)=>{if(!value)throw new Error(message);};
async function rejected(fn){let error;try{await fn();}catch(e){error=e;}check(error,'Expected rejection.');}
const progress=text=>{document.getElementById('status').textContent=text;};
export async function verifyCrossing(expected){
  check(expected.passed&&expected.sourceUnchanged,'Fresh Node reference required.');
  const checks=[];
  for(const shape of [[1,1,1],[1,7,1],[3,5,7],[7,1,5],[1,5,3]]){
    const cpu=createStateSpaceField3D(...shape),gpu=await createGpuField3D(...shape);
    try{
      for(let z=0;z<shape[2];z++)for(let y=0;y<shape[1];y++)for(let x=0;x<shape[0];x++){
        const i=x+shape[0]*(y+shape[1]*z),m=MATERIALS_3D[(i*7+Math.floor(i/3))%MATERIALS_3D.length].id;cpu.setCell(x,y,z,m,(i*43)%256);if(i%3===0)cpu.setEnergy(x,y,z,i%2?MAX_ENERGY_Q:0);
      }
      for(const tick of [0,1,3,4294967297,Number.MAX_SAFE_INTEGER-1024]){
        const initial={...cpu.snapshot(),tick};await gpu.restore(initial);
        for(let pass=0;pass<27;pass++){
          const ref=runVolumePass({grid:cpu.grid,energyQ:cpu.energyQ},...shape,tick,pass),actual=await gpu.inspectPass(pass);
          equal(actual.packedCells,[...ref.grid],`Packed pass mismatch ${shape}/${tick}/${pass}`);equal(actual.energyQ,[...ref.energyQ],`Energy pass mismatch ${shape}/${tick}/${pass}`);
        }
        equal(await gpu.snapshot(),initial,'Pass inspection changed committed state.');
      }
      checks.push({shape,passes:135,exact:true});progress(`Exact pass conformance: ${shape.join('×')}`);
    }finally{gpu.close();}
  }
  const gpu=await createGpuField3D(32,32,32);
  try{
    for(const scene of expected.scenes){
      await gpu.restore(scene.initial);
      for(const t of [1,3,4,509,510,1024]){await gpu.step(t-gpu.tick);equal(await gpu.snapshot(),scene.checkpoints[t],`${scene.scene} at ${t}`);}
      for(const tick of [3,509]){await gpu.restore(scene.checkpoints[tick]);await gpu.step(1024-tick);equal(await gpu.snapshot(),scene.checkpoints[1024],`${scene.scene} restart ${tick}`);check((await gpu.energyBalance()).driftQ===0n,'Energy drift.');}
      checks.push({scene:scene.scene,ticks:1024,restarts:[3,509],exact:true});progress(`${scene.scene}: 1024 GPU ticks and both restarts exact`);
    }
    await gpu.restore(expected.game.initial.field);const before=await gpu.snapshot();
    for(const operation of [()=>gpu.setCell(0,0,0,4),()=>gpu.setEnergy(0,0,0,-1),()=>gpu.step(1,{edits:[{x:0,y:0,z:0,material:1},{x:0,y:0,z:0,energyQ:0}]}),()=>gpu.queryRegion({origin:[31,0,0],size:[2,1,1]}),()=>gpu.restore({...before,tick:-1}),()=>gpu.restore({...before,rulesVersion:'ca-v4'})]){await rejected(operation);equal(await gpu.snapshot(),before,'Rejected operation mutated state.');}
    const corrupt=structuredClone(before);corrupt.packedCells[0]|=1<<16;await rejected(()=>gpu.restore(corrupt));equal(await gpu.snapshot(),before,'Bad packed state changed field.');
    const running=gpu.step();await rejected(()=>gpu.setEnergy(0,0,0,0));await rejected(()=>gpu.close());await running;
    const cpu=createStateSpaceField3D(32,32,32);cpu.restore(await gpu.snapshot());
    const edits=[{x:0,y:0,z:0,material:8,thermal:5},{x:1,y:2,z:3,energyQ:MAX_ENERGY_Q}];for(const e of edits){if('material'in e)cpu.setCell(e.x,e.y,e.z,e.material,e.thermal);else cpu.setEnergy(e.x,e.y,e.z,e.energyQ);}await gpu.step(0,{edits});equal(await gpu.snapshot(),cpu.snapshot(),'Batched edits differ.');
    // Reset the accounting baseline on both sides before checking exact deltas.
    await gpu.restore(cpu.snapshot());cpu.restore(cpu.snapshot());const q=123456;cpu.setEnergy(1,2,3,q);await gpu.setEnergy(1,2,3,q);equal(await gpu.snapshot(),cpu.snapshot(),'Edits differ.');equal(Object.fromEntries(Object.entries(await gpu.energyBalance()).map(([k,v])=>[k,String(v)])),Object.fromEntries(Object.entries(cpu.energyBalance()).map(([k,v])=>[k,String(v)])),'Ledger differs.');
    const region=await gpu.queryRegion({origin:[1,2,3],size:[3,5,7]}),grid=cpu.grid;let k=0;for(let z=3;z<10;z++)for(let y=2;y<7;y++)for(let x=1;x<4;x++)check(region.grid[k++]===grid[x+32*(y+32*z)],'Region order mismatch.');region.grid.fill(0);equal(await gpu.snapshot(),cpu.snapshot(),'Region was not isolated.');
    checks.push({invalidInputsAtomic:true,concurrentOperationsRejected:true,ledgerExact:true,regionIsolated:true});
    const g=new CrossingGame(gpu);await g.restore(expected.game.initial);
    for(const c of expected.game.commands)await g.step(c);equal(await g.snapshot(),expected.game.final,'Full game replay differs.');
    equal(g.commands,expected.game.commands,'Input tape differs.');check((await gpu.energyBalance()).driftQ===0n,'Gameplay drift.');
    for(const tick of [3,119,157,509]){await g.restore(expected.game.checkpoints[tick]);for(const c of expected.game.commands.slice(tick))await g.step(c);equal(await g.snapshot(),expected.game.final,`Game restart ${tick}`);check((await gpu.energyBalance()).driftQ===0n,'Restart energy drift.');progress(`Player + terrain restart ${tick}: exact`);}
    const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;const renderer=await gpu.createRenderer(canvas);const state=await gpu.snapshot();
    for(const eye of [[6,22,15],[8,18,10],[25,22,15]])await renderer.render({eye,forward:[1,0,0],right:[0,0,-1],up:[0,-1,0]});
    renderer.close();equal(await gpu.snapshot(),state,'Rendering changed physics.');
    checks.push({gameTicks:600,won:true,restarts:[3,119,157,509],exact:true,renderingIsolated:true});
  }finally{gpu.close();}
  const live=window.crossing;await live.reset();const saved=await live.snapshot();await rejected(()=>live.restore({...saved,player:{...saved.player,x:-1}}));equal(await live.snapshot(),saved,'Bad game save changed live state.');
  await live.step({moveX:256});check((await live.snapshot()).field.tick===1,'Public step failed.');document.getElementById('step').click();await new Promise(resolve=>setTimeout(resolve,100));check((await live.snapshot()).field.tick===2,'UI step failed.');
  const beforeView=(await live.snapshot()).field;await live.view({yaw:.2,pitch:.3});equal((await live.snapshot()).field,beforeView,'Camera isolation');await live.reset();
  progress('All GPU physics, gameplay and restart checks passed.');return{passed:true,checks};
}
