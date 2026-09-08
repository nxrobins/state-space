/// <reference types="@webgpu/types" />
/** Portable WebGPU field. Await step before accessing or editing its complete state. */
import { FieldState, type StateSpaceField } from './browser_state_space.js';
import { DEFAULT_REGISTRY, requireRegistry, type MaterialRegistry } from './registry.js';
import { checkedInteger, validateDimensions } from './validation.js';
import { COMMON_SHADER, KERNEL_SOURCES } from './generated/shaders.js';
import { KERNEL_SPECS, movementScheduleForTick } from './generated/schedule.js';
import { inspectPass, type PassReport, type StepOptions } from './inspection.js';
import { planStructure, rulesForRegistry, type StructuralState } from './structure.js';

export interface GpuStateSpaceField extends Omit<StateSpaceField, 'step'> {
  readonly backendInfo: Readonly<{ vendor: string; architecture: string; device: string; description: string; isFallbackAdapter: boolean }>;
  step(ticks?: number, options?: StepOptions): Promise<readonly PassReport[]>;
}
export interface GpuFieldOptions { fillMaterial?: number; registry?: MaterialRegistry }

class WebGpuField extends FieldState implements GpuStateSpaceField {
  readonly backendInfo: GpuStateSpaceField['backendInfo'];
  #device: GPUDevice;
  #pipelines: Map<string, GPUComputePipeline>;
  #buffers: GPUBuffer[];
  #groups: [GPUBindGroup, GPUBindGroup];
  #staging: GPUBuffer;
  #loss: string | undefined;

  constructor(width: number, height: number, fill: number, registry: MaterialRegistry, device: GPUDevice,
              layout: GPUBindGroupLayout, pipelines: Map<string, GPUComputePipeline>, info: GpuStateSpaceField['backendInfo']) {
    super(width, height, fill, registry);
    this.#device = device;
    this.#pipelines = pipelines;
    this.backendInfo = Object.freeze(info);
    const bytes = width * height * 4;
    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
    this.#buffers = Array.from({ length: 6 }, () => device.createBuffer({ size: bytes, usage }));
    const cold = device.createBuffer({ size: this.coldTable.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.#buffers.push(cold);
    device.queue.writeBuffer(cold, 0, this.coldTable.buffer as ArrayBuffer);
    const plan = device.createBuffer({ size: bytes * 2, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.#buffers.push(plan);
    this.#staging = device.createBuffer({ size: bytes * 3, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    this.#buffers.push(this.#staging);
    const [a, b, ea, eb, sa, sb] = this.#buffers;
    this.#groups = [[a, b, cold, ea, eb, sa, sb, plan], [b, a, cold, eb, ea, sb, sa, plan]].map(buffers => device.createBindGroup({ layout,
      entries: buffers.map((buffer, binding) => ({ binding, resource: { buffer } })) })) as [GPUBindGroup, GPUBindGroup];
    void device.lost.then(info => { this.#loss = info.message || info.reason; });
  }

  override close(): void {
    if (this.closed) return;
    super.close();
    for (const buffer of this.#buffers) buffer.destroy();
    this.#pipelines.clear();
    this.#device.destroy();
  }

  async #readState(current: number): Promise<StructuralState> {
    const bytes = this.width * this.height * 4;
    const encoder = this.#device.createCommandEncoder();
    encoder.copyBufferToBuffer(this.#buffers[current], 0, this.#staging, 0, bytes);
    encoder.copyBufferToBuffer(this.#buffers[current + 2], 0, this.#staging, bytes, bytes);
    encoder.copyBufferToBuffer(this.#buffers[current + 4], 0, this.#staging, bytes * 2, bytes);
    this.#device.queue.submit([encoder.finish()]);
    await this.#staging.mapAsync(GPUMapMode.READ);
    try {
      const range = this.#staging.getMappedRange();
      return { grid: new Uint32Array(range.slice(0, bytes)), energyQ: new Uint32Array(range.slice(bytes, bytes * 2)), structure: new Uint32Array(range.slice(bytes * 2, bytes * 3)) };
    } finally {
      this.#staging.unmap();
    }
  }

  async step(ticks = 1, options: StepOptions = {}): Promise<readonly PassReport[]> {
    this.ensureAvailable();
    checkedInteger(ticks, 0, Number.MAX_SAFE_INTEGER - this.tickCount, 'ticks');
    if (options.inspect !== undefined && typeof options.inspect !== 'boolean') throw new Error('inspect must be a boolean.');
    if (this.#loss !== undefined) throw new Error(`WebGPU device lost: ${this.#loss}`);
    if (ticks === 0) return Object.freeze([]);
    this.busy = true;
    this.#device.pushErrorScope('validation');
    let scopeOpen = true;
    try {
      // Upload the last committed state. Failed steps can retry from that exact state.
      this.#device.queue.writeBuffer(this.#buffers[0], 0, this.cells.buffer as ArrayBuffer);
      this.#device.queue.writeBuffer(this.#buffers[2], 0, this.energies.buffer as ArrayBuffer);
      this.#device.queue.writeBuffer(this.#buffers[4], 0, this.bonds.buffer as ArrayBuffer);
      let current = 0;
      let before: StructuralState = { grid: this.cells, energyQ: this.energies, structure: this.bonds };
      const reports: PassReport[] = [];
      for (let offset = 0; offset < ticks; offset += 1) {
        const structuralPlan = planStructure(before, this.width, this.height, rulesForRegistry(this.registry));
        const upload = new Uint32Array(this.width * this.height * 2);
        for (let i = 0; i < structuralPlan.sources.length; i += 1) {
          upload[i * 2] = structuralPlan.sources[i]; upload[i * 2 + 1] = structuralPlan.structure[i];
        }
        this.#device.queue.writeBuffer(this.#buffers[7], 0, upload);
        let encoder = this.#device.createCommandEncoder();
        for (const passId of movementScheduleForTick(this.tickCount + offset)) {
          const pass = encoder.beginComputePass();
          pass.setPipeline(this.#pipelines.get(passId)!);
          pass.setBindGroup(0, this.#groups[current]);
          pass.dispatchWorkgroups(Math.ceil(this.width / 16), Math.ceil(this.height / 16));
          pass.end();
          current = 1 - current;
          if (options.inspect) {
            this.#device.queue.submit([encoder.finish()]);
            const after = await this.#readState(current);
            reports.push(inspectPass(before, after, this.coldTable, this.tickCount + offset, passId, passId === 'structure' ? structuralPlan : undefined));
            before = after;
            encoder = this.#device.createCommandEncoder();
          }
        }
        this.#device.queue.submit([encoder.finish()]);
        if (!options.inspect) before = await this.#readState(current);
      }
      const state = before;
      const error = await this.#device.popErrorScope();
      scopeOpen = false;
      if (error) throw new Error(error.message);
      this.commitState(state, this.tickCount + ticks);
      return Object.freeze(reports);
    } finally {
      try { if (scopeOpen) await this.#device.popErrorScope(); }
      finally { this.busy = false; }
    }
  }
}

export async function createGpuField(width: number, height: number, options: GpuFieldOptions = {}): Promise<GpuStateSpaceField> {
  const cells = validateDimensions(width, height);
  const registry = options.registry === undefined ? DEFAULT_REGISTRY : options.registry;
  const fill = options.fillMaterial === undefined ? 0 : options.fillMaterial;
  requireRegistry(registry); registry.material(fill);
  if (typeof navigator === 'undefined' || !navigator.gpu) throw new Error('WebGPU is unavailable; use createStateSpaceField for the CPU backend.');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('No WebGPU adapter is available.');
  const device = await adapter.requestDevice();
  try {
    if (cells * 8 > device.limits.maxStorageBufferBindingSize || cells * 12 > device.limits.maxBufferSize ||
        Math.max(Math.ceil(width / 16), Math.ceil(height / 16)) > device.limits.maxComputeWorkgroupsPerDimension) {
      throw new Error('Grid exceeds the WebGPU device allocation or dispatch limits.');
    }
    const layout = device.createBindGroupLayout({ entries: [0, 1, 2, 3, 4, 5, 6, 7].map(binding => ({ binding,
      visibility: GPUShaderStage.COMPUTE, buffer: { type: [1, 4, 6].includes(binding) ? 'storage' : 'read-only-storage' } })) });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    const modules = new Map<string, GPUShaderModule>();
    const pipelines = new Map<string, GPUComputePipeline>();
    for (const spec of KERNEL_SPECS) {
      let module = modules.get(spec.source_file);
      if (!module) {
        module = device.createShaderModule({ code: COMMON_SHADER + KERNEL_SOURCES[spec.source_file] });
        modules.set(spec.source_file, module);
      }
      const constants: Record<string, number> = { GRID_WIDTH: width, GRID_HEIGHT: height };
      for (const [name, value] of Object.entries(spec.constants)) {
        if (typeof value !== 'number') throw new Error(`Invalid generated pipeline constant: ${name}`);
        constants[name] = value;
      }
      pipelines.set(spec.id, await device.createComputePipelineAsync({ layout: pipelineLayout,
        compute: { module, entryPoint: 'tick', constants } }));
    }
    const info = adapter.info;
    return new WebGpuField(width, height, fill, registry, device, layout, pipelines,
      { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description, isFallbackAdapter: info.isFallbackAdapter });
  } catch (error) {
    device.destroy();
    throw error;
  }
}
