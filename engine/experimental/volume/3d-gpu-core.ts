/** GPU-resident implementation of the unchanged ca-3d-m1 rules. */
import { buildColdTable } from '../../generated/materials.js';
import { checkedInteger } from '../../validation.js';
import {
  createStateSpaceField3D,
  validateVolumeSnapshot,
  volumeSchedule,
  MAX_ENERGY_Q,
  type VolumeSnapshot,
  type VolumeSample,
} from '../3d.js';
import { chunkShaders } from './3d-shader.js';
import { activeShaders } from './active-shader.js';
import { makeTerrainRenderer } from './3d-renderer.js';
import { makeChunkRenderer, type ResidentChunkRenderer } from './world-renderer.js';
import {
  makeGameplayResources,
  checkedGameplayState,
  checkedGameplayRules,
  checkedGameplayCommand,
} from '../gameplay/gameplay-gpu.js';
import type {
  GameplayState3D,
  GameplayRules3D,
  GameplayCommand3D,
  GameplayPresentation3D,
  ResidentGameplay3D,
} from '../gameplay/gameplay-view.js';
export type {
  GameplayState3D,
  GameplayRules3D,
  GameplayCommand3D,
  GameplayPresentation3D,
  GameplayCommit3D,
  ResidentGameplay3D,
} from '../gameplay/gameplay-view.js';
import { LatencyProfiler, type Trace } from './latency.js';
import type { LatencySnapshot } from './3d-view.js';
export type { LatencyRecord, LatencySnapshot } from './3d-view.js';
import {
  type TerrainCamera,
  type TerrainRenderer,
  type TerrainAppearance,
  type TerrainLightingMode,
  type TerrainStyleOptions,
} from './3d-view.js';

export type RegionRequest3D = { origin: readonly number[]; size: readonly number[] };
export type Region3D = { origin: number[]; size: number[]; grid: Uint32Array; tick: number };
export type VolumeEdit3D = { x: number; y: number; z: number } & (
  { material: number; thermal?: number } | { energyQ: number }
);
export type GpuStepOptions3D = { edits?: readonly VolumeEdit3D[]; region?: RegionRequest3D };
export type Activity3D = {
  mode: 'dense' | 'sparse';
  tick: number;
  totalChunks: number;
  activityChunkSize: number;
  storageChunks: number;
  awake: number[];
  wakeReasons: number[];
  terrainDirty?: number[];
  dispatchedChunks: number;
  denseChunks: number;
  peakChunks: number;
  sleepingChunks: number;
  plannerBuilds?: number;
  plannerReuses?: number;
};
export interface GpuVolume3D {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly tick: number;
  readonly backendInfo: Readonly<Record<string, string | boolean>>;
  step(ticks?: number, options?: GpuStepOptions3D): Promise<Region3D | undefined>;
  queryRegion(region: RegionRequest3D): Promise<Region3D>;
  snapshot(): Promise<VolumeSnapshot>;
  restore(snapshot: VolumeSnapshot): Promise<void>;
  sample(x: number, y: number, z: number): Promise<VolumeSample>;
  setCell(x: number, y: number, z: number, material: number, thermal?: number): Promise<void>;
  setEnergy(x: number, y: number, z: number, energyQ: number): Promise<void>;
  energyBalance(): Promise<{
    initialQ: bigint;
    externalQ: bigint;
    currentQ: bigint;
    driftQ: bigint;
  }>;
  /** Diagnostic: run one pass on scratch state without changing the committed field. */
  inspectPass(passIndex: number): Promise<VolumeSnapshot>;
  createRenderer(canvas: HTMLCanvasElement): Promise<TerrainRenderer>;
  createGameplay(state: GameplayState3D, rules: GameplayRules3D): Promise<ResidentGameplay3D>;
  inspectActivity(): Promise<Activity3D>;
  inspectLatency(afterId?: number): LatencySnapshot;
  settleLatency(): Promise<void>;
  close(): void;
}
export type {
  TerrainCamera,
  TerrainRenderer,
  TerrainAppearance,
  TerrainLightingMode,
  TerrainStyleOptions,
  TerrainStyleSettings,
  TerrainStyleProfile,
  TerrainStyleColor,
} from './3d-view.js';
const EMPTY_EDITS = new Uint32Array(0);
const KINDS = ['gravity', 'diagonal', 'liquid', 'buoyancy', 'gas', 'heat', 'phase'];
const total = (values: ArrayLike<number>) => {
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i];
  return BigInt(sum);
};
const storage = () => GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;

async function compile(device: GPUDevice, code: string) {
  const module = device.createShaderModule({ code });
  const info = await module.getCompilationInfo(),
    errors = info.messages.filter((m) => m.type === 'error');
  if (errors.length)
    throw new Error(errors.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join('\n'));
  return module;
}

class ResidentVolume implements GpuVolume3D {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly backendInfo: GpuVolume3D['backendInfo'];
  #device: GPUDevice;
  #pipeline: GPUComputePipeline;
  #edit: GPUComputePipeline;
  #query: GPUComputePipeline;
  #buffers: GPUBuffer[] = [];
  #cells: GPUBuffer[];
  #energy: GPUBuffer[];
  #cold: GPUBuffer;
  #uniform: GPUBuffer;
  #slots = 29;
  #groups: GPUBindGroup[] = [];
  #current = 0;
  #editData: GPUBuffer;
  #editResult: GPUBuffer;
  #editRead: GPUBuffer;
  #queryResult: GPUBuffer;
  #queryRead: GPUBuffer;
  #fullRead: GPUBuffer;
  #tick = 0;
  #initial: bigint;
  #external = 0n;
  #busy = false;
  #fault = '';
  #closed = false;
  #renderers: TerrainRenderer[] = [];
  #worldRenderer = false;
  #config: ResidentConfig;
  #dirty: GPUBuffer;
  #activity?: GPUBuffer;
  #activityRead?: GPUBuffer;
  #indirect: GPUBuffer[] = [];
  #activeEdge = 0;
  #stageGroups: Record<string, GPUBindGroup> = {};
  #stages: Record<string, GPUComputePipeline>;
  #lastTicks = 0;
  #activityCache?: Uint32Array;
  #activityZeros = new Uint32Array(0);
  #profiler: LatencyProfiler;
  #params = new Uint32Array(29 * 64);
  #queryGroups: GPUBindGroup[] = [];
  #editGroups: GPUBindGroup[] = [];
  #revision = 0;
  #gameplay?: ResidentGameplay3D;
  #chunkRenderers = new Map<TerrainRenderer, ResidentChunkRenderer>();
  constructor(
    w: number,
    h: number,
    d: number,
    initial: VolumeSnapshot,
    device: GPUDevice,
    pipeline: GPUComputePipeline,
    edit: GPUComputePipeline,
    query: GPUComputePipeline,
    info: GpuVolume3D['backendInfo'],
    config: ResidentConfig,
    stages: Record<string, GPUComputePipeline>,
  ) {
    this.#profiler = new LatencyProfiler(device, config.profiling, config.gpuTiming);
    this.#config = config;
    this.width = w;
    this.height = h;
    this.depth = d;
    this.#device = device;
    this.backendInfo = Object.freeze(info);
    for (const key of ['width', 'height', 'depth', 'backendInfo'])
      Object.defineProperty(this, key, { writable: false, configurable: false });
    this.#pipeline = pipeline;
    this.#edit = edit;
    this.#query = query;
    this.#stages = stages;
    const bytes = w * h * d * 4;
    const buffer = (size: number, usage: GPUBufferUsageFlags) => {
      const b = device.createBuffer({ size, usage });
      this.#buffers.push(b);
      return b;
    };
    this.#cells = [buffer(bytes, storage()), buffer(bytes, storage())];
    this.#energy = [buffer(bytes, storage()), buffer(bytes, storage())];
    this.#dirty = buffer(
      Math.max(1, config.chunkSize ? (w * h * d) / config.chunkSize ** 3 : 1) * 4,
      storage(),
    );
    this.#invalidate();
    if (config.sparse) {
      this.#activeEdge = Math.min(config.chunkSize, 8);
      const chunks = (w * h * d) / this.#activeEdge ** 3;
      this.#activityZeros = new Uint32Array(chunks);
      this.#activity = buffer((16 + 4 * chunks) * 4, storage());
      this.#indirect = [
        buffer(12, storage() | GPUBufferUsage.INDIRECT),
        buffer(12, storage() | GPUBufferUsage.INDIRECT),
      ];
      this.#activityRead = buffer(
        (16 + 4 * chunks) * 4 + this.#dirty.size,
        GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      );
      this.#wakeAll();
      this.#stageGroups.collectWork = device.createBindGroup({
        layout: stages.collectWork.getBindGroupLayout(0),
        entries: [
          { binding: 7, resource: { buffer: this.#activity } },
          { binding: 8, resource: { buffer: this.#indirect[0] } },
          { binding: 9, resource: { buffer: this.#indirect[1] } },
        ],
      });
    }
    const cold = buildColdTable();
    this.#cold = buffer(cold.byteLength, storage());
    device.queue.writeBuffer(this.#cold, 0, cold);
    this.#uniform = buffer(this.#slots * 256, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    this.#editData = buffer(64 * 16, storage());
    this.#editResult = buffer(64 * 8, storage());
    this.#editRead = buffer(64 * 8, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ);
    this.#queryResult = buffer(4096 * 4, storage());
    this.#queryRead = buffer(4096 * 4, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ);
    this.#fullRead = buffer(bytes * 2, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ);
    this.#initial = total(initial.energyQ);
    device.queue.writeBuffer(this.#cells[0], 0, this.#pack(initial.packedCells));
    device.queue.writeBuffer(this.#energy[0], 0, this.#pack(initial.energyQ));
    if (config.sparse) {
      device.queue.writeBuffer(this.#cells[1], 0, this.#pack(initial.packedCells));
      device.queue.writeBuffer(this.#energy[1], 0, this.#pack(initial.energyQ));
    }
    this.#bind();
    device.addEventListener('uncapturederror', (event) => {
      this.#fault = event.error.message;
    });
    void device.lost.then((info) => {
      this.#fault = info.message || info.reason;
    });
  }
  #address(x: number, y: number, z: number) {
    const e = this.#config.chunkSize,
      w = this.width,
      h = this.height;
    return e
      ? (Math.floor(x / e) + (w / e) * (Math.floor(y / e) + (h / e) * Math.floor(z / e))) * e ** 3 +
          (x % e) +
          e * ((y % e) + e * (z % e))
      : x + w * (y + h * z);
  }
  #pack(source: ArrayLike<number>) {
    const out = new Uint32Array(source.length);
    let i = 0;
    for (let z = 0; z < this.depth; z++)
      for (let y = 0; y < this.height; y++)
        for (let x = 0; x < this.width; x++) out[this.#address(x, y, z)] = source[i++];
    return out;
  }
  #unpack(source: Uint32Array) {
    const out = new Uint32Array(source.length);
    let i = 0;
    for (let z = 0; z < this.depth; z++)
      for (let y = 0; y < this.height; y++)
        for (let x = 0; x < this.width; x++) out[i++] = source[this.#address(x, y, z)];
    return out;
  }
  #invalidateEdits(edits: Uint32Array) {
    const e = this.#config.chunkSize;
    if (!e) return;
    const n = [this.width / e, this.height / e, this.depth / e],
      seen = new Set<number>();
    for (let i = 0; i < edits.length; i += 4) {
      if (edits[i + 1] === 1) continue;
      const k = Math.floor(edits[i] / e ** 3),
        l = edits[i] % e ** 3;
      const c = [k % n[0], Math.floor(k / n[0]) % n[1], Math.floor(k / (n[0] * n[1]))],
        local = [l % e, Math.floor(l / e) % e, Math.floor(l / e ** 2)];
      seen.add(k);
      for (let a = 0; a < 3; a++)
        for (const sign of [-1, 1])
          if (
            (sign < 0 ? local[a] === 0 : local[a] === e - 1) &&
            c[a] + sign >= 0 &&
            c[a] + sign < n[a]
          ) {
            const other = [...c];
            other[a] += sign;
            seen.add(other[0] + n[0] * (other[1] + n[1] * other[2]));
          }
    }
    for (const k of seen) this.#device.queue.writeBuffer(this.#dirty, k * 4, new Uint32Array([1]));
  }
  #wakeAll() {
    if (!this.#activity) return;
    const n = (this.#activity.size / 4 - 16) / 4;
    this.#device.queue.writeBuffer(this.#activity, 16 * 4, new Uint32Array(n).fill(1));
    this.#device.queue.writeBuffer(this.#activity, (16 + n) * 4, new Uint32Array(n).fill(2));
    this.#device.queue.writeBuffer(this.#activity, 40, new Uint32Array([1]));
    this.#device.queue.writeBuffer(this.#activity, (16 + 3 * n) * 4, new Uint32Array(n).fill(32));
  }
  #wakeEdits(edits: Uint32Array) {
    if (!this.#activity) return;
    const e = this.#activeEdge,
      b = this.#config.chunkSize,
      bn = [this.width / b, this.height / b, this.depth / b],
      n = [this.width / e, this.height / e, this.depth / e],
      count = n[0] * n[1] * n[2],
      seen = new Set<number>();
    for (let i = 0; i < edits.length; i += 4) {
      const k = Math.floor(edits[i] / b ** 3),
        l = edits[i] % b ** 3,
        g = [
          (k % bn[0]) * b + (l % b),
          (Math.floor(k / bn[0]) % bn[1]) * b + (Math.floor(l / b) % b),
          Math.floor(k / (bn[0] * bn[1])) * b + Math.floor(l / b ** 2),
        ],
        c = g.map((v) => Math.floor(v / e)),
        local = g.map((v) => v % e);
      for (let z = local[2] < 2 ? -1 : 0; z <= (local[2] >= e - 2 ? 1 : 0); z++)
        for (let y = local[1] < 2 ? -1 : 0; y <= (local[1] >= e - 2 ? 1 : 0); y++)
          for (let x = local[0] < 2 ? -1 : 0; x <= (local[0] >= e - 2 ? 1 : 0); x++) {
            const t = [c[0] + x, c[1] + y, c[2] + z];
            if (t.every((v, a) => v >= 0 && v < n[a])) seen.add(t[0] + n[0] * (t[1] + n[1] * t[2]));
          }
    }
    if (seen.size) this.#device.queue.writeBuffer(this.#activity, 40, new Uint32Array([1]));
    for (const k of seen) {
      this.#device.queue.writeBuffer(this.#activity, (16 + k) * 4, new Uint32Array([1]));
      this.#device.queue.writeBuffer(
        this.#activity,
        (16 + 3 * count + k) * 4,
        new Uint32Array([16]),
      );
    }
  }
  #invalidate() {
    this.#device.queue.writeBuffer(this.#dirty, 0, new Uint32Array(this.#dirty.size / 4).fill(1));
  }
  get tick() {
    return this.#tick;
  }
  async prepareActivity() {
    if (!this.#activity) return;
    const params = this.#parameters(1);
    this.#shape(params, 0);
    this.#device.queue.writeBuffer(this.#uniform, 0, params);
    this.#device.pushErrorScope('validation');
    const e = this.#device.createCommandEncoder(),
      pass = e.beginComputePass();
    pass.setPipeline(this.#stages.collectWork);
    pass.setBindGroup(0, this.#stageGroups.collectWork);
    pass.dispatchWorkgroups(1);
    pass.setPipeline(this.#stages.certify);
    pass.setBindGroup(0, this.#groups[0], [0]);
    pass.dispatchWorkgroupsIndirect(this.#indirect[0], 0);
    pass.setPipeline(this.#stages.commitCert);
    pass.dispatchWorkgroups(
      Math.ceil((this.width * this.height * this.depth) / this.#activeEdge ** 3 / 64),
    );
    pass.end();
    await this.#finish(e);
    this.#device.queue.writeBuffer(this.#activity, 16, new Uint32Array(6));
    await this.#device.queue.onSubmittedWorkDone();
  }
  #available() {
    if (this.#closed || this.#fault || this.#busy)
      throw new Error(
        this.#closed
          ? '3D GPU field is closed.'
          : this.#fault || '3D GPU field has an operation in flight.',
      );
  }
  async #run<T>(operation: () => Promise<T>): Promise<T> {
    this.#available();
    this.#busy = true;
    try {
      return await operation();
    } finally {
      this.#busy = false;
    }
  }
  #bind() {
    this.#groups = [0, 1].map((i) =>
      this.#device.createBindGroup({
        layout: this.#pipeline.getBindGroupLayout(0),
        entries: [
          this.#cells[i],
          this.#energy[i],
          this.#cells[1 - i],
          this.#energy[1 - i],
          this.#cold,
          this.#uniform,
          this.#dirty,
          ...(this.#activity ? [this.#activity, this.#indirect[1 - i]] : []),
        ].map((buffer, binding) => ({
          binding,
          resource: { buffer, ...(binding === 5 ? { size: 48 } : {}) },
        })),
      }),
    );
    this.#queryGroups = [0, 1].map((i) =>
      this.#device.createBindGroup({
        layout: this.#query.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.#cells[i] } },
          { binding: 5, resource: { buffer: this.#uniform, offset: 256, size: 48 } },
          { binding: 7, resource: { buffer: this.#queryResult } },
        ],
      }),
    );
    this.#editGroups = [0, 1].map((i) =>
      this.#device.createBindGroup({
        layout: this.#edit.getBindGroupLayout(0),
        entries: [
          [2, this.#cells[i]],
          [3, this.#energy[i]],
          [4, this.#cold],
          [5, this.#uniform],
          [6, this.#editData],
          [7, this.#editResult],
        ].map(([binding, buffer]) => ({
          binding: binding as number,
          resource: {
            buffer: buffer as GPUBuffer,
            ...(binding === 5 ? { offset: 0, size: 48 } : {}),
          },
        })),
      }),
    );
  }
  inspectLatency(afterId = 0) {
    return this.#profiler.snapshot(afterId);
  }
  settleLatency() {
    return this.#profiler.settle();
  }
  #parameters(slots: number) {
    if (slots > this.#slots) {
      this.#uniform.destroy();
      this.#slots = slots;
      this.#uniform = this.#device.createBuffer({
        size: slots * 256,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.#buffers.push(this.#uniform);
      this.#params = new Uint32Array(slots * 64);
      this.#bind();
    }
    this.#params.fill(0, 0, slots * 64);
    return this.#params.subarray(0, slots * 64);
  }
  #shape(params: Uint32Array, slot: number) {
    params.set(
      [this.width, this.height, this.depth, this.width * this.height * this.depth],
      slot * 64,
    );
  }
  #region(region?: RegionRequest3D): RegionRequest3D | undefined {
    if (region === undefined) return;
    if (
      !region ||
      !Array.isArray(region.origin) ||
      !Array.isArray(region.size) ||
      region.origin.length !== 3 ||
      region.size.length !== 3
    )
      throw new Error('Region needs three origin and size coordinates.');
    const shape = [this.width, this.height, this.depth],
      origin: number[] = [],
      size: number[] = [];
    for (let i = 0; i < 3; i++) {
      size.push(checkedInteger(region.size[i], 1, shape[i], 'region size'));
      origin.push(checkedInteger(region.origin[i], 0, shape[i] - size[i], 'region origin'));
    }
    checkedInteger(size[0] * size[1] * size[2], 1, 4096, 'region cell count');
    return { origin, size };
  }
  #edits(edits: readonly VolumeEdit3D[] = []) {
    if (!Array.isArray(edits)) throw new Error('A commit supports at most 64 unique cell edits.');
    const count = checkedInteger(edits.length, 0, 64, 'edit count');
    if (count === 0) return EMPTY_EDITS;
    const seen = new Set<number>(),
      data = new Uint32Array(count * 4);
    let seed: ReturnType<ResidentConfig['cpu']> | undefined;
    for (let k = 0; k < count; k++) {
      const e = edits[k];
      if (!e || typeof e !== 'object') throw new Error('Invalid volume edit.');
      checkedInteger(e.x, 0, this.width - 1, 'x');
      checkedInteger(e.y, 0, this.height - 1, 'y');
      checkedInteger(e.z, 0, this.depth - 1, 'z');
      const i = e.x + this.width * (e.y + this.height * e.z);
      if (seen.has(i)) throw new Error('Duplicate edit coordinate.');
      seen.add(i);
      const keys = Object.keys(e).sort().join(',');
      if ('material' in e) {
        if (!['material,x,y,z', 'material,thermal,x,y,z'].includes(keys))
          throw new Error('Unknown placement edit field.');
        seed ??= this.#config.cpu(1, 1, 1);
        seed.setCell(0, 0, 0, e.material, e.thermal);
        const s = seed.sample(0, 0, 0);
        data.set([this.#address(e.x, e.y, e.z), 0, seed.grid[0], s.energyQ], k * 4);
      } else {
        if (keys !== 'energyQ,x,y,z') throw new Error('Unknown energy edit field.');
        checkedInteger(e.energyQ, 0, MAX_ENERGY_Q, 'energyQ');
        data.set([this.#address(e.x, e.y, e.z), 1, 0, e.energyQ], k * 4);
      }
    }
    return data;
  }
  async #finish(
    encoder: GPUCommandEncoder,
    reads: { buffer: GPUBuffer; bytes: number }[] = [],
    trace?: Trace,
  ) {
    this.#profiler.resolve(encoder, trace);
    this.#profiler.mark(trace, 'encodedAt');
    this.#device.queue.submit([encoder.finish()]);
    this.#profiler.submitted(trace);
    const validation = this.#device.popErrorScope().then((error) => {
      this.#profiler.mark(trace, 'validationCompletedAt');
      return error;
    });
    const mappings = Promise.allSettled(
      reads.map((r) => r.buffer.mapAsync(GPUMapMode.READ, 0, r.bytes)),
    ).then((results) => {
      this.#profiler.mark(trace, 'readbacksReadyAt');
      for (const r of results) if (r.status === 'rejected') throw r.reason;
    });
    const results = await Promise.allSettled([
      validation,
      this.#device.queue
        .onSubmittedWorkDone()
        .then(() => this.#profiler.mark(trace, 'queueCompletedAt')),
      mappings,
    ]);
    try {
      const failed = results.find((r) => r.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
      const error = results[0].status === 'fulfilled' && results[0].value;
      if (error) throw new Error((error as GPUError).message);
      if (this.#fault) throw new Error(this.#fault);
      return reads.map((r) => new Uint32Array(r.buffer.getMappedRange(0, r.bytes).slice(0)));
    } catch (error) {
      this.#fault = String(error);
      throw error;
    } finally {
      reads.forEach((r) => {
        if (r.buffer.mapState === 'mapped') r.buffer.unmap();
      });
    }
  }
  #encodePhysics(encoder: GPUCommandEncoder, slot: number, current: number, trace?: Trace) {
    const compute = encoder.beginComputePass(
      this.#profiler.pass(trace, 'physicsPlanningAndCertification'),
    );
    const chunks =
      (this.width * this.height * this.depth) /
      (this.#activeEdge || this.#config.chunkSize || 1) ** 3;
    const stage = (name: string, groups: number) => {
      compute.setPipeline(this.#stages[name]);
      if (this.#stageGroups[name]) compute.setBindGroup(0, this.#stageGroups[name]);
      compute.dispatchWorkgroups(groups);
    };
    for (let s = 2; s < slot; s++) {
      compute.setBindGroup(0, this.#groups[current], [s * 256]);
      if (this.#activity && (s - 2) % 27 === 0) stage('collectWork', 1);
      compute.setPipeline(this.#pipeline);
      compute.setBindGroup(0, this.#groups[current], [s * 256]);
      if (this.#activity) compute.dispatchWorkgroupsIndirect(this.#indirect[current], 0);
      else compute.dispatchWorkgroups(Math.ceil((this.width * this.height * this.depth) / 64));
      current = 1 - current;
      if (this.#activity && (s - 1) % 27 === 0) {
        compute.setBindGroup(0, this.#groups[current], [0]);
        compute.setPipeline(this.#stages.certify);
        compute.dispatchWorkgroupsIndirect(this.#indirect[current], 0);
        stage('commitCert', Math.ceil(chunks / 64));
      }
    }
    compute.end();
    return current;
  }
  async step(ticks = 1, options: GpuStepOptions3D = {}): Promise<Region3D | undefined> {
    checkedInteger(ticks, 0, 1024, 'ticks per request');
    checkedInteger(this.#tick + ticks, 0, Number.MAX_SAFE_INTEGER, 'end tick');
    if (
      !options ||
      typeof options !== 'object' ||
      Array.isArray(options) ||
      Object.keys(options).some((k) => k !== 'edits' && k !== 'region')
    )
      throw new Error('Invalid GPU step options.');
    const region = this.#region(options.region),
      edits = this.#edits(options.edits);
    return this.#run(async () => {
      const trace = this.#profiler.begin('step', this.#tick + ticks);
      if (ticks || edits.length) this.#activityCache = undefined;
      const params = this.#parameters(ticks * 27 + 2);
      this.#shape(params, 0);
      params[9] = edits.length / 4;
      if (region) {
        this.#shape(params, 1);
        params.set(region.size, 68);
        params.set(region.origin, 72);
      }
      let slot = 2;
      for (let t = 0; t < ticks; t++)
        for (const pass of volumeSchedule(this.#tick + t)) {
          this.#shape(params, slot);
          params.set(
            [
              KINDS.indexOf(pass.kind),
              pass.axis,
              pass.parity,
              pass.direction >>> 0,
              (this.#tick + t) >>> 0,
            ],
            slot * 64 + 4,
          );
          slot++;
        }
      this.#device.queue.writeBuffer(this.#uniform, 0, params);
      // Host edits write their wake reasons before this submission. Preserve
      // that ordering; ordinary ticks clear on the GPU with no zero upload.
      if (this.#activity && ticks && edits.length)
        this.#device.queue.writeBuffer(
          this.#activity,
          (16 + 3 * this.#activityZeros.length) * 4,
          this.#activityZeros,
        );
      if (edits.length) {
        this.#device.queue.writeBuffer(this.#editData, 0, edits);
        this.#invalidateEdits(edits);
        this.#wakeEdits(edits);
      }
      this.#profiler.mark(trace, 'preparedAt');
      this.#device.pushErrorScope('validation');
      const encoder = this.#device.createCommandEncoder();
      if (this.#activity && ticks) {
        encoder.clearBuffer(this.#activity, 16, 24);
        if (!edits.length)
          encoder.clearBuffer(
            this.#activity,
            (16 + 3 * this.#activityZeros.length) * 4,
            this.#activityZeros.byteLength,
          );
      }
      let current = this.#current;
      if (edits.length) {
        const pass = encoder.beginComputePass(this.#profiler.pass(trace, 'edits'));
        pass.setPipeline(this.#edit);
        pass.setBindGroup(0, this.#editGroups[current]);
        pass.dispatchWorkgroups(1);
        pass.end();
      }
      current = this.#encodePhysics(encoder, slot, current, trace);
      if (region) {
        const pass = encoder.beginComputePass(this.#profiler.pass(trace, 'collisionQuery'));
        pass.setPipeline(this.#query);
        pass.setBindGroup(0, this.#queryGroups[current]);
        pass.dispatchWorkgroups(Math.ceil(region.size.reduce((a, b) => a * b, 1) / 64));
        pass.end();
      }
      const reads = [];
      if (edits.length) {
        const bytes = edits.length * 2;
        encoder.copyBufferToBuffer(this.#editResult, 0, this.#editRead, 0, bytes);
        reads.push({ buffer: this.#editRead, bytes });
      }
      if (region) {
        const bytes = region.size.reduce((a, b) => a * b, 1) * 4;
        encoder.copyBufferToBuffer(this.#queryResult, 0, this.#queryRead, 0, bytes);
        reads.push({ buffer: this.#queryRead, bytes });
      }
      const interval = this.#config.activityReadbackInterval ?? 0;
      const sampleActivity = Boolean(
        this.#activity && ticks && interval && (this.#tick + ticks) % interval === 0,
      );
      if (sampleActivity) {
        const bytes = this.#encodeActivityRead(encoder);
        reads.push({ buffer: this.#activityRead!, bytes });
      }
      const values = await this.#finish(encoder, reads, trace);
      if (edits.length) {
        const deltas = values.shift()!;
        for (let i = 0; i < deltas.length; i += 2)
          this.#external += BigInt(deltas[i + 1]) - BigInt(deltas[i]);
      }
      this.#current = current;
      this.#tick += ticks;
      if (ticks) this.#lastTicks = ticks;
      if (ticks || edits.length) this.#revision++;
      if (sampleActivity) this.#activityCache = values.pop()!;
      this.#profiler.mark(trace, 'completedAt');
      return region
        ? { origin: [...region.origin], size: [...region.size], grid: values[0], tick: this.#tick }
        : undefined;
    });
  }
  async queryRegion(region: RegionRequest3D) {
    const checked = this.#region(region);
    if (!checked) throw new Error('A region is required.');
    return (await this.step(0, { region: checked }))!;
  }
  async #snapshot(current = this.#current): Promise<VolumeSnapshot> {
    const bytes = this.width * this.height * this.depth * 4;
    this.#device.pushErrorScope('validation');
    const encoder = this.#device.createCommandEncoder();
    encoder.copyBufferToBuffer(this.#cells[current], 0, this.#fullRead, 0, bytes);
    encoder.copyBufferToBuffer(this.#energy[current], 0, this.#fullRead, bytes, bytes);
    const [words] = await this.#finish(encoder, [{ buffer: this.#fullRead, bytes: bytes * 2 }]);
    const template = this.#config.cpu(1, 1, 1).snapshot();
    const result = {
      ...template,
      width: this.width,
      height: this.height,
      depth: this.depth,
      tick: this.#tick,
      packedCells: Array.from(this.#unpack(words.subarray(0, bytes / 4))),
      energyQ: Array.from(this.#unpack(words.subarray(bytes / 4))),
    };
    this.#config.validate(result);
    return result;
  }
  async snapshot() {
    return this.#run(() => this.#snapshot());
  }
  async restore(snapshot: VolumeSnapshot) {
    const state = this.#config.validate(snapshot);
    if (
      snapshot.width !== this.width ||
      snapshot.height !== this.height ||
      snapshot.depth !== this.depth
    )
      throw new Error('3D snapshot geometry differs from the field.');
    const tick = snapshot.tick;
    return this.#run(async () => {
      this.#activityCache = undefined;
      this.#device.queue.writeBuffer(
        this.#cells[0],
        0,
        this.#pack(state.grid) as Uint32Array<ArrayBuffer>,
      );
      this.#device.queue.writeBuffer(
        this.#energy[0],
        0,
        this.#pack(state.energyQ) as Uint32Array<ArrayBuffer>,
      );
      if (this.#activity) {
        this.#device.queue.writeBuffer(
          this.#cells[1],
          0,
          this.#pack(state.grid) as Uint32Array<ArrayBuffer>,
        );
        this.#device.queue.writeBuffer(
          this.#energy[1],
          0,
          this.#pack(state.energyQ) as Uint32Array<ArrayBuffer>,
        );
        this.#device.queue.writeBuffer(this.#activity, 16, new Uint32Array(6));
        this.#wakeAll();
      }
      await this.#device.queue.onSubmittedWorkDone();
      if (this.#activity) await this.prepareActivity();
      this.#current = 0;
      this.#tick = tick;
      this.#initial = total(state.energyQ);
      this.#external = 0n;
      this.#lastTicks = 0;
      this.#invalidate();
      this.#revision++;
    });
  }
  async sample(x: number, y: number, z: number) {
    checkedInteger(x, 0, this.width - 1, 'x');
    checkedInteger(y, 0, this.height - 1, 'y');
    checkedInteger(z, 0, this.depth - 1, 'z');
    const cpu = this.#config.cpu(this.width, this.height, this.depth);
    cpu.restore(await this.snapshot());
    return cpu.sample(x, y, z);
  }
  async setCell(x: number, y: number, z: number, material: number, thermal?: number) {
    await this.step(0, {
      edits: [{ x, y, z, material, ...(thermal === undefined ? {} : { thermal }) }],
    });
  }
  async setEnergy(x: number, y: number, z: number, energyQ: number) {
    await this.step(0, { edits: [{ x, y, z, energyQ }] });
  }
  async energyBalance() {
    const s = await this.snapshot();
    const currentQ = total(s.energyQ);
    return {
      initialQ: this.#initial,
      externalQ: this.#external,
      currentQ,
      driftQ: currentQ - this.#initial - this.#external,
    };
  }
  async inspectPass(passIndex: number) {
    checkedInteger(passIndex, 0, 26, 'pass index');
    return this.#run(async () => {
      this.#activityCache = undefined;
      const p = volumeSchedule(this.#tick)[passIndex],
        params = this.#parameters(1);
      this.#shape(params, 0);
      params.set([KINDS.indexOf(p.kind), p.axis, p.parity, p.direction >>> 0, this.#tick >>> 0], 4);
      this.#device.queue.writeBuffer(this.#uniform, 0, params);
      this.#device.pushErrorScope('validation');
      const e = this.#device.createCommandEncoder();
      const pass = e.beginComputePass();
      pass.setBindGroup(0, this.#groups[this.#current], [0]);
      if (this.#activity) {
        this.#wakeAll();
        pass.setPipeline(this.#stages.collectWork);
        pass.setBindGroup(0, this.#stageGroups.collectWork);
        pass.dispatchWorkgroups(1);
      }
      pass.setPipeline(this.#pipeline);
      pass.setBindGroup(0, this.#groups[this.#current], [0]);
      if (this.#activity) pass.dispatchWorkgroupsIndirect(this.#indirect[this.#current], 0);
      else pass.dispatchWorkgroups(Math.ceil((this.width * this.height * this.depth) / 64));
      pass.end();
      await this.#finish(e);
      const result = await this.#snapshot(1 - this.#current);
      this.#wakeAll();
      return result;
    });
  }
  #encodeActivityRead(e: GPUCommandEncoder) {
    e.copyBufferToBuffer(this.#activity!, 0, this.#activityRead!, 0, this.#activity!.size);
    e.copyBufferToBuffer(
      this.#dirty,
      0,
      this.#activityRead!,
      this.#activity!.size,
      this.#dirty.size,
    );
    return this.#activity!.size + this.#dirty.size;
  }
  #activityInfo(words?: Uint32Array): Activity3D {
    const storageChunks = this.#config.chunkSize
        ? (this.width * this.height * this.depth) / this.#config.chunkSize ** 3
        : 1,
      count = this.#activity
        ? (this.width * this.height * this.depth) / this.#activeEdge ** 3
        : storageChunks,
      dense = count * 27 * this.#lastTicks,
      activityChunkSize = this.#activeEdge || this.#config.chunkSize || this.width;
    if (!this.#activity)
      return {
        mode: 'dense',
        tick: this.#tick,
        totalChunks: count,
        activityChunkSize,
        storageChunks,
        awake: Array(count).fill(1),
        wakeReasons: Array(count).fill(0),
        dispatchedChunks: dense,
        denseChunks: dense,
        peakChunks: count,
        sleepingChunks: 0,
      };
    if (!words) throw new Error('Missing activity readback.');
    const awake = Array.from(words.subarray(16, 16 + count));
    return {
      mode: 'sparse',
      tick: this.#tick,
      totalChunks: count,
      activityChunkSize,
      storageChunks,
      awake,
      wakeReasons: Array.from(words.subarray(16 + 3 * count, 16 + 4 * count)),
      terrainDirty: Array.from(words.subarray(16 + 4 * count)),
      dispatchedChunks: words[4],
      denseChunks: dense,
      peakChunks: words[5],
      sleepingChunks: awake.filter((v) => v === 0).length,
      plannerBuilds: words[8],
      plannerReuses: words[9],
    };
  }
  async inspectActivity(): Promise<Activity3D> {
    return this.#run(async () => {
      if (!this.#activity || this.#activityCache) return this.#activityInfo(this.#activityCache);
      this.#device.pushErrorScope('validation');
      const e = this.#device.createCommandEncoder();
      const bytes = this.#encodeActivityRead(e);
      const [words] = await this.#finish(e, [{ buffer: this.#activityRead!, bytes }]);
      return this.#activityInfo(words);
    });
  }
  async createGameplay(
    initial: GameplayState3D,
    rules: GameplayRules3D,
  ): Promise<ResidentGameplay3D> {
    if (!this.#config.chunkSize || Math.min(this.width, this.height, this.depth) < 16)
      throw new Error('Resident gameplay requires chunked dimensions of at least 16.');
    if (this.#gameplay) throw new Error('A field supports one resident gameplay controller.');
    const shape = [this.width, this.height, this.depth];
    let state: GameplayState3D = checkedGameplayState(initial, shape);
    const checkedRules = checkedGameplayRules(rules, shape);
    return this.#run(async () => {
      const resources = await makeGameplayResources(
        this.#device,
        shape,
        this.#config.chunkSize,
        this.#cold,
        this.#dirty,
        this.#activity,
        checkedRules,
        this.#profiler,
      );
      let closed = false,
        revision = this.#revision;
      const initialize = async (s: GameplayState3D) => {
        resources.writeState(s);
        this.#device.pushErrorScope('validation');
        const e = this.#device.createCommandEncoder();
        resources.initialize(e, this.#cells[this.#current], this.#energy[this.#current]);
        await this.#finish(e);
        state = s;
        revision = this.#revision;
      };
      const available = () => {
        if (closed) throw new Error('Resident gameplay is closed.');
        if (revision !== this.#revision)
          throw new Error(
            'Terrain changed outside resident gameplay; restore the actor before continuing.',
          );
      };
      const execute = async (
        command: GameplayCommand3D | undefined,
        presentation?: GameplayPresentation3D,
      ) => {
        available();
        const c = command
          ? checkedGameplayCommand(command, this.#tick + 1)
          : {
              tick: this.#tick,
              moveX: 0,
              moveZ: 0,
              jump: false,
              tool: 'none' as const,
              look: state.look,
            };
        let renderer: ResidentChunkRenderer | undefined, camera: TerrainCamera | undefined;
        if (presentation) {
          renderer = this.#chunkRenderers.get(presentation.renderer);
          if (!renderer) throw new Error('Renderer does not belong to this field.');
          const view = presentation.camera;
          if (!view || Object.keys(view).some((k) => !['forward', 'right', 'up'].includes(k)))
            throw new Error('Resident view contains unsupported fields.');
          camera = {
            eye: [state.player.x / 256, (state.player.y - 400) / 256, state.player.z / 256],
            forward: Array.from(view.forward ?? []),
            right: Array.from(view.right ?? []),
            up: Array.from(view.up ?? []),
          };
          renderer.validateCamera(camera);
          const axes = [camera.forward, camera.right, camera.up];
          for (let i = 0; i < 3; i++)
            for (let j = i; j < 3; j++) {
              const dot = axes[i].reduce((sum, v, k) => sum + v * axes[j][k], 0);
              if (Math.abs(dot - (i === j ? 1 : 0)) > 1e-5)
                throw new Error('Resident camera axes must be orthonormal.');
            }
        }
        return this.#run(async () => {
          const view = camera ? camera.forward.map((v) => Math.round(v * 256)) : c.look;
          // Validation and parameter uploads precede any mutating dispatch.
          resources.prepare(c, view);
          const trace = this.#profiler.begin('gameplay', c.tick);
          let slot = 2;
          if (command) {
            const params = this.#parameters(29);
            this.#shape(params, 0);
            for (const p of volumeSchedule(this.#tick)) {
              this.#shape(params, slot);
              params.set(
                [KINDS.indexOf(p.kind), p.axis, p.parity, p.direction >>> 0, this.#tick >>> 0],
                slot * 64 + 4,
              );
              slot++;
            }
            this.#device.queue.writeBuffer(this.#uniform, 0, params);
          }
          this.#profiler.mark(trace, 'preparedAt');
          this.#device.pushErrorScope('validation');
          const e = this.#device.createCommandEncoder();
          let current = this.#current;
          if (command) {
            if (this.#activity) {
              e.clearBuffer(this.#activity, 16, 24);
              e.clearBuffer(
                this.#activity,
                (16 + 3 * this.#activityZeros.length) * 4,
                this.#activityZeros.byteLength,
              );
            }
            resources.tools(
              e,
              this.#cells[current],
              this.#energy[current],
              c.tool !== 'none' && state.player.cooldown <= 1 && state.status !== 'lost',
              trace,
            );
            current = this.#encodePhysics(e, slot, current, trace);
            resources.controller(e, this.#cells[current], this.#energy[current], trace);
          } else resources.present(e, this.#cells[current], this.#energy[current], trace);
          if (renderer && camera)
            renderer.encode(e, camera, this.#cells[current], resources.result, trace, c.tick);
          e.copyBufferToBuffer(resources.result, 0, resources.read, 0, 512);
          const reads = [{ buffer: resources.read, bytes: 512 }],
            interval = this.#config.activityReadbackInterval ?? 0;
          const sampleActivity = Boolean(
            this.#activity && command && interval && c.tick % interval === 0,
          );
          if (sampleActivity)
            reads.push({ buffer: this.#activityRead!, bytes: this.#encodeActivityRead(e) });
          const values = await this.#finish(e, reads, trace);
          let commit;
          try {
            commit = resources.decode(values[0], c.tick);
          } catch (error) {
            this.#fault = String(error);
            throw error;
          }
          if (command) {
            for (let i = 0; i < values[0][15]; i++)
              this.#external += BigInt(values[0][65 + i * 2]) - BigInt(values[0][64 + i * 2]);
            this.#current = current;
            this.#tick = c.tick;
            this.#lastTicks = 1;
            this.#revision++;
            revision = this.#revision;
          }
          this.#activityCache = sampleActivity ? values[1] : undefined;
          state = {
            player: { ...commit.player },
            look: [...commit.look],
            status: commit.status,
            carved: commit.carved,
            iceWalk: commit.iceWalk,
          };
          this.#profiler.mark(trace, 'completedAt');
          return commit;
        });
      };
      const driver: ResidentGameplay3D = {
        step: (c, p) => execute(checkedGameplayCommand(c, this.#tick + 1), p),
        present: (p) => {
          if (!p) throw new Error('A gameplay presentation is required.');
          return execute(undefined, p);
        },
        restore: (s) => {
          if (closed) throw new Error('Resident gameplay is closed.');
          const checked = checkedGameplayState(s, shape);
          return this.#run(() => initialize(checked));
        },
        close: () => {
          if (closed) return;
          if (this.#busy) throw new Error('Cannot close gameplay with an operation in flight.');
          closed = true;
          resources.close();
          this.#gameplay = undefined;
        },
      };
      try {
        await initialize(state);
        this.#gameplay = driver;
        return Object.freeze(driver);
      } catch (error) {
        resources.close();
        throw error;
      }
    });
  }
  async createRenderer(canvas: HTMLCanvasElement): Promise<TerrainRenderer> {
    if (this.#config.chunkSize && this.#worldRenderer)
      throw new Error('A world supports one terrain cache per field.');
    return this.#run(async () => {
      this.#activityCache = undefined;
      const renderer = this.#config.chunkSize
        ? await makeChunkRenderer(
            this.#device,
            canvas,
            () => ({
              grid: this.#cells[this.#current],
              shape: [this.width, this.height, this.depth],
            }),
            this.#dirty,
            this.#config.chunkSize,
            this.#profiler,
            () => this.#tick,
          )
        : await makeTerrainRenderer(
            this.#device,
            canvas,
            () => ({
              grid: this.#cells[this.#current],
              shape: [this.width, this.height, this.depth],
            }),
            this.#profiler,
            () => this.#tick,
          );
      let rendererClosed = false;
      const wrapped = {
        ...(renderer.setStyle
          ? { setStyle: (value: TerrainStyleOptions) => this.#run(() => renderer.setStyle!(value)) }
          : {}),
        ...(renderer.inspectStyle
          ? { inspectStyle: () => this.#run(() => renderer.inspectStyle!()) }
          : {}),
        ...(renderer.setLightingMode
          ? {
              setLightingMode: (value: TerrainLightingMode) =>
                this.#run(() => renderer.setLightingMode!(value)),
            }
          : {}),
        ...(renderer.setHeatDistortion
          ? {
              setHeatDistortion: (value: boolean) =>
                this.#run(() => renderer.setHeatDistortion!(value)),
            }
          : {}),
        ...(renderer.setAppearance
          ? {
              setAppearance: (value: TerrainAppearance) =>
                this.#run(() => renderer.setAppearance!(value)),
            }
          : {}),
        render: (camera: TerrainCamera) =>
          this.#run(() => {
            this.#activityCache = undefined;
            return renderer.render(camera);
          }),
        close: () => {
          if (rendererClosed) return;
          if (this.#busy) throw new Error('Cannot close terrain with an operation in flight.');
          renderer.close();
          rendererClosed = true;
          this.#worldRenderer = false;
          this.#chunkRenderers.delete(wrapped);
        },
        ...(renderer.inspectMesh
          ? { inspectMesh: () => this.#run(() => renderer.inspectMesh!()) }
          : {}),
      };
      this.#renderers.push(wrapped);
      this.#worldRenderer = Boolean(this.#config.chunkSize);
      if (this.#config.chunkSize)
        this.#chunkRenderers.set(wrapped, renderer as ResidentChunkRenderer);
      return wrapped;
    });
  }
  close() {
    if (this.#closed) return;
    if (this.#busy) throw new Error('Cannot close a field with an operation in flight.');
    this.#closed = true;
    this.#gameplay?.close();
    this.#renderers.forEach((r) => r.close());
    this.#profiler.close();
    this.#buffers.forEach((b) => b.destroy());
    this.#device.destroy();
  }
}

export type ResidentConfig = {
  profiling?: boolean;
  gpuTiming?: boolean;
  chunkSize: number;
  sparse?: boolean;
  activityReadbackInterval?: number;
  cpu: (w: number, h: number, d: number, fill?: number) => import('../3d.js').StateSpaceField3D;
  validate: typeof validateVolumeSnapshot;
};
export async function createResidentVolume(
  initial: VolumeSnapshot,
  config: ResidentConfig,
): Promise<GpuVolume3D> {
  const { width, height, depth } = initial;
  if (!globalThis.navigator?.gpu) throw new Error('WebGPU is required for GPU 3D fields.');
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('No WebGPU adapter.');
  if (config.profiling !== undefined && typeof config.profiling !== 'boolean')
    throw new Error('Invalid profiling option.');
  if (config.gpuTiming !== undefined && typeof config.gpuTiming !== 'boolean')
    throw new Error('Invalid GPU timing option.');
  const device = await adapter.requestDevice({
    requiredFeatures:
      config.profiling && config.gpuTiming && adapter.features.has('timestamp-query')
        ? ['timestamp-query']
        : [],
  });
  try {
    const shaders = config.sparse
      ? activeShaders(
          config.chunkSize,
          (width * height * depth) / Math.min(config.chunkSize, 8) ** 3,
        )
      : chunkShaders(config.chunkSize);
    // Geometry is immutable for this field. Compile addresses against constants
    // so power-of-two chunk/world divisions become shifts, without changing the
    // global coordinates, pair ownership or uniform-buffer ABI.
    const shape = `const SHAPE=vec4u(${width}u,${height}u,${depth}u,${width * height * depth}u);\n`;
    const specialize = (code: string) => shape + code.replaceAll('p.shape', 'SHAPE');
    const module = await compile(device, specialize(shaders.physics)),
      access = await compile(device, specialize(shaders.access));
    const layout = device.createBindGroupLayout({
      entries: [0, 1, 2, 3, 4, 5, 6, ...(config.sparse ? [7, 8] : [])].map((binding) => ({
        binding,
        visibility: GPUShaderStage.COMPUTE,
        buffer:
          binding === 5
            ? { type: 'uniform', hasDynamicOffset: true, minBindingSize: 48 }
            : {
                type:
                  binding === 2 || binding === 3 || binding === 6 || binding === 7 || binding === 8
                    ? 'storage'
                    : 'read-only-storage',
              },
      })),
    });
    const pipeline = await device.createComputePipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module, entryPoint: 'main' },
    });
    const edit = await device.createComputePipelineAsync({
      layout: 'auto',
      compute: { module: access, entryPoint: 'edit' },
    });
    const query = await device.createComputePipelineAsync({
      layout: 'auto',
      compute: { module: access, entryPoint: 'query' },
    });
    const stages: Record<string, GPUComputePipeline> = {};
    if (config.sparse)
      for (const entryPoint of ['collectWork', 'certify', 'commitCert'])
        stages[entryPoint] = await device.createComputePipelineAsync({
          label: 'active-' + entryPoint,
          layout:
            entryPoint === 'collectWork'
              ? 'auto'
              : device.createPipelineLayout({ bindGroupLayouts: [layout] }),
          compute: { module, entryPoint },
        });
    const info = adapter.info;
    const field = new ResidentVolume(
      width,
      height,
      depth,
      initial,
      device,
      pipeline,
      edit,
      query,
      {
        vendor: info.vendor,
        architecture: info.architecture,
        device: info.device,
        description: info.description,
        isFallbackAdapter: info.isFallbackAdapter,
      },
      config,
      stages,
    );
    if (config.sparse) await field.prepareActivity();
    return field;
  } catch (error) {
    device.destroy();
    throw error;
  }
}
