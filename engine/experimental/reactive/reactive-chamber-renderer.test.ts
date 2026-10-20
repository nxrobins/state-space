import { afterEach, expect, test, vi } from 'vitest';
import { createChamber } from '../../../examples/reactive-chamber/scenario.js';
import { prepareScene, orbitCamera } from '../../../examples/reactive-chamber/presentation.js';
import { createChamberRenderer } from '../../../examples/reactive-chamber/renderer.js';
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test('worst completed frame survives eviction from the bounded timing history', async () => {
  vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2, STORAGE: 4 });
  vi.stubGlobal('GPUShaderStage', { VERTEX: 1 });
  let now = 0,
    duration = 30;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  // Only GPU completion is simulated; execute the renderer's real timing and history path.
  const device = {
    pushErrorScope() {},
    popErrorScope: async () => null,
    createShaderModule: () => ({ getCompilationInfo: async () => ({ messages: [] }) }),
    createBindGroupLayout: () => ({}),
    createPipelineLayout: () => ({}),
    createRenderPipelineAsync: async () => ({}),
    createBuffer: () => ({ destroy() {} }),
    createBindGroup: () => ({}),
    lost: new Promise(() => {}),
    queue: {
      writeBuffer() {},
      submit() {},
      onSubmittedWorkDone: async () => {
        now += duration;
      },
    },
    createCommandEncoder: () => ({
      beginRenderPass: () => ({ setPipeline() {}, setBindGroup() {}, draw() {}, end() {} }),
      finish: () => ({}),
    }),
  } as unknown as GPUDevice;
  const { registry, session } = await createChamber('collapse');
  const scene = prepareScene(registry, session.snapshot()),
    camera = orbitCamera(-0.65, 0.42, 16);
  const color = {
    width: 640,
    height: 400,
    format: 'rgba8unorm',
    createView: () => ({}),
  } as unknown as GPUTexture;
  const depth = { ...color, format: 'depth32float' } as GPUTexture;
  const renderer = await createChamberRenderer(device, 'rgba8unorm');
  try {
    await renderer.render(scene, camera, color, depth);
    duration = 1;
    for (let i = 0; i < 256; i++) await renderer.render(scene, camera, color, depth);
    expect(renderer.frameCount).toBe(257);
    expect(renderer.timings).toHaveLength(256);
    expect(Math.max(...renderer.timings)).toBe(1);
    expect(renderer.worstFrameMs).toBe(30);
    duration = 40;
    await renderer.render(scene, camera, color, depth);
    expect(renderer.worstFrameMs).toBe(40);
  } finally {
    await renderer.close();
  }
});
