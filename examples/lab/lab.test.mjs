import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createStateSpaceField, DEFAULT_REGISTRY, MAT } from '../../dist/sdk/state-space.js';
import { LabController, encode } from './controller.js';
import { SCENARIOS } from './scenarios.js';
import { drawField, locateCell } from './view.js';
import { lintSource } from '../../engine/lint_ts.mjs';

const custom = await DEFAULT_REGISTRY.extend(JSON.parse(readFileSync(new URL('../sdk/materials.json', import.meta.url), 'utf8')));
const registryFor = async scene => scene.customRegistry ? custom : DEFAULT_REGISTRY;
const cpuFactory = async (_backend, width, height, registry) => createStateSpaceField(width, height, undefined, registry);

test('all lab scenes exhibit their named behavior while retaining exact energy and replay', async () => {
  const rows = [];
  for (const scene of SCENARIOS) {
    const lab = new LabController(cpuFactory, registryFor);
    try {
      await lab.load(scene.id);
      const initial = await lab.exportSession();
      await lab.step(scene.ticks, true);
      const final = lab.view.snapshot;
      assert.equal(lab.view.balance.driftQ, '0');
      assert.equal(lab.view.reports.length, scene.ticks * 18);
      assert.ok(lab.view.reports.every(report => report.deltaQ === '0'));
      const positions = material => final.packedCells.flatMap((cell, index) => (cell & 255) === material ? [index] : []);
      if (scene.id === 'span') assert.deepEqual(final.packedCells, initial.snapshot.packedCells);
      if (scene.id === 'fragment') {
        assert.equal(positions(MAT.METAL).length, 27);
        assert.equal(Math.min(...positions(MAT.METAL)), 15 * scene.width + 12);
        assert.equal(lab.view.plan.components.filter(component => component.cells.some(i => (final.packedCells[i] & 255) === MAT.METAL)).length, 1);
      }
      if (scene.id === 'fire') {
        assert.equal(positions(MAT.WOOD).length, 0);
        assert.equal(positions(MAT.METAL).length, 11);
        assert.ok(Math.min(...positions(MAT.METAL)) >= 10 * scene.width);
        assert.ok(lab.view.reports.some(report => report.passId === 'combustion' && report.changes > 0));
      }
      if (scene.id === 'phase') {
        assert.ok(positions(MAT.MOLTEN_METAL).length > 0);
        assert.ok(positions(MAT.ICE).length > 0);
      }
      if (scene.id === 'extension') { assert.ok(positions(19).length > 0); assert.equal(positions(255).length, 16); }
      await lab.importSession(JSON.parse(JSON.stringify(initial)));
      await lab.step(1); const split = await lab.exportSession();
      await lab.importSession(split); await lab.step(scene.ticks - 1);
      assert.deepEqual(lab.view.snapshot, final);
      rows.push({ scene: scene.id, ticks: scene.ticks, passed: true });
    } finally { await lab.close(); }
  }
  console.log(encode(rows));
});

test('queued GPU steps, edits, export and backend switches retain one complete state', async () => {
  let inFlight = false;
  const factory = async (backend, width, height, registry) => {
    if (backend === 'broken') throw new Error('Adapter creation failed');
    const field = createStateSpaceField(width, height, undefined, registry);
    return new Proxy(field, { get(target, key) {
      if (inFlight) throw new Error('Read while GPU was busy');
      if (key === 'step') return async (...args) => { inFlight = true; await new Promise(resolve => setImmediate(resolve)); inFlight = false; return field.step(...args); };
      const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
    } });
  };
  const lab = new LabController(factory, registryFor);
  try {
    await lab.load('fragment', 'webgpu');
    await Promise.all([lab.step(1, true), lab.step(1), lab.edit(0, 0, 'paint', MAT.SAND), lab.switchBackend('cpu')]);
    assert.equal(lab.view.snapshot.tick, 2); assert.equal(lab.view.samples[0].material, MAT.SAND);
    const saved = await lab.exportSession();
    await assert.rejects(lab.switchBackend('broken'), /Adapter creation failed/);
    assert.deepEqual((await lab.exportSession()).snapshot, saved.snapshot);
    const invalid = structuredClone(saved); delete invalid.snapshot.structure;
    await assert.rejects(lab.importSession(invalid), /Snapshot/);
    assert.deepEqual((await lab.exportSession()).snapshot, saved.snapshot);
    const changing = structuredClone(saved), importing = lab.importSession(changing); changing.snapshot.packedCells[0] = 0;
    await importing; assert.deepEqual(lab.view.snapshot, saved.snapshot);
    await lab.step(1); assert.equal(lab.view.snapshot.tick, 3);
    assert.equal(lab.view.balance.driftQ, '0');
    assert.throws(() => { lab.view.snapshot.energyQ[0] = 1; }, TypeError);
  } finally { await lab.close(); }
  await assert.rejects(lab.step(), /closed/);
});

test('bond overlay draws the reciprocal edges returned by the public sample API', async () => {
  const lab = new LabController(cpuFactory, registryFor);
  try {
    await lab.load('span'); let lines = 0;
    const context = { fillRect() {}, strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() { lines += 1; }, stroke() {} };
    drawField({ getContext: () => context }, lab.view, 'material', { x: 0, y: 0 });
    const bondedCells = lab.view.samples.filter(cell => cell.bonds !== 0);
    assert.ok(bondedCells.length > 50);
    assert.ok(lines >= bondedCells.length / 2, `Expected visible bonds, observed ${lines} line segments`);
    assert.deepEqual(locateCell({ getBoundingClientRect: () => ({ left: 40, top: 60, width: 800, height: 560 }) }, { clientX: 300, clientY: 330 }, 40, 28), { x: 13, y: 13 });
  } finally { await lab.close(); }
});

test('a queued scene change follows the selected backend at execution time', async () => {
  const lab = new LabController(cpuFactory, registryFor);
  try {
    await lab.load('span');
    await Promise.all([lab.switchBackend('webgpu'), lab.load('fire')]);
    assert.equal(lab.view.backend, 'webgpu');
    assert.equal(lab.view.scene, 'fire');
  } finally { await lab.close(); }
});

test('public client lint rejects compact bond bits and internal physics imports', () => {
  assert.ok(lintSource('if (cell.bonds & 2) draw();', 'examples/lab/view.js').some(value => value.startsWith('SS042')));
  assert.ok(lintSource("import { planStructure } from '../../engine/structure.js';", 'examples/lab/view.js').some(value => value.startsWith('SS046')));
  assert.ok(lintSource('class Lab { #backend; load(id, backend = this.#backend) {} }', 'examples/lab/controller.js').some(value => value.startsWith('SS048')));
  assert.deepEqual(lintSource(readFileSync(new URL('view.js', import.meta.url), 'utf8'), 'examples/lab/view.js'), []);
});
