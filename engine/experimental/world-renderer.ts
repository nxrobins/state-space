/// <reference types="@webgpu/types" />
/** Persistent per-chunk face lists. Physics owns invalidation, never visibility. */
import { DRAW } from './3d-renderer.js';
import type { TerrainCamera, TerrainRenderer } from './3d-view.js';

export async function makeChunkRenderer(device:GPUDevice,canvas:HTMLCanvasElement,state:()=>{grid:GPUBuffer;shape:number[]},dirty:GPUBuffer,edge:number):Promise<TerrainRenderer>{
  const context=canvas.getContext('webgpu');if(!context)throw new Error('Cannot create WebGPU canvas.');
  const shape=state().shape,count=shape.reduce((a,b)=>a*b,1),capacity=edge**3*6,chunks=count/edge**3;
  const format=navigator.gpu.getPreferredCanvasFormat();context.configure({device,format,alphaMode:'opaque'});
  const mapping=`
const EDGE=${edge}u;
fn coordinate(i:u32)->vec3u{let n=camera.shape.xyz/EDGE;let k=i/(EDGE*EDGE*EDGE);let l=i%(EDGE*EDGE*EDGE);return vec3u(k%n.x,(k/n.x)%n.y,k/(n.x*n.y))*EDGE+vec3u(l%EDGE,(l/EDGE)%EDGE,l/(EDGE*EDGE));}
fn index(c:vec3u)->u32{let n=camera.shape.xyz/EDGE;let k=c/EDGE;let l=c%EDGE;return (k.x+n.x*(k.y+n.y*k.z))*EDGE*EDGE*EDGE+l.x+EDGE*(l.y+EDGE*l.z);}
fn linear(c:vec3u)->u32{return c.x+camera.shape.x*(c.y+camera.shape.y*c.z);}
`;
  const common=`struct Camera {eye:vec4f,right:vec4f,up:vec4f,forward:vec4f,projection:vec4f,shape:vec4u}
@group(0) @binding(0) var<storage,read> grid:array<u32>;
@group(0) @binding(1) var<storage,read_write> faces:array<u32>;
@group(0) @binding(2) var<storage,read_write> args:array<atomic<u32>>;
@group(0) @binding(3) var<uniform> camera:Camera;
@group(0) @binding(4) var<storage,read_write> dirty:array<atomic<u32>>;
@group(0) @binding(5) var<storage,read_write> rebuild:array<u32>;
${mapping}
@compute @workgroup_size(64) fn reset(@builtin(global_invocation_id) id:vec3u){
 let k=id.x;if(k>=${chunks}u){return;}let changed=atomicExchange(&dirty[k],0u);rebuild[k]=changed;
 if(changed!=0u){atomicStore(&args[k*4u],6u);atomicStore(&args[k*4u+1u],0u);atomicStore(&args[k*4u+2u],k*6u);atomicStore(&args[k*4u+3u],0u);}
}
@compute @workgroup_size(64) fn mesh(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=${count}u){return;}let k=i/(EDGE*EDGE*EDGE);if(rebuild[k]==0u){return;}
 let m=grid[i]&255u;if(m==0u){return;}let c=vec3i(coordinate(i));
 let normals=array<vec3i,6>(vec3i(-1,0,0),vec3i(1,0,0),vec3i(0,-1,0),vec3i(0,1,0),vec3i(0,0,-1),vec3i(0,0,1));
 for(var f=0u;f<6u;f++){let t=c+normals[f];var exposed=true;
  if(m!=9u&&all(t>=vec3i(0))&&all(t<vec3i(camera.shape.xyz))){let n=grid[index(vec3u(t))]&255u;exposed=n==0u||n==9u;}
  if(exposed){let slot=atomicAdd(&args[k*4u+1u],1u);faces[k*${capacity}u+slot]=i*6u+f;}
 }
}`;
  const drawCode=DRAW.replace('const colors=',mapping+'\nconst colors=')
    .replace('let face=faces[instance];','let face=faces[(vertex/6u)*'+capacity+'u+instance];')
    .replace('let c=vec3f(f32(i%shape.x),f32((i/shape.x)%shape.y),f32(i/(shape.x*shape.y)));','let c=vec3f(coordinate(i));')
    .replace('let uv=uvs[vertex];','let uv=uvs[vertex%6u];').replace('if(i==camera.shape.w)','if(linear(coordinate(i))==camera.shape.w)');
  async function module(code:string){const m=device.createShaderModule({code});const info=await m.getCompilationInfo();const errors=info.messages.filter(m=>m.type==='error');if(errors.length)throw new Error(errors.map(m=>`${m.lineNum}: ${m.message}`).join('\n'));return m;}
  const meshModule=await module(common),drawModule=await module(drawCode);
  const reset=await device.createComputePipelineAsync({layout:'auto',compute:{module:meshModule,entryPoint:'reset'}});
  const mesh=await device.createComputePipelineAsync({layout:'auto',compute:{module:meshModule,entryPoint:'mesh'}});
  const draw=await device.createRenderPipelineAsync({layout:'auto',vertex:{module:drawModule,entryPoint:'vertex'},fragment:{module:drawModule,entryPoint:'fragment',targets:[{format}]},primitive:{topology:'triangle-list'},depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less'}});
  const buffer=(size:number,usage:number)=>device.createBuffer({size,usage});
  const faces=buffer(count*24,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC),args=buffer(chunks*16,GPUBufferUsage.STORAGE|GPUBufferUsage.INDIRECT|GPUBufferUsage.COPY_SRC),rebuild=buffer(chunks*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC),uniform=buffer(96,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
  // Invalidation belongs to each cache. Restrict worlds to one terrain renderer.
  device.queue.writeBuffer(dirty,0,new Uint32Array(chunks).fill(1));
  const resetGroup=device.createBindGroup({layout:reset.getBindGroupLayout(0),entries:[{binding:2,resource:{buffer:args}},{binding:4,resource:{buffer:dirty}},{binding:5,resource:{buffer:rebuild}}]});
  const bindings=new Map<GPUBuffer,{mesh:GPUBindGroup;draw:GPUBindGroup}>();
  let depth:GPUTexture|undefined,width=0,height=0,closed=false;
  const renderer:TerrainRenderer={
    async render(camera:TerrainCamera){
      if(closed)throw new Error('Terrain renderer is closed.');
      const vectors=[camera.eye,camera.right,camera.up,camera.forward].map(a=>{if(!a||a.length!==3)throw new Error('Invalid terrain camera.');const v=[a[0],a[1],a[2]];if(!v.every(Number.isFinite))throw new Error('Invalid terrain camera.');return v;});
      if(camera.target!==undefined&&(!Number.isSafeInteger(camera.target)||camera.target<0||camera.target>=count))throw new Error('Invalid target.');
      if(canvas.width<1||canvas.height<1)throw new Error('Canvas must have positive dimensions.');
      if(!depth||width!==canvas.width||height!==canvas.height){depth?.destroy();width=canvas.width;height=canvas.height;depth=device.createTexture({size:[width,height],format:'depth24plus',usage:GPUTextureUsage.RENDER_ATTACHMENT});}
      const {grid}=state();let groups=bindings.get(grid);
      if(!groups){groups={mesh:device.createBindGroup({layout:mesh.getBindGroupLayout(0),entries:[grid,faces,args,uniform,dirty,rebuild].flatMap((buffer,binding)=>binding===4?[]:[{binding,resource:{buffer}}])}),draw:device.createBindGroup({layout:draw.getBindGroupLayout(0),entries:[grid,faces,uniform].map((buffer,binding)=>({binding,resource:{buffer}}))})};bindings.set(grid,groups);}
      const data=new ArrayBuffer(96),f=new Float32Array(data),u=new Uint32Array(data),near=.06,far=160,tan=Math.tan(Math.PI/6);
      f.set([...vectors[0],0,...vectors[1],0,...vectors[2],0,...vectors[3],0,tan*width/height,tan,far/(far-near),-near*far/(far-near)]);u.set([...shape,camera.target??0xffffffff],20);device.queue.writeBuffer(uniform,0,data);
      device.pushErrorScope('validation');const encoder=device.createCommandEncoder();
      const compute=encoder.beginComputePass();compute.setPipeline(reset);compute.setBindGroup(0,resetGroup);compute.dispatchWorkgroups(Math.ceil(chunks/64));compute.setPipeline(mesh);compute.setBindGroup(0,groups.mesh);compute.dispatchWorkgroups(Math.ceil(count/64));compute.end();
      const pass=encoder.beginRenderPass({colorAttachments:[{view:context.getCurrentTexture().createView(),clearValue:[.065,.10,.15,1],loadOp:'clear',storeOp:'store'}],depthStencilAttachment:{view:depth.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}});
      pass.setPipeline(draw);pass.setBindGroup(0,groups.draw);
      const n=shape.map(v=>v/edge),radius=Math.sqrt(3)*edge/2;
      for(let k=0;k<chunks;k++){
        const center=[k%n[0],Math.floor(k/n[0])%n[1],Math.floor(k/(n[0]*n[1]))].map((v,i)=>(v+.5)*edge-vectors[0][i]);
        const dot=(v:number[])=>center.reduce((s,c,i)=>s+c*v[i],0),z=dot(vectors[3]);
        // Sphere/frustum test, enlarged plane bounds remain conservative.
        if(z+radius<near||z-radius>far||Math.abs(dot(vectors[1]))>z*tan*width/height+radius*Math.hypot(1,tan*width/height)||Math.abs(dot(vectors[2]))>z*tan+radius*Math.hypot(1,tan))continue;
        pass.drawIndirect(args,k*16);
      }
      pass.end();device.queue.submit([encoder.finish()]);const results=await Promise.allSettled([device.popErrorScope(),device.queue.onSubmittedWorkDone()]);for(const r of results){if(r.status==='rejected')throw r.reason;if(r.value)throw new Error((r.value as GPUError).message);}
    },
    async inspectMesh(){
      if(closed)throw new Error('Terrain renderer is closed.');
      const bytes=chunks*20+count*24,read=buffer(bytes,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ),e=device.createCommandEncoder();
      e.copyBufferToBuffer(args,0,read,0,chunks*16);e.copyBufferToBuffer(rebuild,0,read,chunks*16,chunks*4);e.copyBufferToBuffer(faces,0,read,chunks*20,count*24);device.queue.submit([e.finish()]);
      try{await read.mapAsync(GPUMapMode.READ);const words=new Uint32Array(read.getMappedRange()),result:number[][]=[];
        for(let k=0;k<chunks;k++)result.push(Array.from(words.subarray(chunks*5+k*capacity,chunks*5+k*capacity+words[k*4+1])).sort((a,b)=>a-b));
        return{faces:result,rebuilt:Array.from(words.subarray(chunks*4,chunks*5))};
      }finally{if(read.mapState==='mapped')read.unmap();read.destroy();}
    },
    close(){if(closed)return;closed=true;depth?.destroy();faces.destroy();args.destroy();rebuild.destroy();uniform.destroy();context.unconfigure();bindings.clear();},
  };return renderer;
}
