/** Owns canvas, GPU device and frame scheduling. No physics or session authority. */
import { createFramePump } from '../shared/frame-pump.js';
import { createBuilderRenderer } from './renderer.js';
import { canvasSize, type BuilderScene, type BuilderCamera } from './presentation.js';
export async function checkRuntimeHold() {
  const response = await fetch('../verification/safety-hold.json', {
    cache: 'no-store',
    signal: AbortSignal.timeout(2000),
  });
  if (response.status === 404) return;
  if (!response.ok) throw Error('Could not check the local runtime hold.');
  const hold = await response.json();
  if (
    !hold ||
    typeof hold !== 'object' ||
    Array.isArray(hold) ||
    (Object.hasOwn(hold, 'blockRecovery') && hold.blockRecovery !== false)
  )
    throw Error('Runtime verification is held for incident review.');
}
export async function openBuilderView(
  canvas: HTMLCanvasElement,
  options: { onPaint(): void; onError(error: string): void },
) {
  await checkRuntimeHold();
  if (!navigator.gpu) throw Error('The builder needs a browser with WebGPU.');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'low-power' });
  if (!adapter || adapter.info.isFallbackAdapter) throw Error('A native GPU adapter is required.');
  const device = await adapter.requestDevice();
  let renderer: Awaited<ReturnType<typeof createBuilderRenderer>> | null = null;
  let context: GPUCanvasContext | null = null;
  try {
    const format = navigator.gpu.getPreferredCanvasFormat();
    renderer = await createBuilderRenderer(device, format);
    const ownedRenderer = renderer;
    context = canvas.getContext('webgpu');
    if (!context) throw Error('WebGPU canvas unavailable.');
    context.configure({ device, format, alphaMode: 'opaque' });
    const ownedContext = context;
    let depth: GPUTexture | null = null,
      closing: Promise<void> | null = null,
      latest: { scene: BuilderScene; camera: BuilderCamera } | null = null,
      displayed: { scene: BuilderScene; camera: BuilderCamera } | null = null;
    const pump = createFramePump({
      requestFrame: (callback) => requestAnimationFrame(callback),
      cancelFrame: (id) => cancelAnimationFrame(id),
      guard: async () => {},
      onError: options.onError,
      async draw() {
        if (!latest) return;
        const captured = latest,
          rect = canvas.getBoundingClientRect(),
          { width, height } = canvasSize(rect.width, rect.height, devicePixelRatio);
        if (!depth || canvas.width !== width || canvas.height !== height) {
          depth?.destroy();
          canvas.width = width;
          canvas.height = height;
          depth = device.createTexture({
            size: [width, height],
            format: 'depth32float',
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
          });
        }
        await ownedRenderer.render(
          captured.scene,
          captured.camera,
          ownedContext.getCurrentTexture(),
          depth,
        );
        displayed = captured;
        options.onPaint();
      },
    });
    const resize = new ResizeObserver(() => pump.invalidate());
    resize.observe(canvas);
    const fail = (message: string) => {
      if (!closing) options.onError(message);
    };
    void device.lost.then((info) => fail(`Device lost: ${info.message}`));
    device.addEventListener('uncapturederror', (event) => fail(event.error.message));
    return {
      renderer: ownedRenderer,
      backendInfo: {
        isFallbackAdapter: adapter.info.isFallbackAdapter,
        vendor: adapter.info.vendor,
      },
      get displayed() {
        return displayed;
      },
      present(scene: BuilderScene, camera: BuilderCamera) {
        if (closing) return;
        latest = { scene, camera: structuredClone(camera) };
        pump.invalidate();
      },
      painted: pump.settled,
      close() {
        if (closing) return closing;
        resize.disconnect();
        closing = (async () => {
          try {
            await pump.close();
            await ownedRenderer.close();
          } finally {
            depth?.destroy();
            ownedContext.unconfigure();
            device.destroy();
            latest = displayed = null;
          }
        })();
        return closing;
      },
    };
  } catch (error) {
    try {
      await renderer?.close();
    } finally {
      context?.unconfigure();
      device.destroy();
    }
    throw error;
  }
}
export type BuilderView = Awaited<ReturnType<typeof openBuilderView>>;
