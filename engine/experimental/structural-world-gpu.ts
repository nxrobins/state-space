/// <reference types="@webgpu/types" preserve="true" />
/// <reference types="@webgpu/types" />
/** Independent M5 GPU solver. The committed bank is never a scratch output. */
import { buildColdTable } from '../generated/materials.js';
import { checkedInteger, stateCopyTargets } from '../validation.js';
import { energyLedger, temperatureQ } from '../thermal.js';
import { DEFAULT_REGISTRY } from '../registry.js';
import { volumeSchedule } from './3d-core.js';
import { activeWorldGeometry, checkedActiveWorldRegion } from './active-world-core.js';
import type { RegionRequest3D } from './3d-gpu-core.js';
import { structuralShaders, STRUCTURAL_LIST_STAGES } from './structural-shader.js';
import { structuralActivityShaders } from './structural-active-shader.js';
import { CpuStructuralWorld3D, prepareStructuralEdits3D, validateStructuralSnapshot3D,
  type StructuralWorldOptions3D, type StructuralSnapshot3D, type StructuralEdit3D, type StructuralStepOptions3D } from './structural-world-core.js';
import { BONDS_3D, ANCHOR_3D, INTEGRITY_3D, type StructuralState3D } from './structural-mechanics.js';
import { makeChunkRenderer, type ResidentChunkRenderer } from './world-renderer.js';
import { makeGameplayResources, checkedGameplayState, checkedGameplayRules, checkedGameplayCommand } from './gameplay-gpu.js';
import { LatencyProfiler, type Trace } from './latency.js';
import { commitStructuralGoal } from './structural-gameplay.js';
import type { TerrainRenderer, TerrainCamera, TerrainAppearance, TerrainLightingMode } from './3d-view.js';
export type { TerrainRenderer, TerrainCamera, TerrainAppearance, TerrainLightingMode } from './3d-view.js';
import type { GameplayState3D, GameplayRules3D, GameplayCommand3D, GameplayPresentation3D } from './gameplay-view.js';
import type { StructuralResidentGameplay3D, StructuralGameplayOptions3D, StructuralGameplayCommit3D, StructuralSubmissionTiming3D, StructuralGameplayLatency3D } from './structural-view.js';
export type { StructuralResidentGameplay3D, StructuralGameplayOptions3D, StructuralGameplayCommit3D } from './structural-view.js';
export { checkedGameplayState as validateStructuralGameplayState3D } from './gameplay-gpu.js';

const KINDS=['gravity','diagonal','liquid','buoyancy','gas','heat','phase'];
const BINDINGS={
  main:[0,1,2,3,4,5,6,7,8], supportInit:[0,4,7,9], supportRelax:[7,9,14], supportSummary:[0,4,9],
  loadLevel:[0,4,5,7,9], damage:[0,1,4,7,8,9], normalize:[0,4,7,8], componentInit:[7,9],
  componentRelax:[7,9,14], blockInit:[0,4,7,9], blockRelax:[7,9,14], applyMotion:[0,1,2,3,6,7,8,9],
  editBatch:[2,3,4,5,6,8,9,10,11],
  certifyLocal:[0,1,4,6,7],collectLocal:[6,12],
  certifyPlan:[0,2,3,4,7,8,9],
  queryCells:[0,1,5,7,13],
  relaxStart:[9,14],relaxAdvance:[9,14],relaxEnd:[5,9,14],
  loadInit:[0,4,7,9],loadRelax:[0,4,7,9,14],loadSummary:[9],
} as const;
type Stage=keyof typeof BINDINGS;
const listStages=new Set<Stage>(STRUCTURAL_LIST_STAGES);
type Bank={grid:GPUBuffer;energyQ:GPUBuffer;structure:GPUBuffer};
type Pipelines=Record<Stage,GPUComputePipeline>;
const cold=buildColdTable();
const total=(values:ArrayLike<number>)=>{let sum=0;for(let i=0;i<values.length;i++)sum+=values[i];return BigInt(sum);};
const storage=()=>GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST;
export type StructuralSolveStats3D={tick:number;supportPasses:number;loadPasses?:number;componentPasses:number;blockingPasses:number;maxDistance:number;supportedWeight:number;reactionTotal:number;planReused?:boolean;planReusable?:boolean;batchedSolve?:boolean;fallbackMask?:number;listedCells?:number};
export type StructuralGpuOptions3D=StructuralWorldOptions3D & {mode?:'dense'|'active';solveBatchLimit?:number;profiling?:boolean;gpuTiming?:boolean};

export class GpuStructuralWorld3D {
  readonly width:number;readonly height:number;readonly depth:number;readonly chunkSize:number;
  readonly backendInfo:Readonly<Record<string,string|boolean>>;
  readonly mode:'dense'|'active';
  #device:GPUDevice;#pipelines:Pipelines;#banks:Bank[]=[];#owned:GPUBuffer[]=[];#current=0;#tick=0;
  #cold:GPUBuffer;#work:GPUBuffer;#dirty:GPUBuffer;#uniform:GPUBuffer;#commands:GPUBuffer;#receipts:GPUBuffer;
  #controlRead:GPUBuffer;#receiptRead:GPUBuffer;#fullRead:GPUBuffer;
  #indirect:GPUBuffer;#activityRead:GPUBuffer;
  #queryResult:GPUBuffer;#queryRead:GPUBuffer;
  #solveDispatch:GPUBuffer;
  #solveBatchLimit:number;
  #memberBound=0;#solveGroups=0;
  #groups=new Map<string,GPUBindGroup>();#params=new Uint32Array(64*64);
  #computePass?:GPUComputePassEncoder;
  #busy=false;#closed=false;#fault='';#initial=0n;#external=0n;
  #planReusable=false;
  #renderers=new Map<TerrainRenderer,ResidentChunkRenderer>();#gameplay?:StructuralResidentGameplay3D;
  #revision=0;#submissions=0;
  #submitTrace?:StructuralSubmissionTiming3D[];
  #profiler:LatencyProfiler;#traces=new WeakMap<GPUCommandEncoder,Trace>();
  #stats:StructuralSolveStats3D={tick:0,supportPasses:0,componentPasses:0,blockingPasses:0,maxDistance:0,supportedWeight:0,reactionTotal:0};
  constructor(initial:StructuralSnapshot3D,device:GPUDevice,pipelines:Pipelines,info:Record<string,string|boolean>,mode:'dense'|'active',solveBatchLimit:number,profiling=false,gpuTiming=false) {
    this.width=initial.width;this.height=initial.height;this.depth=initial.depth;this.chunkSize=initial.chunkSize;
    this.#device=device;this.#pipelines=pipelines;this.backendInfo=Object.freeze({...info});this.mode=mode;this.#solveBatchLimit=solveBatchLimit;
    this.#profiler=new LatencyProfiler(device,profiling,gpuTiming,128);
    const bytes=this.width*this.height*this.depth*4;
    const buffer=(size:number,usage:GPUBufferUsageFlags)=>{const b=device.createBuffer({size,usage});this.#owned.push(b);return b;};
    for(let i=0;i<3;i++)this.#banks.push({grid:buffer(bytes,storage()),energyQ:buffer(bytes,storage()),structure:buffer(bytes,storage())});
    this.#cold=buffer(cold.byteLength,storage());device.queue.writeBuffer(this.#cold,0,cold);
    this.#work=buffer(64+bytes*5,storage());this.#dirty=buffer(bytes/this.chunkSize**3*3+16,storage());
    this.#indirect=buffer(12,storage()|GPUBufferUsage.INDIRECT);this.#activityRead=buffer(12,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ);
    this.#queryResult=buffer(4096*16,storage());this.#queryRead=buffer(4096*16,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ);
    this.#solveDispatch=buffer(16,storage());
    this.#uniform=buffer(this.#params.byteLength,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
    this.#commands=buffer(65536*16,storage());this.#receipts=buffer(65536*8,storage());
    this.#controlRead=buffer(64,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ);
    this.#receiptRead=buffer(65536*8,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ);
    this.#fullRead=buffer(bytes*3,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ);
    this.#memberBound=this.#upload(0,validateStructuralSnapshot3D(initial));this.#tick=initial.tick;this.#initial=total(initial.energyQ);
    device.queue.writeBuffer(this.#dirty,0,new Uint32Array(this.#dirty.size/4).fill(1));
    device.addEventListener('uncapturederror',e=>{this.#fault=e.error.message;});
    void device.lost.then(info=>{this.#fault=info.message||info.reason;});
    for(const key of ['width','height','depth','chunkSize','backendInfo','mode'])Object.defineProperty(this,key,{writable:false,configurable:false});
  }
  get tick(){return this.#tick;}
  inspectSolve(){return{...this.#stats};}
  inspectLatency(afterId=0){return this.#profiler.snapshot(afterId);}
  settleLatency(){return this.#profiler.settle();}
  #trace(e:GPUCommandEncoder,tick=this.#tick+1){
    if(!this.#profiler.enabled)return;
    let trace=this.#traces.get(e);
    if(!trace){trace=this.#profiler.begin(this.#gameplay?'gameplay':'step',tick)!;this.#traces.set(e,trace);}
    return trace;
  }
  inspectActivity(){return this.#run(async()=>{
    const chunks=this.width*this.height*this.depth/this.chunkSize**3;
    if(this.mode==='dense')return{mode:this.mode,tick:this.#tick,totalChunks:chunks,finalAwake:chunks,dispatchedChunks:chunks*27,peakChunks:chunks};
    const e=this.#device.createCommandEncoder();e.copyBufferToBuffer(this.#dirty,chunks*12,this.#activityRead,0,12);
    const [v]=await this.#submit(e,[{buffer:this.#activityRead,bytes:12}]);return{mode:this.mode,tick:this.#tick,totalChunks:chunks,finalAwake:v[0],dispatchedChunks:v[1],peakChunks:v[2]};
  });}
  #address(x:number,y:number,z:number){const e=this.chunkSize;return(Math.floor(x/e)+this.width/e*(Math.floor(y/e)+this.height/e*Math.floor(z/e)))*e**3+x%e+e*(y%e+e*(z%e));}
  #pack(source:ArrayLike<number>){const out=new Uint32Array(source.length);let i=0;for(let z=0;z<this.depth;z++)for(let y=0;y<this.height;y++)for(let x=0;x<this.width;x++)out[this.#address(x,y,z)]=source[i++];return out;}
  #unpack(source:Uint32Array){const out=new Uint32Array(source.length);let i=0;for(let z=0;z<this.depth;z++)for(let y=0;y<this.height;y++)for(let x=0;x<this.width;x++)out[i++]=source[this.#address(x,y,z)];return out;}
  #upload(bank:number,state:StructuralState3D){for(const key of ['grid','energyQ','structure'] as const)this.#device.queue.writeBuffer(this.#banks[bank][key],0,this.#pack(state[key]));let count=0;for(const s of state.structure)if(s&INTEGRITY_3D)count++;return count;}
  async #run<T>(operation:()=>Promise<T>):Promise<T>{
    if(this.#closed||this.#fault||this.#busy)throw Error(this.#closed?'Structural world closed.':this.#fault||'Structural operation already in flight.');
    this.#busy=true;try{return await operation();}catch(error){this.#planReusable=false;throw error;}finally{this.#busy=false;this.#submitTrace=undefined;}
  }
  #group(stage:Stage,input:number,output:number,structure=input){
    const key=`${stage}/${input}/${output}/${structure}`;let group=this.#groups.get(key);if(group)return group;
    const a=this.#banks[input],b=this.#banks[output],buffers=[a.grid,a.energyQ,b.grid,b.energyQ,this.#cold,this.#uniform,this.#dirty,this.#banks[structure].structure,b.structure,this.#work,this.#commands,this.#receipts,this.#indirect,this.#queryResult,this.#solveDispatch];
    group=this.#device.createBindGroup({layout:this.#pipelines[stage].getBindGroupLayout(0),entries:BINDINGS[stage].map(binding=>({binding,resource:{buffer:buffers[binding],...(binding===5?{size:48}:{})}}))});
    this.#groups.set(key,group);return group;
  }
  #compute(e:GPUCommandEncoder,encode:()=>void,label='structuralSolve'){
    if(this.#computePass)throw Error('Nested structural compute encoding.');
    const pass=e.beginComputePass(this.#profiler.pass(this.#trace(e),label));this.#computePass=pass;
    try{encode();}finally{pass.end();this.#computePass=undefined;}
  }
  #dispatch(e:GPUCommandEncoder,stage:Stage,input:number,output:number,structure=input,slot=0){
    const shared=this.#computePass,pass=shared??e.beginComputePass(this.#profiler.pass(this.#trace(e),stage==='main'?'materials.'+KINDS[this.#params[slot*64+4]]:stage));pass.setPipeline(this.#pipelines[stage]);
    pass.setBindGroup(0,this.#group(stage,input,output,structure),(BINDINGS[stage] as readonly number[]).includes(5)?[slot*256]:[]);
    if(listStages.has(stage))pass.dispatchWorkgroups(this.#solveGroups);
    else if(stage==='main'&&this.mode==='active')pass.dispatchWorkgroupsIndirect(this.#indirect,0);
    else pass.dispatchWorkgroups(stage==='editBatch'||stage==='collectLocal'||stage.startsWith('relax')?1:Math.ceil(this.width*this.height*this.depth/64));if(!shared)pass.end();
  }
  #parameters(slot:number,values:number[]){this.#params.fill(0,slot*64,(slot+1)*64);this.#params.set(values,slot*64+4);}
  #writeParameters(slots:number){this.#device.queue.writeBuffer(this.#uniform,0,this.#params,0,slots*64);}
  async #submit(e:GPUCommandEncoder,reads:{buffer:GPUBuffer;bytes:number}[]=[]){
    const trace=this.#traces.get(e);this.#profiler.resolve(e,trace);
    this.#device.pushErrorScope('validation');
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{
      this.#device.queue.submit([e.finish()]);this.#submissions++;this.#profiler.submitted(trace);
      const timing:StructuralSubmissionTiming3D|undefined=this.#submitTrace?{submittedAt:performance.now()}:undefined;if(timing)this.#submitTrace!.push(timing);
      const validation=this.#device.popErrorScope().then(error=>{if(timing)timing.validatedAt=performance.now();return error;});
      const mapped=Promise.all(reads.map(async({buffer,bytes})=>{
        await buffer.mapAsync(GPUMapMode.READ,0,bytes);try{return new Uint32Array(buffer.getMappedRange(0,bytes)).slice();}finally{buffer.unmap();}
      })).then(values=>{if(timing)timing.mappedAt=performance.now();return values;});
      // Wait for drawing too: a mapped control buffer alone need not certify
      // completion of unrelated GPU work. Both waits share one host boundary.
      const pending=Promise.all([mapped,this.#device.queue.onSubmittedWorkDone().then(()=>{if(timing)timing.queueCompletedAt=performance.now();}),validation]).then(([values,,error])=>{if(error)throw Error(error.message);return values;});
      const values=await Promise.race([pending,new Promise<never>((_,reject)=>{timer=setTimeout(()=>{this.#fault='M5 GPU completion exceeded 1500 ms; state not committed.';this.#device.destroy();reject(Error(this.#fault));},1500);})]);
      if(this.#fault)throw Error(this.#fault);this.#profiler.mark(trace,'completedAt');return values;
    }finally{if(timer)clearTimeout(timer);}
  }
  async #control(e:GPUCommandEncoder){e.copyBufferToBuffer(this.#work,0,this.#controlRead,0,64);const [value]=await this.#submit(e,[{buffer:this.#controlRead,bytes:64}]);if(value[2])throw Error(`Structural solve rejected scratch state (code ${value[2]}).`);if(value[13]>this.#solveGroups*64)throw Error('Structural worklist exceeds certified dispatch coverage.');return value;}
  async #converge(stage:'supportRelax'|'componentRelax'|'blockRelax',input:number,structure:number,deadline:number){
    const max=this.width*this.height*this.depth+4;
    for(let count=0;count<max;count+=4){
      if(performance.now()>deadline)throw Error(`Structural ${stage} deadline exceeded; tick not committed.`);
      const e=this.#device.createCommandEncoder();e.clearBuffer(this.#work,0,4);
      this.#compute(e,()=>{for(let k=0;k<4;k++)this.#dispatch(e,stage,input,0,structure);});
      const control=await this.#control(e);if(control[0]===0)return count+4;
    }
    throw Error(`Structural ${stage} failed to converge; tick not committed.`);
  }
  async #edits(commands:Uint32Array,bank:number,tick=this.#tick+1):Promise<bigint>{
    if(!commands.length)return 0n;
    const count=commands.length/4;this.#device.queue.writeBuffer(this.#commands,0,commands);
    let e=this.#device.createCommandEncoder();e.clearBuffer(this.#work,0,64);
    for(const key of ['grid','energyQ','structure'] as const)e.copyBufferToBuffer(this.#banks[this.#current][key],0,this.#banks[bank][key],0,this.#banks[bank][key].size);
    for(let start=0;start<count;){
      let slots=0;
      while(start<count&&slots<16){this.#trace(e,tick);this.#parameters(slots,[0,0,0,0,0,start,Math.min(start+64,count)]);this.#dispatch(e,'editBatch',this.#current,bank,this.#current,slots++);start+=64;}
      this.#writeParameters(slots);await this.#control(e);e=this.#device.createCommandEncoder();
    }
    e.copyBufferToBuffer(this.#receipts,0,this.#receiptRead,0,count*8);
    const [pairs]=await this.#submit(e,[{buffer:this.#receiptRead,bytes:count*8}]);let external=0n;
    for(let k=0;k<count;k++)external+=BigInt(pairs[k*2+1])-BigInt(pairs[k*2]);return external;
  }
  async #batchedSolve(commands:Uint32Array,a:number,b:number){
    const edited=commands.length>0,input=edited?a:this.#current,damage=edited?b:a,normalized=edited?a:b;
    const e=this.#device.createCommandEncoder();e.clearBuffer(this.#work,0,64);
    if(edited){
      this.#device.queue.writeBuffer(this.#commands,0,commands);
      for(const key of ['grid','energyQ','structure'] as const)e.copyBufferToBuffer(this.#banks[this.#current][key],0,this.#banks[a][key],0,this.#banks[a][key].size);
      this.#parameters(0,[0,0,0,0,0,0,commands.length/4]);this.#dispatch(e,'editBatch',this.#current,a,this.#current,0);
    }
    this.#compute(e,()=>{
    const relax=(stage:'supportRelax'|'loadRelax'|'componentRelax'|'blockRelax',structure:number,slot:number)=>{
      this.#parameters(slot,[1<<(slot-1),slot,0,0]);this.#dispatch(e,'relaxStart',input,damage);
      // These are attempt budgets, never physical iteration limits. Every
      // exhausted family discards the attempt and invokes complete convergence.
      // Blocking is a fixed-point solve too: four iterations can be exhausted
      // by stacked disconnected components even when the other families fit.
      const budget=Math.min(this.#solveBatchLimit,stage==='supportRelax'||stage==='loadRelax'?64:32);
      for(let k=0;k<budget;k++){this.#dispatch(e,stage,input,damage,structure);this.#dispatch(e,'relaxAdvance',input,damage);}
      this.#dispatch(e,'relaxEnd',input,damage,input,slot);
    };
    this.#dispatch(e,'supportInit',input,damage);relax('supportRelax',input,1);
    this.#dispatch(e,'supportSummary',input,damage);this.#dispatch(e,'loadInit',input,damage);relax('loadRelax',input,2);this.#dispatch(e,'loadSummary',input,damage);
    this.#dispatch(e,'damage',input,damage);this.#dispatch(e,'normalize',input,normalized,damage);this.#dispatch(e,'componentInit',input,damage,normalized);relax('componentRelax',normalized,3);
    this.#dispatch(e,'blockInit',input,damage,normalized);relax('blockRelax',normalized,4);
    });
    this.#writeParameters(5);e.copyBufferToBuffer(this.#work,0,this.#controlRead,0,64);
    if(edited)e.copyBufferToBuffer(this.#receipts,0,this.#receiptRead,0,commands.length*2);
    const rows=await this.#submit(e,[{buffer:this.#controlRead,bytes:64},...(edited?[{buffer:this.#receiptRead,bytes:commands.length*2}]:[])]),control=rows[0];
    if(control[2])throw Error(`Structural solve rejected scratch state (code ${control[2]}).`);
    if(control[13]>this.#solveGroups*64)throw Error('Structural worklist exceeds certified dispatch coverage.');
    if(control[8])return{complete:false as const,mask:control[8]};
    if(control[4]!==control[5])throw Error('Structural reactions do not balance supported weight.');
    let external=0n;if(edited)for(let k=0;k<commands.length/4;k++)external+=BigInt(rows[1][k*2+1])-BigInt(rows[1][k*2]);
    return{complete:true as const,input,damage,normalized,external,control};
  }
  async #tickOnce(commands:Uint32Array,finish?:(e:GPUCommandEncoder,bank:number)=>Promise<Uint32Array>){
    const deadline=performance.now()+5000,[a,b]=[0,1,2].filter(i=>i!==this.#current),edited=commands.length>0;
    // Each edit can create at most one intact cell. The prior committed count
    // includes all phase changes, and restores count their validated snapshot.
    this.#solveGroups=Math.ceil(Math.min(this.width*this.height*this.depth,this.#memberBound+commands.length/4)/64);
    if(this.#planReusable&&!edited){
      // The previous completed tick certified both graph equality and zero
      // impending damage. No speculative partial support solve is used.
      const input=this.#current,e=this.#device.createCommandEncoder();e.clearBuffer(this.#work,0,4);e.clearBuffer(this.#work,8,4);e.clearBuffer(this.#work,24,4);e.clearBuffer(this.#work,56,4);
      const current=this.#encodeMotionAndMaterial(e,input,a,b,input),control=await(finish?finish(e,current):this.#control(e));
      this.#current=current;this.#tick++;this.#revision++;this.#planReusable=control[6]===0;this.#memberBound=Math.min(this.width*this.height*this.depth,this.#memberBound+(control[14]|0));
      this.#stats={...this.#stats,tick:this.#tick,supportPasses:0,loadPasses:0,componentPasses:0,blockingPasses:0,planReused:true,planReusable:this.#planReusable};return;
    }
    this.#planReusable=false;
    let fallbackMask=0;
    if(commands.length<=256){
      const plan=await this.#batchedSolve(commands,a,b);
      if(plan.complete){
        const e=this.#device.createCommandEncoder(),current=this.#encodeMotionAndMaterial(e,plan.input,plan.damage,plan.normalized,plan.normalized),control=await(finish?finish(e,current):this.#control(e));
        this.#current=current;this.#tick++;this.#revision++;this.#external+=plan.external;this.#planReusable=!edited&&control[6]===0;this.#memberBound=Math.min(this.width*this.height*this.depth,this.#memberBound+(control[14]|0));
        this.#stats={tick:this.#tick,supportPasses:plan.control[9],loadPasses:plan.control[10],componentPasses:plan.control[11],blockingPasses:plan.control[12],maxDistance:plan.control[1],supportedWeight:plan.control[4],reactionTotal:plan.control[5],planReused:false,planReusable:this.#planReusable,batchedSolve:true,fallbackMask:0,listedCells:plan.control[13]};return;
      }
      fallbackMask=plan.mask;
    }
    const external=await this.#edits(commands,a),input=edited?a:this.#current,damage=edited?b:a,normalized=edited?a:b;
    let e=this.#device.createCommandEncoder();e.clearBuffer(this.#work,0,64);this.#dispatch(e,'supportInit',input,damage);this.#dispatch(e,'relaxStart',input,damage);await this.#control(e);
    const supportPasses=await this.#converge('supportRelax',input,input,deadline);
    e=this.#device.createCommandEncoder();this.#dispatch(e,'supportSummary',input,damage);const summary=await this.#control(e),maxDistance=summary[1];
    for(let level=maxDistance;level>=0;){
      if(performance.now()>deadline)throw Error('Structural load solve deadline exceeded; tick not committed.');
      e=this.#device.createCommandEncoder();let slots=0;
      while(level>=0&&slots<32){this.#parameters(slots,[0,0,0,0,0,level--]);this.#dispatch(e,'loadLevel',input,damage,input,slots++);}
      this.#writeParameters(slots);await this.#control(e);
    }
    e=this.#device.createCommandEncoder();this.#dispatch(e,'damage',input,damage);
    this.#dispatch(e,'normalize',input,normalized,damage);this.#dispatch(e,'componentInit',input,damage,normalized);const balanced=await this.#control(e);
    if(balanced[4]!==balanced[5])throw Error('Structural reactions do not balance supported weight; tick not committed.');
    const componentPasses=await this.#converge('componentRelax',input,normalized,deadline);
    e=this.#device.createCommandEncoder();this.#dispatch(e,'blockInit',input,damage,normalized);await this.#control(e);
    const blockingPasses=await this.#converge('blockRelax',input,normalized,deadline);
    e=this.#device.createCommandEncoder();const current=this.#encodeMotionAndMaterial(e,input,damage,normalized,normalized),control=await(finish?finish(e,current):this.#control(e));
    this.#current=current;this.#tick++;this.#revision++;this.#external+=external;this.#planReusable=!edited&&control[6]===0;this.#memberBound=Math.min(this.width*this.height*this.depth,this.#memberBound+(control[14]|0));
    this.#stats={tick:this.#tick,supportPasses,componentPasses,blockingPasses,maxDistance,supportedWeight:balanced[4],reactionTotal:balanced[5],planReused:false,planReusable:this.#planReusable,batchedSolve:false,fallbackMask,listedCells:balanced[13]};
  }
  #encodeMotionAndMaterial(e:GPUCommandEncoder,input:number,damage:number,normalized:number,structure:number){
    this.#dispatch(e,'applyMotion',input,damage,structure);
    let current=damage,spare=normalized,slot=0;
    if(this.mode==='active'){
      // Sleeping cells agree in both banks. Global motion precedes certification.
      for(const key of ['grid','energyQ','structure'] as const)e.copyBufferToBuffer(this.#banks[current][key],0,this.#banks[spare][key],0,this.#banks[current][key].size);
      const chunkBytes=this.width*this.height*this.depth/this.chunkSize**3*4;
      e.clearBuffer(this.#dirty,chunkBytes,this.#dirty.size-chunkBytes);
    }
    // Compute dispatches retain their order and individual resource-usage
    // scopes. Copies/clears stay outside the pass; input/output banks still
    // swap after every material pass. Avoid one native wrapper per dispatch.
    const schedule=volumeSchedule(this.#tick);
    const materialPass=(p:typeof schedule[number])=>{
      this.#parameters(slot,[KINDS.indexOf(p.kind),p.axis,p.parity,p.direction>>>0,this.#tick>>>0]);
      if(this.mode==='active')this.#dispatch(e,'collectLocal',current,spare);
      this.#dispatch(e,'main',current,spare,current,slot++);[current,spare]=[spare,current];
    };
    if(this.#profiler.gpuTimestamps){
      // Diagnostic-only pass boundaries expose family costs; acceptance timing
      // runs with profiling disabled and retains the combined compute pass.
      if(this.mode==='active')this.#dispatch(e,'certifyLocal',current,spare);
      for(const p of schedule)materialPass(p);
      this.#dispatch(e,'normalize',current,spare);
    }else this.#compute(e,()=>{
      if(this.mode==='active')this.#dispatch(e,'certifyLocal',current,spare);
      for(const p of schedule)materialPass(p);
      this.#dispatch(e,'normalize',current,spare);
    },'materials');
    this.#writeParameters(slot);
    e.copyBufferToBuffer(this.#banks[spare].structure,0,this.#banks[current].structure,0,this.#banks[current].structure.size);
    // Count only membership changes for the next conservative dispatch bound.
    // The committed bank is immutable, including edits and phase transitions.
    this.#dispatch(e,'certifyPlan',this.#current,current);
    return current;
  }
  step(ticks=1,options:StructuralStepOptions3D={}){
    checkedInteger(ticks,0,32,'ticks per request');checkedInteger(this.#tick+ticks,0,Number.MAX_SAFE_INTEGER,'end tick');
    if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>k!=='edits'))throw Error('Invalid structural step options.');
    const commands=prepareStructuralEdits3D(options.edits===undefined?[]:options.edits,this);
    return this.#run(async()=>{
      if(!ticks&&commands.length){this.#planReusable=false;const bank=(this.#current+1)%3,external=await this.#edits(commands,bank,this.#tick);this.#current=bank;this.#revision++;this.#external+=external;this.#memberBound=Math.min(this.width*this.height*this.depth,this.#memberBound+commands.length/4);}
      for(let t=0;t<ticks;t++)await this.#tickOnce(t?new Uint32Array():commands);
    });
  }
  edit(edits:readonly StructuralEdit3D[]){return this.step(0,{edits});}
  setCell(x:number,y:number,z:number,material:number,thermal?:number){return this.edit([{kind:'material',x,y,z,material,...(thermal===undefined?{}:{thermal})}]);}
  setEnergy(x:number,y:number,z:number,energyQ:number){return this.edit([{kind:'energy',x,y,z,energyQ}]);}
  setAnchor(x:number,y:number,z:number,anchored:boolean){return this.edit([{kind:'anchor',x,y,z,anchored}]);}
  setIntegrity(x:number,y:number,z:number,integrity:number){return this.edit([{kind:'integrity',x,y,z,integrity}]);}
  setBond(x:number,y:number,z:number,direction:number,bonded:boolean){return this.edit([{kind:'bond',x,y,z,direction,bonded}]);}
  async #readState():Promise<StructuralState3D>{
    const e=this.#device.createCommandEncoder(),bytes=this.width*this.height*this.depth*4,bank=this.#banks[this.#current];
    for(const [i,key] of (['grid','energyQ','structure'] as const).entries())e.copyBufferToBuffer(bank[key],0,this.#fullRead,i*bytes,bytes);
    const [values]=await this.#submit(e,[{buffer:this.#fullRead,bytes:bytes*3}]);
    return{grid:this.#unpack(values.subarray(0,bytes/4)),energyQ:this.#unpack(values.subarray(bytes/4,bytes/2)),structure:this.#unpack(values.subarray(bytes/2))};
  }
  snapshot(){return this.#run(async()=>{
    const state=await this.#readState(),template=new CpuStructuralWorld3D({width:4,height:4,depth:4,chunkSize:4}).snapshot();
    return{...template,width:this.width,height:this.height,depth:this.depth,chunkSize:this.chunkSize,tick:this.#tick,
      packedCells:Array.from(state.grid),energyQ:Array.from(state.energyQ),structure:Array.from(state.structure)};
  });}
  restore(snapshot:StructuralSnapshot3D){
    const state=validateStructuralSnapshot3D(snapshot),tick=snapshot.tick;
    if(snapshot.width!==this.width||snapshot.height!==this.height||snapshot.depth!==this.depth)throw Error('Structural snapshot geometry differs.');
    return this.#run(async()=>{this.#planReusable=false;const next=(this.#current+1)%3,count=this.#upload(next,state);await this.#submit(this.#device.createCommandEncoder());this.#current=next;this.#memberBound=count;this.#tick=tick;this.#revision++;this.#initial=total(state.energyQ);this.#external=0n;this.#device.queue.writeBuffer(this.#dirty,0,new Uint32Array(this.#dirty.size/4).fill(1));});
  }
  queryRegion(request:RegionRequest3D){
    const {origin,size}=checkedActiveWorldRegion(request,this);
    return this.#run(async()=>{
      const count=size[0]*size[1]*size[2],e=this.#device.createCommandEncoder();this.#parameters(0,[...size,0,...origin]);this.#writeParameters(1);
      const pass=e.beginComputePass();pass.setPipeline(this.#pipelines.queryCells);pass.setBindGroup(0,this.#group('queryCells',this.#current,0),[0]);pass.dispatchWorkgroups(Math.ceil(count/64));pass.end();
      e.copyBufferToBuffer(this.#queryResult,0,this.#queryRead,0,count*16);const [words]=await this.#submit(e,[{buffer:this.#queryRead,bytes:count*16}]);
      const grid=new Uint32Array(count),energyQ=new Uint32Array(count),structure=new Uint32Array(count);
      for(let i=0;i<count;i++){grid[i]=words[i*4];energyQ[i]=words[i*4+1];structure[i]=words[i*4+2];}
      return{origin:[...origin],size:[...size],grid,energyQ,structure,tick:this.#tick};
    });
  }
  copyStateInto(target:StructuralState3D){
    const arrays=stateCopyTargets(target,this.width*this.height*this.depth);
    if(arrays.some(a=>!(a.buffer instanceof ArrayBuffer)))throw Error('State copy requires owned ArrayBuffers.');
    return this.#run(async()=>{const state=await this.#readState();for(const [i,key] of (['grid','energyQ','structure'] as const).entries())Uint32Array.prototype.set.call(arrays[i],state[key]);return this.#tick;});
  }
  sample(x:number,y:number,z:number){
    checkedInteger(x,0,this.width-1,'x');checkedInteger(y,0,this.height-1,'y');checkedInteger(z,0,this.depth-1,'z');
    return this.queryRegion({origin:[x,y,z],size:[1,1,1]}).then(s=>{const v=s.grid[0],q=s.energyQ[0],word=s.structure[0];
      return{material:v&255,materialName:DEFAULT_REGISTRY.material(v&255).name,phase:(v>>>24)&15,thermal:(v>>>8)&255,energyQ:q,temperatureQ:temperatureQ(v,q,cold),structure:word,integrity:word&INTEGRITY_3D,anchored:Boolean(word&ANCHOR_3D),bonds:BONDS_3D.map(b=>Boolean(word&b))};});
  }
  energyBalance(){return this.#run(async()=>{const currentQ=total((await this.#readState()).energyQ);return{initialQ:this.#initial,externalQ:this.#external,currentQ,driftQ:currentQ-this.#initial-this.#external};});}
  energyLedger(){return this.#run(async()=>energyLedger(await this.#readState(),cold));}
  createRenderer(canvas:HTMLCanvasElement):Promise<TerrainRenderer>{return this.#run(async()=>{
    if(this.#renderers.size)throw Error('A structural world supports one terrain cache.');
    const renderer=await makeChunkRenderer(this.#device,canvas,()=>({grid:this.#banks[this.#current].grid,shape:[this.width,this.height,this.depth]}),this.#dirty,this.chunkSize,this.#profiler,()=>this.#tick);
    let closed=false;
    const wrapped:TerrainRenderer={
      render:(camera:TerrainCamera)=>this.#run(()=>renderer.render(camera)),
      setAppearance:(value:TerrainAppearance)=>this.#run(()=>renderer.setAppearance!(value)),
      setLightingMode:(value:TerrainLightingMode)=>this.#run(()=>renderer.setLightingMode!(value)),
      setHeatDistortion:(value:boolean)=>this.#run(()=>renderer.setHeatDistortion!(value)),
      inspectMesh:()=>this.#run(()=>renderer.inspectMesh!()),
      close:()=>{if(closed)return;if(this.#busy)throw Error('Cannot close terrain with an operation in flight.');closed=true;renderer.close();this.#renderers.delete(wrapped);},
    };this.#renderers.set(wrapped,renderer);return Object.freeze(wrapped);
  });}
  createGameplay(initial:GameplayState3D,rules:GameplayRules3D):Promise<StructuralResidentGameplay3D>{
    const shape=[this.width,this.height,this.depth];if(Math.min(...shape)<16)throw Error('Resident gameplay requires dimensions of at least 16.');
    let state:GameplayState3D=checkedGameplayState(initial,shape);const checkedRules=checkedGameplayRules(rules,shape);
    return this.#run(async()=>{
      if(this.#gameplay)throw Error('A structural world supports one controller.');
      const profiler=this.#profiler,resources=await makeGameplayResources(this.#device,shape,this.chunkSize,this.#cold,this.#dirty,undefined,checkedRules,profiler);
      let closed=false,revision=this.#revision;
      const initialize=async(s:GameplayState3D)=>{
        resources.writeState(s);const e=this.#device.createCommandEncoder();resources.initialize(e,this.#banks[this.#current].grid,this.#banks[this.#current].energyQ);
        await this.#submit(e);state=s;revision=this.#revision;
      };
      const execute=(command:GameplayCommand3D|undefined,options:StructuralGameplayOptions3D={})=>{
        if(closed||revision!==this.#revision)throw Error(closed?'Structural gameplay closed.':'Terrain changed externally; restore the controller before continuing.');
        if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!['edits','presentation'].includes(k)))throw Error('Invalid structural gameplay options.');
        const c=command?checkedGameplayCommand(command,this.#tick+1):{tick:this.#tick,moveX:0,moveZ:0,jump:false,tool:'none' as const,look:state.look};
        if(c.tool!=='none')throw Error('Use M5 structural edits; legacy controller tools are disabled.');
        const edits=prepareStructuralEdits3D(options.edits===undefined?[]:options.edits,this);
        if(!command&&edits.length)throw Error('Presentation cannot edit physics.');
        let renderer:ResidentChunkRenderer|undefined,camera:TerrainCamera|undefined;
        if(options.presentation){
          renderer=this.#renderers.get(options.presentation.renderer);if(!renderer)throw Error('Renderer does not belong to this world.');
          const view=options.presentation.camera;
          if(!view||Object.keys(view).some(k=>!['forward','right','up'].includes(k)))throw Error('Invalid presentation camera.');
          camera={eye:[state.player.x/256,(state.player.y-400)/256,state.player.z/256],forward:Array.from(view.forward??[]),right:Array.from(view.right??[]),up:Array.from(view.up??[])};
          renderer.validateCamera(camera);const axes=[camera.forward,camera.right,camera.up];
          for(let i=0;i<3;i++)for(let j=i;j<3;j++)if(Math.abs(axes[i].reduce((s,v,k)=>s+v*axes[j][k],0)-(i===j?1:0))>1e-5)throw Error('Camera axes must be orthonormal.');
        }
        return this.#run(async()=>{
          const start=this.#submissions;let commit:StructuralGameplayCommit3D|undefined;
          const latency:StructuralGameplayLatency3D={startedAt:performance.now(),preparedAt:0,boundaries:[]};this.#submitTrace=latency.boundaries;
          // Re-upload the last committed actor. A rejected scratch frame cannot
          // leak controller mutations into the next attempt.
          resources.writeState(state);resources.prepare(c,camera?camera.forward.map(v=>Math.round(v*256)):c.look);
          latency.preparedAt=performance.now();
          const finish=async(e:GPUCommandEncoder,bank:number)=>{
            const {grid,energyQ}=this.#banks[bank],trace=this.#trace(e,c.tick);
            if(command){resources.tools(e,grid,energyQ,false,trace);resources.controller(e,grid,energyQ,trace);}
            else{resources.initialize(e,grid,energyQ);resources.present(e,grid,energyQ,trace);}
            latency.renderStartedAt=performance.now();if(renderer&&camera)renderer.encode(e,camera,grid,resources.result,trace,c.tick);latency.renderEncodedAt=performance.now();
            if(command)e.copyBufferToBuffer(this.#work,0,this.#controlRead,0,64);
            e.copyBufferToBuffer(resources.result,0,resources.read,0,512);
            const rows=await this.#submit(e,[...(command?[{buffer:this.#controlRead,bytes:64}]:[]),{buffer:resources.read,bytes:512}]);
            const control=command?rows[0]:new Uint32Array(16);if(control[2])throw Error(`Structural gameplay rejected solve (${control[2]}).`);
            const result=resources.decode(rows[command?1:0],c.tick),decoded=command?commitStructuralGoal(result,checkedRules):result,submissions=this.#submissions-start;
            commit={...decoded,submissions,completionBoundaries:submissions,latency};return control;
          };
          if(command)await this.#tickOnce(edits,finish);else await finish(this.#device.createCommandEncoder(),this.#current);
          if(!commit)throw Error('Missing gameplay commit');
          state={player:{...commit.player},look:[...commit.look],status:commit.status,carved:commit.carved,iceWalk:commit.iceWalk};revision=this.#revision;latency.completedAt=performance.now();return commit;
        });
      };
      const driver:StructuralResidentGameplay3D={
        step:(command,options)=>execute(command,options),present:(presentation:GameplayPresentation3D)=>execute(undefined,{presentation}),
        restore:s=>{if(closed)throw Error('Structural gameplay closed.');const checked=checkedGameplayState(s,shape);return this.#run(()=>initialize(checked));},
        inspect:()=>structuredClone(state),
        close:()=>{if(closed)return;if(this.#busy)throw Error('Cannot close gameplay with an operation in flight.');closed=true;resources.close();this.#gameplay=undefined;},
      };
      try{await initialize(state);this.#gameplay=driver;return Object.freeze(driver);}catch(error){resources.close();throw error;}
    });
  }
  close(){if(this.#closed)return;if(this.#busy)throw Error('Cannot close a structural world with an operation in flight.');this.#closed=true;this.#gameplay?.close();for(const renderer of Array.from(this.#renderers.keys()))renderer.close();this.#profiler.close();this.#owned.forEach(b=>b.destroy());this.#device.destroy();}
}

export async function createStateSpaceStructuralWorld3DGPU(options:StructuralGpuOptions3D={}):Promise<GpuStructuralWorld3D>{
  if(!options||typeof options!=='object'||Array.isArray(options))throw Error('Invalid structural GPU options.');
  const {mode='dense',solveBatchLimit:requestedLimit,profiling,gpuTiming,...geometry}=options;if(mode!=='dense'&&mode!=='active')throw Error('Invalid structural execution mode.');
  if(profiling!==undefined&&typeof profiling!=='boolean')throw Error('Invalid profiling option.');
  if(gpuTiming!==undefined&&typeof gpuTiming!=='boolean')throw Error('Invalid GPU timing option.');
  const g=activeWorldGeometry(geometry);
  // Budgets bound an attempt, never physical propagation. Large worlds need
  // room for landing contacts; exhausted attempts still converge completely.
  const solveBatchLimit=requestedLimit===undefined?(Math.max(g.width,g.height,g.depth)>64?64:32):requestedLimit;
  checkedInteger(solveBatchLimit,1,64,'solve batch limit');
  const initial=new CpuStructuralWorld3D(geometry).snapshot();
  if(!globalThis.navigator?.gpu)throw Error('WebGPU unavailable.');
  const adapter=await navigator.gpu.requestAdapter();if(!adapter)throw Error('No WebGPU adapter.');
  // editBatch uses eight storage bindings. No adapter-specific raised limit.
  const device=await adapter.requestDevice({requiredFeatures:profiling&&gpuTiming&&adapter.features.has('timestamp-query')?['timestamp-query']:[]});
  try{
    const base=structuralShaders(g.chunkSize,[g.width,g.height,g.depth]),active=mode==='active'?structuralActivityShaders(base.physics,g.chunkSize,g.width*g.height*g.depth/g.chunkSize**3):undefined;
    const codes={physics:active?.physics??base.physics,mechanics:base.mechanics,...(active?{planning:active.planning}:{})},pipelines={} as Pipelines;
    for(const [name,code] of Object.entries(codes)){
      const module=device.createShaderModule({code}),errors=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error');
      if(errors.length)throw Error(errors.map(m=>`${name}:${m.lineNum}:${m.linePos} ${m.message}`).join('\n'));
      for(const stage of Object.keys(BINDINGS) as Stage[]){
        const moduleName=stage==='main'?'physics':['certifyLocal','collectLocal'].includes(stage)?'planning':'mechanics';
        if(moduleName!==name)continue;
        const layout=device.createBindGroupLayout({entries:BINDINGS[stage].map(binding=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:binding===5?{type:'uniform',hasDynamicOffset:true,minBindingSize:48}:{type:[0,1,4,7,10].includes(binding)?'read-only-storage':'storage'}}))});
        pipelines[stage]=await device.createComputePipelineAsync({layout:device.createPipelineLayout({bindGroupLayouts:[layout]}),compute:{module,entryPoint:stage}});
      }
    }
    const info=adapter.info;
    return new GpuStructuralWorld3D(initial,device,pipelines,{vendor:info.vendor,architecture:info.architecture,device:info.device,description:info.description,isFallbackAdapter:info.isFallbackAdapter},mode,solveBatchLimit,profiling,gpuTiming);
  }catch(error){device.destroy();throw error;}
}
