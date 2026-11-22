/** Supervised CPU cost of the frozen liquid/contact cases.
 *
 *   node scripts/profile_liquid_contact.mjs [--commit <sha>] [--select light|heavy|all|<id>[,<id>...]]
 *     [--rounds <1..25>] [--passes <1..4>] [--host loop|sliced|paced]
 *     [--focus <function>[,<function>...]] [--timeout <seconds, at most 1800>]
 *
 * Without a commit it measures the working tree: per case its CPU time, deterministic work
 * units, the split by tick stage, the functions with the most self time, and who reaches the
 * hottest of them (or each function --focus names), counted with its callees. With a commit it
 * measures that commit and the working tree and reports their ratio, which is how an
 * exact-behaviour change is costed. It measures and never asserts behaviour;
 * `freeze_liquid_contact.mjs compare` is the exactness check.
 *
 * Each engine runs alone, in a fresh child process started with --single-threaded, inside
 * the one supervised job. Two engines in one process disturb each other: they share object
 * shapes, and while one runs the other's functions are unreferenced, so a collection drops
 * their optimized code. On one thread the runtime's compiler and collector are counted with
 * the engine instead of running beside it, the process stays under the supervisor's CPU cap
 * so its time is not throttled, and the same work costs nearly the same from run to run. The
 * figure is therefore everything the process spent, engine and runtime together. A default
 * runtime moves part of that to other threads; it does not make it free.
 *
 * A case is warmed until its hot functions have been compiled, then timed in samples of about
 * a second and a half. With a commit the two engines take turns by process: working tree,
 * commit, commit, working tree for two passes.
 *
 * `--host` says how the ticks are driven, because the runtime does part of its collection in
 * tasks that only run when the process returns to its event loop, and what is unreferenced at
 * that moment decides what a collection may drop. `loop`, the default, runs a case back to
 * back and never returns. `sliced` takes a case that asks for one tick sequence and drives
 * that as a host does: one bounded slice of a tick per turn of the event loop. `paced` also
 * waits eight milliseconds between ticks, as a host with a fixed tick rate would. A case that
 * advances in several steps is skipped under both. The stage split and the function profile
 * are taken in a loop whichever is chosen. */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Session } from 'node:inspector/promises';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
  'Usage: node scripts/profile_liquid_contact.mjs [--commit <sha>] [--select light|heavy|all|<id-substring>[,...]]\n' +
  '  [--rounds <1..25>] [--passes <1..4>] [--host loop|sliced|paced]\n' +
  '  [--focus <function>[,<function>...]] [--timeout <seconds, at most 1800>]';
const say = (row) => console.log(JSON.stringify(row));
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b),
    middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const round = (value, digits = 3) => Number(value.toPrecision(digits));

/** Run one case with no digests. `segments`, when given, receives one `[stage, work, ns]`
 * entry per run of a tick stage, in order; the clock is read only when the stage changes.
 * `asked`, when given, is told each tick sequence the case asks for. */
function drive({ engine, profiles }, frozen, segments, asked) {
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
      asked?.(start, count);
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
const turn = () => new Promise((done) => setImmediate(done));
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
/** The tick sequence of a case that asks for exactly one: its starting snapshot and its number
 * of ticks. A case that advances in several steps, or one tick at a time, has none: a host
 * could not be given its ticks without the script that decides them. */
function onlySequence(side, frozen) {
  const sequences = [];
  drive(side, frozen, undefined, (start, count) => sequences.push({ start, count }));
  return sequences.length === 1 ? sequences[0] : null;
}
/** Drive one tick sequence as a host does: a bounded slice of work per turn of the event
 * loop and, when `gap` is set, that many idle milliseconds between ticks. */
async function host({ engine, profiles }, { start, count }, gap) {
  const stats = { steps: 0, work: 0, rejected: null };
  let snapshot = start;
  try {
    for (let step = 0; step < count; step++) {
      const job = engine.createMultiphysicsTickJob3D(profiles, snapshot);
      while (job.progress().status === 'running') {
        job.advance(256);
        await turn();
      }
      const result = job.result();
      snapshot = result.snapshot;
      stats.steps++;
      stats.work += result.report.work;
      if (gap) await pause(gap);
    }
  } catch (error) {
    stats.rejected = error.message;
  }
  return stats;
}
/** CPU time of one run, averaged over `repeat` runs. The clock ticks in steps of about 16 ms
 * on Windows, so a short case is repeated until one sample is long. Whatever the runtime
 * does while the process is back in its event loop is counted. */
async function timed(side, frozen, repeat, sequence, gap) {
  const before = process.cpuUsage();
  let stats;
  for (let i = 0; i < repeat; i++)
    stats = sequence ? await host(side, sequence, gap) : drive(side, frozen);
  const used = process.cpuUsage(before);
  return { ...stats, cpuMs: (used.user + used.system) / 1000 / repeat };
}

/** Self time by function from a sampling profile of three runs. */
async function hottest(side, frozen, focusNames) {
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
  // Who reaches a function: the hottest, or each one --focus names. A sample counts for a
  // function when that function is anywhere on its stack, so the share includes the time
  // spent in whatever it calls. Each such sample is filed under the three nearest distinct
  // callers above the function's innermost frame.
  const names = new Set(self.keys());
  for (const frame of frames.keys()) names.add(label(frame));
  const percent = (micros) => round((100 * micros) / total);
  const reached = (focusNames ? focusNames.split(',') : [null]).map((wanted) => {
    const focus = wanted ? [...names].find((key) => key.startsWith(`${wanted} :`)) : ranked[0]?.[0],
      chains = new Map();
    let inclusive = 0;
    profile.samples.forEach((id, i) => {
      let at = id;
      while (at !== undefined && label(at) !== focus) at = parents.get(at);
      if (at === undefined) return;
      inclusive += profile.timeDeltas[i];
      const chain = [];
      for (at = parents.get(at); at !== undefined && chain.length < 3; at = parents.get(at))
        if (label(at) !== focus && label(at) !== chain.at(-1)) chain.push(label(at));
      const key = chain.join(' < ');
      chains.set(key, (chains.get(key) ?? 0) + profile.timeDeltas[i]);
    });
    return {
      function: focus ?? wanted,
      percentWithCallees: percent(inclusive),
      from: [...chains]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([chain, micros]) => ({ chain, percent: percent(micros) })),
    };
  });
  return {
    garbageCollectorPercent: percent(self.get('(garbage collector)') ?? 0),
    functions: ranked
      .slice(0, 12)
      .map(([key, micros]) => ({ function: key, percent: percent(micros) })),
    reached,
  };
}

/** One engine, alone in this process: warm each case, then time it. */
async function measure({ output, bundle, select, rounds, focus, detail, host: mode }) {
  const catalogue = await import(pathToFileURL(resolve(output, 'catalogue.mjs')).href),
    engine = await import(pathToFileURL(bundle).href),
    side = { engine, profiles: await engine.createMultiphysicsProfiles3D() };
  for (const frozen of selectCases(catalogue, select)) {
    const sequence = mode === 'loop' ? null : onlySequence(side, frozen),
      gap = mode === 'paced' ? 8 : 0;
    if (mode !== 'loop' && !sequence) {
      say({ case: frozen.id, skipped: 'The case does not run as one tick sequence.' });
      continue;
    }
    // Warm until the optimizing compiler has had the hot functions: at least three runs and
    // 24 ticks, and then six seconds of CPU time or thirty runs, whichever comes first.
    let run,
      runs = 0,
      steps = 0,
      warmMs = 0;
    do {
      run = await timed(side, frozen, 1, sequence, gap);
      runs++;
      steps += Math.max(1, run.steps);
      warmMs += run.cpuMs;
      say({ case: frozen.id, warmRun: runs });
    } while (runs < 3 || steps < 24 || (warmMs < 6000 && runs < 30));
    const repeat = Math.max(1, Math.min(40, Math.ceil(1500 / Math.max(1, run.cpuMs))));
    const samples = [];
    for (let i = 0; i < rounds; i++) {
      run = await timed(side, frozen, repeat, sequence, gap);
      samples.push(run.cpuMs);
      say({ case: frozen.id, round: i + 1 });
    }
    const row = {
      case: frozen.id,
      runsPerSample: repeat,
      warmRuns: runs,
      steps: run.steps,
      rejected: run.rejected,
      work: run.work,
      samples,
    };
    if (detail) {
      // The same deterministic segments run every time, and a disturbance only ever adds
      // time, so each segment's least time over the runs is its cost.
      let least = null;
      for (let i = 0; i < Math.max(3, rounds); i++) {
        const segments = [];
        drive(side, frozen, segments);
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
      row.stageMsPerStep = round(Number(wall) / 1e6 / run.steps, 4);
      row.stages = Object.entries(stages)
        .map(([stage, { work, ns }]) => ({
          stage,
          percent: round(Number((ns * 10000n) / wall) / 100),
          work,
        }))
        .filter((stage) => stage.percent >= 0.5)
        .sort((a, b) => b.percent - a.percent);
      Object.assign(row, await hottest(side, frozen, focus));
    }
    say({ measured: row });
  }
}

/** Start one measuring child and collect the rows it reports. Its other lines pass through,
 * so the supervisor sees progress. */
function child(config, configPath) {
  return new Promise((done, fail) => {
    const rows = [];
    let pending = '';
    writeFile(configPath, JSON.stringify(config)).then(() => {
      const running = spawn(
        process.execPath,
        ['--single-threaded', fileURLToPath(import.meta.url), '--child', configPath],
        { stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true },
      );
      running.stdout.setEncoding('utf8');
      running.stdout.on('data', (text) => {
        const lines = (pending + text).split('\n');
        pending = lines.pop();
        for (const line of lines) {
          let parsed = null;
          try {
            parsed = JSON.parse(line);
          } catch {
            // Not a row: pass it through below.
          }
          if (parsed?.measured) rows.push(parsed.measured);
          else console.log(line);
        }
      });
      running.once('error', fail);
      running.once('exit', (code) =>
        code === 0 ? done(rows) : fail(Error(`Measuring process exited with ${code}.`)),
      );
    }, fail);
  });
}

async function orchestrate() {
  const options = readOptions(
    process.argv.slice(2),
    {
      commit: undefined,
      select: 'control',
      rounds: '5',
      passes: '2',
      host: 'loop',
      timeout: '900',
      focus: undefined,
    },
    USAGE,
  );
  if (
    !/^([1-9]|1[0-9]|2[0-5])$/.test(options.rounds) ||
    !/^[1-4]$/.test(options.passes) ||
    !['loop', 'sliced', 'paced'].includes(options.host)
  )
    throw Error(USAGE);
  const rounds = Number(options.rounds),
    passes = Number(options.passes);
  await guardNode('cpu', Number(options.timeout));

  const output = resolve('dist/liquid-contact', `profile-${randomUUID()}`);
  await mkdir(output, { recursive: true });
  const catalogue = await loadCatalogue(output);
  selectCases(catalogue, options.select);
  const candidate = await bundleEngine(process.cwd(), output, 'candidate', catalogue);
  const frozen = options.commit
    ? await extractCommit(options.commit, output).then(async ({ sha, root }) => ({
        sha,
        ...(await bundleEngine(root, output, 'frozen', catalogue)),
      }))
    : null;
  const config = (bundle, detail) => ({
    output,
    bundle: bundle.path,
    select: options.select,
    rounds,
    focus: options.focus,
    detail,
    host: options.host,
  });
  const sides = { candidate: new Map(), frozen: new Map() };
  const keep = (name, measured) => {
    for (const row of measured) {
      const kept = sides[name].get(row.case);
      if (kept) kept.samples.push(...row.samples);
      else sides[name].set(row.case, row);
    }
  };
  if (!frozen) keep('candidate', await child(config(candidate, true), resolve(output, 'run.json')));
  else
    for (let pass = 0; pass < passes; pass++)
      // Alternate which engine goes first, so drift across the job cannot favour either.
      for (const name of pass % 2 ? ['frozen', 'candidate'] : ['candidate', 'frozen']) {
        say({ stage: 'measuring', engine: name, pass: pass + 1 });
        keep(
          name,
          await child(
            config(name === 'frozen' ? frozen : candidate, false),
            resolve(output, 'run.json'),
          ),
        );
      }
  const rows = [];
  for (const [id, row] of sides.candidate) {
    const { samples, ...measured } = row,
      cpuMs = median(samples);
    const summary = {
      ...measured,
      cpuMs: round(cpuMs, 4),
      cpuMsMinMax: [round(Math.min(...samples), 4), round(Math.max(...samples), 4)],
      cpuMsPerStep: row.steps ? round(cpuMs / row.steps, 4) : null,
      nsPerWorkUnit: row.work ? round((1e6 * cpuMs) / row.work) : null,
    };
    if (frozen) {
      const before = sides.frozen.get(id);
      Object.assign(summary, {
        frozenCpuMs: round(median(before.samples), 4),
        frozenCpuMsMinMax: [
          round(Math.min(...before.samples), 4),
          round(Math.max(...before.samples), 4),
        ],
        // Medians of all samples of each engine, and each engine's least sample: the work is
        // deterministic and a disturbance only ever adds time.
        ratio: round(cpuMs / median(before.samples), 4),
        leastRatio: round(Math.min(...samples) / Math.min(...before.samples), 4),
        sameStepsAndWork: before.steps === row.steps && before.work === row.work,
      });
    }
    rows.push(summary);
    say(summary);
  }
  await writeFile(
    resolve(output, 'report.json'),
    JSON.stringify(
      {
        select: options.select,
        rounds,
        passes: frozen ? passes : 1,
        host: options.host,
        runtime: {
          node: process.version,
          v8: process.versions.v8,
          cpu: cpus()[0]?.model,
          flags: '--single-threaded',
        },
        esbuild: esbuildVersion,
        supervisorJob: process.env.STATE_SPACE_VERIFICATION_JOB,
        candidateSourceSha256: candidate.sourceSha256,
        frozen: frozen && { commit: frozen.sha, sourceSha256: frozen.sourceSha256 },
        rows,
      },
      null,
      2,
    ) + '\n',
  );
  say({ stage: 'profiled', cases: rows.length, output });
}

if (process.argv[2] === '--child')
  await measure(JSON.parse(await readFile(process.argv[3], 'utf8')));
else await orchestrate();
