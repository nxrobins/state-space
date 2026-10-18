/** Explicit acquisition/cleanup seam, exercised with non-GPU ports. */
import type { TacticalRenderer3D } from 'state-space-engine/experimental/3d/tactical-renderer';
import { createSlabUIModel, type SlabClient, type SlabUIModel } from './ui-model.js';

export async function openSlabUIRuntime(options: {
  guard: () => Promise<void>; signal: AbortSignal; device: () => Promise<GPUDevice>; client: () => SlabClient;
  renderer: (device: GPUDevice) => Promise<TacticalRenderer3D>;
  model?: typeof createSlabUIModel;
}) {
  let device: GPUDevice | undefined, client: SlabClient | undefined, model: SlabUIModel | undefined, renderer: TacticalRenderer3D | undefined, closing: Promise<void> | undefined;
  const check = () => {if (options.signal.aborted) throw Error('Startup cancelled.');};
  const close = () => closing ??= (async () => {
    const results = await Promise.allSettled([Promise.resolve().then(() => renderer?.close()), Promise.resolve().then(() => model ? model.close() : client?.close())]);
    device?.destroy(); const failed = results.find(r => r.status === 'rejected'); if (failed?.status === 'rejected') throw failed.reason;
  })();
  try {
    check(); await options.guard(); check(); device = await options.device(); check();
    await options.guard(); check(); client = options.client(); model = await (options.model ?? createSlabUIModel)(client, options.guard); check();
    await options.guard(); check(); renderer = await options.renderer(device); check();
    return {device, client, model, renderer, close};
  } catch (error) {try {await close();} catch { /* Keep original startup error. */ } throw error;}
}
