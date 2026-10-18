/** Bounded public-SDK checks. No scenes, rendering, frame loops or benchmarks. */
import { verifySmallVolumePasses } from '../first-person/verify-passes.js';
import { createStateSpaceField3D, MAT } from '../../dist/sdk/state-space-3d.js';
import { createGpuField3D } from '../../dist/sdk/state-space-3d-gpu.js';
import { createStateSpaceStructuralWorld3D } from '../../dist/sdk/state-space-structural-world.js';
import { createStateSpaceStructuralWorld3DGPU } from '../../dist/sdk/state-space-structural-world-gpu.js';
const same=(a,b,message)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error(message);};
const check=(value,message)=>{if(!value)throw Error(message);};
const hardware=info=>check(info.isFallbackAdapter===false,'A hardware WebGPU adapter is required.');
async function invalidRestore(gpu, before){
  let rejected=false;
  try{await gpu.restore({...before,rulesVersion:'invalid-smoke-rules'});}catch{rejected=true;}
  check(rejected,'Invalid snapshot was accepted.');same(await gpu.snapshot(),before,'Invalid restore changed committed state.');
}
export async function materialPasses(budget,progress){
  const rows=await verifySmallVolumePasses(progress,budget);
  for(const row of rows)hardware(row.backendInfo);
  return {summary:'675 exact material pass comparisons',maxCells:105,rows};
}
export async function materialContinuation(budget,progress){
  const cpu=createStateSpaceField3D(3,5,7),gpu=await createGpuField3D(3,5,7);
  try{
    hardware(gpu.backendInfo);
    for(let z=0;z<7;z++)for(let x=0;x<3;x++)cpu.setCell(x,4,z,MAT.STONE,20);
    cpu.setCell(1,0,3,MAT.SAND,20);cpu.setCell(0,1,2,MAT.WATER,0);cpu.setCell(2,3,4,MAT.STEAM,180);
    const initial={...cpu.snapshot(),tick:3};cpu.restore(initial);await gpu.restore(initial);
    cpu.step(5);budget();await gpu.step(2);const saved=await gpu.snapshot();budget();await gpu.step(3);
    const final=await gpu.snapshot();same(final,cpu.snapshot(),'Complete material continuation differs.');
    check(final.packedCells[1+3*(5*3)]!==initial.packedCells[1+3*(5*3)],'Sand did not move.');
    check(cpu.energyBalance().driftQ===0n&&(await gpu.energyBalance()).driftQ===0n,'Material energy drift.');
    budget();await gpu.restore(saved);await gpu.step(3);same(await gpu.snapshot(),final,'Odd-tick material restart differs.');
    await invalidRestore(gpu,final);progress('Material continuation, restart and rollback exact.');
    return {summary:'Material continuation, odd-tick restart and invalid-restore rollback exact',maxCells:105,
      ticks:5,restartTick:saved.tick,energyDriftQ:'0',backendInfo:gpu.backendInfo};
  }finally{gpu.close();}
}
export function createStructuralSmokeFixture(){
  const geometry={width:8,height:8,depth:8,chunkSize:4},cpu=createStateSpaceStructuralWorld3D(geometry),plate=[];
  for(let z=0;z<8;z++)for(let x=0;x<8;x++)cpu.setCell(x,7,z,MAT.STONE,20);
  const floor=cpu.snapshot().packedCells.flatMap((word,i)=>(word&255)===MAT.STONE?[i]:[]);
  for(const x of [3,4])for(const z of [3,4]){cpu.setCell(x,1,z,MAT.STONE,20);plate.push(x+8*(1+8*z));}
  const expectedStoneCells=[...floor,...plate.map(i=>i+8*5)].sort((a,b)=>a-b);
  return {geometry,cpu,initial:cpu.snapshot(),plate,expectedStoneCells};
}
export async function structural(mode,budget,progress){
  const {geometry,cpu,initial,plate,expectedStoneCells}=createStructuralSmokeFixture();
  const gpu=await createStateSpaceStructuralWorld3DGPU({...geometry,mode});
  try{
    hardware(gpu.backendInfo);await gpu.restore(initial);let saved;
    for(let tick=1;tick<=6;tick++){
      budget();cpu.step();await gpu.step();const state=await gpu.snapshot();same(state,cpu.snapshot(),mode+' structural tick '+tick+' differs.');
      check(cpu.energyBalance().driftQ===0n&&(await gpu.energyBalance()).driftQ===0n,'Structural energy drift.');
      if(tick===3)saved=state;progress(mode+' structural tick '+tick+'/6 exact.');
    }
    const final=await gpu.snapshot(),fallen=final.packedCells.flatMap((word,i)=>(word&255)===MAT.STONE?[i]:[]);
    same(fallen,expectedStoneCells,'The bonded plate did not fall coherently to the floor.');
    budget();await gpu.restore(saved);await gpu.step(3);same(await gpu.snapshot(),final,'Structural restart differs.');
    await invalidRestore(gpu,final);
    return {summary:mode+' structural ticks, coherent collapse, restart and rollback exact',mode,maxCells:512,ticks:6,
      restartTick:3,coherentPlateCells:plate.length,energyDriftQ:'0',backendInfo:gpu.backendInfo};
  }finally{gpu.close();}
}
