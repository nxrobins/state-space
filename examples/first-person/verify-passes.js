// Small M2 pass corpus, shared by the bounded probe and the complete verifier.
import { createGpuField3D } from '../../dist/sdk/state-space-3d-gpu.js';
import { createStateSpaceField3D, MATERIALS_3D, MAX_ENERGY_Q, runVolumePass } from '../../dist/sdk/state-space-3d.js';
const equal=(a,b,message)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error(message);};
export async function verifySmallVolumePasses(progress=()=>{},checkBudget=()=>{}){
  const checks=[];
  checkBudget();
  for(const shape of [[1,1,1],[1,7,1],[3,5,7],[7,1,5],[1,5,3]]){
    const cpu=createStateSpaceField3D(...shape),gpu=await createGpuField3D(...shape);
    try{
      for(let z=0;z<shape[2];z++)for(let y=0;y<shape[1];y++)for(let x=0;x<shape[0];x++){
        const i=x+shape[0]*(y+shape[1]*z),m=MATERIALS_3D[(i*7+Math.floor(i/3))%MATERIALS_3D.length].id;cpu.setCell(x,y,z,m,(i*43)%256);if(i%3===0)cpu.setEnergy(x,y,z,i%2?MAX_ENERGY_Q:0);
      }
      for(const tick of [0,1,3,4294967297,Number.MAX_SAFE_INTEGER-1024]){
        const initial={...cpu.snapshot(),tick};await gpu.restore(initial);
        for(let pass=0;pass<27;pass++){
          checkBudget();
          const ref=runVolumePass({grid:cpu.grid,energyQ:cpu.energyQ},...shape,tick,pass),actual=await gpu.inspectPass(pass);
          equal(actual.packedCells,[...ref.grid],`Packed pass mismatch ${shape}/${tick}/${pass}`);equal(actual.energyQ,[...ref.energyQ],`Energy pass mismatch ${shape}/${tick}/${pass}`);
        }
        equal(await gpu.snapshot(),initial,'Pass inspection changed committed state.');
      }
      checks.push({shape,passes:135,exact:true,backendInfo:gpu.backendInfo});progress(`Exact pass conformance: ${shape.join('×')}`);
    }finally{gpu.close();}
  }
  return checks;
}
