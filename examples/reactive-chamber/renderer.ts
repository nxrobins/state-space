/// <reference types="@webgpu/types" />
/** Bounded reactive box renderer. One submit/completion per frame; caller owns the device. */
import { TACTICAL_CAMERA_WGSL_3D } from 'state-space-engine/experimental/3d/tactical-renderer';
import { sceneData, type ChamberScene, type ChamberCamera } from './presentation.js';
const SHADER =
  TACTICAL_CAMERA_WGSL_3D +
  `
struct Box { minimum:vec4f, size:vec4f, color:vec4f }
@group(1) @binding(0) var<storage,read> boxes:array<Box>;
struct Out { @builtin(position) position:vec4f, @location(0) color:vec4f, @location(1) uv:vec2f }
@vertex fn vertex(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->Out {
 let f=vertex/6u;let uvs=array<vec2f,6>(vec2f(0,0),vec2f(1,0),vec2f(1,1),vec2f(0,0),vec2f(1,1),vec2f(0,1));let uv=uvs[vertex%6u];
 var local=vec3f(0);switch f {
 case 0u:{local=vec3f(0,uv.y,uv.x);}case 1u:{local=vec3f(1,uv.y,1-uv.x);}
 case 2u:{local=vec3f(uv.x,0,1-uv.y);}case 3u:{local=vec3f(uv.x,1,uv.y);}
 case 4u:{local=vec3f(1-uv.x,uv.y,0);}default:{local=vec3f(uv.x,uv.y,1);}}
 let shades=array<f32,6>(.68,.82,1.,.55,.72,.88);let box=boxes[instance];var out:Out;
 out.position=projectWorld(box.minimum.xyz+local*box.size.xyz);out.color=vec4f(box.color.rgb*shades[f],1.);out.uv=uv;return out;
}
@fragment fn solid(v:Out)->@location(0) vec4f {return v.color;}
@fragment fn outline(v:Out)->@location(0) vec4f {if(all(v.uv>vec2f(.025))&&all(v.uv<vec2f(.975))){discard;}return vec4f(1.,.78,.3,1.);}
`;
export async function createChamberRenderer(device: GPUDevice, format: GPUTextureFormat) {
  const owned: GPUBuffer[] = [],
    buffer = (size: number, usage: GPUBufferUsageFlags) => {
      const b = device.createBuffer({ size, usage });
      owned.push(b);
      return b;
    };
  let flight: Promise<string> | null = null,
    closed = false,
    closing: Promise<void> | null = null,
    failure: string | null = null;
  let cached: ChamberScene | null = null,
    frames = 0,
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
    const boxesLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      ],
    });
    const layout = device.createPipelineLayout({ bindGroupLayouts: [cameraLayout, boxesLayout] });
    const pipeline = (entryPoint: string, overlay: boolean) =>
      device.createRenderPipelineAsync({
        layout,
        vertex: { module, entryPoint: 'vertex' },
        fragment: { module, entryPoint, targets: [{ format }] },
        primitive: { topology: 'triangle-list' },
        depthStencil: {
          format: 'depth32float',
          depthWriteEnabled: !overlay,
          depthCompare: overlay ? 'less-equal' : 'less',
        },
      });
    const solid = await pipeline('solid', false),
      outline = await pipeline('outline', true);
    const uniform = buffer(96, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST),
      boxes = buffer(513 * 48, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST),
      selection = buffer(48, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    const bind = (layout: GPUBindGroupLayout, resource: GPUBuffer) =>
      device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: resource } }] });
    const cameraBind = bind(cameraLayout, uniform),
      boxBind = bind(boxesLayout, boxes),
      selectionBind = bind(boxesLayout, selection);
    setupScope = false;
    const error = await device.popErrorScope();
    if (error) throw Error(error.message);
    void device.lost.then((info) => {
      if (!closed) failure = `Device lost: ${info.message}`;
    });
    return {
      get timings() {
        return [...timings];
      },
      get frameCount() {
        return frames;
      },
      get state() {
        return closed
          ? 'closed'
          : closing
            ? 'closing'
            : failure
              ? 'failed'
              : flight
                ? 'working'
                : 'ready';
      },
      async render(
        scene: ChamberScene,
        camera: ChamberCamera,
        color: GPUTexture,
        depth: GPUTexture,
      ): Promise<string> {
        if (closed || closing || flight || failure)
          throw Error(failure ?? 'Renderer unavailable or a frame is already outstanding.');
        const data = sceneData(scene);
        if (
          scene.count > 513 ||
          color.width !== depth.width ||
          color.height !== depth.height ||
          color.format !== format ||
          depth.format !== 'depth32float' ||
          color.width < 1 ||
          color.height < 1 ||
          color.width > 1600 ||
          color.height > 900
        )
          throw Error('Invalid chamber render targets.');
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
        new Uint32Array(bytes).set([8, 8, 8, 0xffffffff], 20);
        const work = Promise.resolve().then(async () => {
          device.pushErrorScope('validation');
          let error: unknown;
          try {
            device.queue.writeBuffer(uniform, 0, bytes);
            if (cached !== scene) {
              device.queue.writeBuffer(boxes, 0, data.boxes);
              if (scene.selected) device.queue.writeBuffer(selection, 0, data.selection);
            }
            const encoder = device.createCommandEncoder(),
              pass = encoder.beginRenderPass({
                colorAttachments: [
                  {
                    view: color.createView(),
                    clearValue: [0.035, 0.055, 0.08, 1],
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
            pass.setPipeline(solid);
            pass.setBindGroup(0, cameraBind);
            pass.setBindGroup(1, boxBind);
            pass.draw(36, scene.count);
            if (scene.selected) {
              pass.setPipeline(outline);
              pass.setBindGroup(1, selectionBind);
              pass.draw(36, 1);
            }
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
          cached = scene;
          frames++;
          timings.push(performance.now() - start);
          if (timings.length > 256) timings.shift();
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
            cached = null;
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
export type ChamberRenderer = Awaited<ReturnType<typeof createChamberRenderer>>;
