/** Full public v2 tick latency and separate stage/sampling profiles of the frozen water scenes. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Session } from 'node:inspector/promises';
import { cpus } from 'node:os';
import { basename, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { BUNDLE, ENTRY, bundleEngine, hash, loadCatalogue } from './liquid_contact_engine.mjs';
import { guardNode } from './verification_guard.mjs';
import { scenes } from './world_pressure_capture.mjs';

const goldenPath = 'engine/experimental/multiphysics/liquid-contact-freeze.json';
const golden = JSON.parse(readFileSync(goldenPath, 'utf8'));
const write = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2;
};

// Only the diagnostic bundle exposes the inner yield labels. Refuse a partial or stale patch.
async function buildDiagnostic(output) {
  await build({
    ...BUNDLE,
    entryPoints: [ENTRY],
    outfile: resolve(output, 'diagnostic.mjs'),
    plugins: [
      {
        name: 'fluid-stage-labels',
        setup(builder) {
          const seen = new Set();
          builder.onLoad(
            { filter: /[/\\]multiphysics[/\\](world-tick|fluid-coupling)\.ts$/ },
            ({ path }) => {
              const name = basename(path);
              const [old, replacement] =
                name === 'world-tick.ts'
                  ? ["yield 'fluid-coupling';", "yield 'first/' + fluidResult.value;"]
                  : [
                      "job.advance(1);\n    yield 'fluid-solve';",
                      "yield 'fluid-solve/' + job.advance(1).stage;",
                    ];
              const source = readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
              assert.equal(source.split(old).length, 2, name + ' diagnostic hook changed');
              seen.add(name);
              return { contents: source.replace(old, replacement), loader: 'ts' };
            },
          );
          builder.onEnd(() => {
            assert.equal(seen.size, 2, 'missing diagnostic hook');
          });
        },
      },
    ],
  });
}

// A complete tick includes admission, all advances, validation and copying the published result.
// Attribute each advance to the label it returns after doing the work, including the first unit
// after a stage transition. Reading its timer precedes updating the profiling table.
function tick(engine, profiles, snapshot, stages) {
  const start = stages && performance.now();
  const job = engine.createMultiphysicsTickJob3D(profiles, snapshot);
  if (!stages) {
    while (job.progress().status === 'running') job.advance(256);
    return job.result();
  }
  stages.admission = { ms: performance.now() - start, work: 0 };
  let progress;
  do {
    const since = performance.now();
    progress = job.advance(1);
    const ms = performance.now() - since;
    const name = progress.stage.startsWith('fluid-') ? 'post/' + progress.stage : progress.stage;
    const row = (stages[name] ??= { ms: 0, work: 0 });
    row.ms += ms;
    row.work += progress.lastAdvanceWork;
  } while (progress.status === 'running');
  const since = performance.now();
  const result = job.result();
  stages.publication = { ms: performance.now() - since, work: 0 };
  return result;
}

async function measure(output, scene) {
  const load = async (name) => import(pathToFileURL(resolve(output, name + '.mjs')).href);
  const engine = await load('public'),
    catalogue = await load('catalogue');
  const profiles = await engine.createMultiphysicsProfiles3D();
  const reference = [];
  let initial;
  const recording = {
    ...engine,
    createMultiphysicsTickJob3D(p, state) {
      initial ??= structuredClone(state);
      const job = engine.createMultiphysicsTickJob3D(p, state);
      return {
        ...job,
        result() {
          const result = job.result();
          reference.push(structuredClone(result));
          return result;
        },
      };
    },
  };
  const fixture = catalogue.FROZEN_CASES_3D.find((f) => f.id === scene.id);
  const { heavy, why, ...expected } = golden.cases[scene.id];
  assert.deepEqual(catalogue.recordFrozenCase3D(recording, profiles, fixture), expected);
  assert.equal(expected.outcome, 'completed');
  assert.equal(reference.length, scene.ticks);
  assert.equal(initial.rules, 'multiphysics-world-2');
  assert.equal(initial.parcels.filter((p) => p.material === 'water').length, scene.water);
  const initialHash = catalogue.digestFrozen3D(initial);
  const resultHashes = reference.map(catalogue.digestFrozen3D);
  const checked = (results) => {
    assert.deepEqual(results, reference, 'full tick or report changed');
    assert.equal(catalogue.digestFrozen3D(initial), initialHash, 'input changed');
  };

  const samples = [];
  // Warm the actual public path. Stop after at least three sequences, 24 ticks and 6 s or 30 sequences.
  let warmups = 0,
    warmCpu = 0;
  do {
    const results = [];
    let snapshot = initial;
    const start = process.cpuUsage();
    for (let t = 0; t < scene.ticks; t++) {
      const result = tick(engine, profiles, snapshot);
      results.push(result);
      snapshot = result.snapshot;
    }
    const used = process.cpuUsage(start);
    warmCpu += (used.user + used.system) / 1000;
    warmups++;
    checked(results);
  } while (warmups < 3 || warmups * scene.ticks < 24 || (warmCpu < 6000 && warmups < 30));

  for (let round = 0; round < 9; round++) {
    let snapshot = initial;
    const results = [],
      times = [];
    for (let t = 0; t < scene.ticks; t++) {
      const cpu = process.cpuUsage(),
        start = performance.now();
      const result = tick(engine, profiles, snapshot);
      const wallMs = performance.now() - start,
        used = process.cpuUsage(cpu);
      times.push({ wallMs, cpuMs: (used.user + used.system) / 1000 });
      results.push(result);
      snapshot = result.snapshot;
    }
    samples.push(times);
    checked(results);
  }
  console.log(scene.id, 'ordinary tick timings complete');

  // Profile only ordinary ticks. Perform evidence checks after stopping the sampler.
  const session = new Session();
  session.connect();
  let profile;
  const sampled = [];
  try {
    await session.post('Profiler.enable');
    await session.post('Profiler.setSamplingInterval', { interval: 200 });
    await session.post('Profiler.start');
    for (let round = 0; round < 4; round++) {
      let snapshot = initial;
      const results = [];
      for (let t = 0; t < scene.ticks; t++) {
        const result = tick(engine, profiles, snapshot);
        results.push(result);
        snapshot = result.snapshot;
      }
      sampled.push(results);
    }
    ({ profile } = await session.post('Profiler.stop'));
  } finally {
    session.disconnect();
  }
  for (const results of sampled) checked(results);
  write(resolve(output, scene.id + '.cpuprofile'), profile);
  const nodes = new Map(profile.nodes.map((n) => [n.id, n.callFrame])),
    self = new Map();
  for (const [i, id] of profile.samples.entries()) {
    const frame = nodes.get(id);
    const label =
      frame.functionName +
      (frame.url ? ' (' + basename(frame.url) + ':' + (frame.lineNumber + 1) + ')' : '');
    self.set(label, (self.get(label) ?? 0) + profile.timeDeltas[i]);
  }
  const sum = [...self.values()].reduce((a, b) => a + b, 0);
  assert(sum > 0);
  const sampledSelf = [...self]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([frame, us]) => ({ frame, percent: (100 * us) / sum }));

  const diagnostic = await load('diagnostic');
  const diagProfiles = await diagnostic.createMultiphysicsProfiles3D();
  const stageSamples = [];
  for (let round = 0; round < 7; round++) {
    let snapshot = initial;
    const results = [],
      stagesByTick = [];
    for (let t = 0; t < scene.ticks; t++) {
      const stages = {};
      const result = tick(diagnostic, diagProfiles, snapshot, stages);
      assert.equal(
        Object.values(stages).reduce((n, s) => n + s.work, 0),
        result.report.work,
      );
      for (const pass of ['first/', 'post/'])
        assert(
          Object.keys(stages).some((key) => key.startsWith(pass + 'fluid-solve/projection-gram')),
        );
      stagesByTick.push(stages);
      results.push(result);
      snapshot = result.snapshot;
    }
    checked(results);
    if (round >= 2) stageSamples.push(stagesByTick);
  }
  const perTick = reference.map((r, t) => ({
    tick: r.snapshot.tick,
    work: r.report.work,
    hash: resultHashes[t],
    cpuMs: median(samples.map((s) => s[t].cpuMs)),
    wallMs: median(samples.map((s) => s[t].wallMs)),
  }));
  const datasets = stageSamples.map((round) => {
    const totals = {};
    for (const stages of round)
      for (const [label, s] of Object.entries(stages)) totals[label] = (totals[label] ?? 0) + s.ms;
    return totals;
  });
  // Use one observed round nearest the median whole-stage time so every share has one denominator.
  const totals = datasets.map((d) => Object.values(d).reduce((a, b) => a + b, 0));
  const rep = totals.indexOf(median(totals));
  const breakdown = Object.entries(datasets[rep])
    .sort((a, b) => b[1] - a[1])
    .map(([stage, ms]) => ({ stage, ms, percent: (100 * ms) / totals[rep] }));
  return {
    ...scene,
    initialHash,
    warmups,
    samples,
    perTick,
    sampledSelf,
    stageSamples,
    representativeStageRound: rep,
    breakdown,
    medianCpuMsPerTick: median(samples.map((s) => s.reduce((v, t) => v + t.cpuMs, 0) / s.length)),
    medianWallMsPerTick: median(samples.map((s) => s.reduce((v, t) => v + t.wallMs, 0) / s.length)),
  };
}

await guardNode('cpu', 600);
assert.equal(process.versions.v8, golden.runtime.v8);
if (process.argv[2] === '--child') {
  const [, , , output, id] = process.argv;
  const scene = scenes.find((s) => s.id === id);
  assert(scene);
  write(resolve(output, id + '.json'), await measure(output, scene));
} else {
  const output = resolve('dist/verification/world-tick-profile', randomUUID());
  mkdirSync(output, { recursive: true });
  const report = {
    schema: 'world-tick-profile-1',
    status: 'started',
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    cpu: cpus()[0]?.model,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    v8: process.versions.v8,
    supervisor: process.env.STATE_SPACE_VERIFICATION_JOB,
    flags: ['--single-threaded'],
    cases: [],
  };
  const save = () => write(resolve(output, 'summary.json'), report);
  save();
  try {
    const catalogue = await loadCatalogue(output),
      bundle = await bundleEngine(process.cwd(), output, 'public', catalogue);
    await buildDiagnostic(output);
    Object.assign(report, {
      engineSHA256: bundle.sourceSha256,
      catalogueSHA256: catalogue.sha256,
      frozenSHA256: hash(readFileSync(goldenPath)),
      driverSHA256: hash(readFileSync(fileURLToPath(import.meta.url))),
    });
    for (const scene of scenes) {
      console.log('Profiling', scene.id);
      execFileSync(
        process.execPath,
        ['--single-threaded', fileURLToPath(import.meta.url), '--child', output, scene.id],
        { stdio: 'inherit' },
      );
      report.cases.push(scene.id + '.json');
      save();
    }
    report.status = 'complete';
  } catch (e) {
    report.status = 'failed';
    report.error = String(e);
    throw e;
  } finally {
    save();
  }
}
