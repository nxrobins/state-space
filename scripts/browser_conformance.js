// Run from a local browser against the built public SDK and retained native corpus.
// Uses only exported APIs. Every pass must reconstruct the native complete state.
import { createStateSpaceField, createGpuField } from '../dist/sdk/state-space.js';

function same(actual, expected, label) {
  const encode = value => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item);
  if (encode(actual) !== encode(expected)) throw new Error(`Mismatch: ${label}`);
}

function checkPasses(initial, reports, expected, label) {
  same(reports.length, expected.length, `${label} pass count`);
  const cells = initial.packedCells.slice(), energy = initial.energyQ.slice(), structure = initial.structure.slice();
  reports.forEach((report, index) => {
    const reference = expected[index];
    same([report.tick, report.passId], [reference.tick, reference.id], `${label} pass identity`);
    const seen = new Set();
    for (const change of report.changes) {
      if (seen.has(change.index) || change.index < 0 || change.index >= cells.length) throw new Error('Invalid/duplicate changed cell');
      seen.add(change.index);
      same([change.beforePacked, change.beforeEnergyQ, change.beforeStructure],
        [cells[change.index], energy[change.index], structure[change.index]], `${label} delta input`);
      cells[change.index] = change.afterPacked;
      energy[change.index] = change.afterEnergyQ;
      structure[change.index] = change.afterStructure;
    }
    same(cells, reference.cells, `${label} ${index} packed`);
    same(energy, reference.energyQ, `${label} ${index} energy`);
    same(structure, reference.structure, `${label} ${index} structure`);
    same(report.after.totalQ.toString(), report.before.totalQ.toString(), `${label} energy budget`);
  });
}

export async function verifyBrowserCorpus(url, progress = () => {}) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Cannot read native evidence: ${response.status}`);
  const cases = await response.json();
  if (!Array.isArray(cases) || cases.length < 31 || new Set(cases.map(value => value.name)).size !== cases.length) throw new Error('Incomplete or ambiguous corpus');
  const rows = [];
  let backendInfo;
  for (const fixture of cases) {
    const cpu = createStateSpaceField(fixture.width, fixture.height);
    const gpu = await createGpuField(fixture.width, fixture.height);
    try {
      const initial = { ...cpu.packedSnapshot(), tick: fixture.tick, packedCells: fixture.cells, energyQ: fixture.energyQ, structure: fixture.structure };
      cpu.restore(initial); gpu.restore(initial);
      const cpuPasses = cpu.step(fixture.ticks, { inspect: true });
      const gpuPasses = await gpu.step(fixture.ticks, { inspect: true });
      checkPasses(initial, cpuPasses, fixture.passes, `${fixture.name} CPU`);
      checkPasses(initial, gpuPasses, fixture.passes, `${fixture.name} WebGPU`);
      same(gpuPasses, cpuPasses, `${fixture.name} complete reports and structural diagnostics`);
      const final = gpu.packedSnapshot();
      same(final, cpu.packedSnapshot(), `${fixture.name} public snapshot`);
      gpu.restore(initial);
      await gpu.step(1);
      const saved = gpu.packedSnapshot();
      await gpu.step(fixture.ticks - 1);
      same(gpu.packedSnapshot(), final, `${fixture.name} uninspected stepping`);
      gpu.restore(JSON.parse(JSON.stringify(saved)));
      await gpu.step(fixture.ticks - 1);
      same(gpu.packedSnapshot(), final, `${fixture.name} serialized restart`);
      same(gpu.energyBalance().driftQ.toString(), '0', `${fixture.name} final accounting`);
      backendInfo = gpu.backendInfo;
      rows.push({ name: fixture.name, width: fixture.width, height: fixture.height, ticks: fixture.ticks,
        passComparisons: gpuPasses.length, completeReportsMatch: true, uninspectedMatch: true, restartMatch: true, final });
      progress({ completed: rows.length, total: cases.length, name: fixture.name });
    } finally { cpu.close(); gpu.close(); }
  }
  // A pooled readback may contain a failed intermediate tick. It must never
  // overwrite the committed start state, even after the first mapping succeeds.
  const gpu = await createGpuField(9, 7), cpu = createStateSpaceField(9, 7);
  try {
    gpu.setCell(4, 0, 3); gpu.setCell(4, 5, 2); gpu.setCell(3, 2, 5);
    const initial = gpu.packedSnapshot(); cpu.restore(initial); cpu.step(3);
    const expected = cpu.packedSnapshot();
    for (const fault of ['mapAsync', 'getMappedRange']) {
      gpu.restore(initial);
      const original = GPUBuffer.prototype[fault]; let calls = 0;
      GPUBuffer.prototype[fault] = function (...args) {
        if (fault === 'mapAsync' && ++calls === 2) return Promise.reject(new Error('injected readback failure'));
        const result = original.apply(this, args);
        if (fault === 'getMappedRange' && ++calls === 2) new Uint32Array(result)[9 * 7 * 2 + 3] |= 8192;
        return result;
      };
      let rejected = false;
      try { await gpu.step(3); } catch { rejected = true; }
      finally { GPUBuffer.prototype[fault] = original; }
      if (!rejected || calls !== 2) throw new Error('Pooled readback fault was not exercised');
      same(gpu.packedSnapshot(), initial, 'failed pooled step remains atomic');
      await gpu.step(3); same(gpu.packedSnapshot(), expected, 'pooled retry matches CPU');
    }
    const target = { grid: new Uint32Array(63), energyQ: new Uint32Array(63), structure: new Uint32Array(63) };
    const pending = gpu.step(); let rejected = false;
    try { gpu.copyStateInto(target); } catch { rejected = true; }
    if (!rejected) throw new Error('Copy during a GPU step must fail');
    await pending;
    if (gpu.copyStateInto(target) !== gpu.tick) throw new Error('Copy tick differs');
    for (const key of ['grid', 'energyQ', 'structure']) same([...target[key]], [...gpu.snapshot()[key]], 'reusable public copy');
    const saved = gpu.packedSnapshot(); target.grid.fill(0);
    same(gpu.packedSnapshot(), saved, 'caller-owned copy does not alias GPU state');
    let nested;
    const reentrant = new Proxy(target, { getOwnPropertyDescriptor(object, key) {
      nested ??= gpu.step(); return Reflect.getOwnPropertyDescriptor(object, key);
    } });
    rejected = false;
    try { gpu.copyStateInto(reentrant); } catch { rejected = true; }
    await nested;
    if (!rejected) throw new Error('Reentrant copy during a GPU step must fail');
  } finally { gpu.close(); cpu.close(); }
  return { passed: true, backendInfo, ownedReadbackRollback: true, reusableCopyIsolation: true,
    caseCount: rows.length, passComparisons: rows.reduce((sum, row) => sum + row.passComparisons, 0), rows };
}
