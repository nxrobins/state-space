// Executed inside an actual browser by scripts/verify_browser.py.
import { LabController, encode } from './controller.js';
import { SCENARIOS } from './scenarios.js';
import { bondMarkers } from './view.js';

const require = (condition, label) => { if (!condition) throw new Error(label); };
const same = (actual, expected, label) => require(encode(actual) === encode(expected), label);
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
async function settled() {
  const deadline = performance.now() + 20000;
  while (window.engineLab.pending) { if (performance.now() > deadline) throw new Error('UI did not finish'); await pause(); }
  require(!document.getElementById('status').classList.contains('error'), document.getElementById('status').textContent);
}

export async function verifyLab(progress = () => {}) {
  const rows = [];
  for (const scene of SCENARIOS) {
    const cpu = new LabController(), gpu = new LabController();
    try {
      await cpu.load(scene.id, 'cpu'); await gpu.load(scene.id, 'webgpu');
      require(!gpu.view.backendInfo.isFallbackAdapter, 'Hardware WebGPU adapter required for release evidence');
      same(gpu.view.snapshot, cpu.view.snapshot, `${scene.id} initial complete state`);
      await cpu.step(scene.ticks, true); await gpu.step(scene.ticks, true);
      same(gpu.view.snapshot, cpu.view.snapshot, `${scene.id} final complete state`);
      same(gpu.view.reports, cpu.view.reports, `${scene.id} pass diagnostics`);
      same(gpu.view.balance.driftQ, '0', `${scene.id} energy drift`);
      const final = gpu.view.snapshot, session = await gpu.exportSession();
      await gpu.switchBackend('cpu'); same(gpu.view.snapshot, final, `${scene.id} backend transfer`);
      await gpu.step(1); const continued = gpu.view.snapshot;
      await gpu.importSession(session); await gpu.switchBackend('webgpu'); await gpu.step(1);
      same(gpu.view.snapshot, continued, `${scene.id} cross-backend continuation`);
      const invalid = JSON.parse(encode(session)); delete invalid.snapshot.structure;
      let rejected = false; try { await gpu.importSession(invalid); } catch { rejected = true; }
      require(rejected, 'Incomplete snapshot must fail');
      same(gpu.view.snapshot, continued, `${scene.id} failed import atomicity`);
      await Promise.all([gpu.step(1), gpu.step(1)]);
      same(gpu.view.snapshot.tick, continued.tick + 2, `${scene.id} serialized asynchronous stepping`);
      rows.push({ scene: scene.id, ticks: scene.ticks, final, reportsMatch: true, restartMatch: true, invalidImportRejected: true, concurrentStepsSerialized: true, backendInfo: gpu.view.backendInfo });
      progress({ stage: 'live scenes', completed: rows.length, total: SCENARIOS.length });
    } finally { await cpu.close(); await gpu.close(); }
  }
  return { passed: true, sceneCount: rows.length, rows };
}

export async function verifyLabUI() {
  await window.engineLab.ready;
  const ui = window.engineLab, lab = ui.controller, byId = id => document.getElementById(id);
  const select = async (id, value) => { byId(id).value = value; byId(id).dispatchEvent(new Event('change', { bubbles: true })); await settled(); };
  await select('scenario', 'fragment'); await select('backend', 'webgpu');
  byId('inspect').checked = true; byId('step').click(); await settled();
  require(lab.view.snapshot.tick === 1 && byId('passes').textContent.includes('structure'), 'Inspected step did not render');
  require(lab.view.reports.length === 18, 'UI must retain all last-step pass diagnostics');
  const canvas = byId('world'), box = canvas.getBoundingClientRect(), x = 13, y = 4;
  require(Math.abs(box.width / box.height - canvas.width / canvas.height) < 0.005, 'Canvas letterboxing breaks cell picking');
  canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: box.left + (x + .5) / 40 * box.width, clientY: box.top + (y + .5) / 28 * box.height }));
  same(byId('coordinates').textContent, `${x}, ${y}`, 'Pointer maps to rendered cell');
  require(byId('sample').textContent.includes('metal'), 'Pointer must inspect the plate');
  require(bondMarkers(lab.view.samples[y * 40 + x].bonds).includes('●'), 'Bond directions must be visible');
  await select('action', 'heat'); const before = BigInt(lab.view.ledger.totalQ);
  canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await settled();
  require(BigInt(lab.view.ledger.totalQ) - before === 200n * 256n, 'Keyboard intervention must change the selected cell');
  same(lab.view.balance.driftQ, '0', 'External edit accounting');
  byId('save').click(); await settled(); const saved = lab.view.snapshot;
  byId('step').click(); await settled(); byId('restore').click(); await settled();
  same(lab.view.snapshot, saved, 'Save/restore controls');
  await select('scenario', 'extension');
  require([...byId('material').options].some(option => option.value === '255'), 'Custom material palette');
  const custom = await lab.exportSession();
  await select('scenario', 'span');
  const transfer = new DataTransfer(); transfer.items.add(new File([JSON.stringify(custom)], 'session.json', { type: 'application/json' }));
  byId('upload').files = transfer.files; byId('upload').dispatchEvent(new Event('change', { bubbles: true })); await settled();
  same(lab.view.snapshot, custom.snapshot, 'Session file restores complete state with catalog');
  await select('overlay', 'temperature');
  byId('play').click();
  const deadline = performance.now() + 20000;
  while (lab.view.snapshot.tick < custom.snapshot.tick + 2) { if (performance.now() > deadline) throw new Error('Play failed to advance'); await pause(); }
  byId('play').click(); await settled(); require(!ui.playing, 'Pause must stop playback');
  const stopped = lab.view.snapshot.tick; await new Promise(resolve => setTimeout(resolve, 150));
  same(lab.view.snapshot.tick, stopped, 'Paused simulation stays paused');
  require(byId('status').textContent.startsWith('Paused'), 'Paused status must agree with playback');
  same(byId('scenario').value, 'imported', 'Restored session must have a meaningful selection');
  return { passed: true, inspectedPasses: 18, pickedCell: { x, y }, externalHeatQ: 200 * 256,
    snapshotControls: true, customFileImport: true, playback: true, canvasAspectRatio: box.width / box.height, finalTick: stopped };
}
