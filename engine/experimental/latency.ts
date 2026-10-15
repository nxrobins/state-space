/// <reference types="@webgpu/types" />
/** Bounded presentation diagnostics. Never used to choose physical work. */
import type { LatencyRecord, LatencySnapshot } from './3d-view.js';
type Slot = { query: GPUQuerySet; resolve: GPUBuffer; read: GPUBuffer; busy: boolean };
export type Trace = { record: LatencyRecord; slot?: Slot; labels: string[] };

export class LatencyProfiler {
  readonly enabled: boolean;
  readonly gpuTimestamps: boolean;
  readonly gpuTimingRequested: boolean;
  #slots: Slot[] = []; #records: LatencyRecord[] = []; #pending = new Set<Promise<void>>(); #next = 0;
  constructor(device: GPUDevice, enabled = false, gpuTiming = false) {
    this.enabled = enabled; this.gpuTimingRequested = enabled && gpuTiming; this.gpuTimestamps = this.gpuTimingRequested && device.features.has('timestamp-query');
    if (this.gpuTimestamps) for (let i = 0; i < 3; i++) this.#slots.push({
      query: device.createQuerySet({type: 'timestamp', count: 16}),
      resolve: device.createBuffer({size: 256, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC}),
      read: device.createBuffer({size: 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ}), busy: false,
    });
  }
  begin(kind: LatencyRecord['kind'], tick: number): Trace | undefined {
    if (!this.enabled) return;
    const slot = this.#slots.find(s => !s.busy);
    if (slot) slot.busy = true;
    const record: LatencyRecord = {id: ++this.#next, kind, tick, cpu: {startedAt: performance.now()},
      gpu: {status: slot ? 'pending' : this.gpuTimestamps ? 'busy' : this.gpuTimingRequested ? 'unsupported' : 'disabled', ms: {}}};
    this.#records.push(record); if (this.#records.length > 32) this.#records.shift();
    return {record, slot, labels: []};
  }
  mark(trace: Trace | undefined, name: string) { if (trace) trace.record.cpu[name] = performance.now(); }
  pass(trace: Trace | undefined, label: string): GPUComputePassDescriptor {
    if (!trace?.slot) return {};
    if (trace.labels.length >= 8) throw new Error('Latency query capacity exceeded.');
    const index = trace.labels.length * 2; trace.labels.push(label);
    return {timestampWrites: {querySet: trace.slot.query, beginningOfPassWriteIndex: index, endOfPassWriteIndex: index + 1}};
  }
  resolve(encoder: GPUCommandEncoder, trace?: Trace) {
    if (!trace?.slot || !trace.labels.length) return;
    encoder.resolveQuerySet(trace.slot.query, 0, trace.labels.length * 2, trace.slot.resolve, 0);
    encoder.copyBufferToBuffer(trace.slot.resolve, 0, trace.slot.read, 0, trace.labels.length * 16);
  }
  submitted(trace?: Trace) {
    this.mark(trace, 'submittedAt');
    if (!trace?.slot) return;
    const slot = trace.slot;
    if (!trace.labels.length) { slot.busy = false; trace.record.gpu.status = 'complete'; return; }
    // No extra submission or await in the gameplay path. Busy slots drop a
    // diagnostic sample, never a physical tick. Errors are retained explicitly.
    const pending = slot.read.mapAsync(GPUMapMode.READ, 0, trace.labels.length * 16).then(() => {
      const times = new BigUint64Array(slot.read.getMappedRange(0, trace.labels.length * 16));
      for (let i = 0; i < trace.labels.length; i++) {
        if (times[i * 2 + 1] < times[i * 2]) throw new Error('Non-monotonic GPU timestamps.');
        trace.record.gpu.ms[trace.labels[i]] = Number(times[i * 2 + 1] - times[i * 2]) / 1e6;
      }
      trace.record.gpu.status = 'complete';
    }).catch(error => { trace.record.gpu.status = 'error'; trace.record.gpu.error = String(error); })
      .finally(() => { if (slot.read.mapState === 'mapped') slot.read.unmap(); slot.busy = false; this.#pending.delete(pending); });
    this.#pending.add(pending);
  }
  snapshot(afterId = 0): LatencySnapshot {
    if(!Number.isSafeInteger(afterId)||afterId<0)throw new Error('Invalid latency cursor.');
    return {enabled: this.enabled, gpuTimingRequested: this.gpuTimingRequested, gpuTimestamps: this.gpuTimestamps, capacity: 32,
      records: this.#records.filter(r=>r.id>afterId).map(r => ({...r, cpu: {...r.cpu}, gpu: {...r.gpu, ms: {...r.gpu.ms}}}))};
  }
  /** For receipt finalization only, after the measured loop has stopped. */
  async settle() { await Promise.all(this.#pending); }
  close() { for (const s of this.#slots) { s.query.destroy(); s.resolve.destroy(); s.read.destroy(); } }
}
