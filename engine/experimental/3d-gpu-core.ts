/// <reference types="@webgpu/types" />
/** GPU-resident implementation of the unchanged ca-3d-m1 rules. */
import { buildColdTable } from '../generated/materials.js';
import { checkedInteger } from '../validation.js';
import { createStateSpaceField3D, validateVolumeSnapshot, volumeSchedule, MAX_ENERGY_Q,
  type VolumeSnapshot, type VolumeSample } from './3d.js';
import { chunkShaders } from './3d-shader.js';
import { makeTerrainRenderer } from './3d-renderer.js';
import { makeChunkRenderer } from './world-renderer.js';
import { type TerrainCamera, type TerrainRenderer } from './3d-view.js';

export type RegionRequest3D = { origin: readonly number[]; size: readonly number[] };
export type Region3D = { origin: number[]; size: number[]; grid: Uint32Array; tick: number };
export type VolumeEdit3D = { x: number; y: number; z: number } & ({ material: number; thermal?: number } | { energyQ: number });
export type GpuStepOptions3D = { edits?: readonly VolumeEdit3D[]; region?: RegionRequest3D };
export interface GpuVolume3D {
  readonly width: number; readonly height: number; readonly depth: number; readonly tick: number;
  readonly backendInfo: Readonly<Record<string, string | boolean>>;
  step(ticks?: number, options?: GpuStepOptions3D): Promise<Region3D | undefined>;
  queryRegion(region: RegionRequest3D): Promise<Region3D>;
  snapshot(): Promise<VolumeSnapshot>;
  restore(snapshot: VolumeSnapshot): Promise<void>;
  sample(x: number, y: number, z: number): Promise<VolumeSample>;
  setCell(x: number, y: number, z: number, material: number, thermal?: number): Promise<void>;
  setEnergy(x: number, y: number, z: number, energyQ: number): Promise<void>;
  energyBalance(): Promise<{ initialQ: bigint; externalQ: bigint; currentQ: bigint; driftQ: bigint }>;
  /** Diagnostic: run one pass on scratch state without changing the committed field. */
  inspectPass(passIndex: number): Promise<VolumeSnapshot>;
  createRenderer(canvas: HTMLCanvasElement): Promise<TerrainRenderer>;
  close(): void;
}
export type { TerrainCamera, TerrainRenderer } from './3d-view.js';
const KINDS = ['gravity', 'diagonal', 'liquid', 'buoyancy', 'gas', 'heat', 'phase'];
const total = (values: ArrayLike<number>) => { let sum = 0; for (let i = 0; i < values.length; i++) sum += values[i]; return BigInt(sum); };
const storage = () => GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;

async function compile(device: GPUDevice, code: string) {
  const module = device.createShaderModule({ code });
  const info = await module.getCompilationInfo(), errors = info.messages.filter(m => m.type === 'error');
  if (errors.length) throw new Error(errors.map(m => `${m.lineNum}:${m.linePos} ${m.message}`).join('\n'));
  return module;
}

class ResidentVolume implements GpuVolume3D {
  readonly width: number; readonly height: number; readonly depth: number;
  readonly backendInfo: GpuVolume3D['backendInfo'];
  #device: GPUDevice; #pipeline: GPUComputePipeline; #edit: GPUComputePipeline; #query: GPUComputePipeline;
  #buffers: GPUBuffer[] = []; #cells: GPUBuffer[]; #energy: GPUBuffer[]; #cold: GPUBuffer;
  #uniform: GPUBuffer; #slots = 29; #groups: GPUBindGroup[] = []; #current = 0;
  #editData: GPUBuffer; #editResult: GPUBuffer; #editRead: GPUBuffer; #queryResult: GPUBuffer; #queryRead: GPUBuffer; #fullRead: GPUBuffer;
  #tick = 0; #initial: bigint; #external = 0n; #busy = false; #fault = ''; #closed = false;
  #renderers: TerrainRenderer[] = []; #worldRenderer=false; #config: ResidentConfig; #dirty: GPUBuffer;
  constructor(w: number, h: number, d: number, initial: VolumeSnapshot, device: GPUDevice,
    pipeline: GPUComputePipeline, edit: GPUComputePipeline, query: GPUComputePipeline, info: GpuVolume3D['backendInfo'], config:ResidentConfig) {
    this.#config=config; this.width = w; this.height = h; this.depth = d; this.#device = device;
    this.backendInfo = Object.freeze(info);
    for (const key of ['width', 'height', 'depth', 'backendInfo']) Object.defineProperty(this, key, { writable: false, configurable: false });
    this.#pipeline = pipeline; this.#edit = edit; this.#query = query;
    const bytes = w * h * d * 4;
    const buffer = (size: number, usage: GPUBufferUsageFlags) => { const b = device.createBuffer({ size, usage }); this.#buffers.push(b); return b; };
    this.#cells = [buffer(bytes, storage()), buffer(bytes, storage())];
    this.#energy = [buffer(bytes, storage()), buffer(bytes, storage())];
    this.#dirty=buffer(Math.max(1,config.chunkSize ? w*h*d/config.chunkSize**3 : 1)*4,storage()); this.#invalidate();
    const cold = buildColdTable(); this.#cold = buffer(cold.byteLength, storage()); device.queue.writeBuffer(this.#cold, 0, cold);
    this.#uniform = buffer(this.#slots * 256, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    this.#editData = buffer(64 * 16, storage()); this.#editResult = buffer(64 * 8, storage());
    this.#editRead = buffer(64 * 8, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ);
    this.#queryResult = buffer(4096 * 4, storage()); this.#queryRead = buffer(4096 * 4, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ);
    this.#fullRead = buffer(bytes * 2, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ);
    this.#initial = total(initial.energyQ);
    device.queue.writeBuffer(this.#cells[0], 0, this.#pack(initial.packedCells));
    device.queue.writeBuffer(this.#energy[0], 0, this.#pack(initial.energyQ));
    this.#bind();
    device.addEventListener('uncapturederror', event => { this.#fault = event.error.message; });
    void device.lost.then(info => { this.#fault = info.message || info.reason; });
  }
  #address(x:number,y:number,z:number) {
    const e=this.#config.chunkSize,w=this.width,h=this.height;
    return e ? (Math.floor(x/e)+w/e*(Math.floor(y/e)+h/e*Math.floor(z/e)))*e**3+x%e+e*(y%e+e*(z%e)) : x+w*(y+h*z);
  }
  #pack(source:ArrayLike<number>){const out=new Uint32Array(source.length);let i=0;for(let z=0;z<this.depth;z++)for(let y=0;y<this.height;y++)for(let x=0;x<this.width;x++)out[this.#address(x,y,z)]=source[i++];return out;}
  #unpack(source:Uint32Array){const out=new Uint32Array(source.length);let i=0;for(let z=0;z<this.depth;z++)for(let y=0;y<this.height;y++)for(let x=0;x<this.width;x++)out[i++]=source[this.#address(x,y,z)];return out;}
  #invalidateEdits(edits:Uint32Array){
    const e=this.#config.chunkSize;if(!e)return;
    const n=[this.width/e,this.height/e,this.depth/e],seen=new Set<number>();
    for(let i=0;i<edits.length;i+=4){if(edits[i+1]===1)continue;const k=Math.floor(edits[i]/e**3),l=edits[i]%e**3;
      const c=[k%n[0],Math.floor(k/n[0])%n[1],Math.floor(k/(n[0]*n[1]))],local=[l%e,Math.floor(l/e)%e,Math.floor(l/e**2)];seen.add(k);
      for(let a=0;a<3;a++)for(const sign of [-1,1])if((sign<0?local[a]===0:local[a]===e-1)&&c[a]+sign>=0&&c[a]+sign<n[a]){const other=[...c];other[a]+=sign;seen.add(other[0]+n[0]*(other[1]+n[1]*other[2]));}
    }
    for(const k of seen)this.#device.queue.writeBuffer(this.#dirty,k*4,new Uint32Array([1]));
  }
  #invalidate(){this.#device.queue.writeBuffer(this.#dirty,0,new Uint32Array(this.#dirty.size/4).fill(1));}
  get tick() { return this.#tick; }
  #available() { if (this.#closed || this.#fault || this.#busy) throw new Error(this.#closed ? '3D GPU field is closed.' : this.#fault || '3D GPU field has an operation in flight.'); }
  async #run<T>(operation: () => Promise<T>): Promise<T> {
    this.#available(); this.#busy = true;
    try { return await operation(); } finally { this.#busy = false; }
  }
  #bind() {
    this.#groups = [0, 1].map(i => this.#device.createBindGroup({ layout: this.#pipeline.getBindGroupLayout(0), entries:
      [this.#cells[i], this.#energy[i], this.#cells[1-i], this.#energy[1-i], this.#cold, this.#uniform, this.#dirty].map((buffer, binding) => ({ binding, resource: { buffer, ...(binding === 5 ? { size: 48 } : {}) } })) }));
  }
  #parameters(slots: number) {
    if (slots > this.#slots) {
      this.#uniform.destroy(); this.#slots = slots;
      this.#uniform = this.#device.createBuffer({ size: slots * 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      this.#buffers.push(this.#uniform); this.#bind();
    }
    return new Uint32Array(slots * 64);
  }
  #shape(params: Uint32Array, slot: number) { params.set([this.width, this.height, this.depth, this.width * this.height * this.depth], slot * 64); }
  #region(region?: RegionRequest3D): RegionRequest3D | undefined {
    if (region === undefined) return;
    if (!region || !Array.isArray(region.origin) || !Array.isArray(region.size) || region.origin.length !== 3 || region.size.length !== 3) throw new Error('Region needs three origin and size coordinates.');
    const shape = [this.width, this.height, this.depth], origin: number[] = [], size: number[] = [];
    for (let i = 0; i < 3; i++) {
      size.push(checkedInteger(region.size[i], 1, shape[i], 'region size'));
      origin.push(checkedInteger(region.origin[i], 0, shape[i] - size[i], 'region origin'));
    }
    checkedInteger(size[0] * size[1] * size[2], 1, 4096, 'region cell count');
    return { origin, size };
  }
  #edits(edits: readonly VolumeEdit3D[] = []) {
    if (!Array.isArray(edits)) throw new Error('A commit supports at most 64 unique cell edits.');
    const count = checkedInteger(edits.length, 0, 64, 'edit count');
    const seen = new Set<number>(), data = new Uint32Array(count * 4), seed = this.#config.cpu(1,1,1);
    for (let k = 0; k < count; k++) {
      const e = edits[k];
      if (!e || typeof e !== 'object') throw new Error('Invalid volume edit.');
      checkedInteger(e.x, 0, this.width-1, 'x'); checkedInteger(e.y, 0, this.height-1, 'y'); checkedInteger(e.z, 0, this.depth-1, 'z');
      const i=e.x+this.width*(e.y+this.height*e.z); if(seen.has(i)) throw new Error('Duplicate edit coordinate.'); seen.add(i);
      const keys=Object.keys(e).sort().join(',');
      if ('material' in e) {
        if (!['material,x,y,z','material,thermal,x,y,z'].includes(keys)) throw new Error('Unknown placement edit field.');
        seed.setCell(0,0,0,e.material,e.thermal); const s=seed.sample(0,0,0);
        data.set([this.#address(e.x,e.y,e.z),0,seed.grid[0],s.energyQ],k*4);
      } else {
        if(keys!=='energyQ,x,y,z') throw new Error('Unknown energy edit field.');
        checkedInteger(e.energyQ,0,MAX_ENERGY_Q,'energyQ');data.set([this.#address(e.x,e.y,e.z),1,0,e.energyQ],k*4);
      }
    }
    return data;
  }
  async #finish(encoder: GPUCommandEncoder, reads: { buffer: GPUBuffer; bytes: number }[] = []) {
    this.#device.queue.submit([encoder.finish()]);
    const validation = this.#device.popErrorScope();
    const results = await Promise.allSettled([validation, this.#device.queue.onSubmittedWorkDone(), ...reads.map(r => r.buffer.mapAsync(GPUMapMode.READ,0,r.bytes))]);
    try {
      const failed=results.find(r=>r.status==='rejected');if(failed?.status==='rejected') throw failed.reason;
      const error = results[0].status==='fulfilled' && results[0].value;
      if(error) throw new Error((error as GPUError).message);
      if(this.#fault) throw new Error(this.#fault);
      return reads.map(r=>new Uint32Array(r.buffer.getMappedRange(0,r.bytes).slice(0)));
    } catch(error) { this.#fault=String(error); throw error; }
    finally { reads.forEach(r=>{if(r.buffer.mapState==='mapped')r.buffer.unmap();}); }
  }
  async step(ticks = 1, options: GpuStepOptions3D = {}): Promise<Region3D | undefined> {
    checkedInteger(ticks,0,1024,'ticks per request'); checkedInteger(this.#tick+ticks,0,Number.MAX_SAFE_INTEGER,'end tick');
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(k => k !== 'edits' && k !== 'region')) throw new Error('Invalid GPU step options.');
    const region=this.#region(options.region), edits=this.#edits(options.edits);
    return this.#run(async()=>{
      const params=this.#parameters(ticks*27+2);this.#shape(params,0);params[9]=edits.length/4;
      if(region){this.#shape(params,1);params.set(region.size,68);params.set(region.origin,72);}
      let slot=2;for(let t=0;t<ticks;t++) for(const pass of volumeSchedule(this.#tick+t)) {
        this.#shape(params,slot);params.set([KINDS.indexOf(pass.kind),pass.axis,pass.parity,pass.direction>>>0,(this.#tick+t)>>>0],slot*64+4);slot++;
      }
      this.#device.queue.writeBuffer(this.#uniform,0,params);
      if(edits.length){this.#device.queue.writeBuffer(this.#editData,0,edits);this.#invalidateEdits(edits);}
      this.#device.pushErrorScope('validation');const encoder=this.#device.createCommandEncoder();
      let current=this.#current;
      if(edits.length){
        const group=this.#device.createBindGroup({layout:this.#edit.getBindGroupLayout(0),entries:[
          [2,this.#cells[current]],[3,this.#energy[current]],[4,this.#cold],[5,this.#uniform],[6,this.#editData],[7,this.#editResult],
        ].map(([binding,buffer])=>({binding:binding as number,resource:{buffer:buffer as GPUBuffer,...(binding===5?{offset:0,size:48}:{})}}))});
        const pass=encoder.beginComputePass();pass.setPipeline(this.#edit);pass.setBindGroup(0,group);pass.dispatchWorkgroups(1);pass.end();
      }
      const compute=encoder.beginComputePass();compute.setPipeline(this.#pipeline);
      for(let s=2;s<slot;s++){compute.setBindGroup(0,this.#groups[current],[s*256]);compute.dispatchWorkgroups(Math.ceil(this.width*this.height*this.depth/64));current=1-current;}
      compute.end();
      if(region){
        const group=this.#device.createBindGroup({layout:this.#query.getBindGroupLayout(0),entries:[
          {binding:0,resource:{buffer:this.#cells[current]}},{binding:5,resource:{buffer:this.#uniform,offset:256,size:48}},{binding:7,resource:{buffer:this.#queryResult}},
        ]});
        const pass=encoder.beginComputePass();pass.setPipeline(this.#query);pass.setBindGroup(0,group);pass.dispatchWorkgroups(Math.ceil(region.size.reduce((a,b)=>a*b,1)/64));pass.end();
      }
      const reads=[];
      if(edits.length){const bytes=edits.length*2;encoder.copyBufferToBuffer(this.#editResult,0,this.#editRead,0,bytes);reads.push({buffer:this.#editRead,bytes});}
      if(region){const bytes=region.size.reduce((a,b)=>a*b,1)*4;encoder.copyBufferToBuffer(this.#queryResult,0,this.#queryRead,0,bytes);reads.push({buffer:this.#queryRead,bytes});}
      const values=await this.#finish(encoder,reads);
      if(edits.length){const deltas=values.shift()!;for(let i=0;i<deltas.length;i+=2)this.#external+=BigInt(deltas[i+1])-BigInt(deltas[i]);}
      this.#current=current;this.#tick+=ticks;
      return region ? {origin:[...region.origin],size:[...region.size],grid:values[0],tick:this.#tick} : undefined;
    });
  }
  async queryRegion(region: RegionRequest3D) { const checked = this.#region(region); if (!checked) throw new Error('A region is required.'); return (await this.step(0,{region:checked}))!; }
  async #snapshot(current = this.#current): Promise<VolumeSnapshot> {
    const bytes=this.width*this.height*this.depth*4;this.#device.pushErrorScope('validation');const encoder=this.#device.createCommandEncoder();
    encoder.copyBufferToBuffer(this.#cells[current],0,this.#fullRead,0,bytes);encoder.copyBufferToBuffer(this.#energy[current],0,this.#fullRead,bytes,bytes);
    const [words]=await this.#finish(encoder,[{buffer:this.#fullRead,bytes:bytes*2}]);
    const template=this.#config.cpu(1,1,1).snapshot();
    const result={...template,width:this.width,height:this.height,depth:this.depth,tick:this.#tick,packedCells:Array.from(this.#unpack(words.subarray(0,bytes/4))),energyQ:Array.from(this.#unpack(words.subarray(bytes/4)))};
    this.#config.validate(result);return result;
  }
  async snapshot() {return this.#run(()=>this.#snapshot());}
  async restore(snapshot: VolumeSnapshot) {
    const state=this.#config.validate(snapshot);if(snapshot.width!==this.width||snapshot.height!==this.height||snapshot.depth!==this.depth)throw new Error('3D snapshot geometry differs from the field.');
    const tick=snapshot.tick;
    return this.#run(async()=>{
      this.#device.queue.writeBuffer(this.#cells[0],0,this.#pack(state.grid) as Uint32Array<ArrayBuffer>);this.#device.queue.writeBuffer(this.#energy[0],0,this.#pack(state.energyQ) as Uint32Array<ArrayBuffer>);
      await this.#device.queue.onSubmittedWorkDone();this.#current=0;this.#tick=tick;this.#initial=total(state.energyQ);this.#external=0n;this.#invalidate();
    });
  }
  async sample(x:number,y:number,z:number) { checkedInteger(x,0,this.width-1,'x');checkedInteger(y,0,this.height-1,'y');checkedInteger(z,0,this.depth-1,'z');
    const cpu=this.#config.cpu(this.width,this.height,this.depth);cpu.restore(await this.snapshot());return cpu.sample(x,y,z); }
  async setCell(x:number,y:number,z:number,material:number,thermal?:number){await this.step(0,{edits:[{x,y,z,material,...(thermal===undefined?{}:{thermal})}]});}
  async setEnergy(x:number,y:number,z:number,energyQ:number){await this.step(0,{edits:[{x,y,z,energyQ}]});}
  async energyBalance(){const s=await this.snapshot();const currentQ=total(s.energyQ);return{initialQ:this.#initial,externalQ:this.#external,currentQ,driftQ:currentQ-this.#initial-this.#external};}
  async inspectPass(passIndex:number){checkedInteger(passIndex,0,26,'pass index');return this.#run(async()=>{
    const p=volumeSchedule(this.#tick)[passIndex],params=this.#parameters(1);this.#shape(params,0);params.set([KINDS.indexOf(p.kind),p.axis,p.parity,p.direction>>>0,this.#tick>>>0],4);
    this.#device.queue.writeBuffer(this.#uniform,0,params);this.#device.pushErrorScope('validation');const e=this.#device.createCommandEncoder();const pass=e.beginComputePass();pass.setPipeline(this.#pipeline);pass.setBindGroup(0,this.#groups[this.#current],[0]);pass.dispatchWorkgroups(Math.ceil(this.width*this.height*this.depth/64));pass.end();await this.#finish(e);return this.#snapshot(1-this.#current);
  });}
  async createRenderer(canvas: HTMLCanvasElement): Promise<TerrainRenderer> {
    if(this.#config.chunkSize&&this.#worldRenderer)throw new Error('A world supports one terrain cache per field.');
    return this.#run(async()=>{
      const renderer=this.#config.chunkSize ? await makeChunkRenderer(this.#device,canvas,()=>({grid:this.#cells[this.#current],shape:[this.width,this.height,this.depth]}),this.#dirty,this.#config.chunkSize) : await makeTerrainRenderer(this.#device,canvas,()=>({grid:this.#cells[this.#current],shape:[this.width,this.height,this.depth]}));
      let rendererClosed=false;
      const wrapped={render:(camera:TerrainCamera)=>this.#run(()=>renderer.render(camera)),close:()=>{if(rendererClosed)return;if(this.#busy)throw new Error('Cannot close terrain with an operation in flight.');renderer.close();rendererClosed=true;this.#worldRenderer=false;},...(renderer.inspectMesh?{inspectMesh:()=>this.#run(()=>renderer.inspectMesh!())}:{})};this.#renderers.push(wrapped);this.#worldRenderer=Boolean(this.#config.chunkSize);return wrapped;
    });
  }
  close(){if(this.#closed)return;if(this.#busy)throw new Error('Cannot close a field with an operation in flight.');this.#closed=true;this.#renderers.forEach(r=>r.close());this.#buffers.forEach(b=>b.destroy());this.#device.destroy();}
}

export type ResidentConfig = { chunkSize: number; cpu: (w:number,h:number,d:number,fill?:number)=>import('./3d.js').StateSpaceField3D; validate: typeof validateVolumeSnapshot };
export async function createResidentVolume(initial:VolumeSnapshot, config:ResidentConfig):Promise<GpuVolume3D>{
  const {width,height,depth}=initial;
  if(!globalThis.navigator?.gpu)throw new Error('WebGPU is required for GPU 3D fields.');
  const adapter=await navigator.gpu.requestAdapter();if(!adapter)throw new Error('No WebGPU adapter.');
  const device=await adapter.requestDevice();
  try{
    const shaders=chunkShaders(config.chunkSize);
    const module=await compile(device,shaders.physics),access=await compile(device,shaders.access);
    const layout=device.createBindGroupLayout({entries:[0,1,2,3,4,5,6].map(binding=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:binding===5?{type:'uniform',hasDynamicOffset:true,minBindingSize:48}:{type:binding===2||binding===3||binding===6?'storage':'read-only-storage'}}))});
    const pipeline=await device.createComputePipelineAsync({layout:device.createPipelineLayout({bindGroupLayouts:[layout]}),compute:{module,entryPoint:'main'}});
    const edit=await device.createComputePipelineAsync({layout:'auto',compute:{module:access,entryPoint:'edit'}});
    const query=await device.createComputePipelineAsync({layout:'auto',compute:{module:access,entryPoint:'query'}});
    const info=adapter.info;return new ResidentVolume(width,height,depth,initial,device,pipeline,edit,query,{vendor:info.vendor,architecture:info.architecture,device:info.device,description:info.description,isFallbackAdapter:info.isFallbackAdapter},config);
  }catch(error){device.destroy();throw error;}
}
