/** Supervised CPU cost of the frozen liquid/contact cases.
 *
 *   node scripts/profile_liquid_contact.mjs [--commit <sha>] [--select light|heavy|all|<id>]
 *     [--rounds <1..25>] [--focus <function>] [--timeout <seconds, at most 1800>]
 *
 * Without a commit it measures the working tree: per case its CPU time, deterministic work
 * units, the split by tick stage and the functions with the most self time. With a commit it
 * runs that commit and the working tree in alternating order and reports the paired ratio,
 * which is how an exact-behaviour change is costed. It measures and never asserts
 * behaviour; `freeze_liquid_contact.mjs compare` is the exactness check.
 *
 * Time is the process's own CPU time (user plus system). Under the supervisor's CPU cap wall
 * time is throttled, so it is used only for the stage split, where it is a share. */
import { randomUUID } from 'node:crypto';
import { Session } from 'node:inspector/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { version as esbuildVersion } from 'esbuild';
import {
  bundleEngine,
  extractCommit,
  loadCatalogue,
  readOptions,
  selectCases,
} from './liquid_contact_engine.mjs';
import { guardNode } from './verification_guard.mjs';

const USAGE =
  'Usage: node scripts/profile_liquid_contact.mjs [--commit <sha>] [--select light|heavy|all|<id-substring>]\n' +
  '  [--rounds <1..25>] [--focus <function>] [--timeout <seconds, at most 1800>]';
const options = readOptions(
  process.argv.slice(2),
  { commit: undefined, select: 'control', rounds: '5', timeout: '900', focus: undefined },
  USAGE,
);
if (!/^([1-9]|1[0-9]|2[0-5])$/.test(options.rounds)) throw Error(USAGE);
const rounds = Number(options.rounds);
await guardNode('cpu', Number(options.timeout));

const output = resolve('dist/liquid-contact', `profile-${randomUUID()}`);
await mkdir(output, { recursive: true });
const say = (row) => console.log(JSON.stringify(row));
const catalogue = await loadCatalogue(output);
const selected = selectCases(catalogue, options.select);

async function load(root, name) {
  const bundle = await bundleEngine(root, output, name, catalogue),
    engine = await import(pathToFileURL(bundle.path).href);
  return { bundle, engine, profiles: await engine.createMultiphysicsProfiles3D() };
}
/** Run one case with no digests. `segments`, when given, receives one `[stage, work, ns]`
 * entry per run of a tick stage, in order; the clock is read only when the stage changes. */
function drive({ engine, profiles }, frozen, segments) {
  const stats = { steps: 0, work: 0, rejected: null };
  const add = (stage, work, since) => {
    const now = process.hrtime.bigint();
    segments.push([stage, work, now - since]);
    return now;
  };
  frozen.run({
    engine,
    profiles,
    seed: (id, material, center, extra = {}) =>
      engine.seedThermalParcel3D(profiles, {
        id,
        material,
        center,
        owner: 'authored',
        temperature: 20,
        ...extra,
      }),
    advance(start, count, observe) {
      let snapshot = start;
      for (let step = 0; step < count; step++) {
        if (stats.rejected !== null) return { snapshot, rejected: true };
        try {
          let result;
          if (segments) {
            let mark = process.hrtime.bigint(),
              stage = 'admission',
              units = 0;
            const job = engine.createMultiphysicsTickJob3D(profiles, snapshot);
            mark = add(stage, 0, mark);
            stage = null;
            for (;;) {
              const progress = job.advance(1);
              if (progress.stage !== stage) {
                if (stage !== null) mark = add(stage, units, mark);
                stage = progress.stage;
                units = 0;
              }
              units++;
              if (progress.status !== 'running') break;
            }
            mark = add(stage, units, mark);
            result = job.result();
            add('result copy', 0, mark);
          } else {
            const job = engine.createMultiphysicsTickJob3D(profiles, snapshot);
            while (job.progress().status === 'running') job.advance(256);
            result = job.result();
          }
          snapshot = result.snapshot;
          stats.steps++;
          stats.work += result.report.work;
          observe?.(result, step);
        } catch (error) {
          stats.rejected = error.message;
          return { snapshot, rejected: true };
        }
      }
      return { snapshot, rejected: false };
    },
    commit(_value, work) {
      stats.steps++;
      stats.work += work;
    },
    reject(rejection) {
      stats.rejected = rejection.message;
    },
    fact() {},
  });
  return stats;
}
/** CPU time of one run, averaged over `repeat` back-to-back runs. The process clock ticks in
 * steps of about 16 ms on Windows, so a short case is repeated until one sample is long. */
function timed(side, frozen, repeat = 1) {
  const before = process.cpuUsage();
  let stats;
  for (let i = 0; i < repeat; i++) stats = drive(side, frozen);
  const used = process.cpuUsage(before);
  return { ...stats, cpuMs: (used.user + used.system) / 1000 / repeat };
}
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b),
    middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const round = (value, digits = 3) => Number(value.toPrecision(digits));

/** Self time by function from a sampling profile of one run. */
async function hottest(side, frozen) {
  const session = new Session();
  session.connect();
  await session.post('Profiler.enable');
  await session.post('Profiler.setSamplingInterval', { interval: 100 });
  await session.post('Profiler.start');
  // Three runs in one profile: a single short run samples too few ticks to rank functions.
  for (let i = 0; i < 3; i++) {
    drive(side, frozen);
    say({ case: frozen.id, profiledRun: i + 1 });
  }
  const { profile } = await session.post('Profiler.stop');
  session.disconnect();
  const frames = new Map(profile.nodes.map((node) => [node.id, node.callFrame])),
    parents = new Map(),
    self = new Map();
  for (const node of profile.nodes)
    for (const child of node.children ?? []) parents.set(child, node.id);
  // Engine frames carry their bundle line; the runtime's own frames are grouped.
  const label = (id) => {
    const frame = frames.get(id),
      name = frame.functionName || '(anonymous)';
    return frame.url.startsWith('file:')
      ? `${name} :${frame.lineNumber + 1}`
      : frame.url
        ? '(node runtime)'
        : name;
  };
  let total = 0;
  profile.samples.forEach((id, i) => {
    self.set(label(id), (self.get(label(id)) ?? 0) + profile.timeDeltas[i]);
    total += profile.timeDeltas[i];
  });
  const ranked = [...self]
    .filter(
      ([key]) =>
        !['(garbage collector)', '(idle)', '(program)', '(root)', '(node runtime)'].includes(key),
    )
    .sort((a, b) => b[1] - a[1]);
  // Who reaches one function, the hottest unless --focus names another: the three nearest
  // distinct callers of each of its samples.
  const focus = options.focus
      ? ranked.find(([key]) => key.startsWith(`${options.focus} :`))?.[0]
      : ranked[0]?.[0],
    chains = new Map();
  profile.samples.forEach((id, i) => {
    if (label(id) !== focus) return;
    const chain = [];
    for (let at = parents.get(id); at !== undefined && chain.length < 3; at = parents.get(at))
      if (label(at) !== focus && label(at) !== chain.at(-1)) chain.push(label(at));
    const key = chain.join(' < ');
    chains.set(key, (chains.get(key) ?? 0) + profile.timeDeltas[i]);
  });
  const percent = (micros) => round((100 * micros) / total);
  return {
    garbageCollectorPercent: percent(self.get('(garbage collector)') ?? 0),
    functions: ranked
      .slice(0, 12)
      .map(([key, micros]) => ({ function: key, percent: percent(micros) })),
    focus,
    hottestReachedFrom: [...chains]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([chain, micros]) => ({ chain, percent: percent(micros) })),
  };
}

const candidate = await load(process.cwd(), 'candidate');
const frozenSide = options.commit
  ? await extractCommit(options.commit, output).then(async ({ sha, root }) => ({
      sha,
      ...(await load(root, 'frozen')),
    }))
  : null;
const rows = [];
for (const frozen of selected) {
  // Warm the optimizing compiler outside the measured rounds, and size one sample to about
  // a second and a half of CPU time.
  const warm = timed(candidate, frozen);
  if (frozenSide) timed(frozenSide, frozen);
  const repeat = Math.max(1, Math.min(40, Math.ceil(1500 / Math.max(1, warm.cpuMs))));
  say({ case: frozen.id, stage: 'warmed', repeat });
  const samples = { candidate: [], frozen: [] };
  let last = null,
    lastFrozen = null;
  for (let i = 0; i < rounds; i++) {
    // Alternate which engine runs first, so order cannot favour either.
    for (const name of frozenSide && i % 2 ? ['frozen', 'candidate'] : ['candidate', 'frozen']) {
      if (name === 'frozen' && !frozenSide) continue;
      const run = timed(name === 'frozen' ? frozenSide : candidate, frozen, repeat);
      samples[name].push(run.cpuMs);
      if (name === 'frozen') lastFrozen = run;
      else last = run;
    }
    say({ case: frozen.id, round: i + 1 });
  }
  const cpuMs = median(samples.candidate),
    row = {
      case: frozen.id,
      runsPerSample: repeat,
      steps: last.steps,
      rejected: last.rejected,
      work: last.work,
      cpuMs: round(cpuMs, 4),
      cpuMsMinMax: [
        round(Math.min(...samples.candidate), 4),
        round(Math.max(...samples.candidate), 4),
      ],
      cpuMsPerStep: last.steps ? round(cpuMs / last.steps, 4) : null,
      nsPerWorkUnit: last.work ? round((1e6 * cpuMs) / last.work) : null,
    };
  if (frozenSide) {
    Object.assign(row, {
      frozenCpuMs: round(median(samples.frozen), 4),
      // Per round, so drift across the run cancels.
      pairedRatio: round(median(samples.candidate.map((value, i) => value / samples.frozen[i])), 4),
      sameStepsAndWork: lastFrozen.steps === last.steps && lastFrozen.work === last.work,
    });
  } else {
    // The same deterministic segments run every time; a pause under the CPU cap only ever
    // adds time, so each segment's least time over the runs is its cost.
    let least = null;
    for (let i = 0; i < Math.max(3, rounds); i++) {
      const segments = [];
      drive(candidate, frozen, segments);
      say({ case: frozen.id, stageRun: i + 1 });
      if (least && least.some(([stage], at) => stage !== segments[at]?.[0]))
        throw Error('Stage sequence changed between identical runs.');
      least = least
        ? least.map(([stage, work, ns], at) => [
            stage,
            work,
            ns < segments[at][2] ? ns : segments[at][2],
          ])
        : segments;
    }
    const stages = {};
    for (const [stage, work, ns] of least) {
      const entry = (stages[stage] ??= { work: 0, ns: 0n });
      entry.work += work;
      entry.ns += ns;
    }
    const wall = Object.values(stages).reduce((sum, stage) => sum + stage.ns, 0n);
    row.stageMsPerStep = round(Number(wall) / 1e6 / last.steps, 4);
    row.stages = Object.entries(stages)
      .map(([stage, { work, ns }]) => ({
        stage,
        percent: round(Number((ns * 10000n) / wall) / 100),
        work,
      }))
      .filter((stage) => stage.percent >= 0.5)
      .sort((a, b) => b.percent - a.percent);
    Object.assign(row, await hottest(candidate, frozen));
  }
  rows.push(row);
  say(row);
}
await writeFile(
  resolve(output, 'report.json'),
  JSON.stringify(
    {
      select: options.select,
      rounds,
      runtime: { node: process.version, v8: process.versions.v8, cpu: cpus()[0]?.model },
      esbuild: esbuildVersion,
      supervisorJob: process.env.STATE_SPACE_VERIFICATION_JOB,
      candidateSourceSha256: candidate.bundle.sourceSha256,
      frozen: frozenSide && {
        commit: frozenSide.sha,
        sourceSha256: frozenSide.bundle.sourceSha256,
      },
      rows,
    },
    null,
    2,
  ) + '\n',
);
say({ stage: 'profiled', cases: rows.length, output });
