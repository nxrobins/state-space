/** Capture v2 world ticks, then compare private linear solvers on identical detached inputs. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { BUNDLE, hash } from './liquid_contact_engine.mjs';
import { guardNode } from './verification_guard.mjs';
import { captureScene, scenes } from './world_pressure_capture.mjs';

await guardNode('cpu', 600);
const output = resolve('dist/verification/world-pressure', randomUUID());
mkdirSync(output, { recursive: true });
const goldenFile = 'engine/experimental/multiphysics/liquid-contact-freeze.json';
const golden = JSON.parse(readFileSync(goldenFile, 'utf8'));
const write = (file, value) =>
  writeFileSync(
    resolve(output, file),
    JSON.stringify(
      value,
      (_key, v) => (typeof v === 'number' && !Number.isFinite(v) ? String(v) : v),
      2,
    ) + '\n',
  );
const report = {
  schema: 'world-pressure-study-1',
  status: 'started',
  node: process.version,
  v8: process.versions.v8,
  arch: process.arch,
  platform: process.platform,
  cpu: cpus()[0]?.model,
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  supervisor: process.env.STATE_SPACE_VERIFICATION_JOB,
  sources: {},
  cases: [],
  scope: 'Fixed active-face replays. Whole-world and GPU speedup are unmeasured.',
};
write('summary.json', report);

const median = (values) => {
  const xs = [...values].sort((a, b) => a - b);
  return (xs[Math.floor((xs.length - 1) / 2)] + xs[Math.floor(xs.length / 2)]) / 2;
};
function compare(scene) {
  const pairs = [],
    summaries = {};
  for (const [i, order] of [
    ['dense', 'matrix-free'],
    ['matrix-free', 'dense'],
  ].entries()) {
    const pair = {};
    for (const method of order) {
      const file = scene.id + '-' + method + '-' + i + '.json';
      execFileSync(
        process.execPath,
        [
          '--single-threaded',
          'scripts/world_pressure_replay.mjs',
          output,
          scene.file,
          scene.sha256,
          method,
          resolve(output, file),
        ],
        { stdio: 'inherit' },
      );
      const run = JSON.parse(readFileSync(resolve(output, file), 'utf8'));
      assert.equal(run.rows.length, scene.capturedFaces);
      const summary = (summaries[method] ??= {
        rows: run.rows.length,
        passing: run.rows.filter((row) => row.accepted).length,
        maxResidualOverBudget: Math.max(0, ...run.rows.map((r) => r.residual / r.tolerance)),
        maxResponseError: Math.max(0, ...run.rows.map((r) => r.responseError)),
        maxForceError: Math.max(0, ...run.rows.flatMap((r) => r.bodies.map((b) => b.forceError))),
        maxTorqueError: Math.max(0, ...run.rows.flatMap((r) => r.bodies.map((b) => b.torqueError))),
        maxIterations: Math.max(0, ...run.rows.map((r) => r.iterations)),
        cpuMs: [],
        wallMs: [],
        peakRSSKiB: [],
        files: [],
      });
      if (summary.files.length) {
        const prior = JSON.parse(readFileSync(resolve(output, summary.files[0]), 'utf8'));
        assert.deepEqual(run.rows, prior.rows, 'replay diagnostics changed across processes');
      }
      summary.files.push(file);
      summary.cpuMs.push(...run.samples.map((s) => s.cpuMs));
      summary.wallMs.push(...run.samples.map((s) => s.wallMs));
      summary.peakRSSKiB.push(run.processPeakRSSKiB);
      pair[method] = median(run.samples.map((s) => s.cpuMs));
    }
    pairs.push(pair);
  }
  for (const result of Object.values(summaries)) {
    result.medianCpuMs = median(result.cpuMs);
    result.medianWallMs = median(result.wallMs);
  }
  return {
    methods: summaries,
    pairedProcessMediansCpuMs: pairs,
    passesFaceGates:
      scene.capturedFaces > 0 && Object.values(summaries).every((s) => s.passing === s.rows),
    fasterInBothOrders: scene.capturedFaces > 0 && pairs.every((p) => p['matrix-free'] < p.dense),
  };
}

try {
  assert.equal(process.versions.v8, golden.runtime.v8, 'use the frozen V8 for exact comparison');
  const bundle = resolve(output, 'study.mjs');
  const result = await build({
    ...BUNDLE,
    stdin: {
      resolveDir: process.cwd(),
      contents:
        "export * from './engine/experimental/multiphysics.ts';" +
        "export { createWorldTickJob } from './engine/experimental/multiphysics/world-tick.ts';" +
        "export { createProjectionStudy3D } from './engine/experimental/multiphysics/projection-study.ts';" +
        "export * from './engine/test-support/multiphysics-frozen-cases.ts';",
    },
    outfile: bundle,
    metafile: true,
  });
  for (const file of [
    ...Object.keys(result.metafile.inputs).filter((p) => p !== '<stdin>'),
    goldenFile,
    'scripts/world_pressure_capture.mjs',
    'scripts/world_pressure_replay.mjs',
    'scripts/compare_world_pressure.mjs',
    'scripts/liquid_contact_engine.mjs',
    'package-lock.json',
  ])
    report.sources[file] = hash(readFileSync(file));
  const api = await import(pathToFileURL(bundle).href);
  const profiles = await api.createMultiphysicsProfiles3D();
  for (const fixture of scenes) {
    console.log('Capturing', fixture.id);
    const scene = captureScene(api, profiles, golden, fixture, output);
    report.cases.push(scene);
    write('summary.json', report);
    console.log('Comparing', scene.capturedFaces, 'faces from', fixture.id);
    Object.assign(scene, compare(scene));
    write('summary.json', report);
    assert.equal(
      scene.methods.dense.passing,
      scene.capturedFaces,
      'dense replay disagrees with v2',
    );
  }
  // The catalogue repeats a rejection and retries from a serialized save. Both must retain
  // the exact stage, work, reason, and atomicity when the observer is installed.
  const fixture = api.FROZEN_CASES_3D.find((f) => f.id === 'reject-compressed-liquid');
  const { heavy, why, ...expected } = golden.cases[fixture.id];
  const noop = () => {};
  const observing = {
    ...api,
    createMultiphysicsTickJob3D: (p, s) =>
      api.createWorldTickJob(p, s, { first: noop, postDrift: noop }),
  };
  const rejected = api.recordFrozenCase3D(observing, profiles, fixture);
  assert.deepEqual(rejected, expected);
  assert.equal(rejected.rejection.atomic, true);
  report.rejectionControl = rejected.rejection;
  report.status = 'complete';
  console.log('Capture and replay complete', output);
} catch (e) {
  report.status = 'failed';
  report.error = String(e);
  throw e;
} finally {
  write('summary.json', report);
}
