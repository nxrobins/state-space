/// <reference types="@webgpu/types" />
/** Internal small GPU probes; not a public runtime option. */
import {makeLightList,LIGHT_LIST_QUERIES} from './light-list.js';
import {CpuStructuralWorld3D} from './structural-world-core.js';
import {createStateSpaceStructuralWorld3DGPU} from './structural-world-gpu.js';
import {MAT} from '../generated/materials.js';

export async function verifyLightList(){
 const adapter=await navigator.gpu.requestAdapter();if(!adapter||adapter.info.isFallbackAdapter)throw Error('Hardware GPU required');
 const device=await adapter.requestDevice(),chunks=512,bytes=(chunks+1)*4;
 const lights=device.createBuffer({size:chunks*32,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
 const read=device.createBuffer({size:bytes,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
 const list=await makeLightList(device,lights,chunks),cases:number[]=[];
 device.pushErrorScope('validation');
 try{
  for(const selected of [[],[0,511],[7,32,255,510],Array.from({length:512},(_,i)=>i),[],[511]]){
   const values=new Float32Array(chunks*8);for(const k of selected){values[k*8+3]=1;values[k*8+4]=k+1;}
   device.queue.writeBuffer(lights,0,values);
   const encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();list.encode(pass);pass.end();
   encoder.copyBufferToBuffer(list.buffer,0,read,0,bytes);device.queue.submit([encoder.finish()]);
   await read.mapAsync(GPUMapMode.READ);const words=new Uint32Array(read.getMappedRange()).slice();read.unmap();
   if(words[0]!==selected.length||selected.some((k,i)=>words[i+1]!==k))throw Error('Light worklist differs from ordered nonempty sources');
   cases.push(selected.length);
  }
  await device.queue.onSubmittedWorkDone();const error=await device.popErrorScope();if(error)throw Error(error.message);
  return{passed:true,capacity:chunks,sourceCounts:cases,ordered:true,emptyAfterFull:true};
 }finally{list.close();lights.destroy();read.destroy();device.destroy();}
}

export async function verifyLightImages(){
 const cpu=new CpuStructuralWorld3D({width:16,height:16,depth:16,chunkSize:4});
 for(let z=0;z<16;z++)for(let x=0;x<16;x++)cpu.setCell(x,12,z,MAT.STONE,0);
 for(let z=6;z<12;z++)for(let x=5;x<10;x++)cpu.setCell(x,11,z,MAT.WATER,25);
 for(let y=7;y<11;y++)for(let x=2;x<5;x++)cpu.setCell(x,y,10,MAT.ICE,0);
 for(let y=6;y<10;y++)cpu.setCell(11,y,9,MAT.GLASS,0);
 for(const x of [3,12]){cpu.setCell(x,11,7,MAT.LAVA,255);cpu.setEnergy(x,11,7,1000*256);}
 const initial=cpu.snapshot(),images=new Map<string,Uint8Array>(),results=[];
 const original=GPUDevice.prototype.createShaderModule;let baselineModules=0;
 const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;document.body.append(canvas);
 // Read the actual final render target, independent of compositor discard timing.
 // This owned test canvas uses a persistent output texture with identical format.
 const context=canvas.getContext('webgpu')!,configure=context.configure.bind(context);
 let output:GPUTexture|undefined,device:GPUDevice|undefined;
 context.configure=(configuration)=>{
  configure(configuration);output?.destroy();device=configuration.device;
  output=device.createTexture({size:[canvas.width,canvas.height],format:configuration.format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
 };
 context.getCurrentTexture=()=>output!;
 const capture=async()=>{
  const bytesPerRow=canvas.width*4,read=device!.createBuffer({size:bytesPerRow*canvas.height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  try{
   const encoder=device!.createCommandEncoder();encoder.copyTextureToBuffer({texture:output!},{buffer:read,bytesPerRow},[canvas.width,canvas.height]);device!.queue.submit([encoder.finish()]);
   await read.mapAsync(GPUMapMode.READ);return new Uint8Array(read.getMappedRange()).slice();
  }finally{if(read.mapState==='mapped')read.unmap();read.destroy();}
 };
 try{
  for(const baseline of [true,false]){
   if(baseline)GPUDevice.prototype.createShaderModule=function(descriptor:GPUShaderModuleDescriptor){
    let code=descriptor.code;
    if(code.includes(LIGHT_LIST_QUERIES)){
     // Exercise the previous complete source enumeration with the same compiled
     // shading functions. The impossible live condition keeps binding 11 valid.
     code=code.replace(LIGHT_LIST_QUERIES,LIGHT_LIST_QUERIES
      .replace('return lightList[0];','return select(CHUNKS,lightList[0],lightList[0]>CHUNKS);')
      .replace('return lightList[1u+slot];','return select(slot,lightList[1u+slot],lightList[0]>CHUNKS);'));
     baselineModules++;
    }
    return original.call(this,{...descriptor,code});
   };
   const gpu=await createStateSpaceStructuralWorld3DGPU({width:16,height:16,depth:16,chunkSize:4,mode:'active'});let renderer;
   try{
    await gpu.restore(initial);renderer=await gpu.createRenderer(canvas);await renderer.setAppearance!('naturalistic');
    for(const mode of ['reference','cached'] as const){
     await gpu.restore(initial);await renderer.setLightingMode!(mode);
     for(const state of ['hot','cooled','moved']){
      if(state==='cooled')await gpu.edit([{kind:'energy',x:3,y:11,z:7,energyQ:0}]);
      if(state==='moved')await gpu.edit([{kind:'material',x:12,y:11,z:7,material:MAT.AIR,thermal:0},{kind:'material',x:8,y:10,z:9,material:MAT.LAVA,thermal:255},{kind:'energy',x:8,y:10,z:9,energyQ:1000*256}]);
      await renderer.render({eye:[8,8,-2],forward:[0,0,1],right:[1,0,0],up:[0,-1,0]});
      const pixels=await capture(),key=mode+'/'+state;
      if(new Set(pixels.filter((_,i)=>i%4!==3)).size<32)throw Error('Image comparison captured a blank or unrendered frame');
      if(baseline)images.set(key,pixels);
      else{
       const before=images.get(key)!;let changed=0,maxDelta=0;
       for(let i=0;i<pixels.length;i++){const delta=Math.abs(pixels[i]-before[i]);if(delta)changed++;maxDelta=Math.max(maxDelta,delta);}
       if(changed)throw Error(`Compact lighting changed ${key}: ${changed} channels, max ${maxDelta}`);
       results.push({mode,state,channels:pixels.length,changed,maxDelta});
      }
      if(gpu.tick!==0||(await gpu.energyBalance()).driftQ!==0n)throw Error('Presentation changed physical state');
     }
    }
   }finally{renderer?.close();gpu.close();GPUDevice.prototype.createShaderModule=original;}
  }
  if(baselineModules!==4)throw Error('Image baseline did not cover both lighting modes and shader families');
  return{passed:true,resolution:[320,180],baselineModules,comparisons:results};
 }finally{GPUDevice.prototype.createShaderModule=original;output?.destroy();canvas.remove();}
}
