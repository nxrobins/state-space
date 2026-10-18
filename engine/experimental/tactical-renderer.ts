/// <reference types="@webgpu/types" />
import { cameraData, copyStamp, sceneData, TACTICAL_RENDER_LIMITS_3D, type TacticalCamera3D, type TacticalScene3D } from './tactical-presentation.js';
import { TACTICAL_MESH, TACTICAL_TERRAIN, TACTICAL_BOXES } from './tactical-render-shaders.js';
import type { GeometryStamp3D } from './gameplay-geometry.js';
import { fields } from './tactical-worker-wire.js';
export { prepareTacticalScene3D, projectTacticalPoint3D, TACTICAL_RENDER_CONTRACT_3D, TACTICAL_RENDER_LIMITS_3D, TACTICAL_RENDER_COORDINATES_3D } from './tactical-presentation.js';
export type { TacticalScene3D, TacticalCamera3D, TacticalDecoration3D, TacticalDecorations3D } from './tactical-presentation.js';
export { TACTICAL_CAMERA_WGSL_3D } from './tactical-render-shaders.js';

export type TacticalRenderOptions3D = {colorFormat: 'rgba8unorm' | 'bgra8unorm' | 'rgba16float'; depthFormat: 'depth24plus' | 'depth32float'};
export type TacticalRenderTargets3D = {color: GPUTexture; depth: GPUTexture};
export type TacticalDrawContext3D = {
  /** Synchronous borrowed pass. Do not end it, submit work, or retain it. */
  pass: GPURenderPassEncoder; camera: GPUBindGroup; cameraLayout: GPUBindGroupLayout;
  stamp: Readonly<GeometryStamp3D>; width: number; height: number;
};
export type TacticalRenderState3D = {status: 'ready' | 'working' | 'failed' | 'closing' | 'closed'; error: string | null; lastCompleted: Readonly<GeometryStamp3D> | null};
export interface TacticalRenderer3D {
  readonly cameraLayout: GPUBindGroupLayout;
  readonly formats: Readonly<TacticalRenderOptions3D>;
  state(): TacticalRenderState3D;
  /** One submit and completion boundary. Rejects overlap rather than queueing frames. */
  render(scene: TacticalScene3D, camera: TacticalCamera3D, targets: TacticalRenderTargets3D, draw?: (context: TacticalDrawContext3D) => void): Promise<Readonly<GeometryStamp3D>>;
  close(): Promise<void>;
}
const message = (e: unknown) => e instanceof Error ? e.message : 'Tactical rendering failed.';
type Cache = {count: number; grid: GPUBuffer; faces: GPUBuffer; args: GPUBuffer; mesh: GPUBindGroup; terrain: GPUBindGroup};
/** Caller owns device/targets. No adapter acquisition, canvas, loop, readback or simulation. */
export async function createTacticalRenderer3D(device: GPUDevice, options: TacticalRenderOptions3D): Promise<TacticalRenderer3D> {
  fields(options, ['colorFormat', 'depthFormat']);
  if (!['rgba8unorm', 'bgra8unorm', 'rgba16float'].includes(options.colorFormat) || !['depth24plus', 'depth32float'].includes(options.depthFormat)) throw Error('Unsupported tactical target format.');
  const formats = Object.freeze({...options}), owned = new Set<GPUBuffer>();
  const allocate = (label: string, size: number, usage: GPUBufferUsageFlags) => {
    if (size > device.limits.maxBufferSize || usage & GPUBufferUsage.STORAGE && size > device.limits.maxStorageBufferBindingSize) throw Error('Tactical buffer exceeds device limits.');
    const buffer = device.createBuffer({label, size, usage}); owned.add(buffer); return buffer;
  };
  const destroy = (buffer: GPUBuffer) => {buffer.destroy(); owned.delete(buffer);};
  let scope = false;
  try {
    device.pushErrorScope('validation'); scope = true;
    const module = async (code: string) => {
      const shader = device.createShaderModule({code}), info = await shader.getCompilationInfo();
      const errors = info.messages.filter(m => m.type === 'error'); if (errors.length) throw Error(errors.map(e => e.message).join('\n')); return shader;
    };
    const meshModule = await module(TACTICAL_MESH), terrainModule = await module(TACTICAL_TERRAIN), boxModule = await module(TACTICAL_BOXES);
    const cameraLayout = device.createBindGroupLayout({entries: [{binding: 0, visibility: GPUShaderStage.VERTEX, buffer: {type: 'uniform', minBindingSize: 96}}]});
    const terrainLayout = device.createBindGroupLayout({entries: [0, 1].map(binding => ({binding, visibility: GPUShaderStage.VERTEX, buffer: {type: 'read-only-storage' as const}}))});
    const boxLayout = device.createBindGroupLayout({entries: [{binding: 0, visibility: GPUShaderStage.VERTEX, buffer: {type: 'read-only-storage', minBindingSize: 48}}]});
    const mesh = await device.createComputePipelineAsync({layout: 'auto', compute: {module: meshModule, entryPoint: 'mesh'}});
    const pipeline = (label: string, shader: GPUShaderModule, layout: GPUBindGroupLayout, fragment: string, overlay = false) => device.createRenderPipelineAsync({
      label, layout: device.createPipelineLayout({bindGroupLayouts: [cameraLayout, layout]}), vertex: {module: shader, entryPoint: 'vertex'},
      fragment: {module: shader, entryPoint: fragment, targets: [{format: formats.colorFormat, ...(overlay ? {blend: {color: {srcFactor: 'src-alpha' as const, dstFactor: 'one-minus-src-alpha' as const}, alpha: {srcFactor: 'one' as const, dstFactor: 'one-minus-src-alpha' as const}}} : {})}]},
      primitive: {topology: 'triangle-list'}, depthStencil: {format: formats.depthFormat, depthWriteEnabled: !overlay, depthCompare: overlay ? 'less-equal' : 'less'}, multisample: {count: 1},
    });
    const terrainPipeline = await pipeline('tactical terrain', terrainModule, terrainLayout, 'fragment');
    const actorPipeline = await pipeline('tactical actors', boxModule, boxLayout, 'actor');
    const overlayPipeline = await pipeline('tactical overlays', boxModule, boxLayout, 'overlay', true);
    const uniform = allocate('tactical camera', 96, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    const actors = allocate('tactical actors', TACTICAL_RENDER_LIMITS_3D.actors * 48, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    const overlays = allocate('tactical overlays', TACTICAL_RENDER_LIMITS_3D.overlays * 48, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    const bind = (layout: GPUBindGroupLayout, buffers: GPUBuffer[]) => device.createBindGroup({layout, entries: buffers.map((buffer, binding) => ({binding, resource: {buffer}}))});
    const cameraBind = bind(cameraLayout, [uniform]), actorBind = bind(boxLayout, [actors]), overlayBind = bind(boxLayout, [overlays]);
    scope = false; const setupError = await device.popErrorScope(); if (setupError) throw Error(setupError.message);
    let cache: Cache | undefined, cachedScene: TacticalScene3D | undefined, last: Readonly<GeometryStamp3D> | null = null;
    let flight: Promise<Readonly<GeometryStamp3D>> | undefined, closing: Promise<void> | undefined, closed = false, fault: string | null = null;
    void device.lost.then(info => {if (!closed) fault = `Device lost: ${info.message}`;}, error => {if (!closed) fault = message(error);});
    const validateTargets = (targets: TacticalRenderTargets3D) => {
      fields(targets, ['color', 'depth']); const {color, depth} = targets;
      if (!color || !depth || color === depth) throw Error('Expected separate color and depth targets.');
      for (const [target, format] of [[color, formats.colorFormat], [depth, formats.depthFormat]] as const) {
        if (target.format !== format || target.dimension !== '2d' || target.depthOrArrayLayers !== 1 || target.mipLevelCount !== 1 || target.sampleCount !== 1 || !(target.usage & GPUTextureUsage.RENDER_ATTACHMENT) ||
          !Number.isInteger(target.width) || !Number.isInteger(target.height) || target.width < 1 || target.height < 1 || target.width > TACTICAL_RENDER_LIMITS_3D.targetSize || target.height > TACTICAL_RENDER_LIMITS_3D.targetSize) throw Error('Incompatible tactical render target.');
      }
      if (color.width !== depth.width || color.height !== depth.height) throw Error('Target dimensions differ.');
      return {width: color.width, height: color.height};
    };
    const ensureCache = (count: number) => {
      if (cache?.count === count) return cache;
      const added: GPUBuffer[] = [], make = (label: string, size: number, usage: GPUBufferUsageFlags) => {const b = allocate(label, size, usage); added.push(b); return b;};
      try {
        const grid = make('tactical grid', count * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
        const faces = make('tactical faces', count * 24, GPUBufferUsage.STORAGE);
        const args = make('tactical indirect', 16, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.INDIRECT);
        const next = {count, grid, faces, args, mesh: bind(mesh.getBindGroupLayout(0), [grid, faces, args, uniform]), terrain: bind(terrainLayout, [grid, faces])};
        if (cache) [cache.grid, cache.faces, cache.args].forEach(destroy); cache = next; return next;
      } catch (error) {added.forEach(destroy); throw error;}
    };
    const render = async (scene: TacticalScene3D, camera: TacticalCamera3D, targets: TacticalRenderTargets3D, draw?: (context: TacticalDrawContext3D) => void) => {
      if (closed || closing) throw Error('Tactical renderer is closed or closing.');
      if (fault) throw Error(fault); if (flight) throw Error('A tactical frame is already outstanding.');
      const data = sceneData(scene), {width, height} = validateTargets(targets), cameraBytes = cameraData(camera, width, height, scene.shape), count = data.grid.length;
      const {color, depth} = targets;
      if (draw !== undefined && typeof draw !== 'function') throw Error('Host draw must be synchronous.');
      if (count * 24 > device.limits.maxBufferSize || count * 24 > device.limits.maxStorageBufferBindingSize || Math.ceil(count / 64) > device.limits.maxComputeWorkgroupsPerDimension) throw Error('Scene exceeds device limits.');
      // Defer encoding until flight is assigned, including reentrant host callbacks.
      const work = Promise.resolve().then(async () => {
        let error: unknown, opened = false;
        try {
          device.pushErrorScope('validation'); opened = true;
          const resources = ensureCache(count), changed = cachedScene !== scene;
          device.queue.writeBuffer(uniform, 0, cameraBytes);
          if (changed) {
            device.queue.writeBuffer(resources.grid, 0, data.grid);
            device.queue.writeBuffer(resources.args, 0, new Uint32Array([6, 0, 0, 0]));
            if (scene.actors) device.queue.writeBuffer(actors, 0, data.actors);
            if (scene.overlays) device.queue.writeBuffer(overlays, 0, data.overlays);
          }
          const encoder = device.createCommandEncoder({label: 'tactical frame'});
          if (changed) {const pass = encoder.beginComputePass(); pass.setPipeline(mesh); pass.setBindGroup(0, resources.mesh); pass.dispatchWorkgroups(Math.ceil(count / 64)); pass.end();}
          const pass = encoder.beginRenderPass({colorAttachments: [{view: color.createView(), clearValue: [0.065, 0.10, 0.15, 1], loadOp: 'clear', storeOp: 'store'}], depthStencilAttachment: {view: depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store'}});
          pass.setPipeline(terrainPipeline); pass.setBindGroup(0, cameraBind); pass.setBindGroup(1, resources.terrain); pass.drawIndirect(resources.args, 0);
          if (scene.actors) {pass.setPipeline(actorPipeline); pass.setBindGroup(1, actorBind); pass.draw(36, scene.actors);}
          if (draw) {
            const result: unknown = draw({pass, camera: cameraBind, cameraLayout, stamp: copyStamp(scene.stamp), width, height});
            if (result !== undefined) {if (result && typeof (result as Promise<unknown>).then === 'function') void Promise.resolve(result).catch(() => {}); throw Error('Host draw must return synchronously without a value.');}
          }
          // Host pipelines may have rebound either group. Restore both explicitly.
          if (scene.overlays) {pass.setPipeline(overlayPipeline); pass.setBindGroup(0, cameraBind); pass.setBindGroup(1, overlayBind); pass.draw(36, scene.overlays);}
          pass.end(); device.queue.submit([encoder.finish()]);
        } catch (e) {error = Error(message(e));}
        // Drain once even if encoding failed after writeBuffer; never dispose in-flight resources.
        const scopeResult = opened ? Promise.resolve().then(() => device.popErrorScope()) : Promise.resolve(null);
        const settled = await Promise.allSettled([scopeResult, Promise.resolve().then(() => device.queue.onSubmittedWorkDone())]);
        for (const result of settled) {
          if (result.status === 'rejected') error ??= Error(message(result.reason));
          else if (result.value) error ??= Error(result.value.message);
        }
        if (fault) error ??= Error(fault);
        if (error !== undefined) {fault = message(error); throw Error(fault);}
        cachedScene = scene; last = copyStamp(scene.stamp); return copyStamp(last);
      });
      flight = work;
      try {return await work;} finally {flight = undefined;}
    };
    return Object.freeze({cameraLayout, formats, render,
      state: (): TacticalRenderState3D => ({status: closed ? 'closed' : closing ? 'closing' : fault ? 'failed' : flight ? 'working' : 'ready', error: fault, lastCompleted: last ? copyStamp(last) : null}),
      close() {
        closing ??= (async () => {try {await flight;} catch { /* Failed work was drained by render. */ } finally {for (const b of [...owned]) destroy(b); cache = undefined; cachedScene = undefined; closed = true;}})();
        return closing;
      },
    });
  } catch (error) {
    if (scope) {scope = false; await device.popErrorScope().catch(() => {});}
    for (const b of [...owned]) destroy(b); throw error;
  }
}
