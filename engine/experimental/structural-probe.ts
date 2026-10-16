/// <reference types="@webgpu/types" />
/** Internal bounded verification bundle, not a public SDK entry or demo. */
import { structuralShaders } from './structural-shader.js';
import { createStateSpaceStructuralWorld3DGPU } from './structural-world-gpu.js';
import { CpuStructuralWorld3D, type StructuralEdit3D, type StructuralSnapshot3D } from './structural-world-core.js';
import { MAT } from '../generated/materials.js';
export async function verifyM5ShaderCompile() {
  if(!navigator.gpu)throw Error('WebGPU unavailable.');
  const adapter=await navigator.gpu.requestAdapter();if(!adapter)throw Error('No WebGPU adapter.');
  const device=await adapter.requestDevice(),errors:string[]=[],compiled:string[]=[];
  device.addEventListener('uncapturederror',event=>errors.push(event.error.message));
  try {
    const codes=structuralShaders(4,[8,8,8]);
    for(const [name,code] of Object.entries(codes)) {
      const module=device.createShaderModule({code});
      const messages=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error');
      if(messages.length)throw Error(messages.map(m=>`${name}:${m.lineNum}:${m.linePos} ${m.message}`).join('\n'));
      const entries=name==='physics'?['main']:['supportInit','supportRelax','supportSummary','loadLevel','damage','normalize','componentInit','componentRelax','blockInit','blockRelax','applyMotion','editBatch','certifyPlan','queryCells'];
      for(const entryPoint of entries) {
        document.getElementById('status')!.textContent=`M5 tiny shader compilation: ${entryPoint}`;
        await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint}});compiled.push(entryPoint);
      }
    }
    if(errors.length)throw Error(errors.join('\n'));
    const info=adapter.info;
    return{passed:true,scope:'8^3 shader compilation only; no physics dispatch',compiled,
      backendInfo:{vendor:info.vendor,architecture:info.architecture,isFallbackAdapter:info.isFallbackAdapter}};
  } finally {device.destroy();}
}

const status=(text:string)=>{document.getElementById('status')!.textContent=text;};
function equalState(a:StructuralSnapshot3D,b:StructuralSnapshot3D,label:string){
  for(const key of ['width','height','depth','tick','schemaVersion','rulesVersion','worldVersion','materialCatalogHash'] as const)if(a[key]!==b[key])throw Error(`${label}: ${key} differs`);
  for(const key of ['packedCells','energyQ','structure'] as const){
    if(a[key].length!==b[key].length)throw Error(`${label}: ${key} length differs`);
    for(let i=0;i<a[key].length;i++)if(a[key][i]!==b[key][i])throw Error(`${label}: ${key}[${i}] ${a[key][i]} != ${b[key][i]}`);
  }
}
async function digest(state:StructuralSnapshot3D){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(state)))),v=>v.toString(16).padStart(2,'0')).join('');}
export async function verifyM5GpuTiny(mode:'dense'|'active'='dense'){
  const gpu=await createStateSpaceStructuralWorld3DGPU({width:8,height:8,depth:8,chunkSize:4,mode});
  const results=[];
  try{
    for(const scene of ['control','cut','heat','ice','overload']){
      const cpu=new CpuStructuralWorld3D({width:8,height:8,depth:8,chunkSize:8});
      const cold=cpu.snapshot();cold.packedCells=cold.packedCells.map(v=>v&0xffff00ff);cold.energyQ.fill(0);cpu.restore(cold);
      for(let x=1;x<=6;x++)cpu.setCell(x,3,3,scene==='ice'?MAT.ICE:MAT.STONE,0);
      cpu.setAnchor(1,3,3,true);
      if(scene==='overload')cpu.setIntegrity(1,3,3,1);else cpu.setAnchor(6,3,3,true);
      const initial=cpu.snapshot();cpu.restore(initial);await gpu.restore(initial);
      const checkpoints=new Map<number,StructuralSnapshot3D>();
      const commands=(tick:number):StructuralEdit3D[]=>tick===9&&scene!=='control'&&scene!=='overload'?[1,6].map(x=>scene==='cut'
        ?{kind:'material',x,y:3,z:3,material:MAT.AIR,thermal:0}
        :{kind:'energy',x,y:3,z:3,energyQ:(scene==='ice'?100:1000)*256}):[];
      for(let tick=1;tick<=16;tick++){
        cpu.step(1,{edits:commands(tick)});await gpu.step(1,{edits:commands(tick)});const state=await gpu.snapshot();
        equalState(state,cpu.snapshot(),`${scene} tick ${tick}`);if([3,8,9,16].includes(tick))checkpoints.set(tick,state);
        if(scene==='overload'&&tick===1){
          // Six stone cells weigh 24; the weakened root can carry only 12.
          // Its five-cell fragment must detach and fall without any heat/edit trigger.
          if(cpu.sample(1,3,3).integrity!==0||cpu.sample(3,3,3).material!==MAT.AIR||cpu.sample(3,4,3).material!==MAT.STONE)throw Error('Overload did not break the root and drop the fragment on tick one');
        }
        if(tick%4===0){status(`M5 tiny exact ${scene}: ${tick}/16`);await new Promise(resolve=>setTimeout(resolve,10));}
      }
      if((await gpu.energyBalance()).driftQ!==0n)throw Error(`${scene}: energy drift`);
      const final=await gpu.snapshot();await gpu.restore(checkpoints.get(3)!);
      for(let tick=4;tick<=16;tick++)await gpu.step(1,{edits:commands(tick)});
      equalState(await gpu.snapshot(),final,`${scene} restart`);
      if((await gpu.energyBalance()).driftQ!==0n)throw Error(`${scene}: restarted energy drift`);
      const activity=await gpu.inspectActivity();
      if(mode==='active'&&scene==='control'&&activity.dispatchedChunks!==0)throw Error('Quiescent control did not sleep');
      results.push({scene,ticks:16,restart:3,partition:[8,4],exact:true,energyDriftQ:'0',finalHash:await digest(final),solve:gpu.inspectSolve(),activity,final});
    }
    for(const floating of [false,true]){
      const cpu=new CpuStructuralWorld3D({width:8,height:8,depth:8,chunkSize:8});
      const cold=cpu.snapshot();cold.packedCells=cold.packedCells.map(v=>v&0xffff00ff);cold.energyQ.fill(0);cpu.restore(cold);
      if(floating){cpu.setCell(4,3,4,MAT.ICE,0);cpu.setCell(4,4,4,MAT.WATER,25);}
      else{cpu.setCell(1,3,1,MAT.STONE,0);cpu.setAnchor(1,3,1,true);cpu.setCell(6,1,6,MAT.WATER,25);}
      await gpu.restore(cpu.snapshot());
      for(let tick=1;tick<=8;tick++){
        cpu.step();await gpu.step();equalState(await gpu.snapshot(),cpu.snapshot(),`Root predicate ${floating}/${tick}`);
        if(tick===2&&gpu.inspectSolve().planReused===floating)throw Error('Root-predicate cache did not distinguish remote flow from lost flotation');
      }
      if((await gpu.energyBalance()).driftQ!==0n)throw Error('Root-predicate energy drift');
    }
    // All shape errors and state-dependent late errors must discard the transaction.
    const before=await gpu.snapshot(),balance=await gpu.energyBalance();
    for(const edits of [null,[null],Array(1),[{kind:'material',x:2,y:2,z:2,material:MAT.WATER},{kind:'anchor',x:2,y:2,z:2,anchored:true}],
      [{kind:'material',x:2,y:2,z:2,material:MAT.STONE},{kind:'bond',x:2,y:2,z:2,direction:1,bonded:true}]]){
      let rejected=false;try{await gpu.step(1,{edits:edits as unknown as StructuralEdit3D[]});}catch{rejected=true;}
      if(!rejected)throw Error('Malformed/state-dependent edit accepted');equalState(await gpu.snapshot(),before,'Failed edit rollback');
      if((await gpu.energyBalance()).externalQ!==balance.externalQ)throw Error('Rejected edit changed external ledger');
    }
    await gpu.step(0,{edits:undefined});await gpu.step(0,{edits:[]});equalState(await gpu.snapshot(),before,'Empty edit defaults');
    const sample=await gpu.sample(2,3,4),index=2+8*(3+8*4);
    if(sample.structure!==before.structure[index]||sample.energyQ!==before.energyQ[index]||sample.material!==(before.packedCells[index]&255))throw Error('Bounded sample differs');
    const region=await gpu.queryRegion({origin:[2,2,2],size:[4,4,4]});
    for(let z=0;z<4;z++)for(let y=0;y<4;y++)for(let x=0;x<4;x++){
      const from=x+2+8*(y+2+8*(z+2)),to=x+4*(y+4*z);
      if(region.grid[to]!==before.packedCells[from]||region.energyQ[to]!==before.energyQ[from]||region.structure[to]!==before.structure[from])throw Error('Cross-seam query differs');
    }
    status('M5 tiny exact replay and edit rollback passed');
    return{passed:true,scope:`8^3 ${mode} GPU/CPU only; 16 ticks per scenario, restart at 3; not M5 acceptance`,backendInfo:gpu.backendInfo,results,atomicEdits:true,rootPredicateCacheExact:true};
  }finally{gpu.close();}
}

/** One independently supervised tiny trajectory. Expected bytes come from Node. */
export async function verifyM5GpuTrajectory(mode:'dense'|'active',base:string){
  const reference=await(await fetch(`${base}/report.json`)).json();
  if(!reference.passed||reference.ticks!==1024||reference.dimensions.join(',')!=='8,8,8')throw Error('Missing passing tiny Node reference');
  const commands=await(await fetch(`${base}/commands.json`)).json() as {tick:number;edits:StructuralEdit3D[]}[];
  if(commands.length!==1024||commands.some((c,i)=>c.tick!==i+1))throw Error('Invalid Node command tape');
  const checkpoint=async(tick:number):Promise<StructuralSnapshot3D>=>{
    const item=reference.checkpoints[tick],response=await fetch(`${base}/${item.path}`);if(!response.ok)throw Error('Missing Node checkpoint');
    const bytes=await response.arrayBuffer();
    const checksum=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
    if(checksum!==item.sha256)throw Error('Node checkpoint checksum differs');
    return await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
  };
  const gpu=await createStateSpaceStructuralWorld3DGPU({width:8,height:8,depth:8,chunkSize:mode==='active'?4:8,mode});
  const checks:{restart:number;tick:number;exact:boolean}[]=[];
  try{
    const run=async(start:number,end:number)=>{
      await gpu.restore(await checkpoint(start));
      for(let tick=start+1;tick<=end;tick++){
        await gpu.step(1,{edits:commands[tick-1].edits});
        if(reference.checkpoints[tick]){
          equalState(await gpu.snapshot(),await checkpoint(tick),`${reference.scene}/${mode}/${start}->${tick}`);
          if((await gpu.energyBalance()).driftQ!==0n)throw Error('GPU energy drift');checks.push({restart:start,tick,exact:true});
        }
        if(tick%32===0){status(`M5 ${mode} ${reference.scene}: ${start}->${tick}/${end}`);await new Promise(resolve=>setTimeout(resolve,5));}
      }
    };
    await run(0,1024);const uninterrupted=await gpu.snapshot();await run(3,31);await run(509,1024);
    equalState(await gpu.snapshot(),uninterrupted,'Uninterrupted/restarted GPU state');
    status(`M5 ${mode} ${reference.scene}: 1024 ticks and odd restarts passed`);
    return{passed:true,scope:'8^3 Node/GPU foundation, 1024 ticks; not representative gameplay or M5 acceptance',mode,scene:reference.scene,
      ticks:1024,checks,energyDriftQ:'0',backendInfo:gpu.backendInfo,finalHash:await digest({...uninterrupted,chunkSize:4}),nodeFinalHash:reference.finalHash,solve:gpu.inspectSolve(),activity:await gpu.inspectActivity()};
  }finally{gpu.close();}
}

/** Two long beams span eight storage chunks, with independently removed roots. */
export async function verifyM5DistantSupport(mode:'dense'|'active',solveBatchLimit=32){
  const results=[];let backendInfo:Readonly<Record<string,string|boolean>>={};
  for(const axis of ['x','z'] as const){
    const geometry=axis==='x'?{width:32,height:8,depth:8}:{width:8,height:8,depth:32};
    const cpu=new CpuStructuralWorld3D({...geometry,chunkSize:8}),gpu=await createStateSpaceStructuralWorld3DGPU({...geometry,chunkSize:4,mode,solveBatchLimit});backendInfo=gpu.backendInfo;
    const coordinate=(position:number,y=3)=>axis==='x'?{x:position,y,z:3}:{x:3,y,z:position};
    try{
      const cold=cpu.snapshot();cold.packedCells=cold.packedCells.map(v=>v&0xffff00ff);cold.energyQ.fill(0);cpu.restore(cold);
      for(let p=1;p<=30;p++){const c=coordinate(p);cpu.setCell(c.x,c.y,c.z,MAT.STONE,0);}
      for(const p of [1,30]){const c=coordinate(p);cpu.setAnchor(c.x,c.y,c.z,true);}
      await gpu.restore(cpu.snapshot());const checkpoints=new Map<number,StructuralSnapshot3D>();let reuseCount=0,fallbackCount=0;
      const edits=(tick:number):StructuralEdit3D[]=>tick===9||tick===13?[{kind:'material',...coordinate(tick===9?1:30),material:MAT.AIR,thermal:0}]:[];
      for(let tick=1;tick<=24;tick++){
        cpu.step(1,{edits:edits(tick)});await gpu.step(1,{edits:edits(tick)});const state=await gpu.snapshot();equalState(state,cpu.snapshot(),`${mode} ${axis} distant support ${tick}`);
        const c=coordinate(16,tick===13?4:3);
        if(tick<=13&&cpu.sample(c.x,c.y,c.z).material!==MAT.STONE)throw Error('Distant supported/control failure bound differs');
        if(gpu.inspectSolve().planReused)reuseCount++;
        else if(gpu.inspectSolve().fallbackMask)fallbackCount++;
        if([3,12,13,24].includes(tick))checkpoints.set(tick,state);
        if(tick%4===0)status(`M5 ${mode} distant ${axis} support: ${tick}/24`);
      }
      const final=await gpu.snapshot();await gpu.restore(checkpoints.get(3)!);
      for(let tick=4;tick<=24;tick++)await gpu.step(1,{edits:edits(tick)});
      equalState(await gpu.snapshot(),final,'Distant-support restart');
      if((await gpu.energyBalance()).driftQ!==0n)throw Error('Distant-support energy drift');
      if(!reuseCount)throw Error('Exact support cache not exercised');
      if(solveBatchLimit===1&&!fallbackCount)throw Error('Bounded-attempt fallback was not exercised');
      results.push({axis,geometry,ticks:24,chunksAlongBeam:8,firstSupportRemovedAt:9,stableThrough:12,lastSupportRemovedAt:13,fellAt:13,restart:3,reuseCount,fallbackCount,solveBatchLimit,exact:true,finalHash:await digest(final)});
    }finally{gpu.close();}
  }
  return{passed:true,scope:'32x8x8 and 8x8x32 distant support, not full-size gameplay acceptance',mode,backendInfo,results};
}

/** Verification-only permutation of invocation ownership and active chunk order.
 * The isolated probe owns this browser; restore the native method before exit.
 * No public runtime option or physical rule changes to support this check.
 */
export async function verifyM5ProcessingOrder(){
  const original=GPUDevice.prototype.createShaderModule;
  let mechanicsPermutations=0,listPermutations=0;
  GPUDevice.prototype.createShaderModule=function(descriptor:GPUShaderModuleDescriptor){
    let code=descriptor.code;
    if(code.includes('fn supportRelax(')){
      const pattern=/let i=id\.x;if\(i([<>]=?)SHAPE\.w/g;
      code=code.replace(pattern,(_match,comparison:string)=>{mechanicsPermutations++;return `let i=SHAPE.w-1u-id.x;if(i${comparison}SHAPE.w`;});
    }
    if(code.includes('fn collectLocal(')){
      const marker='for(var k=0u;k<M5_CHUNKS;k++){';
      if(!code.includes(marker))throw Error('Active worklist template changed');
      code=code.replace(marker,'for(var cursor=0u;cursor<M5_CHUNKS;cursor++){let k=M5_CHUNKS-1u-cursor;');listPermutations++;
    }
    return original.call(this,{...descriptor,code});
  };
  try{
    const result=await verifyM5DistantSupport('active',1);
    if(mechanicsPermutations<28||listPermutations!==4)throw Error('Processing-order probe did not permute both worlds');
    return{...result,scope:'Reversed structural invocation ownership and reversed active worklist; exact CPU state across eight-chunk X/Z failures and odd restart',mechanicsPermutations,listPermutations};
  }finally{GPUDevice.prototype.createShaderModule=original;}
}
