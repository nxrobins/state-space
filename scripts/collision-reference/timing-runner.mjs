/** Fixed stack timing diagnostics. Live owned-Job attestation precedes engine imports. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance, PerformanceObserver, constants } from 'node:perf_hooks';
import { ROOT, readPacket, hash, json } from './packet.mjs';
if (process.argv.length !== 3) throw Error('Private fixed timing invocation required');
const attempt = resolve(process.argv[2]);
const review = JSON.parse(readFileSync(join(attempt, '../review.json'), 'utf8'));
const python = Object.keys(review.binaries).find((p) => /[\\/]python\.exe$/i.test(p));
if (!python) throw Error('Missing reviewed Python identity');
const attested = JSON.parse(
  execFileSync(
    python,
    ['-I', '-B', join(ROOT, 'scripts/collision_cpu_leaf.py'), '--claim-node', attempt],
    { encoding: 'utf8', windowsHide: true, timeout: 10000 },
  ),
);
const config = attested.timing;
if (config?.kind !== 'rigid-stack-timing-v1') throw Error('Unreviewed timing recipe');
for (const key of ['baseline', 'baselinePacket', 'originalBundle', 'regressionBaseline'])
  if (hash(readFileSync(join(ROOT, config[key]))) !== config[key + 'Sha256'])
    throw Error('Timing baseline changed');
const { packet, sha256 } = readPacket(attested.benchmark.directory);
if (sha256 !== attested.benchmark.packetSha256 || packet.bundleSha256 !== config.bundleSha256)
  throw Error('Attested timing engine mismatch');
const baseline = JSON.parse(readFileSync(join(ROOT, config.baseline), 'utf8'));
const api = await import(pathToFileURL(join(attested.benchmark.directory, 'engine.mjs')).href);
const { benchmarkWorldReplay, benchmarkRigid } = await import('./state-space.mjs');
const { assertExactCapture, assertBaseline } = await import('./profile-data.mjs');
const { same } = await import('./replay.mjs');
const result = {
  kind: config.kind,
  packetSha256: sha256,
  status: 'failed',
  acceptance: packet.protocol.acceptance,
};
const boundedJson = (path, value) => {
  if (Buffer.byteLength(JSON.stringify(value)) > config.maxDiagnosticBytes)
    throw Error('Timing diagnostic output budget exceeded');
  json(path, value);
};
try {
  if (attested.case === 'world-reference') {
    result.world = await benchmarkWorldReplay(api);
    assertExactCapture(result.world.exact, baseline.worldReplay.exact);
    same(
      { ...result.world, exact: result.world.exact.sha256 },
      { ...baseline.worldReplay, exact: baseline.worldReplay.exact.sha256 },
      'timing world baseline',
    );
  } else if (attested.case === 'ss-owned-regression') {
    const old = await import(pathToFileURL(join(ROOT, config.regressionBaseline)).href);
    const { checkOwnedRegression } = await import('./owned-regression.mjs');
    result.regression = checkOwnedRegression(old, api);
  } else {
    const recipes = {
      'ss-stack-plain': { clocks: false, reverse: false },
      'ss-stack-clock-ab-1': { clocks: true, reverse: false },
      'ss-stack-clock-ba-1': { clocks: true, reverse: true },
      'ss-stack-clock-ab-2': { clocks: true, reverse: false },
      'ss-stack-clock-ba-2': { clocks: true, reverse: true },
    };
    const recipe = recipes[attested.case];
    if (!recipe || config.scene !== 'resting-stack') throw Error('Unknown fixed stack timing case');
    if (typeof process.threadCpuUsage !== 'function') throw Error('Missing thread CPU clock');
    const old = await import(pathToFileURL(join(ROOT, config.originalBundle)).href);
    const { timeRigidSteps, annotateTiming } = await import('./timing-data.mjs');
    const scene = packet.fixtures.find((s) => s.id === config.scene),
      rows = [],
      gc = [];
    const appendGc = (entries) => {
      for (const entry of entries) {
        if (gc.length >= config.maxGcEvents) {
          result.gcOverflow = true;
          break;
        }
        gc.push({
          startMs: entry.startTime,
          endMs: entry.startTime + entry.duration,
          durationMs: entry.duration,
          kind: entry.detail.kind,
          flags: entry.detail.flags,
        });
      }
    };
    const observer = recipe.clocks
      ? new PerformanceObserver((list) => appendGc(list.getEntries()))
      : null;
    if (observer) observer.observe({ entryTypes: ['gc'] });
    result.rows = rows;
    result.timeOriginMs = performance.timeOrigin;
    result.clockSemantics =
      'Wall and current-main-thread/process CPU around each synchronous rigid step. CPU counters have coarse OS accounting; raw negative gaps are retained. GC intervals measure elapsed overlap, not GC CPU. Instrumented timings never replace the original cohort.';
    result.recipe = recipe;
    let totalSteps = 0;
    try {
      for (const [dtIndex, dt] of packet.protocol.timesteps.entries()) {
        // Same row context as the original fixture, with fixed opposite-order cohorts.
        const order =
          (dtIndex + Number(recipe.reverse)) % 2 === 0
            ? ['baseline', 'optimized']
            : ['optimized', 'baseline'];
        for (const version of order) {
          const selected = version === 'baseline' ? old : api;
          const measured = recipe.clocks
            ? timeRigidSteps(selected, config.maxStepRecords - totalSteps)
            : null;
          let row;
          try {
            row = benchmarkRigid(measured?.api ?? selected, scene, dt);
            assertBaseline(
              row,
              baseline.rows.find(
                (r) => r.backend === 'state-space-rigid' && r.scene === scene.id && r.dt === dt,
              ),
            );
          } catch (error) {
            boundedJson(join(attempt, 'failed-' + version + '-' + dt + '.json'), {
              error: String(error),
              partial: error.partial ?? null,
              steps: measured?.records ?? [],
            });
            throw error;
          }
          const rowName = version + '-row-' + dt + '.json';
          boundedJson(join(attempt, rowName), row);
          totalSteps += measured?.records.length ?? 0;
          rows.push({
            version,
            dt,
            order,
            exactSha256: row.exact.sha256,
            phaseWork: row.phaseWork,
            timing: row.timing,
            rowFile: rowName,
            rowSha256: hash(readFileSync(join(attempt, rowName))),
            rawSteps: measured?.records ?? [],
            // Capture has already been checked losslessly; this field is used only for work receipts.
            workFrames: row.exact.value.frames.map((f) => f.result.report.work),
          });
        }
      }
    } finally {
      if (observer) {
        // Drain deferred notifications once, after the entire synchronous fixture.
        await new Promise((resolve) => setImmediate(resolve));
        await new Promise((resolve) => setImmediate(resolve));
        appendGc(observer.takeRecords());
        observer.disconnect();
      }
      result.gc = gc;
      result.gcKinds = Object.fromEntries(
        Object.entries(constants).filter(([key]) => key.startsWith('NODE_PERFORMANCE_GC_')),
      );
    }
    if (result.gcOverflow) throw Error('GC event output budget exceeded');
    for (const row of rows) {
      if (recipe.clocks) {
        const record = JSON.parse(readFileSync(join(attempt, row.rowFile), 'utf8'));
        row.measurements = annotateTiming(row.rawSteps, record, gc);
      }
      delete row.rawSteps;
      delete row.workFrames;
    }
    result.totalSteps = totalSteps;
  }
  result.status = 'completed';
} catch (error) {
  result.error = String(error);
  result.stack = error.stack;
  process.exitCode = 1;
}
boundedJson(join(attempt, 'result.json'), result);
readPacket(attested.benchmark.directory);
for (const key of ['baseline', 'baselinePacket', 'originalBundle', 'regressionBaseline'])
  if (hash(readFileSync(join(ROOT, config[key]))) !== config[key + 'Sha256'])
    throw Error('Timing baseline drift');
