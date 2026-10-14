import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';
import { platform, cpus } from 'node:os';
import { SCENES, createScene } from '../examples/volume-lab/scenes.js';
import { sources, save, hash, distribution } from './volume_evidence.mjs';
const { values } = parseArgs({ options: { report: { type: 'string', default: 'docs/checkpoints/volume-m1/cpu.json' } } });
const before = sources(), rows = [];
for (const scene of SCENES) {
  const field = createScene(scene.id), initialHash = hash(field.snapshot()), warmup = [], measured = [];
  for (let tick = 0; tick < 660; tick++) {
    const started = performance.now(); field.step(); const ms = performance.now() - started;
    (tick < 60 ? warmup : measured).push(ms);
  }
  assert.equal(field.energyBalance().driftQ, 0n);
  const row = { scene: scene.id, dimensions: [32,32,32], warmup: distribution(warmup), ticks: distribution(measured),
    initialHash, finalHash: hash(field.snapshot()), endTick: field.tick, energyDriftQ: '0' };
  rows.push(row); console.log(`${scene.id}: median ${row.ticks.median.toFixed(2)} ms/tick, p95 ${row.ticks.p95.toFixed(2)} ms`);
}
const report = { reportVersion: 1, recordedAt: new Date().toISOString(), environment: { node: process.version, platform: platform(), cpu: cpus()[0]?.model },
  scope: 'Public CPU field.step, all 27 passes; excludes setup, state copies, ledger inspection, rendering and hashing.', performanceIsReleaseGate: false,
  sourceHashes: before, sourceUnchanged: hash(before) === hash(sources()), rows };
assert(report.sourceUnchanged); console.log(save(values.report, report));
