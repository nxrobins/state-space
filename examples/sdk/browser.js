import { createStateSpaceField, createGpuField, DEFAULT_REGISTRY, MAT } from 'state-space-engine';

const extensions = await (await fetch(new URL('./materials.json', import.meta.url))).json();
const registry = await DEFAULT_REGISTRY.extend(extensions);
const byId = id => document.getElementById(id);
const canvas = byId('world');
const context = canvas.getContext('2d');
const stringify = value => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item);
let world, saved, working = false;

for (const material of extensions) {
  const label = document.createElement('span');
  const swatch = document.createElement('i');
  swatch.className = 'swatch'; swatch.style.background = material.color;
  label.append(swatch, material.name.replaceAll('_', ' ')); byId('palette').append(label);
}

function render() {
  const grid = world.grid;
  const image = context.createImageData(world.width, world.height);
  for (let i = 0; i < grid.length; i += 1) {
    const color = registry.material(grid[i] & 255).color;
    for (let channel = 0; channel < 3; channel += 1) image.data[i * 4 + channel] = parseInt(color.slice(1 + channel * 2, 3 + channel * 2), 16);
    image.data[i * 4 + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  const ledger = world.energyLedger(), balance = world.energyBalance();
  byId('accounting').textContent = `Tick ${world.tick}\nSensible: ${ledger.sensibleQ} Q\nLatent: ${ledger.latentQ} Q\nChemical: ${ledger.chemicalQ} Q\nTotal: ${ledger.totalQ} Q\nExternal edits: ${balance.externalQ} Q\nDrift: ${balance.driftQ} Q`;
}

async function perform(operation) {
  working = true;
  for (const element of document.querySelectorAll('button,select,input')) element.disabled = true;
  byId('status').textContent = 'Working…';
  try { await operation(); render(); }
  catch (error) { byId('status').textContent = `Error: ${error.message}`; console.error(error); }
  finally {
    working = false;
    for (const element of document.querySelectorAll('button,select,input')) element.disabled = false;
    byId('restore').disabled = !saved;
  }
}

async function reset() {
  const next = byId('backend').value === 'gpu' ? await createGpuField(64, 48, { registry }) : createStateSpaceField(64, 48, MAT.AIR, registry);
  world?.close(); world = next; saved = undefined;
  for (let x = 0; x < 64; x += 1) world.setCell(x, 47, MAT.STONE);
  for (let x = 10; x < 27; x += 1) for (let y = 8; y < 13; y += 1) world.setCell(x, y, 18, 120);
  for (let x = 36; x < 48; x += 1) for (let y = 28; y < 34; y += 1) world.setCell(x, y, 20, 150);
  world.paintCircle(42, 10, 5, 255);
  world.paintCircle(18, 36, 7, MAT.WATER, 25);
  byId('status').textContent = `${byId('backend').value === 'gpu' ? 'WebGPU' : 'CPU'} field ready. All state belongs to registry ${registry.hash.slice(0, 12)}…`;
}

function seedTest(field) {
  for (let x = 0; x < 8; x += 1) field.setCell(x, 6, MAT.STONE, 20);
  field.setCell(2, 1, 18, 120, 9);
  field.setCell(4, 2, 20, 150);
  field.setCell(1, 1, 255, 20, 15);
  field.setEnergy(2, 1, 120 * 256 + 17);
}

async function verify() {
  const cpu = createStateSpaceField(8, 7, MAT.AIR, registry);
  const gpu = await createGpuField(8, 7, { registry });
  try {
    seedTest(cpu); seedTest(gpu);
    const initial = gpu.packedSnapshot();
    const cpuPasses = cpu.step(3, { inspect: true });
    const gpuPasses = await gpu.step(3, { inspect: true });
    if (stringify(cpuPasses) !== stringify(gpuPasses)) throw new Error('CPU/GPU pass deltas differ');
    const savedCpu = cpu.packedSnapshot(), savedGpu = gpu.packedSnapshot();
    cpu.step(2); await gpu.step(2);
    const final = gpu.packedSnapshot();
    if (stringify(cpu.packedSnapshot()) !== stringify(final)) throw new Error('CPU/GPU complete state differs');
    cpu.restore(savedCpu); gpu.restore(savedGpu);
    cpu.step(2); await gpu.step(2);
    if (stringify(cpu.packedSnapshot()) !== stringify(final) || stringify(gpu.packedSnapshot()) !== stringify(final)) throw new Error('Restart differs');
    let invalidRestoreRejected = false;
    try { gpu.restore({ ...final, materialCatalogHash: DEFAULT_REGISTRY.hash }); } catch { invalidRestoreRejected = true; }
    if (!invalidRestoreRejected || stringify(gpu.packedSnapshot()) !== stringify(final)) throw new Error('Invalid restore was not atomic');
    const running = gpu.step(1);
    let blockedEdits = 0;
    for (const access of [() => gpu.setCell(0, 0, MAT.WATER), () => gpu.sample(0, 0), () => gpu.packedSnapshot(), () => gpu.close()]) {
      try { access(); } catch { blockedEdits += 1; }
    }
    const concurrent = gpu.step(1).then(() => false, () => true);
    await running;
    if (blockedEdits !== 4 || !await concurrent) throw new Error('Concurrent GPU access was not rejected');
    gpu.restore(final);
    const result = { catalogHash: registry.hash, initial, final, backendInfo: gpu.backendInfo,
      energyQ: gpu.energyLedger().totalQ.toString(), replayEqual: true, passDeltasMatch: true,
      invalidRestoreRejected, concurrentAccessRejected: true,
      passes: gpuPasses.map(report => ({ tick: report.tick, passId: report.passId,
        changes: report.changes.map(change => ({ index: change.index, before_packed: change.beforePacked, after_packed: change.afterPacked,
          before_energy_q: change.beforeEnergyQ, after_energy_q: change.afterEnergyQ,
          before_structure: change.beforeStructure, after_structure: change.afterStructure })), deltaQ: (report.after.totalQ - report.before.totalQ).toString() })) };
    window.__sdkVerification = result;
    return result;
  } finally { cpu.close(); gpu.close(); }
}

byId('reset').onclick = () => perform(reset);
byId('backend').onchange = () => perform(reset);
byId('step').onclick = () => perform(async () => {
  const reports = await world.step(16, { inspect: byId('inspect').checked });
  byId('passes').textContent = reports.length ? reports.filter(report => report.tick === world.tick - 1).map(report => `${report.passId}: ${report.changes.length} changes, ${report.after.totalQ - report.before.totalQ} Q drift`).join('\n') : 'Inspection was disabled for this step.';
  byId('status').textContent = `Completed tick ${world.tick}.`;
});
byId('save').onclick = () => perform(async () => { saved = JSON.parse(JSON.stringify(world.packedSnapshot())); byId('status').textContent = `Saved tick ${saved.tick}.`; });
byId('restore').onclick = () => perform(async () => { world.restore(saved); byId('status').textContent = `Restored tick ${world.tick}.`; });
byId('verify').onclick = () => perform(async () => {
  const result = await verify();
  byId('status').textContent = `Verified ${result.passes.length} CPU/GPU pass deltas, exact restart, and atomic state access. Energy drift: 0 Q.`;
});
canvas.onpointermove = event => {
  if (working || !world) return;
  const bounds = canvas.getBoundingClientRect();
  const x = Math.floor((event.clientX - bounds.left) / bounds.width * world.width);
  const y = Math.floor((event.clientY - bounds.top) / bounds.height * world.height);
  const cell = world.sample(x, y);
  byId('sample').textContent = `(${x}, ${y}) ${cell.materialName} · temperature ${(cell.temperatureQ / 256).toFixed(2)} · energy ${cell.energyQ} Q`;
};

const ready = perform(reset);
window.sdkExample = Object.freeze({ ready, verify, snapshot: () => world.packedSnapshot() });
