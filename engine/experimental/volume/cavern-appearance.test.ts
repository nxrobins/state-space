/** Source-level renderer integration with inert GPU objects. No native device. */
import { afterEach, expect, test, vi } from 'vitest';
import { makeCavernAppearance } from './cavern-appearance.js';
import { makeChunkRenderer } from './world-renderer.js';
import { resolveTerrainStyle, TERRAIN_STYLE_BYTES } from './terrain-style.js';

// Texture decoding/upload is outside this fixture. No fetch or image decoder.
vi.mock('../rock-textures.js', () => ({ ROCK_TEXTURES: [] }));
afterEach(() => vi.unstubAllGlobals());

function fakeRendererDevice() {
  vi.stubGlobal('GPUBufferUsage', {
    STORAGE: 128,
    COPY_DST: 8,
    COPY_SRC: 4,
    UNIFORM: 64,
    INDEX: 16,
    INDIRECT: 256,
  });
  vi.stubGlobal('GPUTextureUsage', { RENDER_ATTACHMENT: 16, TEXTURE_BINDING: 4 });
  const shaders: string[] = [],
    buffers: { size: number; destroy: ReturnType<typeof vi.fn> }[] = [];
  let failCache = false;
  const pass = {
    setPipeline: vi.fn(),
    setBindGroup: vi.fn(),
    dispatchWorkgroups: vi.fn(),
    draw: vi.fn(),
    end: vi.fn(),
  };
  const encoder = {
    clearBuffer: vi.fn(),
    beginComputePass: vi.fn(() => pass),
    beginRenderPass: vi.fn(() => pass),
    finish: vi.fn(() => ({})),
  };
  const raw = {
    pushErrorScope: vi.fn(),
    popErrorScope: vi.fn(async () => null),
    createShaderModule: vi.fn(({ code }: { code: string }) => {
      shaders.push(code);
      return {
        getCompilationInfo: async () => ({
          messages:
            failCache && code.includes('fn candidatesMain')
              ? [{ type: 'error', lineNum: 1, message: 'injected cache compilation failure' }]
              : [],
        }),
      };
    }),
    createComputePipelineAsync: vi.fn(async () => ({ getBindGroupLayout: () => ({}) })),
    createRenderPipelineAsync: vi.fn(async () => ({ getBindGroupLayout: () => ({}) })),
    createBuffer: vi.fn((d: GPUBufferDescriptor) => {
      const b = { size: d.size, destroy: vi.fn() };
      buffers.push(b);
      return b;
    }),
    createBindGroup: vi.fn((d: GPUBindGroupDescriptor) => d),
    createTexture: vi.fn(() => ({ createView: () => ({}), destroy: vi.fn() })),
    createSampler: vi.fn(() => ({})),
    createCommandEncoder: vi.fn(() => encoder),
    queue: { writeBuffer: vi.fn(), submit: vi.fn(), onSubmittedWorkDone: vi.fn(async () => {}) },
  };
  return {
    device: raw as unknown as GPUDevice,
    raw,
    shaders,
    buffers,
    encoder: encoder as unknown as GPUCommandEncoder,
    failCache(value: boolean) {
      failCache = value;
    },
  };
}

async function fixture() {
  const fake = fakeRendererDevice();
  const appearance = await makeCavernAppearance(
    fake.device,
    'bgra8unorm',
    [8, 8, 8],
    4,
    384,
    {} as GPUBuffer,
    {} as GPUBuffer,
    {} as GPUBuffer,
  );
  const grid = {} as GPUBuffer,
    depth = { createView: () => ({}) } as unknown as GPUTexture;
  return {
    fake,
    appearance,
    prepare: (cached = false) =>
      appearance.prepare(fake.encoder, grid, depth, 32, 32, 7, true, cached),
  };
}

test('reference setup and rendering do not compile, allocate or bind the experimental cache', async () => {
  const { fake, appearance, prepare } = await fixture();
  await appearance.prepareLighting(false);
  prepare();
  expect(
    fake.shaders.every((s) => !s.includes('visibilityNodes') && !s.includes('candidatesMain')),
  ).toBe(true);
  expect(fake.buffers.map((b) => b.size)).toEqual([8 * 32, 9 * 4, 16, TERRAIN_STYLE_BYTES]);
  for (const [descriptor] of fake.raw.createBindGroup.mock.calls)
    expect(Array.from(descriptor.entries).every((e) => e.binding !== 9 && e.binding !== 10)).toBe(
      true,
    );
  appearance.close();
});

test('A/B uses separate pipelines and bindings while sharing the caller submission', async () => {
  const { fake, appearance, prepare } = await fixture(),
    reference = prepare();
  fake.raw.queue.submit.mockClear();
  await Promise.all([appearance.prepareLighting(true), appearance.prepareLighting(true)]);
  expect(fake.shaders.filter((s) => s.includes('fn candidatesMain'))).toHaveLength(1);
  const cached = prepare(true);
  expect(cached.draw).not.toBe(reference.draw);
  expect(
    Array.from((cached.group as unknown as GPUBindGroupDescriptor).entries).map((e) => e.binding),
  ).toContain(9);
  const again = prepare();
  expect(again.draw).toBe(reference.draw);
  expect(
    Array.from((again.group as unknown as GPUBindGroupDescriptor).entries).every(
      (e) => e.binding !== 9 && e.binding !== 10,
    ),
  ).toBe(true);
  expect(fake.raw.queue.submit).not.toHaveBeenCalled();
  appearance.close();
  appearance.close();
  expect(fake.buffers.every((b) => b.destroy.mock.calls.length === 1)).toBe(true);
});

test('failed B compilation releases cache allocations and leaves A usable for retry', async () => {
  const { fake, appearance, prepare } = await fixture(),
    reference = prepare();
  const retained = fake.buffers.length;
  fake.failCache(true);
  await expect(appearance.prepareLighting(true)).rejects.toThrow(
    'injected cache compilation failure',
  );
  expect(fake.buffers.slice(retained).every((b) => b.destroy.mock.calls.length === 1)).toBe(true);
  expect(fake.buffers.slice(0, retained).every((b) => !b.destroy.mock.calls.length)).toBe(true);
  expect(prepare().draw).toBe(reference.draw);
  expect(() => prepare(true)).toThrow('not been prepared');
  fake.failCache(false);
  await appearance.prepareLighting(true);
  expect(prepare(true).draw).not.toBe(reference.draw);
  appearance.close();
});

test('closing during cache setup cannot publish or leak a late cache', async () => {
  const { fake, appearance } = await fixture();
  let release!: () => void, entered!: () => void;
  const blocked = new Promise<void>((resolve) => {
      release = resolve;
    }),
    started = new Promise<void>((resolve) => {
      entered = resolve;
    });
  fake.raw.createComputePipelineAsync.mockImplementationOnce(async () => {
    entered();
    await blocked;
    return { getBindGroupLayout: () => ({}) };
  });
  const pending = appearance.prepareLighting(true);
  await started;
  appearance.close();
  release();
  await expect(pending).rejects.toThrow('closed');
  expect(fake.buffers.every((b) => b.destroy.mock.calls.length === 1)).toBe(true);
});

test('failed light-list initialization releases the source buffer', async () => {
  const fake = fakeRendererDevice();
  fake.raw.createComputePipelineAsync
    .mockResolvedValueOnce({ getBindGroupLayout: () => ({}) })
    .mockRejectedValueOnce(Error('injected light-list failure'));
  await expect(
    makeCavernAppearance(
      fake.device,
      'bgra8unorm',
      [8, 8, 8],
      4,
      384,
      {} as GPUBuffer,
      {} as GPUBuffer,
      {} as GPUBuffer,
    ),
  ).rejects.toThrow('injected light-list failure');
  expect(fake.buffers).toHaveLength(1);
  expect(fake.buffers[0].destroy).toHaveBeenCalledTimes(1);
});

test('style changes upload one owned uniform, share it across passes and add no submission', async () => {
  const { fake, appearance, prepare } = await fixture();
  const styleBuffer = fake.buffers.find((b) => b.size === TERRAIN_STYLE_BYTES)!;
  const input = resolveTerrainStyle({ profile: 'geological', tone: { exposureEV: -1 } });
  appearance.setStyle(input);
  input.tone.exposureEV = 4;
  fake.raw.queue.writeBuffer.mockClear();
  fake.raw.queue.submit.mockClear();
  prepare();
  const writes = fake.raw.queue.writeBuffer.mock.calls as unknown as [
    unknown,
    number,
    Float32Array,
  ][];
  const uploaded = writes.filter(([buffer]) => buffer === styleBuffer);
  expect(uploaded).toHaveLength(1);
  expect(uploaded[0][2][0]).toBeCloseTo(1.65 / 2);
  const styledGroups = fake.raw.createBindGroup.mock.calls
    .map(([d]) => Array.from(d.entries))
    .filter((entries) => entries.some((e) => e.binding === 12));
  expect(styledGroups).toHaveLength(3);
  for (const entries of styledGroups)
    expect(entries.find((e) => e.binding === 12)?.resource).toEqual({ buffer: styleBuffer });
  prepare();
  expect(
    fake.raw.queue.writeBuffer.mock.calls.filter(([buffer]) => buffer === styleBuffer),
  ).toHaveLength(1);
  expect(fake.raw.queue.submit).not.toHaveBeenCalled();
  const returned = appearance.inspectStyle();
  returned.tone.exposureEV = 2;
  expect(appearance.inspectStyle().tone.exposureEV).toBe(-1);
  expect(() => appearance.setStyle({ ...input, profile: 'bad' } as never)).toThrow();
  expect(appearance.inspectStyle().tone.exposureEV).toBe(-1);
  appearance.close();
  expect(styleBuffer.destroy).toHaveBeenCalledTimes(1);
  expect(() => appearance.setStyle(input)).toThrow('closed');
});

test('chunk renderer retains style before lazy setup and across diagnostic switches without touching physics', async () => {
  const fake = fakeRendererDevice();
  vi.stubGlobal('navigator', { gpu: { getPreferredCanvasFormat: () => 'bgra8unorm' } });
  const context = { configure: vi.fn(), unconfigure: vi.fn() };
  const canvas = { getContext: () => context } as unknown as HTMLCanvasElement;
  const state = vi.fn(() => ({ grid: {} as GPUBuffer, shape: [8, 8, 8] }));
  const renderer = await makeChunkRenderer(fake.device, canvas, state, {} as GPUBuffer, 4);
  state.mockClear();
  fake.raw.queue.writeBuffer.mockClear();
  const count = fake.buffers.length;
  const next = resolveTerrainStyle({ profile: 'geological' });
  await renderer.setStyle!(next);
  next.materials.rockTextureScale = 4;
  await expect(renderer.setStyle!({ tone: { exposureEV: Infinity } })).rejects.toThrow();
  expect((await renderer.inspectStyle!()).materials.rockTextureScale).toBe(0.28);
  expect(fake.buffers).toHaveLength(count);
  expect(fake.raw.queue.writeBuffer).not.toHaveBeenCalled();
  await renderer.setAppearance!('naturalistic');
  await renderer.setAppearance!('diagnostic');
  await renderer.setAppearance!('naturalistic');
  expect((await renderer.inspectStyle!()).profile).toBe('geological');
  expect(state).not.toHaveBeenCalled();
  renderer.close();
  await expect(renderer.inspectStyle!()).rejects.toThrow('closed');
});
