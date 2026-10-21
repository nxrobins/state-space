/// <reference types="@webgpu/types" />
/** Portable WebGPU field. Await step before accessing or editing its complete state. */
import { FieldState, type StateSpaceField } from './browser_state_space.js';
import { DEFAULT_REGISTRY, requireRegistry, type MaterialRegistry } from './registry.js';
import { checkedInteger, validateDimensions } from './validation.js';
import { COMMON_SHADER, KERNEL_SOURCES } from './generated/shaders.js';
import { KERNEL_SPECS, movementScheduleForTick } from './generated/schedule.js';
import { inspectPass, type PassReport, type StepOptions } from './inspection.js';
import { planStructure, rulesForRegistry, type StructuralState } from './structure.js';
import { compiledTransportInto, validateOwnedStructure } from './structure_compiled.js';

export interface GpuStateSpaceField extends Omit<StateSpaceField, 'step'> {
  readonly backendInfo: Readonly<{
    vendor: string;
    architecture: string;
    device: string;
    description: string;
    isFallbackAdapter: boolean;
  }>;
  step(ticks?: number, options?: StepOptions): Promise<readonly PassReport[]>;
}
export interface GpuFieldOptions {
  fillMaterial?: number;
  registry?: MaterialRegistry;
}

class WebGpuField extends FieldState implements GpuStateSpaceField {
  readonly backendInfo: GpuStateSpaceField['backendInfo'];
  #device: GPUDevice;
  #pipelines: Map<string, GPUComputePipeline>;
  #buffers: GPUBuffer[];
  #groups: [GPUBindGroup, GPUBindGroup];
  #staging: GPUBuffer;
  #readback: StructuralState;
  #planUpload: Uint32Array;
  #transport: { sources: Uint32Array; structure: Uint32Array };
  #loss: string | undefined;
  #resident = 0;
  // A regular property is safe to invalidate from FieldState's constructor,
  // before this class's private fields have been initialized.
  private uploadState = true;

  protected override stateChanged(): void {
    this.uploadState = true;
  }

  constructor(
    width: number,
    height: number,
    fill: number,
    registry: MaterialRegistry,
    device: GPUDevice,
    layout: GPUBindGroupLayout,
    pipelines: Map<string, GPUComputePipeline>,
    info: GpuStateSpaceField['backendInfo'],
  ) {
    super(width, height, fill, registry);
    this.#device = device;
    this.#pipelines = pipelines;
    this.backendInfo = Object.freeze(info);
    const bytes = width * height * 4;
    this.#readback = {
      grid: new Uint32Array(width * height),
      energyQ: new Uint32Array(width * height),
      structure: new Uint32Array(width * height),
    };
    this.#planUpload = new Uint32Array(width * height * 2);
    this.#transport = {
      sources: new Uint32Array(width * height),
      structure: new Uint32Array(width * height),
    };
    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
    this.#buffers = Array.from({ length: 6 }, () => device.createBuffer({ size: bytes, usage }));
    const cold = device.createBuffer({
      size: this.coldTable.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.#buffers.push(cold);
    device.queue.writeBuffer(cold, 0, this.coldTable.buffer as ArrayBuffer);
    const plan = device.createBuffer({
      size: bytes * 2,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.#buffers.push(plan);
    this.#staging = device.createBuffer({
      size: bytes * 3,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    this.#buffers.push(this.#staging);
    const [a, b, ea, eb, sa, sb] = this.#buffers;
    this.#groups = [
      [a, b, cold, ea, eb, sa, sb, plan],
      [b, a, cold, eb, ea, sb, sa, plan],
    ].map((buffers) =>
      device.createBindGroup({
        layout,
        entries: buffers.map((buffer, binding) => ({ binding, resource: { buffer } })),
      }),
    ) as [GPUBindGroup, GPUBindGroup];
    void device.lost.then((info) => {
      this.#loss = info.message || info.reason;
    });
  }

  override close(): void {
    if (this.closed) return;
    super.close();
    for (const buffer of this.#buffers) buffer.destroy();
    this.#pipelines.clear();
    this.#device.destroy();
  }

  async #readState(
    current: number,
    encoder = this.#device.createCommandEncoder(),
    owned?: StructuralState,
    finishScope?: () => Promise<GPUError | null>,
  ): Promise<StructuralState> {
    const bytes = this.width * this.height * 4;
    encoder.copyBufferToBuffer(this.#buffers[current], 0, this.#staging, 0, bytes);
    encoder.copyBufferToBuffer(this.#buffers[current + 2], 0, this.#staging, bytes, bytes);
    encoder.copyBufferToBuffer(this.#buffers[current + 4], 0, this.#staging, bytes * 2, bytes);
    this.#device.queue.submit([encoder.finish()]);
    const mapping = this.#staging.mapAsync(GPUMapMode.READ);
    // Close the final validation scope immediately after submitting/mapping.
    // Both completion promises can then progress together; neither is skipped.
    const validation = finishScope?.();
    try {
      const [mapped, checked] = await Promise.allSettled([mapping, validation]);
      if (mapped.status === 'rejected') throw mapped.reason;
      if (checked.status === 'rejected') throw checked.reason;
      if (checked.value) throw new Error(checked.value.message);
      const range = this.#staging.getMappedRange();
      if (owned) {
        owned.grid.set(new Uint32Array(range, 0, bytes / 4));
        owned.energyQ.set(new Uint32Array(range, bytes, bytes / 4));
        owned.structure.set(new Uint32Array(range, bytes * 2, bytes / 4));
        return owned;
      }
      return {
        grid: new Uint32Array(range.slice(0, bytes)),
        energyQ: new Uint32Array(range.slice(bytes, bytes * 2)),
        structure: new Uint32Array(range.slice(bytes * 2, bytes * 3)),
      };
    } finally {
      if (this.#staging.mapState === 'mapped') this.#staging.unmap();
    }
  }

  async step(ticks = 1, options: StepOptions = {}): Promise<readonly PassReport[]> {
    this.ensureAvailable();
    checkedInteger(ticks, 0, Number.MAX_SAFE_INTEGER - this.tickCount, 'ticks');
    const requestedInspect = options.inspect;
    if (requestedInspect !== undefined && typeof requestedInspect !== 'boolean')
      throw new Error('inspect must be a boolean.');
    const inspect = requestedInspect === true;
    if (this.#loss !== undefined) throw new Error(`WebGPU device lost: ${this.#loss}`);
    if (ticks === 0) return Object.freeze([]);
    this.busy = true;
    this.#device.pushErrorScope('validation');
    let scopeOpen = true;
    const finishScope = () => {
      const result = this.#device.popErrorScope();
      scopeOpen = false;
      return result;
    };
    try {
      // Unedited successful continuations already reside on the GPU. Edits,
      // restores and failed steps require uploading the complete committed state.
      let current = this.#resident;
      if (this.uploadState) {
        this.#device.queue.writeBuffer(this.#buffers[current], 0, this.cells.buffer as ArrayBuffer);
        this.#device.queue.writeBuffer(
          this.#buffers[current + 2],
          0,
          this.energies.buffer as ArrayBuffer,
        );
        this.#device.queue.writeBuffer(
          this.#buffers[current + 4],
          0,
          this.bonds.buffer as ArrayBuffer,
        );
      }
      // Any failure may have overwritten both ping-pong slots. Retry must upload.
      this.uploadState = true;
      let before: StructuralState = {
        grid: this.cells,
        energyQ: this.energies,
        structure: this.bonds,
      };
      const reports: PassReport[] = [];
      for (let offset = 0; offset < ticks; offset += 1) {
        // The first tick starts from the committed state, validated at commit.
        // Every readback below is validated before the next plan can use it.
        if (!inspect)
          compiledTransportInto(
            before,
            this.width,
            this.height,
            this.registry,
            this.#transport.sources,
            this.#transport.structure,
          );
        const structuralPlan = inspect
          ? planStructure(before, this.width, this.height, rulesForRegistry(this.registry))
          : this.#transport;
        const upload = this.#planUpload;
        for (let i = 0; i < structuralPlan.sources.length; i += 1) {
          upload[i * 2] = structuralPlan.sources[i];
          upload[i * 2 + 1] = structuralPlan.structure[i];
        }
        this.#device.queue.writeBuffer(this.#buffers[7], 0, upload);
        let encoder = this.#device.createCommandEncoder();
        // Dispatch scopes preserve the ordered ping-pong dependencies within one
        // compute pass. Inspection retains a separate submission per kernel.
        const batch = inspect ? undefined : encoder.beginComputePass();
        const schedule = movementScheduleForTick(this.tickCount + offset);
        for (let passIndex = 0; passIndex < schedule.length; passIndex += 1) {
          const passId = schedule[passIndex];
          const pass = batch ?? encoder.beginComputePass();
          pass.setPipeline(this.#pipelines.get(passId)!);
          pass.setBindGroup(0, this.#groups[current]);
          pass.dispatchWorkgroups(Math.ceil(this.width / 16), Math.ceil(this.height / 16));
          if (inspect) pass.end();
          current = 1 - current;
          if (inspect) {
            this.#device.queue.submit([encoder.finish()]);
            const after = await this.#readState(
              current,
              undefined,
              undefined,
              offset === ticks - 1 && passIndex === schedule.length - 1 ? finishScope : undefined,
            );
            reports.push(
              inspectPass(
                before,
                after,
                this.coldTable,
                this.tickCount + offset,
                passId,
                passId === 'structure'
                  ? (structuralPlan as ReturnType<typeof planStructure>)
                  : undefined,
              ),
            );
            before = after;
            encoder = this.#device.createCommandEncoder();
          }
        }
        if (!inspect) {
          batch!.end();
          before = await this.#readState(
            current,
            encoder,
            this.#readback,
            offset === ticks - 1 ? finishScope : undefined,
          );
          before = validateOwnedStructure(before, this.width, this.height, this.registry);
        }
      }
      const state = before;
      if (inspect) this.commitState(state, this.tickCount + ticks);
      else {
        // The readback never aliases committed storage during a step. Swap only
        // after validation and the error scope succeed, preserving atomic retry.
        this.#readback = { grid: this.cells, energyQ: this.energies, structure: this.bonds };
        this.adoptState(state, this.tickCount + ticks);
      }
      this.#resident = current;
      this.uploadState = false;
      return Object.freeze(reports);
    } finally {
      try {
        if (scopeOpen) await this.#device.popErrorScope();
      } finally {
        this.busy = false;
      }
    }
  }
}

export async function createGpuField(
  width: number,
  height: number,
  options: GpuFieldOptions = {},
): Promise<GpuStateSpaceField> {
  const cells = validateDimensions(width, height);
  const registry = options.registry === undefined ? DEFAULT_REGISTRY : options.registry;
  const fill = options.fillMaterial === undefined ? 0 : options.fillMaterial;
  requireRegistry(registry);
  registry.material(fill);
  if (typeof navigator === 'undefined' || !navigator.gpu)
    throw new Error('WebGPU is unavailable; use createStateSpaceField for the CPU backend.');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('No WebGPU adapter is available.');
  const device = await adapter.requestDevice();
  try {
    if (
      cells * 8 > device.limits.maxStorageBufferBindingSize ||
      cells * 12 > device.limits.maxBufferSize ||
      Math.max(Math.ceil(width / 16), Math.ceil(height / 16)) >
        device.limits.maxComputeWorkgroupsPerDimension
    ) {
      throw new Error('Grid exceeds the WebGPU device allocation or dispatch limits.');
    }
    const layout = device.createBindGroupLayout({
      entries: [0, 1, 2, 3, 4, 5, 6, 7].map((binding) => ({
        binding,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: [1, 4, 6].includes(binding) ? 'storage' : 'read-only-storage' },
      })),
    });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    const modules = new Map<string, GPUShaderModule>();
    const pipelines = new Map<string, GPUComputePipeline>();
    for (const spec of KERNEL_SPECS) {
      let module = modules.get(spec.source_file);
      if (!module) {
        module = device.createShaderModule({
          code: COMMON_SHADER + KERNEL_SOURCES[spec.source_file],
        });
        modules.set(spec.source_file, module);
      }
      const constants: Record<string, number> = { GRID_WIDTH: width, GRID_HEIGHT: height };
      for (const [name, value] of Object.entries(spec.constants)) {
        if (typeof value !== 'number')
          throw new Error(`Invalid generated pipeline constant: ${name}`);
        constants[name] = value;
      }
      pipelines.set(
        spec.id,
        await device.createComputePipelineAsync({
          layout: pipelineLayout,
          compute: { module, entryPoint: 'tick', constants },
        }),
      );
    }
    const info = adapter.info;
    return new WebGpuField(width, height, fill, registry, device, layout, pipelines, {
      vendor: info.vendor,
      architecture: info.architecture,
      device: info.device,
      description: info.description,
      isFallbackAdapter: info.isFallbackAdapter,
    });
  } catch (error) {
    device.destroy();
    throw error;
  }
}
