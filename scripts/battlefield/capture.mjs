import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cpus } from 'node:os';
import { Worker } from 'node:worker_threads';
import { guardNode } from '../verification_guard.mjs';
import { loadCatalogue, hash } from '../liquid_contact_engine.mjs';
import { createCrossingMission } from '../../examples/crossing-mission/mission.mjs';
import { complete } from '../crossing_order_replay.mjs';
import * as api from 'state-space-engine/experimental/3d/multiphysics';
import { pack, unpack, viewOf, distribution, startTick, sliceTicks, sliceCount } from './slice.mjs';
import { createTerrain, cameraAt, crossingCells, changedCells, framesPerSlice } from './scene.mjs';
import { build } from 'esbuild';
import {
  MAT,
  createStateSpaceStructuralWorld3D,
} from 'state-space-engine/experimental/3d/structural-world';
import { geometry } from './scene.mjs';
import { measurePass } from './passes.mjs';

await guardNode('cpu', 300);
const root = resolve('dist/verification/battlefield');
await mkdir(root, { recursive: true });
const output = await mkdtemp(root + '/capture-');
const report = {
  status: 'started',
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  cpu: cpus()[0].model,
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  v8: process.versions.v8,
  nativeFrameTimes: null,
  raw: [],
};
let worker;
try {
  const baseline = JSON.parse(
    await readFile('engine/test-support/fixtures/multi-turn-crossing-v2.json', 'utf8'),
  ).expected;
  const { digestFrozen3D: digest } = await loadCatalogue(output);
  assert.equal(process.versions.v8, baseline.v8);
  const profiles = await api.createMultiphysicsProfiles3D(),
    mission = createCrossingMission(api, profiles);
  assert.equal(digest(mission.save().world), baseline.initialSHA256);
  const frames = [],
    plan = mission.prepare('advance-together');
  const prediction = complete(plan, 256, (f) => frames.push(f));
  assert.deepEqual(mission.commit(plan), prediction);
  assert.deepEqual(
    { historySHA256: digest(frames.map(digest)), finalSHA256: digest(prediction.turn) },
    baseline.cases.early,
  );
  assert.equal(prediction.turn.fracture, 95);
  const initial = frames[startTick - 1].result.snapshot;
  const selected = frames.slice(startTick, startTick + sliceCount * sliceTicks);
  assert.equal(selected.length, sliceCount * sliceTicks);
  const slices = [];
  for (let i = 0; i < selected.length; i += sliceTicks) {
    const rows = selected.slice(i, i + sliceTicks);
    slices.push({
      tick: startTick + i,
      edits: rows.map((r) => r.edits),
      views: rows.map((r) => viewOf(r.result.snapshot)),
      results: rows.map((r) => r.result),
    });
  }
  assert.deepEqual(
    slices[0].views.map((v) => v.intact),
    [true, true, false, false],
  );
  const water = initial.parcels.filter((p) => p.material === 'water');
  const final = selected.at(-1).result.snapshot;
  const waterTravel = water.map((p) =>
    Math.hypot(...final.parcels.find((q) => q.id === p.id).center.map((v, i) => v - p.center[i])),
  );
  assert.equal(water.length, 4);
  assert(Math.max(...waterTravel) > 0.001);
  const terrain = createTerrain();
  const views = [viewOf(initial), ...slices.flatMap((s) => s.views)];
  const pictures = views.map((v) => Array.from(crossingCells(v)));
  const waterCells = pictures.map((cells) =>
    pack(cells.filter(([, mat]) => mat === MAT.WATER).map(([key]) => key)),
  );
  assert(new Set(waterCells).size > 1, 'Water must visibly move on the display lattice');
  assert(new Set(pictures.map(pack)).size > 2);
  assert(changedCells(crossingCells(views[0]), crossingCells(views.at(-1)), terrain).length > 0);
  assert.equal(
    new Set(Array.from({ length: framesPerSlice * sliceCount }, (_, i) => pack(cameraAt(i)))).size,
    framesPerSlice * sliceCount,
  );
  const packet = { schema: 'battlefield-crossing-1', initial, slices };
  // Exercise the native pass controller and every presentation edit on the hosted CPU.
  // The injected display clock is only a regression control and produces no frame evidence.
  const display = createStateSpaceStructuralWorld3D(geometry);
  display.restore(terrain);
  let shown = new Map(),
    displayTime = 0;
  const probe = await measurePass({
    packet,
    request: async ({ kind, tick }) => {
      const { views } = slices[(tick - startTick) / sliceTicks];
      return kind === 'preview' ? { views, workerMs: 0 } : views.at(-1);
    },
    boundary: async () => (displayTime += 1000 / 60),
    clock: () => displayTime,
    draw: async (view, forecast) => {
      const next = crossingCells(view, forecast),
        edits = changedCells(shown, next, terrain);
      if (edits.length) display.edit(edits);
      shown = next;
      return { edits: edits.length };
    },
    counts: { frames: 0 },
    check: (observed) =>
      assert.deepEqual(
        observed,
        slices.map((s) => ({ views: s.views, committed: s.views.at(-1) })),
      ),
  });
  assert.equal(probe.frames.length, framesPerSlice * sliceCount);
  assert.deepEqual(
    probe.frames.map((f) => f.key),
    Array.from({ length: probe.frames.length }, (_, i) => i),
  );
  assert.equal(probe.queries.length, sliceCount);
  const lastPicture = display.snapshot().packedCells.map((cell) => cell & 255);
  const expectedPicture = terrain.packedCells.map((cell) => cell & 255);
  for (const [i, mat] of pictures.at(-1)) expectedPicture[i] = mat;
  assert.deepEqual(lastPicture, expectedPicture, 'render edits must restore all vacated cells');
  const bytes = pack(packet);
  assert.deepEqual(unpack(bytes), packet);
  Object.assign(report, {
    firstTick: startTick,
    lastTick: final.tick,
    fractureTick: 95,
    waterTravel,
    physicalParcels: initial.parcels.length,
    presentationGrid: [64, 16, 64],
    squadMarkers: 12,
    physicalActors: 2,
    distinctWaterFootprints: new Set(waterCells).size,
    terrainSHA256: digest(terrain),
    trajectorySHA256: baseline.cases.early.historySHA256,
    packetSHA256: hash(bytes),
  });
  worker = new Worker(new URL('./node-worker.mjs', import.meta.url));
  let pending;
  worker.on('message', ({ value, error }) => {
    if (error) pending.reject(Error(error));
    else pending.resolve(value);
    pending = null;
  });
  worker.on('error', (e) => pending?.reject(e));
  worker.on('exit', (code) => pending?.reject(Error('Benchmark worker exited ' + code)));
  function request(data) {
    return new Promise((resolve, reject) => {
      pending = { resolve, reject };
      worker.postMessage(data);
    });
  }
  for (let round = 0; round < 4; round++) {
    await request({ kind: 'init', snapshot: initial });
    if (!round)
      await assert.rejects(request({ kind: 'commit', tick: startTick }), /No prepared slice/);
    for (const { tick, edits, views } of slices) {
      const sent = performance.now(),
        preview = await request({ kind: 'preview', tick, edits }),
        received = performance.now();
      const commitAt = performance.now(),
        committed = await request({ kind: 'commit', tick }),
        ack = performance.now();
      assert.deepEqual(preview.views, views);
      assert.deepEqual(committed, views.at(-1));
      if (round)
        report.raw.push({
          round,
          tick,
          workerMs: preview.workerMs,
          previewMs: received - sent,
          commitMs: ack - commitAt,
        });
    }
    const audit = await request({ kind: 'audit', tick: final.tick });
    assert.deepEqual(
      audit.history,
      selected.map((f) => f.result),
    );
    assert.deepEqual(audit.live, final);
  }
  report.timing = Object.fromEntries(
    ['workerMs', 'previewMs', 'commitMs'].map((k) => [
      k,
      distribution(report.raw.map((r) => r[k])),
    ]),
  );
  const bundle = resolve(output, 'native');
  await mkdir(bundle);
  await build({
    entryPoints: {
      app: 'scripts/battlefield/browser.mjs',
      worker: 'scripts/battlefield/worker.mjs',
    },
    outdir: bundle,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
  });
  await copyFile('scripts/battlefield/index.html', resolve(bundle, 'index.html'));
  await writeFile(resolve(bundle, 'packet.json'), bytes);
  const files = {};
  for (const name of ['app.js', 'worker.js', 'index.html', 'packet.json'])
    files[name] = hash(await readFile(resolve(bundle, name)));
  await writeFile(
    resolve(bundle, 'manifest.json'),
    JSON.stringify({ revision: report.revision, files }),
  );
  report.nativeFiles = files;
  report.status = 'complete';
  console.log(JSON.stringify({ revision: report.revision, timings: report.timing, waterTravel }));
} catch (e) {
  report.status = 'failed';
  report.error = String(e);
  throw e;
} finally {
  if (worker) await worker.terminate();
  await writeFile(resolve(output, 'summary.json'), JSON.stringify(report, null, 2) + '\n');
}
