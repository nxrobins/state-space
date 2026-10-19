/// <reference types="@webgpu/types" />
import {openChamber, loadChamber, type ChamberClient} from './client.js';
import {CHAMBER, SUPPORT, ICE, type Cell, type ChamberSnapshot} from './scenario.js';
import {MAX_SAVE_BYTES} from './recording.js';
import {prepareScene, inspectScene, pickCell, orbitCamera, sceneData, type ChamberScene} from './presentation.js';
import {createChamberRenderer, type ChamberRenderer} from './renderer.js';
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const button = (id: string) => element<HTMLButtonElement>(id), canvas = element<HTMLCanvasElement>('world');
let client: ChamberClient | null = null, device: GPUDevice | null = null, renderer: ChamberRenderer | null = null, context: GPUCanvasContext | null = null;
let depth: GPUTexture | null = null, scene: ChamberScene | null = null, displayed: ChamberScene | null = null, committed: ChamberSnapshot | null = null;
let selected: Cell = [...SUPPORT], showPreview = true, yaw = -.65, pitch = .42, raf = 0, dirty = false, drawing: Promise<void> | null = null;
let epoch = 0, stopping: Promise<void> | null = null;
let switching = false, unsubscribe = () => {}, sceneKey = '', resize: ResizeObserver | null = null, destroyed = false;
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Chamber failed.';
const notice = (text: string) => {element('notice').textContent = text;};
function updateInspection() {
  if (!displayed || !client) return;
  const s = sceneData(displayed).snapshot, info = inspectScene(displayed, selected), material = client.registry.material(info.material);
  element('inspection').textContent = `${material.name} · (${selected.join(', ')}) · energy ${info.energyQ} Q · integrity ${info.integrity}/255`;
  element('view-label').textContent = displayed.kind === 'preview' ? 'PREVIEW · NOT COMMITTED' : 'COMMITTED WORLD';
  element('view-label').dataset.identity = info.identity;
  element('tick-label').textContent = `TICK ${displayed.tick}`;
  element('resource').textContent = `${Math.round(s.game.remainingQ / CHAMBER.budgetQ * 100)}%`;
  element<HTMLProgressElement>('resource-bar').value = s.game.remainingQ / CHAMBER.budgetQ;
  element('events').textContent = `Fuel cells burned    ${s.game.burned}\nPhase changes        ${s.game.phaseChanges}\nFalling cell steps   ${s.game.fallen}\nLost footing         ${s.game.lostFooting}\nExternal energy      ${s.accounting.externalQ} Q`;
}
async function draw() {
  if (!scene || !device || !renderer || !context || destroyed) return;
  const captured = scene; dirty = false;
  const rect = canvas.getBoundingClientRect(), scale = Math.min(devicePixelRatio, 2), width = Math.min(1600, Math.max(1, Math.round(rect.width * scale))), height = Math.min(900, Math.max(1, Math.round(rect.height * scale)));
  if (canvas.width !== width || canvas.height !== height || !depth) {
    depth?.destroy(); canvas.width = width; canvas.height = height;
    depth = device.createTexture({size: [width, height], format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT});
  }
  await renderer.render(captured, orbitCamera(yaw, pitch), context.getCurrentTexture(), depth);
  displayed = captured; updateInspection();
}
function requestDraw() {
  if (!scene || !device || !renderer || destroyed) return;
  dirty = true; if (raf || drawing) return;
  raf = requestAnimationFrame(() => {raf = 0; drawing = draw().catch(error => {notice(errorText(error)); void stop();}).finally(() => {drawing = null; if (dirty && !destroyed) requestDraw();});});
}
function refresh() {
  if (!client) return;
  const state = client.state, candidate = state.hasPreview ? client.previewSnapshot() : null;
  if (state.status === 'ready') committed = client.snapshot();
  const preview = showPreview && candidate, value = preview || committed;
  const key = JSON.stringify([preview ? candidate.branchId : null, committed?.revision, selected, Boolean(preview)]);
  if (value && sceneKey !== key) {scene = prepareScene(client.registry, value, selected); sceneKey = key; requestDraw();}
  element('status').textContent = state.uncertain ? 'Commit outcome uncertain' : state.error ? 'Worker stopped' : switching ? 'Restoring saved chamber…' : state.busy ? 'Committing…' : state.status === 'working' ? `Previewing · ${state.progress?.completedTicks ?? 0}/2 ticks` : state.hasPreview ? 'Preview ready' : 'Chamber ready';
  const unavailable = switching || state.busy || ['closed', 'failed', 'closing', 'connecting'].includes(state.status);
  for (const id of ['heat', 'cool', 'wait']) button(id).disabled = unavailable || (committed?.domains.tick ?? 0) >= CHAMBER.maxTicks;
  button('commit').disabled = unavailable || !state.hasPreview || state.status !== 'ready';
  button('compare').disabled = unavailable || !state.hasPreview;
  button('discard').disabled = unavailable || state.activeId === null && state.waitingId === null;
  button('save').disabled = switching; button('reset').disabled = switching || state.busy; button('stop').disabled = switching || state.busy;
  button('compare').textContent = showPreview ? 'Show committed' : 'Show preview';
  if (state.uncertain) notice('The worker may have committed before its reply was lost. No retry was sent. Save preserves the last acknowledged state; start a new worker to recover it.');
  else if (state.error) notice(state.error);
}
function bind(next: ChamberClient) {unsubscribe(); client = next; committed = next.snapshot(); sceneKey = ''; showPreview = true; unsubscribe = next.onChange(refresh); refresh();}
async function checkRuntimeHold() {
  const response = await fetch('../verification/safety-hold.json', {cache: 'no-store', signal: AbortSignal.timeout(2000)});
  if (response.status === 404) return;
  if (!response.ok) throw Error('Could not check the local runtime hold.');
  const hold = await response.json();
  if (!hold || typeof hold !== 'object' || Array.isArray(hold) || Object.hasOwn(hold, 'blockRecovery') && hold.blockRecovery !== false) throw Error('Runtime verification is held for incident review.');
}
async function start() {
  if (client || switching) return; const generation = ++epoch; switching = true; destroyed = false; button('start').disabled = true; notice('');
  let pendingDevice: GPUDevice | null = null, pendingRenderer: ChamberRenderer | null = null, pendingClient: ChamberClient | null = null;
  try {
    await checkRuntimeHold(); if (!navigator.gpu) throw Error('This chamber needs a browser with WebGPU.');
    const adapter = await navigator.gpu.requestAdapter({powerPreference: 'low-power'}); if (!adapter || adapter.info.isFallbackAdapter) throw Error('A native GPU adapter is required.');
    pendingDevice = await adapter.requestDevice(); const ownedDevice = pendingDevice;
    void ownedDevice.lost.then(info => {if (device === ownedDevice && !destroyed) {notice(`Device lost: ${info.message}`); void stop();}});
    pendingDevice.addEventListener('uncapturederror', event => notice(event.error.message));
    pendingRenderer = await createChamberRenderer(pendingDevice, navigator.gpu.getPreferredCanvasFormat()); pendingClient = await openChamber();
    if (generation !== epoch) return;
    context = canvas.getContext('webgpu'); if (!context) throw Error('WebGPU canvas unavailable.');
    context.configure({device: pendingDevice, format: navigator.gpu.getPreferredCanvasFormat(), alphaMode: 'opaque'});
    device = pendingDevice; renderer = pendingRenderer; bind(pendingClient); pendingDevice = null; pendingRenderer = null; pendingClient = null;
    resize = new ResizeObserver(requestDraw); resize.observe(canvas); element('empty').hidden = true; button('stop').disabled = false;
  } catch (error) {if (generation === epoch) {notice(errorText(error)); await stop();}}
  finally {
    await pendingClient?.close().catch(() => {}); await pendingRenderer?.close(); pendingDevice?.destroy();
    if (generation === epoch) {switching = false; button('start').disabled = false; refresh();}
  }
}
function stop(): Promise<void> {
  if (stopping) return stopping;
  epoch++; switching = true; button('start').disabled = true; destroyed = true;
  if (raf) cancelAnimationFrame(raf); raf = 0; dirty = false; resize?.disconnect(); resize = null; unsubscribe(); unsubscribe = () => {};
  const old = client; client = null;
  stopping = (async () => {
    try {await old?.close();} catch { /* A failed worker has already terminated. */ }
    await drawing; await renderer?.close(); renderer = null; depth?.destroy(); depth = null; context?.unconfigure(); context = null; device?.destroy(); device = null;
    scene = displayed = null; committed = null; sceneKey = ''; element('empty').hidden = false;
    for (const id of ['heat', 'cool', 'wait', 'compare', 'discard', 'commit', 'save', 'reset', 'stop']) button(id).disabled = true;
    element('status').textContent = 'Stopped';
  })().finally(() => {stopping = null; switching = false; button('start').disabled = false;});
  return stopping;
}
async function preview(kind: 'heat' | 'cool' | 'wait') {
  if (!client) return; showPreview = true; notice('');
  const result = await client.preview(kind === 'wait' ? {kind} : {kind, cell: [...selected]});
  if (result.status === 'failed') throw Error(result.error ?? 'Preview failed.'); return result;
}
async function importSave(text: string) {
  if (!client || switching || client.state.busy) throw Error('Chamber is unavailable.');
  switching = true; const generation = ++epoch, old = client; refresh();
  try {const next = await loadChamber(text); if (generation !== epoch) {await next.close(); return;} await old.close().catch(() => {});
    if (generation !== epoch) {await next.close(); return;} bind(next); notice('Saved chamber restored. Every recorded boundary matched exactly.');}
  finally {if (generation === epoch) {switching = false; refresh();}}
}
const run = (operation: () => unknown | Promise<unknown>) => {void Promise.resolve().then(operation).catch(error => notice(errorText(error)));};
button('start').onclick = () => run(start); button('stop').onclick = () => run(stop);
for (const kind of ['heat', 'cool', 'wait'] as const) button(kind).onclick = () => run(() => preview(kind));
button('commit').onclick = () => run(async () => {await client?.commit(); notice('Outcome committed.'); refresh();});
button('discard').onclick = () => run(async () => {await client?.cancel(); notice('Preview discarded. No resource spent.'); refresh();});
button('compare').onclick = () => {showPreview = !showPreview; refresh();};
button('select-support').onclick = () => {selected = [...SUPPORT]; refresh();}; button('select-ice').onclick = () => {selected = [...ICE]; refresh();};
button('reset').onclick = () => run(async () => {if (!client || switching) return; switching = true; const generation = ++epoch, old = client; refresh();
  try {const next = await openChamber(); if (generation !== epoch) {await next.close(); return;} await old.close().catch(() => {});
    if (generation !== epoch) {await next.close(); return;} bind(next); notice('New chamber.');} finally {if (generation === epoch) {switching = false; refresh();}}});
button('save').onclick = () => {if (!client) return; const blob = new Blob([client.exportSave()], {type: 'application/json'}), url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = `reactive-chamber-tick-${client.snapshot().domains.tick}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);};
element<HTMLInputElement>('load').onchange = event => run(async () => {const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = ''; if (!file) return;
  if (file.size > MAX_SAVE_BYTES) throw Error('Save exceeds the 1 MiB limit.'); await importSave(await file.text());});
let drag: {x: number; y: number; distance: number} | null = null;
canvas.onpointerdown = event => {drag = {x: event.clientX, y: event.clientY, distance: 0}; canvas.setPointerCapture(event.pointerId);};
canvas.onpointermove = event => {if (!drag) return; const dx = event.clientX - drag.x, dy = event.clientY - drag.y; drag.distance += Math.abs(dx) + Math.abs(dy); drag.x = event.clientX; drag.y = event.clientY;
  yaw -= dx * .008; pitch = Math.max(.08, Math.min(1.25, pitch + dy * .008)); requestDraw();};
canvas.onpointerup = event => {if (drag && drag.distance < 4 && displayed) {const rect = canvas.getBoundingClientRect(), hit = pickCell(displayed, orbitCamera(yaw, pitch), event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height); if (hit) {selected = hit; refresh();}} drag = null;};
canvas.onpointercancel = () => {drag = null;};
window.addEventListener('pagehide', () => {void stop();}, {once: true});
export const chamberApp = {start, stop, preview, importSave, get client() {return client;}, get renderer() {return renderer;}, get scene() {return displayed;},
  async painted() {await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); await drawing;},
  orbit(value: number) {yaw = value; requestDraw();}, get running() {return Boolean(client && device && renderer);}};
Object.assign(window, {chamberApp});
Object.assign(window, {macQualification: {ready: true, run() {void import('./verification.js').then(m => m.verifyChamber(chamberApp)); return true;}}});
