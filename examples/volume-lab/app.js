import { MATERIALS_3D, SCHEMA_VERSION_3D, RULES_VERSION_3D, MATERIAL_CATALOG_HASH_3D } from '../../dist/sdk/state-space-3d.js';
import { createFramePump } from '../../web/frame-pump.js';
import { createVolumeRenderer } from './renderer.js';
import { SCENES } from './scenes.js';

const $ = id => document.getElementById(id);
const canvas = $('world');
const distribution = values => { const sorted = [...values].sort((a,b) => a-b); return { min: sorted[0], median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.ceil(sorted.length * .95) - 1], max: sorted.at(-1) }; };
export async function snapshotHash(snapshot) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(snapshot)));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
let state, renderer, pump, worker, requestId = 0, pending, activeFrame = Promise.resolve();
let playing = false, measuring = false, operationBusy = false, failed = false, meshDirty = true, lastTickTime, workerMs = 0, abortBenchmark = false, receiptUrl;
function fatal(error) {
  playing = false; failed = true; $('play').textContent = 'Play'; $('mode').textContent = 'PAUSED / ERROR';
  $('status').textContent = error.message || String(error);
  if (pending) { const p = pending; pending = null; clearTimeout(p.timeout); p.reject(error); }
}
function startWorker() {
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    if (!pending || data.id !== pending.id) return;
    const p = pending; pending = null; clearTimeout(p.timeout);
    if (data.error) p.reject(new Error(data.error)); else { workerMs = data.workerMs; p.resolve(data.result); }
  };
  worker.onerror = event => { fatal(new Error(event.message || 'Physics worker failed.')); worker.terminate(); };
  worker.onmessageerror = () => fatal(new Error('Physics worker response could not be decoded.'));
}
function request(operation, ...args) {
  if (failed) return Promise.reject(new Error('Worker is paused after an error. Export the last committed snapshot and reload.'));
  if (pending) return Promise.reject(new Error('A physics operation is already in progress.'));
  return new Promise((resolve, reject) => {
    const id = ++requestId;
    const timeout = setTimeout(() => { fatal(new Error('Physics operation timed out; last committed state retained.')); worker.terminate(); }, 120000);
    pending = { id, resolve, reject, timeout };
    try { worker.postMessage({ id, operation, args }); }
    catch (error) { pending = null; clearTimeout(timeout); reject(error); }
  });
}
function snapshot() {
  if (!state) throw new Error('No committed state.');
  return { schemaVersion: SCHEMA_VERSION_3D, rulesVersion: RULES_VERSION_3D, materialCatalogHash: MATERIAL_CATALOG_HASH_3D,
    width: state.width, height: state.height, depth: state.depth, tick: state.tick, packedCells: Array.from(state.grid), energyQ: Array.from(state.energyQ) };
}
function adopt(next) {
  state = next; meshDirty = true;
  for (const [axis, length] of [['x', next.width], ['y', next.height], ['z', next.depth]]) { $(axis).max = length - 1; $(axis).value = Math.min(Number($(axis).value), length - 1); }
  $('cut').max = next.depth; $('cut').value = Math.min(Number($('cut').value), next.depth);
}
function options() { return { temperature: $('color').value === 'temperature', steam: $('steam').checked, cut: Number($('cut').value) }; }
function hud() {
  $('tick').textContent = `TICK ${state.tick}`; $('drift').textContent = `${state.balance.driftQ} Q`;
  $('mode').textContent = failed ? 'PAUSED / ERROR' : measuring ? 'MEASURING / CPU' : playing ? 'LIVE / CPU' : 'PAUSED';
  $('cut-value').value = `${$('cut').value} / ${state.depth}`;
  $('counts').replaceChildren(...MATERIALS_3D.map(m => { const row = document.createElement('div'); row.textContent = `${m.name.padEnd(13)} ${String(state.counts[m.id] || 0).padStart(6)}`; return row; }));
}
async function draw() {
  if (!state || !renderer || failed) return;
  if (meshDirty) { renderer.update(state, options()); meshDirty = false; }
  await renderer.render();
}
function controls(disabled) {
  for (const id of ['play','step','reset','scene','inspect','place','heat','import','benchmark','x','y','z','material','thermal','energy','color','steam','cut']) $(id).disabled = disabled;
}
async function pausedOperation(action) {
  if (operationBusy) throw new Error('Wait for the current operation, or cancel the measurement.');
  operationBusy = true; playing = false; $('play').textContent = 'Play'; controls(true);
  try { await activeFrame; const result = await action(); hud(); await draw(); return result; }
  finally { operationBusy = false; controls(false); lastTickTime = undefined; }
}
async function loadScene(id) {
  adopt(await request('scene', id)); $('scene').value = id;
  $('description').textContent = SCENES.find(s => s.id === id).description;
  $('cut').value = state.depth; $('status').textContent = 'Ready. Solids remain fixed until edited or transformed.';
}
async function frame(now) {
  if (operationBusy || failed || !state) return;
  const start = performance.now();
  if (playing && (lastTickTime === undefined || now - lastTickTime >= 1000 / 60 - .5)) {
    adopt(await request('step', 1));
    $('rate').textContent = lastTickTime === undefined ? '—' : `${(1000 / (now - lastTickTime)).toFixed(1)} Hz`;
    lastTickTime = now; hud();
  }
  await draw(); $('frame').textContent = `${(performance.now() - start).toFixed(1)} ms frame · ${workerMs.toFixed(1)} ms worker`;
}
function download(value, name) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}
async function runBenchmark() {
  return pausedOperation(async () => {
    abortBenchmark = false; measuring = true; $('cancel').hidden = false;
    canvas.width = 1920; canvas.height = 1080;
    $('color').value = 'material'; $('steam').checked = true;
    Object.assign(renderer.camera, { yaw: .72, pitch: .55, radius: 73 });
    const receipt = { reportVersion: 1, rulesVersion: RULES_VERSION_3D, catalogHash: MATERIAL_CATALOG_HASH_3D, userAgent: navigator.userAgent,
      backendInfo: renderer.backendInfo, output: [1920, 1080], dimensions: [32,32,32], targetHz: 60,
      performanceIsReleaseGate: false, cancelled: false, rows: [],
      scope: 'Display callback through CPU worker tick, state transfer/counts/ledger, exposed-face mesh construction, uploads, HUD updates, render submission and GPU completion. No OS scanout. Setup, hashing and replay excluded.' };
    window.volumeLab.benchmarkResult = receipt;
    try {
      for (const scene of SCENES) {
        if (abortBenchmark) { receipt.cancelled = true; break; }
        await loadScene(scene.id); hud(); await draw();
        const initialHash = await snapshotHash(snapshot());
        const row = { scene: scene.id, initialHash, warmup: [], frames: [], complete: false };
        receipt.rows.push(row);
        let previousCallback;
        for (let i = 0; i < 660; i++) {
          if (abortBenchmark) { receipt.cancelled = true; break; }
          const callback = await new Promise(resolve => requestAnimationFrame(resolve));
          const started = performance.now();
          adopt(await request('step', 1)); const physicsDone = performance.now();
          meshDirty = true;
          $('status').textContent = `${scene.name} · ${i < 60 ? 'warmup' : 'measured'} ${i < 60 ? i + 1 : i - 59} / ${i < 60 ? 60 : 600}`;
          hud(); await draw(); const finished = performance.now();
          const sample = { tick: state.tick, callback, intervalMs: previousCallback === undefined ? null : callback - previousCallback,
            workMs: finished - started, workerMs, physicsRoundtripMs: physicsDone - started,
            renderingAndHudMs: finished - physicsDone, completionDelayMs: finished - callback };
          (i < 60 ? row.warmup : row.frames).push(sample); previousCallback = callback;
        }
        row.endTick = state.tick; row.finalHash = await snapshotHash(snapshot()); row.energyDriftQ = state.balance.driftQ;
        row.complete = row.frames.length === 600;
        if (row.frames.length) {
          row.workMs = distribution(row.frames.map(r => r.workMs)); row.completionDelayMs = distribution(row.frames.map(r => r.completionDelayMs));
          row.deadlineMisses = row.frames.filter(r => r.completionDelayMs > 1000 / 60).length;
          row.lostDisplaySlots = row.frames.reduce((sum, r) => sum + Math.max(0, Math.round((r.intervalMs || 1000/60) / (1000/60)) - 1), 0);
          const elapsed = row.frames.at(-1).callback - row.frames[0].callback;
          row.achievedTickHz = elapsed ? (row.frames.length - 1) * 1000 / elapsed : null;
        }
        if (row.energyDriftQ !== '0') throw new Error('Energy drift during frame measurement.');
        if (receipt.cancelled) break;
      }
    } catch (error) { receipt.error = error.message; throw error; }
    finally {
      measuring = false; $('cancel').hidden = true;
      if (receiptUrl) URL.revokeObjectURL(receiptUrl);
      receiptUrl = URL.createObjectURL(new Blob([JSON.stringify(receipt)], { type: 'application/json' }));
      $('receipt').href = receiptUrl; $('receipt').download = 'volume-frames.json'; $('receipt').hidden = false;
    }
    $('status').textContent = receipt.cancelled ? 'Measurement cancelled. Partial receipt retained.' : 'Measurement complete. Exact replay is verified separately; 60 Hz is not a release gate.';
    return receipt;
  });
}

async function main() {
  for (const scene of SCENES) $('scene').add(new Option(scene.name, scene.id));
  for (const m of MATERIALS_3D) $('material').add(new Option(m.name, m.id));
  startWorker(); renderer = await createVolumeRenderer(canvas, fatal);
  const selected = new URL(location.href).searchParams.get('scene') || 'flow';
  await loadScene(selected); hud(); await draw();
  const notify = action => { void action().catch(error => { $('status').textContent = error.message; }); };
  const coords = () => ['x','y','z'].map(id => Number($(id).value));
  $('play').onclick = () => { if (failed || operationBusy) return; playing = !playing; $('play').textContent = playing ? 'Pause' : 'Play'; lastTickTime = undefined; hud(); };
  $('step').onclick = () => notify(() => pausedOperation(async () => adopt(await request('step', 1))));
  $('reset').onclick = () => notify(() => pausedOperation(() => loadScene($('scene').value)));
  $('scene').onchange = () => notify(() => pausedOperation(() => loadScene($('scene').value)));
  for (const id of ['color','steam','cut']) $(id).oninput = () => { meshDirty = true; hud(); };
  $('inspect').onclick = () => notify(() => pausedOperation(async () => { $('sample').textContent = JSON.stringify(await request('sample', ...coords()), null, 2); }));
  $('place').onclick = () => notify(() => pausedOperation(async () => adopt(await request('setCell', ...coords(), Number($('material').value), Number($('thermal').value)))));
  $('heat').onclick = () => notify(() => pausedOperation(async () => adopt(await request('setEnergy', ...coords(), Number($('energy').value)))));
  $('export').onclick = () => notify(async () => {
    if (failed) download(snapshot(), `volume-tick-${state.tick}.json`);
    else await pausedOperation(async () => download(snapshot(), `volume-tick-${state.tick}.json`));
  });
  $('import').onclick = () => $('file').click();
  $('file').onchange = () => notify(async () => {
    const file = $('file').files[0]; if (!file) return;
    if (file.size > 4 * 1024 * 1024) throw new Error('Snapshot exceeds the 4 MiB import limit.');
    const saved = JSON.parse(await file.text());
    await pausedOperation(async () => adopt(await request('restore', saved))); $('file').value = '';
  });
  $('benchmark').onclick = () => notify(runBenchmark);
  $('cancel').onclick = () => { abortBenchmark = true; };
  document.addEventListener('visibilitychange', () => { if (document.hidden) { playing = false; abortBenchmark = true; $('play').textContent = 'Play'; hud(); } });
  window.volumeLab = {
    ready: true, backendInfo: renderer.backendInfo, benchmarkResult: null,
    snapshot: async () => { if (!failed) await activeFrame; return snapshot(); },
    step: (ticks = 1) => pausedOperation(async () => { adopt(await request('step', ticks)); return snapshot(); }),
    restore: saved => pausedOperation(async () => { adopt(await request('restore', saved)); return snapshot(); }),
    scene: id => pausedOperation(async () => { await loadScene(id); return snapshot(); }),
    sample: (...args) => pausedOperation(() => request('sample', ...args)),
    setCell: (...args) => pausedOperation(async () => { adopt(await request('setCell', ...args)); return snapshot(); }),
    setEnergy: (...args) => pausedOperation(async () => { adopt(await request('setEnergy', ...args)); return snapshot(); }),
    balance: () => ({ ...state.balance }), hash: async () => snapshotHash(snapshot()),
    renderOptions: value => pausedOperation(async () => {
      if (value.temperature !== undefined) $('color').value = value.temperature ? 'temperature' : 'material';
      if (value.steam !== undefined) $('steam').checked = value.steam;
      if (value.cut !== undefined) $('cut').value = value.cut;
      if (value.yaw !== undefined) renderer.camera.yaw = value.yaw;
      meshDirty = true;
    }),
    runBenchmark, cancelBenchmark: () => { abortBenchmark = true; },
    exportSnapshot: () => download(snapshot(), `volume-tick-${state.tick}.json`),
  };
  pump = createFramePump(now => { activeFrame = frame(now); return activeFrame; }, { onError: fatal });
  window.addEventListener('pagehide', () => { pump.stop(); worker.terminate(); renderer.close(); });
}
main().catch(fatal);
