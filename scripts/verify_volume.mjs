import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';
import { platform, cpus } from 'node:os';
import { createScene, SCENES } from '../examples/volume-lab/scenes.js';
import { createStateSpaceField3D, MATERIALS_3D } from 'state-space-engine/experimental/3d';
import { sources, hash, save } from './volume_evidence.mjs';

const { values } = parseArgs({
  options: {
    report: { type: 'string', default: 'docs/checkpoints/volume-m1/node-verification.json' },
  },
});
const before = sources(),
  rows = [];
save(values.report, {
  reportVersion: 1,
  passed: false,
  status: 'running',
  sourceHashes: before,
  rows,
});
process.once('uncaughtExceptionMonitor', (error) =>
  save(values.report, {
    reportVersion: 1,
    passed: false,
    error: error.message,
    sourceHashes: before,
    rows,
  }),
);
for (const scene of SCENES) {
  const started = performance.now(),
    f = createScene(scene.id),
    initial = f.snapshot(),
    hashes = { 0: hash(initial) },
    checkpoints = new Map();
  const expectedTotal = f.energyBalance().currentQ;
  const familyCounts = (cells) =>
    cells.reduce((counts, word) => {
      const m = word & 255,
        key =
          m === 0
            ? 'air'
            : [2, 8, 9].includes(m)
              ? 'water'
              : [1, 10].includes(m)
                ? 'stone'
                : 'glass';
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {});
  const counts = (cells) =>
    cells.reduce(
      (result, word) => {
        const id = word & 255;
        result[id]++;
        return result;
      },
      Object.fromEntries(MATERIALS_3D.map((m) => [m.id, 0])),
    );
  const initialCounts = counts(initial.packedCells),
    checkpointCounts = { 0: initialCounts };
  const family = familyCounts(initial.packedCells),
    seen = new Set(initial.packedCells.map((v) => v & 255));
  for (let tick = 1; tick <= 1024; tick++) {
    f.step();
    assert.equal(f.energyBalance().driftQ, 0n);
    assert.equal(f.energyBalance().currentQ, expectedTotal);
    if ([1, 3, 4, 509, 510, 660, 1024].includes(tick)) {
      const snap = f.snapshot();
      hashes[tick] = hash(snap);
      checkpoints.set(tick, snap);
      checkpointCounts[tick] = counts(snap.packedCells);
    }
    if (tick % 32 === 0 || tick < 5) for (const word of f.grid) seen.add(word & 255);
  }
  const final = f.snapshot();
  assert.deepEqual(familyCounts(final.packedCells), family);
  if (scene.id === 'phase') assert(seen.has(9), 'Hot chamber must produce steam.');
  if (scene.id === 'melt') {
    assert(checkpointCounts[1][3] < initialCounts[3], 'Hot sand must vitrify.');
    assert(checkpointCounts[1][10] > initialCounts[10], 'Hot stone must melt.');
  }
  const repeated = createScene(scene.id);
  repeated.step(1024);
  assert.deepEqual(repeated.snapshot(), final);
  for (const tick of [3, 509]) {
    const restored = createStateSpaceField3D(32, 32, 32);
    restored.restore(checkpoints.get(tick));
    restored.step(1024 - tick);
    assert.deepEqual(restored.snapshot(), final);
    assert.equal(restored.energyBalance().driftQ, 0n);
  }
  const row = {
    scene: scene.id,
    passed: true,
    ticks: 1024,
    repeatedExact: true,
    restartTicks: [3, 509],
    restartExact: true,
    familyCounts: family,
    checkpointCounts,
    observedMaterials: [...seen].sort((a, b) => a - b),
    energyDriftQ: '0',
    totalQ: String(expectedTotal),
    hashes,
    final,
    durationMs: performance.now() - started,
  };
  rows.push(row);
  console.log(
    `${scene.id}: 1024 ticks, repeat + two split restarts exact, zero drift (${(row.durationMs / 1000).toFixed(1)}s)`,
  );
  save(values.report, {
    reportVersion: 1,
    passed: false,
    status: 'running',
    sourceHashes: before,
    rows,
  });
}
const report = {
  reportVersion: 1,
  passed: true,
  recordedAt: new Date().toISOString(),
  environment: { node: process.version, platform: platform(), cpu: cpus()[0]?.model },
  sourceHashes: before,
  sourceUnchanged: hash(before) === hash(sources()),
  rows,
};
assert(report.sourceUnchanged);
console.log(save(values.report, report));
