/** Oriented multiphysics renderer. One submit and completion per frame; caller owns the device. */
import { TACTICAL_CAMERA_WGSL_3D } from 'state-space-engine/experimental/3d/tactical-renderer';
import {
  INSTANCE_FLOATS,
  MAX_INSTANCES,
  type BuilderScene,
  type BuilderCamera,
} from './presentation.js';
const SHADER =
  TACTICAL_CAMERA_WGSL_3D +
  `
struct Instance { center:vec4f, rotation:vec4f, half:vec4f, color:vec4f }
@group(1) @binding(0) var<storage,read> instances:array<Instance>;
struct Out {
 @builtin(position) position:vec4f,
 @location(0) color:vec4f,
 @location(1) uv:vec2f,
 @location(2) @interpolate(flat) shape:u32,
 @location(3) normal:vec3f,
}
fn rotate(q:vec4f,v:vec3f)->vec3f { let t=2.*cross(q.xyz,v); return v+q.w*t+cross(q.xyz,t); }
@vertex fn vertex(@builtin(vertex_index) vertex:u32,@builtin(instance_index) index:u32)->Out {
 let item=instances[index];var out:Out;out.color=item.color;out.shape=u32(item.center.w);
 let uvs=array<vec2f,6>(vec2f(0,0),vec2f(1,0),vec2f(1,1),vec2f(0,0),vec2f(1,1),vec2f(0,1));
 let uv=uvs[vertex%6u];out.uv=uv;
 if(out.shape==1u){
  // Camera-facing disc at the sample's radius; faces after the first collapse to nothing.
  if(vertex>=6u){out.position=vec4f(0,0,2,1);out.normal=vec3f(0,0,1);return out;}
  let r=item.half.x;let corner=(uv*2.-1.)*r;
  out.position=projectWorld(item.center.xyz+camera.right.xyz*corner.x+camera.up.xyz*corner.y);
  out.normal=-camera.forward.xyz;return out;
 }
 let f=vertex/6u;var local=vec3f(0);var normal=vec3f(0);
 switch f {
  case 0u:{local=vec3f(-1,uv.y*2.-1.,uv.x*2.-1.);normal=vec3f(-1,0,0);}
  case 1u:{local=vec3f(1,uv.y*2.-1.,1.-uv.x*2.);normal=vec3f(1,0,0);}
  case 2u:{local=vec3f(uv.x*2.-1.,-1,1.-uv.y*2.);normal=vec3f(0,-1,0);}
  case 3u:{local=vec3f(uv.x*2.-1.,1,uv.y*2.-1.);normal=vec3f(0,1,0);}
  case 4u:{local=vec3f(1.-uv.x*2.,uv.y*2.-1.,-1);normal=vec3f(0,0,-1);}
  default:{local=vec3f(uv.x*2.-1.,uv.y*2.-1.,1);normal=vec3f(0,0,1);}
 }
 out.position=projectWorld(item.center.xyz+rotate(item.rotation,local*item.half.xyz));
 out.normal=rotate(item.rotation,normal);return out;
}
@fragment fn fragment(v:Out)->@location(0) vec4f {
 let light=normalize(vec3f(.45,.8,.35));
 if(v.shape==1u){
  let p=v.uv*2.-1.;let d=dot(p,p);if(d>1.){discard;}
  let shade=.45+.55*sqrt(1.-d);return vec4f(v.color.rgb*shade*v.color.a,1.);
 }
 let shade=.42+.58*max(dot(normalize(v.normal),light),0.);
 let edge=min(min(v.uv.x,1.-v.uv.x),min(v.uv.y,1.-v.uv.y));
 let outline=select(1.,.62,edge<.03);
 return vec4f(v.color.rgb*shade*outline,1.);
}
`;
export async function createBuilderRenderer(device: GPUDevice, format: GPUTextureFormat) {
  const owned: GPUBuffer[] = [],
    buffer = (size: number, usage: GPUBufferUsageFlags) => {
      const b = device.createBuffer({ size, usage });
      owned.push(b);
      return b;
    };
  let flight: Promise<string> | null = null,
    closed = false,
    closing: Promise<void> | null = null,
    failure: string | null = null,
    uploaded: string | null = null,
    frames = 0,
    worstFrameMs = 0,
    setupScope = true;
  const timings: number[] = [];
  device.pushErrorScope('validation');
  try {
    const module = device.createShaderModule({ code: SHADER }),
      info = await module.getCompilationInfo();
    if (info.messages.some((m) => m.type === 'error'))
      throw Error(info.messages.map((m) => m.message).join('\n'));
    const cameraLayout = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }],
    });
    const instanceLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      ],
    });
    const pipeline = await device.createRenderPipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: [cameraLayout, instanceLayout] }),
      vertex: { module, entryPoint: 'vertex' },
      fragment: { module, entryPoint: 'fragment', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' },
    });
    const uniform = buffer(96, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST),
      instances = buffer(
        MAX_INSTANCES * INSTANCE_FLOATS * 4,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      );
    const cameraBind = device.createBindGroup({
        layout: cameraLayout,
        entries: [{ binding: 0, resource: { buffer: uniform } }],
      }),
      instanceBind = device.createBindGroup({
        layout: instanceLayout,
        entries: [{ binding: 0, resource: { buffer: instances } }],
      });
    setupScope = false;
    const error = await device.popErrorScope();
    if (error) throw Error(error.message);
    void device.lost.then((lost) => {
      if (!closed) failure = `Device lost: ${lost.message}`;
    });
    return {
      /** Completed-frame durations (encode through GPU completion), most recent 512. */
      get timings() {
        return [...timings];
      },
      get worstFrameMs() {
        return worstFrameMs;
      },
      get frameCount() {
        return frames;
      },
      resetTimings() {
        timings.length = 0;
        worstFrameMs = 0;
      },
      async render(
        scene: BuilderScene,
        camera: BuilderCamera,
        color: GPUTexture,
        depth: GPUTexture,
      ): Promise<string> {
        if (closed || closing || flight || failure)
          throw Error(failure ?? 'Renderer unavailable or a frame is already outstanding.');
        if (
          scene.count > MAX_INSTANCES ||
          color.width !== depth.width ||
          color.height !== depth.height ||
          color.format !== format ||
          depth.format !== 'depth32float'
        )
          throw Error('Invalid builder render targets.');
        const start = performance.now(),
          bytes = new ArrayBuffer(96),
          tan = Math.tan(camera.fovY / 2);
        new Float32Array(bytes).set([
          ...camera.eye,
          0,
          ...camera.right,
          0,
          ...camera.up,
          0,
          ...camera.forward,
          0,
          (tan * color.width) / color.height,
          tan,
          camera.far / (camera.far - camera.near),
          (-camera.near * camera.far) / (camera.far - camera.near),
        ]);
        const work = Promise.resolve().then(async () => {
          device.pushErrorScope('validation');
          let error: unknown;
          try {
            device.queue.writeBuffer(uniform, 0, bytes);
            if (uploaded !== scene.identity && scene.count)
              device.queue.writeBuffer(instances, 0, scene.instances);
            const encoder = device.createCommandEncoder(),
              pass = encoder.beginRenderPass({
                colorAttachments: [
                  {
                    view: color.createView(),
                    clearValue: [0.035, 0.05, 0.075, 1],
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
            pass.setPipeline(pipeline);
            pass.setBindGroup(0, cameraBind);
            pass.setBindGroup(1, instanceBind);
            if (scene.count) pass.draw(36, scene.count);
            pass.end();
            device.queue.submit([encoder.finish()]);
          } catch (e) {
            error = e;
          }
          const results = await Promise.allSettled([
            device.popErrorScope(),
            device.queue.onSubmittedWorkDone(),
          ]);
          for (const result of results)
            if (result.status === 'rejected') error ??= result.reason;
            else if (result.value) error ??= Error(result.value.message);
          if (failure) error ??= Error(failure);
          if (error) {
            failure = error instanceof Error ? error.message : 'Render failed.';
            throw Error(failure);
          }
          uploaded = scene.identity;
          frames++;
          const elapsed = performance.now() - start;
          worstFrameMs = Math.max(worstFrameMs, elapsed);
          timings.push(elapsed);
          if (timings.length > 512) timings.shift();
          return scene.identity;
        });
        flight = work;
        try {
          return await work;
        } finally {
          flight = null;
        }
      },
      close() {
        closing ??= (async () => {
          try {
            await flight;
          } catch {
            /* render drained its submission */
          } finally {
            closed = true;
            for (const b of owned) b.destroy();
          }
        })();
        return closing;
      },
    };
  } catch (error) {
    if (setupScope) await device.popErrorScope().catch(() => {});
    for (const b of owned) b.destroy();
    throw error;
  }
}
export type BuilderRenderer = Awaited<ReturnType<typeof createBuilderRenderer>>;
