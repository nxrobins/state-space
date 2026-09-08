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
  return { passed: true, backendInfo, caseCount: rows.length, passComparisons: rows.reduce((sum, row) => sum + row.passComparisons, 0), rows };
}
