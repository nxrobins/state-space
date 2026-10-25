import { afterEach, expect, test, vi } from 'vitest';
import { LatencyProfiler } from './latency.js';

afterEach(() => vi.unstubAllGlobals());
function fakeDevice(supported = true, timestamps = [1000n, 251000n]) {
  vi.stubGlobal('GPUBufferUsage', { QUERY_RESOLVE: 1, COPY_SRC: 2, COPY_DST: 4, MAP_READ: 8 });
  vi.stubGlobal('GPUMapMode', { READ: 1 });
  const maps: { resolve: () => void; reject: (error: Error) => void }[] = [];
  const buffers: { destroy: ReturnType<typeof vi.fn> }[] = [];
  const device = {
    features: new Set(supported ? ['timestamp-query'] : []),
    createQuerySet: vi.fn(() => ({ destroy: vi.fn() })),
    createBuffer: vi.fn(() => {
      const b = {
        mapState: 'unmapped',
        destroy: vi.fn(),
        mapAsync: () =>
          new Promise<void>((resolve, reject) =>
            maps.push({
              resolve: () => {
                b.mapState = 'mapped';
                resolve();
              },
              reject,
            }),
          ),
        getMappedRange: () => new BigUint64Array(timestamps).buffer,
        unmap: () => {
          b.mapState = 'unmapped';
        },
      };
      buffers.push(b);
      return b;
    }),
  };
  return { device: device as unknown as GPUDevice, maps, buffers };
}
test('timestamp readback is bounded and never blocks or submits simulation work', async () => {
  const { device, maps, buffers } = fakeDevice();
  const cpuOnly = new LatencyProfiler(device, true);
  cpuOnly.begin('step', 0);
  expect(cpuOnly.snapshot().records[0].gpu.status).toBe('disabled');
  expect(buffers).toHaveLength(0);
  const p = new LatencyProfiler(device, true, true),
    encoder = {
      resolveQuerySet: vi.fn(),
      copyBufferToBuffer: vi.fn(),
    } as unknown as GPUCommandEncoder;
  for (let tick = 1; tick <= 40; tick++) {
    const trace = p.begin('step', tick)!;
    p.pass(trace, 'physics');
    p.resolve(encoder, trace);
    p.submitted(trace);
    p.mark(trace, 'completedAt');
  }
  expect(maps).toHaveLength(3);
  expect(buffers).toHaveLength(6);
  expect(p.snapshot().records).toHaveLength(32);
  expect(p.snapshot().records.at(-1)!.gpu.status).toBe('busy');
  maps.forEach((m) => m.resolve());
  await p.settle();
  const trace = p.begin('render', 41)!;
  p.pass(trace, 'draw');
  p.submitted(trace);
  maps.at(-1)!.resolve();
  await p.settle();
  const saved = p.snapshot();
  expect(saved.records.at(-1)!.gpu.ms.draw).toBe(0.25);
  saved.records.at(-1)!.gpu.ms.draw = 99;
  saved.records.at(-1)!.cpu.startedAt = -1;
  expect(p.snapshot().records.at(-1)!.gpu.ms.draw).toBe(0.25);
  expect(p.snapshot(trace.record.id).records).toHaveLength(0);
  p.close();
  expect(buffers.every((b) => b.destroy.mock.calls.length === 1)).toBe(true);
});
test('disabled and unsupported diagnostics allocate no GPU resources; mapping errors remain visible', async () => {
  const f = fakeDevice(false),
    disabled = new LatencyProfiler(f.device);
  expect(disabled.begin('step', 1)).toBeUndefined();
  expect(f.buffers).toHaveLength(0);
  const cpu = new LatencyProfiler(f.device, true, true),
    trace = cpu.begin('step', 2);
  expect(cpu.pass(trace, 'physics')).toEqual({});
  expect(cpu.snapshot().records[0].gpu.status).toBe('unsupported');
  expect(f.buffers).toHaveLength(0);
  const g = fakeDevice(),
    gpu = new LatencyProfiler(g.device, true, true),
    t = gpu.begin('step', 1);
  gpu.pass(t, 'physics');
  gpu.submitted(t);
  g.maps[0].reject(new Error('device lost'));
  await gpu.settle();
  expect(gpu.snapshot().records[0].gpu.status).toBe('error');
  expect(gpu.snapshot().records[0].gpu.error).toContain('device lost');
  expect(() => gpu.snapshot(-1)).toThrow('cursor');
  gpu.close();
});

test('volumetric gameplay fits the fixed ten-pass timestamp allocation', () => {
  const { device } = fakeDevice(),
    p = new LatencyProfiler(device, true, true),
    trace = p.begin('step', 1)!;
  for (let i = 0; i < 10; i++) {
    const writes = p.pass(trace, `pass${i}`).timestampWrites!;
    expect(writes.beginningOfPassWriteIndex).toBe(i * 2);
    expect(writes.endOfPassWriteIndex).toBe(i * 2 + 1);
  }
  expect(() => p.pass(trace, 'overflow')).toThrow('capacity');
  expect(trace.labels).toHaveLength(10);
  expect(device.createQuerySet).toHaveBeenCalledWith({ type: 'timestamp', count: 20 });
  p.close();
});

test('structural timing supports bounded multi-pass batches and sums repeated stages', async () => {
  const { device, maps } = fakeDevice(
    true,
    Array.from({ length: 128 }, (_, i) => BigInt(i) * 100000n),
  );
  const p = new LatencyProfiler(device, true, true, 64),
    trace = p.begin('step', 1)!;
  const encoder = {
    resolveQuerySet: vi.fn(),
    copyBufferToBuffer: vi.fn(),
  } as unknown as GPUCommandEncoder;
  for (let i = 0; i < 64; i++) p.pass(trace, 'loadLevel');
  expect(() => p.pass(trace, 'overflow')).toThrow('capacity');
  p.resolve(encoder, trace);
  p.submitted(trace);
  maps[0].resolve();
  await p.settle();
  expect(p.snapshot().records[0].gpu.ms.loadLevel).toBeCloseTo(6.4);
  expect(device.createQuerySet).toHaveBeenCalledWith({ type: 'timestamp', count: 128 });
  expect(encoder.copyBufferToBuffer).toHaveBeenCalledWith(
    expect.anything(),
    0,
    expect.anything(),
    0,
    1024,
  );
  p.close();
  for (const capacity of [0, 129, 1.5, NaN])
    expect(() => new LatencyProfiler(device, true, true, capacity)).toThrow('capacity');
});
