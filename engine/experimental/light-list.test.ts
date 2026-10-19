import {afterEach,expect,test,vi} from 'vitest';
import {makeLightList} from './light-list.js';

afterEach(()=>vi.unstubAllGlobals());
function fixture(){
 vi.stubGlobal('GPUBufferUsage',{STORAGE:128,COPY_SRC:4});
 const buffer={destroy:vi.fn()},pipeline={getBindGroupLayout:vi.fn(()=>({}))},group={};
 const device={
  createShaderModule:vi.fn(()=>({getCompilationInfo:async()=>({messages:[]})})),
  createComputePipelineAsync:vi.fn(async()=>pipeline),createBuffer:vi.fn(()=>buffer),createBindGroup:vi.fn(()=>group),
 };
 const pass={setPipeline:vi.fn(),setBindGroup:vi.fn(),dispatchWorkgroups:vi.fn()};
 return{device,buffer,pipeline,group,pass,make:(chunks=512)=>makeLightList(device as unknown as GPUDevice,{} as GPUBuffer,chunks)};
}

test.each([0,-1,513,1.5,NaN,Infinity])('rejects invalid light capacity %s before creating GPU resources',async chunks=>{
 const f=fixture();await expect(f.make(chunks)).rejects.toThrow('capacity');expect(f.device.createShaderModule).not.toHaveBeenCalled();expect(f.device.createBuffer).not.toHaveBeenCalled();
});
test('encodes repeated updates in the caller pass and closes exactly once',async()=>{
 const f=fixture(),list=await f.make();
 expect(f.device.createBuffer).toHaveBeenCalledWith({size:2052,usage:132});
 list.encode(f.pass as unknown as GPUComputePassEncoder);list.encode(f.pass as unknown as GPUComputePassEncoder);
 expect(f.pass.setPipeline).toHaveBeenCalledWith(f.pipeline);expect(f.pass.setBindGroup).toHaveBeenCalledWith(0,f.group);
 expect(f.pass.dispatchWorkgroups.mock.calls).toEqual([[1],[1]]);
 list.close();list.close();expect(f.buffer.destroy).toHaveBeenCalledTimes(1);
 expect(()=>list.encode(f.pass as unknown as GPUComputePassEncoder)).toThrow('closed');expect(f.pass.dispatchWorkgroups).toHaveBeenCalledTimes(2);
});
test('releases the list if bind-group creation fails',async()=>{
 const f=fixture();f.device.createBindGroup.mockImplementation(()=>{throw Error('injected binding failure');});
 await expect(f.make()).rejects.toThrow('injected binding failure');expect(f.buffer.destroy).toHaveBeenCalledTimes(1);
});
test('propagates pipeline compilation failure before allocating a list',async()=>{
 const f=fixture();f.device.createComputePipelineAsync.mockRejectedValueOnce(Error('injected compilation failure'));
 await expect(f.make()).rejects.toThrow('injected compilation failure');expect(f.device.createBuffer).not.toHaveBeenCalled();
});
