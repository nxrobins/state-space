/// <reference types="@webgpu/types" />
/** DOM adapter. Mounting binds controls only; Start is guarded before native acquisition. */
import { createTacticalWorkerClient3D, tacticalBrowserWorkerTransport3D } from 'state-space-engine/experimental/3d/tactical-session';
import { createTacticalRenderer3D } from 'state-space-engine/experimental/3d/tactical-renderer';
import { createSlabSession, SLAB_WORLD, SLAB_RULES, type SlabGame, type SlabCommand } from './scenario.js';
import { createSlabFramePump, createSlabRuntimeGuard, slabOrbitCamera } from './ui-runtime.js';
import { openSlabUIRuntime } from './ui-host.js';
import { SLAB_SAVE_BYTES, type SlabUIModel } from './ui-model.js';

export function mountSlabUI(document: Document, window: Window & typeof globalThis) {
  const byId = <T extends HTMLElement>(id: string) => {const e = document.getElementById(id); if (!e) throw Error(`Missing slab control: ${id}`); return e as T;};
  const canvas = byId<HTMLCanvasElement>('scene'), message = byId('message'), startButton = byId<HTMLButtonElement>('start');
  const lifecycle = new AbortController(), guard = createSlabRuntimeGuard(window.fetch.bind(window), document.baseURI);
  let model: SlabUIModel | undefined, starting: Promise<void> | undefined, startup: AbortController | undefined, stopping: Promise<void> | undefined;
  let run: {runtime: Awaited<ReturnType<typeof openSlabUIRuntime>>; pump: ReturnType<typeof createSlabFramePump>; context: GPUCanvasContext; depth?: GPUTexture; resize: ResizeObserver; poll: number} | undefined;
  let yaw = 0.6, pitch = 0.55, radius = 14, lastView = '', lastScene: unknown, pointer: {id: number; x: number; y: number} | undefined;
  const on = (target: EventTarget, event: string, callback: EventListener) => target.addEventListener(event, callback, {signal: lifecycle.signal});
  const tell = (error: unknown) => {message.textContent = error instanceof Error ? error.message : String(error);};
  function refresh() {
    startButton.disabled = !!run || !!starting || !!stopping || lifecycle.signal.aborted;
    if (!model) return; const view = model.view(), signature = JSON.stringify(view);
    if (signature !== lastView) {
      lastView = signature;
      byId('boundary').textContent = `${view.mode === 'preview' ? `Preview: ${view.horizon} ticks from tick ${view.baseTick}` : 'Committed view'} · displayed r${view.displayedRevision}, tick ${view.displayedTick} · acknowledged r${view.committedRevision}`;
      byId('resources').textContent = `AP ${view.committedAP} → ${view.displayedAP} · heat resource ${view.committedHeatBudgetQ} → ${view.displayedHeatBudgetQ} Q · action ${view.displayedTurn}`;
      byId('consequences').textContent = `Firing line ${view.observation.firingLine}. External thermal energy: ${view.observation.energyAccounting.externalQ} Q. ${view.observation.holds.map(h => `${h.id} expires at tick ${h.expiresAtTick}`).join('; ') || 'No temporary control.'}`;
      byId('parcels').textContent = `Transport cycle ${view.observation.wind.cycle}. ` + (view.observation.wind.parcels.map(p => `${p.id}: [${p.cell % 8}, ${Math.floor(p.cell / 8) % 8}, ${Math.floor(p.cell / 64)}], velocity [${p.velocityQ.join(', ')}], fraction [${p.remainderQ.join(', ')}] Q; ${p.energyQ} thermal Q`).join('. ') || 'No controllable parcels remain.');
      byId('units').replaceChildren(...view.observation.units.map(unit => {
        const p = document.createElement('p'), depth = Math.max(0, ...unit.exposure.materials.map(m => m.maxImmersionDepthQ));
        p.textContent = `${unit.id}: position [${unit.body.minQ.join(', ')}] Q, velocity [${unit.body.velocityQ.join(', ')}] Q/step; ${unit.body.grounded ? 'grounded' : 'airborne'}, support drop ${unit.support.distanceQ ?? 'none'} Q, liquid depth ${depth} Q. ` +
          unit.exposure.materials.map(m => `material ${m.material}: ${m.minTemperatureQ}–${m.maxTemperatureQ} temperature Q`).join('; '); return p;
      }));
      byId<HTMLButtonElement>('commit').disabled = !run || !view.canCommit;
      byId<HTMLButtonElement>('reset').disabled = !run || !view.canRestore;
      byId<HTMLInputElement>('import').disabled = !run || !view.canRestore;
      byId<HTMLButtonElement>('compare').disabled = !run || view.status !== 'ready';
      byId<HTMLButtonElement>('discard').disabled = !run || !['ready', 'previewing'].includes(view.status);
      for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-command]'))) button.disabled = !run || ['failed', 'closed', 'committing', 'restoring'].includes(view.status);
      byId<HTMLButtonElement>('save').disabled = false; byId('status').textContent = view.uncertain ? 'Outcome uncertain — no automatic retry' : view.status;
      if (view.error) tell(view.error);
    }
    const scene = model.scene(); if (scene !== lastScene) {lastScene = scene; run?.pump.invalidate();}
    if (run && view.status === 'failed' && !stopping) void stop();
  }
  const act = (fn: (current: SlabUIModel) => Promise<unknown> | unknown) => {
    if (!run || !model) return;
    try {const result = fn(model); refresh(); void Promise.resolve(result).catch(tell).finally(refresh);} catch (e) {tell(e); refresh();}
  };
  async function stop() {
    if (stopping) return stopping; startup?.abort();
    stopping = (async () => {
      await starting; const current = run; run = undefined; pointer = undefined;
      if (current) {
        window.clearInterval(current.poll); current.resize.disconnect();
        try {await current.pump.close(); await current.runtime.close();}
        finally {current.depth?.destroy(); current.context.unconfigure();}
      }
    })();
    try {await stopping;} catch (e) {tell(e);} finally {stopping = undefined; lastView = ''; refresh();}
  }
  function start() {
    if (run || starting || stopping || lifecycle.signal.aborted) return;
    startup = new AbortController(); const signal = startup.signal; message.textContent = ''; lastView = ''; lastScene = undefined;
    starting = (async () => {
      let runtime: Awaited<ReturnType<typeof openSlabUIRuntime>> | undefined, context: GPUCanvasContext | null = null;
      let ownedPump: ReturnType<typeof createSlabFramePump> | undefined, ownedResize: ResizeObserver | undefined, ownedPoll: number | undefined;
      try {
        runtime = await openSlabUIRuntime({guard, signal,
          async device() {if (!window.navigator.gpu) throw Error('WebGPU is unavailable.'); const adapter = await window.navigator.gpu.requestAdapter({powerPreference: 'low-power'}); if (!adapter) throw Error('No WebGPU adapter.'); return adapter.requestDevice();},
          client() {
            const worker = new window.Worker(new URL('./worker.js', document.baseURI), {type: 'module'}), channel = `slab:${window.crypto.randomUUID()}`;
            try {worker.postMessage({kind: 'initialize', channel, snapshot: null}); return createTacticalWorkerClient3D<SlabGame, SlabCommand>(tacticalBrowserWorkerTransport3D(worker), {channel, worldId: SLAB_WORLD, gameRulesVersion: SLAB_RULES});}
            catch (e) {worker.terminate(); throw e;}
          }, renderer: device => createTacticalRenderer3D(device, {colorFormat: 'bgra8unorm', depthFormat: 'depth24plus'}),
        });
        if (signal.aborted) throw Error('Startup cancelled.'); model = runtime.model;
        context = canvas.getContext('webgpu'); if (!context) throw Error('Canvas cannot create a WebGPU context.');
        context.configure({device: runtime.device, format: 'bgra8unorm', alphaMode: 'opaque'});
        const currentRuntime = runtime, currentContext = context;
        const pump = createSlabFramePump({requestFrame: callback => window.requestAnimationFrame(callback), cancelFrame: id => window.cancelAnimationFrame(id), guard,
          async draw() {
            const current = run; if (!current || document.hidden) return;
            const bounds = canvas.getBoundingClientRect(), ratio = Math.min(2, window.devicePixelRatio || 1), scale = Math.min(1, 1600 / Math.max(1, bounds.width * ratio), 900 / Math.max(1, bounds.height * ratio));
            const width = Math.max(1, Math.round(bounds.width * ratio * scale)), height = Math.max(1, Math.round(bounds.height * ratio * scale));
            if (!current.depth || canvas.width !== width || canvas.height !== height) {
              current.depth?.destroy(); current.depth = undefined; canvas.width = width; canvas.height = height;
              current.depth = currentRuntime.device.createTexture({size: [width, height], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT});
            }
            await currentRuntime.renderer.render(currentRuntime.model.scene(), slabOrbitCamera(yaw, pitch, radius), {color: currentContext.getCurrentTexture(), depth: current.depth});
          }, onError(error) {model?.fail(error); tell(error); refresh(); void stop();},
        });
        ownedPump = pump; const resize = new window.ResizeObserver(() => pump.invalidate()); ownedResize = resize; resize.observe(canvas);
        ownedPoll = window.setInterval(refresh, 250); run = {runtime, context, pump, resize, poll: ownedPoll};
        pump.invalidate(); refresh();
      } catch (e) {
        tell(e); const abandoned = run?.runtime === runtime ? run : undefined; if (abandoned) run = undefined;
        if (ownedPoll !== undefined) window.clearInterval(ownedPoll); ownedResize?.disconnect();
        try {await ownedPump?.close(); await runtime?.close();}
        catch (cleanup) {tell(`Startup failed; cleanup also reported: ${cleanup instanceof Error ? cleanup.message : String(cleanup)}`);}
        finally {abandoned?.depth?.destroy(); context?.unconfigure();}
      }
    })().finally(() => {starting = undefined; refresh();});
    refresh();
  }
  on(startButton, 'click', start); on(byId('stop'), 'click', () => {void stop();});
  for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>('[data-command]'))) on(button, 'click', () => act(current => {
    const name = button.dataset.command!, command = name === 'air' ? {kind: 'air', unit: byId<HTMLSelectElement>('air-unit').value, direction: byId<HTMLSelectElement>('air-direction').value} :
      name === 'wind' ? {kind: 'wind', parcel: byId<HTMLSelectElement>('wind-parcel').value, direction: byId<HTMLSelectElement>('wind-direction').value} :
      name === 'heat' || name === 'cool' ? {kind: 'heat', deltaQ: (name === 'cool' ? -1 : 1) * Number(byId<HTMLInputElement>('heat').value)} : {kind: name};
    return current.preview(command, Number(byId<HTMLInputElement>('horizon').value));
  }));
  on(byId('commit'), 'click', () => act(current => current.commit())); on(byId('discard'), 'click', () => act(current => current.discard()));
  on(byId('compare'), 'click', () => act(current => current.show(current.view().mode === 'preview' ? 'committed' : 'preview')));
  on(byId('reset'), 'click', () => act(current => current.restore(JSON.stringify(createSlabSession().snapshot()))));
  on(byId('save'), 'click', () => {
    if (!model) return; const url = window.URL.createObjectURL(new Blob([model.save()], {type: 'application/json'})), a = document.createElement('a');
    try {a.href = url; a.download = 'hot-slab-save.json'; a.click();} finally {window.setTimeout(() => window.URL.revokeObjectURL(url), 0);}
  });
  on(byId('import'), 'change', () => {
    const input = byId<HTMLInputElement>('import'), file = input.files?.[0]; input.value = ''; if (!file) return;
    if (file.size > SLAB_SAVE_BYTES) {tell('Save exceeds the 256 KiB limit.'); return;}
    const owner = model; void file.text().then(text => {if (owner !== model) throw Error('Session changed during file reading.'); act(current => current.restore(text));}).catch(tell);
  });
  on(byId('inspect'), 'click', () => {try {if (model) {const c = model.inspectCell(...(['x', 'y', 'z'].map(id => Number(byId<HTMLInputElement>(id).value)) as [number, number, number])); byId('cell').textContent = `${c.material} · ${c.energyQ} energy Q · integrity ${c.integrity} · ${c.bonds} bonds · ${c.anchored ? 'anchored' : 'unanchored'} · ${c.stamp.kind} tick ${c.stamp.tick}`;}} catch (e) {tell(e);}});
  on(canvas, 'pointerdown', e => {const p = e as PointerEvent; if (!run) return; pointer = {id: p.pointerId, x: p.clientX, y: p.clientY}; canvas.setPointerCapture(p.pointerId);});
  on(canvas, 'pointermove', e => {const p = e as PointerEvent; if (!pointer || pointer.id !== p.pointerId) return; yaw += (p.clientX - pointer.x) * 0.008; pitch = Math.max(-1.35, Math.min(1.35, pitch + (p.clientY - pointer.y) * 0.008)); pointer = {id: p.pointerId, x: p.clientX, y: p.clientY}; run?.pump.invalidate();});
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) on(canvas, event, () => {pointer = undefined;});
  on(canvas, 'wheel', e => {if (!run) return; e.preventDefault(); radius = Math.max(4, Math.min(32, radius * Math.exp((e as WheelEvent).deltaY * 0.001))); run.pump.invalidate();});
  on(canvas, 'keydown', e => {const k = e as KeyboardEvent; if (!run) return; const commands: Record<string, () => void> = {ArrowLeft: () => {yaw -= 0.1;}, ArrowRight: () => {yaw += 0.1;}, ArrowUp: () => {pitch = Math.min(1.35, pitch + 0.1);}, ArrowDown: () => {pitch = Math.max(-1.35, pitch - 0.1);}, '+': () => {radius = Math.max(4, radius - 1);}, '-': () => {radius = Math.min(32, radius + 1);}}; if (commands[k.key]) {k.preventDefault(); commands[k.key](); run.pump.invalidate();}});
  on(document, 'visibilitychange', () => {if (!document.hidden) run?.pump.invalidate();}); on(window, 'pagehide', () => {void stop();});
  return async () => {lifecycle.abort(); await stop();};
}
