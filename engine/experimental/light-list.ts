/// <reference types="@webgpu/types" />
/** Exact presentation worklist. Keep source order and omit only absent emitters. */
export const LIGHT_LIST_QUERIES = `
@group(0) @binding(11) var<storage,read> lightList:array<u32>;
fn allLightCount()->u32{return lightList[0];}
fn allLightSource(slot:u32)->u32{return lightList[1u+slot];}
`;

export function lightListShader(chunks:number){
  if(!Number.isSafeInteger(chunks)||chunks<1||chunks>512)throw Error('Invalid light-list capacity.');
  return `
struct Light {position:vec4f,color:vec4f}
@group(0) @binding(3) var<storage,read> lights:array<Light>;
@group(0) @binding(11) var<storage,read_write> lightList:array<u32>;
@compute @workgroup_size(1) fn collectLights(){
 var count=0u;
 // Ascending source order preserves floating-point accumulation and fog ties.
 // Rebuild after each extraction, including temperature-only emitter changes.
 for(var k=0u;k<${chunks}u;k++){
  if(lights[k].position.w!=0.){lightList[1u+count]=k;count++;}
 }
 lightList[0]=count;
}`;
}

export async function makeLightList(device:GPUDevice,lights:GPUBuffer,chunks:number){
  const module=device.createShaderModule({code:lightListShader(chunks)});
  const errors=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error');
  if(errors.length)throw Error(errors.map(m=>`${m.lineNum}: ${m.message}`).join('\n'));
  const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'collectLights'}});
  const buffer=device.createBuffer({size:(chunks+1)*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
  try{
    const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:3,resource:{buffer:lights}},{binding:11,resource:{buffer}}]});
    let closed=false;
    return{buffer,
      encode(pass:GPUComputePassEncoder){if(closed)throw Error('Light list is closed.');pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(1);},
      close(){if(closed)return;closed=true;buffer.destroy();},
    };
  }catch(error){buffer.destroy();throw error;}
}
