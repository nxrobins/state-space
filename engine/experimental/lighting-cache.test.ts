/** CPU/mocked-device regressions. Not GPU conformance or replay evidence. */
import { afterEach, expect, test, vi } from 'vitest';
import { lightingCacheLayout, lightIntersectsRegion, makeLightingCache } from './lighting-cache.js';
import { cavernShaders } from './cavern-appearance.js';
vi.mock('./rock-textures.js', () => ({ ROCK_TEXTURES: [] }));

afterEach(() => vi.unstubAllGlobals());

test('rectangular hierarchy has disjoint complete levels and a bounded allocation', () => {
  const layout = lightingCacheLayout([12, 8, 4]);
  expect(layout.levels.map((l) => l.shape)).toEqual([
    [3, 2, 1],
    [2, 1, 1],
    [1, 1, 1],
  ]);
  expect(layout.levels.map((l) => l.offset)).toEqual([0, 6, 8]);
  expect(layout.hierarchyWords).toBe(9);
  expect(layout.regionCount).toBe(2);
  const largest = lightingCacheLayout([128, 128, 128]);
  expect(
    largest.hierarchyWords * 4 + largest.regionCount * largest.regionStride * 4 + 128 ** 3 * 4,
  ).toBeLessThan(11 * 1024 ** 2);
  expect(lightingCacheLayout([1, 1, 1]).hierarchyWords).toBe(1);
  expect(lightingCacheLayout([9, 5, 1]).levels.map((l) => l.shape)).toEqual([
    [3, 2, 1],
    [2, 1, 1],
    [1, 1, 1],
  ]);
  for (const shape of [
    [0, 8, 8],
    [1.5, 8, 8],
    [256, 8, 8],
    [8, 8],
    [NaN, 8, 8],
  ])
    expect(() => lightingCacheLayout(shape)).toThrow();
});

test('regional culling never excludes an influencing source across a seam', () => {
  // Independent point-distance oracle at corners, seams and interior points.
  const points = [
    [0, 0, 0],
    [7.999, 3, 2],
    [8, 3, 2],
    [15.999, 7.999, 7.999],
    [12, 4, 4],
  ];
  for (const point of points)
    for (const light of [
      [-14, 4, 4],
      [30, 4, 4],
      [8, 25, 4],
      [8, 4, 25],
      [60, 4, 4],
    ]) {
      const distance = Math.hypot(...light.map((v, a) => v - point[a]));
      if (distance <= 22)
        expect(
          lightIntersectsRegion(
            light,
            point.map((v) => Math.floor(v / 8)),
            22,
          ),
        ).toBe(true);
    }
  expect(lightIntersectsRegion([30, 4, 4], [0, 0, 0], 22)).toBe(true);
  expect(lightIntersectsRegion([30.001, 4, 4], [0, 0, 0], 22)).toBe(false);
});

test('wide lists conservatively cover a 48-cell fog ray plus its source radius', () => {
  const eye = [7.9, 7.9, 7.9],
    region = [0, 0, 0];
  for (const direction of [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
    [-1, -1, -1],
  ]) {
    const length = Math.hypot(...direction),
      light = eye.map((p, a) => p + (direction[a] / length) * 70);
    expect(lightIntersectsRegion(light, region, 70)).toBe(true);
  }
});

function fakeDevice(fail = false) {
  vi.stubGlobal('GPUBufferUsage', { STORAGE: 128, COPY_DST: 8, UNIFORM: 64 });
  const buffers: { size: number; destroy: ReturnType<typeof vi.fn> }[] = [],
    writes: { buffer: GPUBuffer; data: number[] }[] = [];
  const device = {
    createBuffer: vi.fn((d: GPUBufferDescriptor) => {
      const b = { size: d.size, destroy: vi.fn() };
      buffers.push(b);
      return b;
    }),
    createShaderModule: vi.fn(() => ({
      getCompilationInfo: async () => ({
        messages: fail ? [{ type: 'error', lineNum: 1, message: 'injected shader failure' }] : [],
      }),
    })),
    createComputePipelineAsync: vi.fn(async () => ({ getBindGroupLayout: () => ({}) })),
    createBindGroup: vi.fn((d: GPUBindGroupDescriptor) => d),
    queue: {
      writeBuffer: vi.fn((buffer: GPUBuffer, _offset: number, data: Uint32Array) =>
        writes.push({ buffer, data: Array.from(data) }),
      ),
      submit: vi.fn(),
    },
  };
  return { device: device as unknown as GPUDevice, raw: device, buffers, writes };
}

test('cache encoding stays inside the caller submission and never owns physics buffers', async () => {
  const fake = fakeDevice(),
    grid = {} as GPUBuffer,
    otherGrid = {} as GPUBuffer,
    lights = {} as GPUBuffer,
    dirty = {} as GPUBuffer;
  const cache = await makeLightingCache(
    fake.device,
    cavernShaders([8, 8, 8], 4, 384).common,
    [8, 8, 8],
    4,
    lights,
    dirty,
  );
  const pass = {
    setPipeline: vi.fn(),
    setBindGroup: vi.fn(),
    dispatchWorkgroups: vi.fn(),
    end: vi.fn(),
  };
  const raw = { clearBuffer: vi.fn(), beginComputePass: vi.fn(() => pass) },
    encoder = raw as unknown as GPUCommandEncoder;
  cache.encode(encoder, grid);
  cache.encode(encoder, otherGrid);
  cache.invalidate();
  cache.encode(encoder, grid);
  // Three encodes may be recorded before submission. Force values must be
  // captured by their bind groups, not three writes to one mutable uniform.
  expect(fake.writes.map((w) => w.data[0])).toEqual([1]);
  const forceFor = (call: number) => {
    const group = pass.setBindGroup.mock.calls[call][1] as GPUBindGroupDescriptor;
    return (Array.from(group.entries).find((e) => e.binding === 8)!.resource as GPUBufferBinding)
      .buffer;
  };
  const stages = pass.setPipeline.mock.calls.length / 3;
  expect(forceFor(0)).toBe(fake.writes[0].buffer);
  expect(forceFor(stages)).not.toBe(forceFor(0));
  expect(forceFor(stages * 2)).toBe(forceFor(0));
  expect(
    fake.writes.every(
      (w) =>
        w.buffer !== grid && w.buffer !== otherGrid && w.buffer !== lights && w.buffer !== dirty,
    ),
  ).toBe(true);
  expect(fake.raw.queue.submit).not.toHaveBeenCalled();
  expect(raw.clearBuffer).toHaveBeenCalledTimes(3);
  cache.close();
  cache.close();
  expect(fake.buffers.every((b) => b.destroy.mock.calls.length === 1)).toBe(true);
  expect(() => cache.encode(encoder, grid)).toThrow('closed');
  expect(() => cache.invalidate()).toThrow('closed');
});

test('failed encoding retains a full rebuild and closes the opened pass', async () => {
  const fake = fakeDevice(),
    grid = {} as GPUBuffer;
  const cache = await makeLightingCache(
    fake.device,
    cavernShaders([8, 8, 8], 4, 384).common,
    [8, 8, 8],
    4,
    {} as GPUBuffer,
    {} as GPUBuffer,
  );
  const pass = {
    setPipeline: vi.fn(),
    setBindGroup: vi.fn(),
    dispatchWorkgroups: vi.fn().mockImplementationOnce(() => {
      throw Error('injected encoding failure');
    }),
    end: vi.fn(),
  };
  const encoder = {
    clearBuffer: vi.fn(),
    beginComputePass: vi.fn(() => pass),
  } as unknown as GPUCommandEncoder;
  expect(() => cache.encode(encoder, grid)).toThrow('injected encoding failure');
  expect(pass.end).toHaveBeenCalledTimes(1);
  const first = pass.setBindGroup.mock.calls[0][1];
  pass.setBindGroup.mockClear();
  cache.encode(encoder, grid);
  expect(pass.setBindGroup.mock.calls[0][1]).toBe(first);
  expect(pass.end).toHaveBeenCalledTimes(2);
  expect(fake.raw.queue.submit).not.toHaveBeenCalled();
  cache.close();
});

test('bind-group failure does not consume invalidation or open a compute pass', async () => {
  const fake = fakeDevice(),
    grid = {} as GPUBuffer;
  const cache = await makeLightingCache(
    fake.device,
    cavernShaders([8, 8, 8], 4, 384).common,
    [8, 8, 8],
    4,
    {} as GPUBuffer,
    {} as GPUBuffer,
  );
  const pass = {
    setPipeline: vi.fn(),
    setBindGroup: vi.fn(),
    dispatchWorkgroups: vi.fn(),
    end: vi.fn(),
  };
  const beginComputePass = vi.fn(() => pass),
    encoder = { clearBuffer: vi.fn(), beginComputePass } as unknown as GPUCommandEncoder;
  fake.raw.createBindGroup.mockImplementationOnce(() => {
    throw Error('injected binding failure');
  });
  expect(() => cache.encode(encoder, grid)).toThrow('injected binding failure');
  expect(beginComputePass).not.toHaveBeenCalled();
  cache.encode(encoder, grid);
  const group = pass.setBindGroup.mock.calls[0][1] as GPUBindGroupDescriptor;
  expect(
    (Array.from(group.entries).find((e) => e.binding === 8)!.resource as GPUBufferBinding).buffer,
  ).toBe(fake.writes[0].buffer);
  cache.close();
});

test('failed cache compilation destroys its allocations without submitting a workload', async () => {
  const fake = fakeDevice(true);
  await expect(
    makeLightingCache(
      fake.device,
      cavernShaders([8, 8, 8], 4, 384).common,
      [8, 8, 8],
      4,
      {} as GPUBuffer,
      {} as GPUBuffer,
    ),
  ).rejects.toThrow('injected shader failure');
  expect(fake.buffers.every((b) => b.destroy.mock.calls.length === 1)).toBe(true);
  expect(fake.raw.queue.submit).not.toHaveBeenCalled();
});
