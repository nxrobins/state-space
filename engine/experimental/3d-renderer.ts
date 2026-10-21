import { type LatencyProfiler } from './latency.js';
/// <reference types="@webgpu/types" />
import { MATERIALS_3D } from './3d.js';
import { type TerrainCamera, type TerrainRenderer } from './3d-view.js';
const palette = Array.from({ length: 18 }, (_, i) => {
  const m = MATERIALS_3D.find((m) => m.id === i);
  return `vec3f(${[1, 3, 5].map((k) => (m ? parseInt(m.color.slice(k, k + 2), 16) / 255 : 0)).join(',')})`;
}).join(',');
const COMMON = `
struct Camera { eye:vec4f, right:vec4f, up:vec4f, forward:vec4f, projection:vec4f, shape:vec4u }
const normals=array<vec3i,6>(vec3i(-1,0,0),vec3i(1,0,0),vec3i(0,-1,0),vec3i(0,1,0),vec3i(0,0,-1),vec3i(0,0,1));
`;
export const MESH =
  COMMON +
  `
@group(0) @binding(0) var<storage,read> grid:array<u32>;
@group(0) @binding(1) var<storage,read_write> faces:array<u32>;
struct Draw { vertices:u32, count:atomic<u32>, first:u32, instance:u32 }
@group(0) @binding(2) var<storage,read_write> args:Draw;
@group(0) @binding(3) var<uniform> camera:Camera;
@compute @workgroup_size(64) fn mesh(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;let shape=camera.shape.xyz;if(i>=shape.x*shape.y*shape.z){return;}
 let m=grid[i]&255u;if(m==0u){return;}
 let c=vec3i(vec3u(i%shape.x,(i/shape.x)%shape.y,i/(shape.x*shape.y)));
 for(var f=0u;f<6u;f++){
  let t=c+normals[f];var exposed=true;
  if(m!=9u&&all(t>=vec3i(0))&&all(t<vec3i(shape))){let n=grid[u32(t.x)+shape.x*(u32(t.y)+shape.y*u32(t.z))]&255u;exposed=n==0u||n==9u;}
  if(exposed){let slot=atomicAdd(&args.count,1u);faces[slot]=i*6u+f;}
 }
}`;
export const DRAW =
  COMMON +
  `
@group(0) @binding(0) var<storage,read> grid:array<u32>;
@group(0) @binding(1) var<storage,read> faces:array<u32>;
@group(0) @binding(2) var<uniform> camera:Camera;
const colors=array<vec3f,18>(${palette});
struct Out{@builtin(position) position:vec4f,@location(0) color:vec3f,@location(1) fog:f32,@location(2) uv:vec2f}
@vertex fn vertex(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->Out{
 let face=faces[instance];let i=face/6u;let f=face%6u;let shape=camera.shape.xyz;
 let c=vec3f(f32(i%shape.x),f32((i/shape.x)%shape.y),f32(i/(shape.x*shape.y)));
 let uvs=array<vec2f,6>(vec2f(0,0),vec2f(1,0),vec2f(1,1),vec2f(0,0),vec2f(1,1),vec2f(0,1));let uv=uvs[vertex];
 var local=vec3f(0);switch f{
 case 0u:{local=vec3f(0,uv.y,uv.x);}case 1u:{local=vec3f(1,uv.y,1-uv.x);}
 case 2u:{local=vec3f(uv.x,0,1-uv.y);}case 3u:{local=vec3f(uv.x,1,uv.y);}
 case 4u:{local=vec3f(1-uv.x,uv.y,0);}default:{local=vec3f(uv.x,uv.y,1);}}
 let v=grid[i];let m=v&255u;if(m==9u){local=vec3f(.39)+local*.22;}
 let p=c+local-camera.eye.xyz;let z=dot(p,camera.forward.xyz);
 var out:Out;out.position=vec4f(dot(p,camera.right.xyz)/camera.projection.x,dot(p,camera.up.xyz)/camera.projection.y,camera.projection.z*z+camera.projection.w,z);
 let light=.30+.70*max(0.,dot(vec3f(normals[f]),normalize(vec3f(.4,-.85,.3))));
 let heat=clamp((f32((v>>8u)&255u)-170.)/85.,0.,1.);
 var color=colors[m]*light+heat*vec3f(.3,.05,0);
 if(i==camera.shape.w){color=mix(color,vec3f(1,.7,.22),.38);}
 out.color=color;out.fog=clamp(z/90.,0.,.7);out.uv=uv;return out;
}
@fragment fn fragment(v:Out)->@location(0) vec4f{let edge=select(1.,.78,any(v.uv<vec2f(.02))||any(v.uv>vec2f(.98)));return vec4f(mix(v.color*edge,vec3f(.065,.10,.15),v.fog),1);}
`;

async function moduleFor(device: GPUDevice, code: string) {
  const module = device.createShaderModule({ code });
  const info = await module.getCompilationInfo();
  const errors = info.messages.filter((m) => m.type === 'error');
  if (errors.length) throw new Error(errors.map((m) => m.message).join('\n'));
  return module;
}
export async function makeTerrainRenderer(
  device: GPUDevice,
  canvas: HTMLCanvasElement,
  state: () => { grid: GPUBuffer; shape: number[] },
  profiler?: LatencyProfiler,
  tick: () => number = () => 0,
): Promise<TerrainRenderer> {
  const context = canvas.getContext('webgpu');
  if (!context) throw new Error('Cannot create WebGPU canvas.');
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });
  const meshModule = await moduleFor(device, MESH),
    drawModule = await moduleFor(device, DRAW);
  const mesh = await device.createComputePipelineAsync({
    layout: 'auto',
    compute: { module: meshModule, entryPoint: 'mesh' },
  });
  const draw = await device.createRenderPipelineAsync({
    layout: 'auto',
    vertex: { module: drawModule, entryPoint: 'vertex' },
    fragment: { module: drawModule, entryPoint: 'fragment', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
  });
  const count = state().shape.reduce((a, b) => a * b, 1);
  const faces = device.createBuffer({ size: count * 6 * 4, usage: GPUBufferUsage.STORAGE });
  const args = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
  });
  const uniform = device.createBuffer({
    size: 96,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  let depth: GPUTexture | undefined,
    width = 0,
    height = 0,
    closed = false;
  const data = new ArrayBuffer(96),
    f = new Float32Array(data),
    u = new Uint32Array(data),
    resetArgs = new Uint32Array([6, 0, 0, 0]);
  const bindings = new Map<GPUBuffer, { mesh: GPUBindGroup; draw: GPUBindGroup }>();
  return {
    async render(camera: TerrainCamera) {
      if (closed) throw new Error('Terrain renderer is closed.');
      const vectors = [camera.eye, camera.right, camera.up, camera.forward].map((a) => {
        if (!a || a.length !== 3) throw new Error('Invalid terrain camera.');
        const copy = [a[0], a[1], a[2]];
        if (!copy.every(Number.isFinite)) throw new Error('Invalid terrain camera.');
        return copy;
      });
      if (camera.target !== undefined) checkedTarget(camera.target, count);
      if (canvas.width < 1 || canvas.height < 1)
        throw new Error('Canvas must have positive dimensions.');
      const trace = profiler?.begin('render', tick());
      if (!depth || width !== canvas.width || height !== canvas.height) {
        depth?.destroy();
        width = canvas.width;
        height = canvas.height;
        depth = device.createTexture({
          size: [width, height],
          format: 'depth24plus',
          usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
      }
      const { grid, shape } = state();
      let groups = bindings.get(grid);
      if (!groups) {
        groups = {
          mesh: device.createBindGroup({
            layout: mesh.getBindGroupLayout(0),
            entries: [grid, faces, args, uniform].map((buffer, binding) => ({
              binding,
              resource: { buffer },
            })),
          }),
          draw: device.createBindGroup({
            layout: draw.getBindGroupLayout(0),
            entries: [grid, faces, uniform].map((buffer, binding) => ({
              binding,
              resource: { buffer },
            })),
          }),
        };
        bindings.set(grid, groups);
      }
      const near = 0.06,
        far = 160,
        tan = Math.tan(Math.PI / 6);
      f.set([
        ...vectors[0],
        0,
        ...vectors[1],
        0,
        ...vectors[2],
        0,
        ...vectors[3],
        0,
        (tan * width) / height,
        tan,
        far / (far - near),
        (-near * far) / (far - near),
      ]);
      u.set([...shape, camera.target ?? 0xffffffff], 20);
      device.queue.writeBuffer(uniform, 0, data);
      device.queue.writeBuffer(args, 0, resetArgs);
      profiler?.mark(trace, 'preparedAt');
      device.pushErrorScope('validation');
      const encoder = device.createCommandEncoder();
      const compute = encoder.beginComputePass(profiler?.pass(trace, 'mesh'));
      compute.setPipeline(mesh);
      compute.setBindGroup(0, groups.mesh);
      compute.dispatchWorkgroups(Math.ceil(count / 64));
      compute.end();
      const pass = encoder.beginRenderPass({
        ...profiler?.pass(trace, 'draw'),
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            clearValue: [0.065, 0.1, 0.15, 1],
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
        depthStencilAttachment: {
          view: depth.createView(),
          depthClearValue: 1,
          depthLoadOp: 'clear',
          depthStoreOp: 'store',
        },
      });
      pass.setPipeline(draw);
      pass.setBindGroup(0, groups.draw);
      pass.drawIndirect(args, 0);
      pass.end();
      profiler?.resolve(encoder, trace);
      profiler?.mark(trace, 'encodedAt');
      device.queue.submit([encoder.finish()]);
      profiler?.submitted(trace);
      const [error] = await Promise.all([
        device.popErrorScope(),
        device.queue.onSubmittedWorkDone().then(() => profiler?.mark(trace, 'queueCompletedAt')),
      ]);
      if (error) throw new Error(error.message);
      profiler?.mark(trace, 'completedAt');
    },
    close() {
      if (closed) return;
      closed = true;
      depth?.destroy();
      faces.destroy();
      args.destroy();
      uniform.destroy();
      context.unconfigure();
      bindings.clear();
    },
  };
}
function checkedTarget(target: number, count: number) {
  if (!Number.isSafeInteger(target) || target < 0 || target >= count)
    throw new Error('Invalid highlighted cell.');
}
