import { LabController } from './controller.js';
import { SCENARIOS } from './scenarios.js';
import { drawField, locateCell, fillDefinitions, bondMarkers } from './view.js';

const byId = id => document.getElementById(id), canvas = byId('world');
const lab = new LabController();
let selected = { x: 0, y: 0 }, saved, playing = false, pending = 0, elapsed = 0, paletteHash;
for (const scene of SCENARIOS) byId('scenario').add(new Option(scene.title, scene.id));
const imported = new Option('Restored session', 'imported'); imported.disabled = true; byId('scenario').add(imported);

function controls() {
  for (const element of document.querySelectorAll('button,select,input')) element.disabled = pending > 0;
  byId('play').disabled = pending > 0 && !playing;
  byId('restore').disabled = pending > 0 || !saved;
  byId('play').textContent = playing ? 'Pause' : 'Play';
}
function render() {
  const view = lab.view;
  if (!view) return;
  const scene = SCENARIOS.find(value => value.id === view.scene);
  const { width, height, tick } = view.snapshot;
  selected.x = Math.min(selected.x, width - 1); selected.y = Math.min(selected.y, height - 1);
  const index = selected.y * width + selected.x, cell = view.samples[index];
  byId('scenario').value = scene?.id ?? 'imported';
  byId('backend').value = view.backend;
  byId('title').textContent = scene?.title ?? 'Your restored world';
  byId('category').textContent = scene?.category ?? 'COMPLETE SNAPSHOT';
  byId('description').textContent = scene?.description ?? 'This field and its catalog were restored from a portable session. Continue stepping or make an edit.';
  byId('limit').textContent = scene?.limit ?? 'The same ca-v3 cellular approximations apply. See the capability matrix for model limits.';
  byId('device').textContent = view.backendInfo ? `${view.backendInfo.vendor} ${view.backendInfo.architecture} · ${view.backendInfo.isFallbackAdapter ? 'fallback adapter' : 'WebGPU adapter'}` : 'Deterministic JavaScript reference';
  byId('tick').textContent = tick; byId('drift').textContent = `${view.balance.driftQ} Q`;
  if (paletteHash !== view.snapshot.materialCatalogHash) {
    const previous = byId('material').value;
    byId('material').replaceChildren(...view.catalog.materials.map(material => new Option(`${material.name.replaceAll('_', ' ')} · ${material.id}`, material.id)));
    if (view.catalog.materials.some(material => String(material.id) === previous)) byId('material').value = previous;
    paletteHash = view.snapshot.materialCatalogHash;
  }
  byId('coordinates').textContent = `${selected.x}, ${selected.y}`;
  fillDefinitions(byId('sample'), [['Material', cell.materialName], ['Temperature', `${(cell.temperatureQ / 256).toFixed(2)} units`], ['Energy', `${cell.energyQ} Q`], ['Integrity', `${cell.integrity} / 255`], ['Bonds · L R U D', bondMarkers(cell.bonds)], ['Anchored', cell.anchored ? 'yes' : 'no'], ['Support distance', view.plan.distances[index] < 0 ? 'unsupported' : view.plan.distances[index]], ['Load / capacity', `${view.plan.loads[index]} / ${view.plan.capacities[index]}`]]);
  fillDefinitions(byId('ledger'), [['Sensible', `${view.ledger.sensibleQ} Q`], ['Latent', `${view.ledger.latentQ} Q`], ['Chemical', `${view.ledger.chemicalQ} Q`], ['Total', `${view.ledger.totalQ} Q`], ['External edits', `${view.balance.externalQ} Q`]]);
  byId('structure').textContent = `${view.plan.components.length} bonded components · ${view.plan.components.filter(component => component.moving).length} ready to fall · ${view.plan.supportedWeight} supported weight units`;
  byId('timing').textContent = `${width} × ${height} cells · last requested step ${elapsed.toFixed(1)} ms (wall time; inspection adds work)`;
  byId('passes').textContent = view.reports.length ? view.reports.map(report => `${report.tick} / ${report.passId}: ${report.changes} changes, ΔE ${report.deltaQ} Q`).join('\n') : 'Enable “Inspect passes” and step to see which rules changed the state.';
  drawField(canvas, view, byId('overlay').value, selected);
}
async function perform(operation, message) {
  pending += 1; controls();
  try { const result = await operation(); render(); byId('status').className = ''; byId('status').textContent = typeof message === 'function' ? message() : message; return result; }
  catch (error) { playing = false; render(); byId('status').className = 'error'; byId('status').textContent = `Operation failed: ${error.message}. The last committed field is retained.`; return null; }
  finally { pending -= 1; controls(); }
}
async function step() {
  const started = performance.now();
  await lab.step(1, byId('inspect').checked); elapsed = performance.now() - started;
}
async function animate() {
  if (!playing) return;
  await perform(step, () => playing ? 'Live simulation running. Pause to inspect or edit.' : 'Paused. Inspect a cell or make an edit.');
  if (playing) setTimeout(animate, 33);
}
byId('play').onclick = () => { playing = !playing; controls(); if (playing) void animate(); else byId('status').textContent = 'Paused. Inspect a cell or make an edit.'; };
byId('step').onclick = () => perform(step, 'Completed one tick.');
byId('scenario').onchange = event => { playing = false; elapsed = 0; return perform(() => lab.load(event.target.value), 'Experiment ready.'); };
byId('backend').onchange = event => { playing = false; return perform(() => lab.switchBackend(event.target.value), 'Backend changed; the complete state and tick were preserved.'); };
byId('reset').onclick = () => { playing = false; elapsed = 0; return perform(() => lab.load(lab.view.scene === 'imported' ? 'span' : lab.view.scene), 'Scene reset.'); };
byId('overlay').onchange = render;
byId('save').onclick = () => perform(async () => { saved = await lab.exportSession(); }, 'Complete state and catalog saved in memory.');
byId('restore').onclick = () => { playing = false; return perform(() => lab.importSession(saved), 'Saved state restored with a new accounting baseline.'); };
byId('download').onclick = () => perform(async () => {
  const session = await lab.exportSession(), url = URL.createObjectURL(new Blob([JSON.stringify(session)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `state-space-tick-${session.snapshot.tick}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}, 'Session downloaded with its registry.');
byId('upload').onchange = event => {
  playing = false;
  const file = event.target.files[0]; event.target.value = '';
  if (file) return perform(async () => {
    if (file.size > 20_000_000) throw new Error('Session file exceeds the 20 MB lab limit');
    const session = JSON.parse(await file.text());
    if (!Number.isSafeInteger(session.snapshot?.width) || !Number.isSafeInteger(session.snapshot?.height) || session.snapshot.width * session.snapshot.height > 16_384) throw new Error('Interactive lab imports are limited to 16,384 cells');
    await lab.importSession(session);
  }, 'Session restored with its material catalog.');
};
function intervene() {
  const action = byId('action').value;
  if (action === 'inspect') return;
  playing = false;
  return perform(() => lab.edit(selected.x, selected.y, action, Number(byId('material').value)), 'Edit applied; its energy was recorded as external input/output.');
}
canvas.onpointermove = event => { if (!lab.view) return; selected = locateCell(canvas, event, lab.view.snapshot.width, lab.view.snapshot.height); render(); };
canvas.onpointerdown = event => { selected = locateCell(canvas, event, lab.view.snapshot.width, lab.view.snapshot.height); render(); if (!pending) void intervene(); };
canvas.onkeydown = event => {
  if (!lab.view) return;
  const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (event.key in moves) { event.preventDefault(); selected.x = Math.max(0, Math.min(lab.view.snapshot.width - 1, selected.x + moves[event.key][0])); selected.y = Math.max(0, Math.min(lab.view.snapshot.height - 1, selected.y + moves[event.key][1])); render(); }
  if (event.key === 'Enter' && !pending) { event.preventDefault(); void intervene(); }
};
const ready = perform(() => lab.load('span', 'cpu'), 'Ready. Run an experiment or inspect a cell.');
window.engineLab = Object.freeze({ ready, controller: lab, render, get playing() { return playing; }, get pending() { return pending; } });
window.addEventListener('pagehide', () => { playing = false; void lab.close(); });
