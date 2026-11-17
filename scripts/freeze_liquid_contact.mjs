/** Supervised recorder for the frozen liquid/contact catalogue.
 *
 *   record [--commit <sha>]  Record the catalogue and write the tracked freeze file. With a
 *                            commit, the engine is bundled from that commit's own blobs, so no
 *                            working-tree edit can leak into the frozen behaviour. Without one,
 *                            the working tree is recorded; the file then names it by the hash
 *                            of its engine sources, which lets a deliberate model change and
 *                            its re-recorded freeze share one commit.
 *   check                    Record the working tree and compare it with the freeze file.
 *   compare --commit <sha>   Record that commit and the working tree in one process and report
 *                            the first difference in every case, with each side's CPU time.
 *
 * Every mode runs inside one supervised CPU job. Output goes under the ignored
 * dist/liquid-contact/; only `record` writes a tracked file. Never changes a safety hold. */
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build, version as esbuildVersion } from 'esbuild';
import { guardNode } from './verification_guard.mjs';

const FREEZE_FILE = 'engine/experimental/multiphysics/liquid-contact-freeze.json';
const CATALOGUE = 'engine/test-support/multiphysics-frozen-cases.ts';
const SOURCES = 'engine/experimental/multiphysics';
const ENTRY = 'engine/experimental/multiphysics.ts';
const BUNDLE = { bundle: true, platform: 'node', format: 'esm', target: 'es2022' };
const USAGE =
  'Usage: node scripts/freeze_liquid_contact.mjs record [--commit <sha>] | check | compare --commit <sha>\n' +
  '  [--select light|heavy|all|<id-substring>] [--timeout <seconds, at most 1800>]';

const [mode, ...rest] = process.argv.slice(2);
const options = { select: 'all', timeout: '600' };
for (let i = 0; i < rest.length; i += 2) {
  const name = rest[i]?.replace(/^--/, '');
  if (!['commit', 'select', 'timeout'].includes(name) || rest[i + 1] === undefined)
    throw Error(USAGE);
  options[name] = rest[i + 1];
}
if (
  !['record', 'check', 'compare'].includes(mode) ||
  (mode === 'check' && options.commit !== undefined) ||
  (mode === 'compare' && options.commit === undefined) ||
  !/^[1-9][0-9]{1,3}$/.test(options.timeout) ||
  Number(options.timeout) > 1800
)
  throw Error(USAGE);
await guardNode('cpu', Number(options.timeout));

const hash = (data) => createHash('sha256').update(data).digest('hex');
const output = resolve('dist/liquid-contact', `${mode}-${randomUUID()}`);
await mkdir(output, { recursive: true });
const say = (row) => console.log(JSON.stringify(row));

async function loadCatalogue() {
  const outfile = resolve(output, 'catalogue.mjs');
  await build({ ...BUNDLE, entryPoints: [CATALOGUE], outfile, logLevel: 'warning' });
  return {
    sha256: hash(await readFile(CATALOGUE)),
    ...(await import(pathToFileURL(outfile).href)),
  };
}
const catalogue = await loadCatalogue();

/** Bundle one engine. `root` is the checkout or an extracted commit. Only sources reachable
 * from the public multiphysics entry are read; their hashes identify the recorded engine. */
async function bundleEngine(root, name) {
  const outfile = resolve(output, `${name}.mjs`);
  const result = await build({
    ...BUNDLE,
    absWorkingDir: root,
    entryPoints: [ENTRY],
    outfile,
    metafile: true,
    logLevel: 'warning',
  });
  const sources = {};
  for (const file of Object.keys(result.metafile.inputs).sort())
    sources[file] = hash(await readFile(resolve(root, file)));
  const rejections = {};
  for (const file of catalogue.FROZEN_REJECTION_SOURCES_3D)
    rejections[file] = catalogue.rejectionVocabulary3D(
      await readFile(resolve(root, SOURCES, file), 'utf8'),
    );
  return {
    path: outfile,
    sourceSha256: hash(
      Object.entries(sources)
        .map(([file, sha256]) => `${file}\0${sha256}\n`)
        .join(''),
    ),
    sources,
    rejections,
  };
}
/** Write the commit's own engine/ blobs, straight from the object store. The working tree
 * cannot redirect them, and no archive tool or checkout filter touches the bytes. */
async function extractCommit(commit) {
  const git = (args, extra = {}) =>
    execFileSync('git', args, { maxBuffer: 512 * 1024 * 1024, windowsHide: true, ...extra });
  const sha = git(['rev-parse', '--verify', `${commit}^{commit}`])
    .toString()
    .trim();
  const root = resolve(output, `source-${sha.slice(0, 12)}`);
  const names = git(['ls-tree', '-r', '-z', '--name-only', sha, 'engine'])
    .toString()
    .split('\0')
    .filter(Boolean);
  if (!names.length || names.some((name) => /[\n\\]|(^|\/)\.\.(\/|$)/.test(name)))
    throw Error('Unexpected engine tree in the frozen commit.');
  const blobs = git(['cat-file', '--batch'], {
    input: names.map((name) => `${sha}:${name}\n`).join(''),
  });
  const made = new Set();
  let offset = 0;
  for (const name of names) {
    const end = blobs.indexOf(10, offset),
      [, kind, size] = blobs.toString('utf8', offset, end).split(' ');
    if (end < 0 || kind !== 'blob' || !/^[0-9]+$/.test(size))
      throw Error(`Cannot read ${name} from the frozen commit.`);
    const target = resolve(root, name),
      folder = dirname(target);
    if (!made.has(folder)) {
      await mkdir(folder, { recursive: true });
      made.add(folder);
    }
    await writeFile(target, blobs.subarray(end + 1, end + 1 + Number(size)));
    offset = end + 2 + Number(size);
  }
  return { sha, root };
}

const selected = catalogue.FROZEN_CASES_3D.filter((frozen) =>
  options.select === 'all'
    ? true
    : options.select === 'light'
      ? !frozen.heavy
      : options.select === 'heavy'
        ? frozen.heavy
        : frozen.id.includes(options.select),
);
if (!selected.length) throw Error('No frozen case matches --select.');

async function recorder(bundle) {
  const engine = await import(pathToFileURL(bundle.path).href),
    profiles = await engine.createMultiphysicsProfiles3D();
  return (frozen, side) => {
    let reported = performance.now();
    const cpu = process.cpuUsage(),
      record = catalogue.recordFrozenCase3D(engine, profiles, frozen, (steps) => {
        // The supervisor stops a job that prints nothing for 40 seconds.
        if (performance.now() - reported > 5000) {
          reported = performance.now();
          say({ case: frozen.id, side, steps });
        }
      }),
      used = process.cpuUsage(cpu);
    return { record, cpuMs: (used.user + used.system) / 1000 };
  };
}
const runtime = {
  node: process.version,
  v8: process.versions.v8,
  platform: process.platform,
  arch: process.arch,
};
const provenance = {
  mode,
  select: options.select,
  runtime,
  esbuild: esbuildVersion,
  bundleOptions: BUNDLE,
  catalogueSha256: catalogue.sha256,
  supervisorJob: process.env.STATE_SPACE_VERIFICATION_JOB,
};
const summary = (record) => ({
  outcome: record.outcome,
  steps: record.steps.length,
  ...(record.rejection
    ? {
        rejection: record.rejection.message,
        stage: record.rejection.stage,
        atomic: record.rejection.atomic,
      }
    : {}),
});
const same = (a, b) => catalogue.encodeFrozen3D(a) === catalogue.encodeFrozen3D(b);
/** First place two records of one case part ways, in reading order. */
function difference(expected, actual) {
  if (same(expected, actual)) return null;
  for (let i = 0; i < Math.max(expected.steps.length, actual.steps.length); i++)
    if (expected.steps[i] !== actual.steps[i])
      return expected.steps[i] === undefined || actual.steps[i] === undefined
        ? `${expected.steps.length} steps expected, ${actual.steps.length} recorded`
        : `step ${i + 1} (digest work): ${expected.steps[i]} -> ${actual.steps[i]}`;
  if (!same(expected.rejection, actual.rejection))
    return `rejection ${JSON.stringify(expected.rejection)} -> ${JSON.stringify(actual.rejection)}`;
  for (const key of new Set([...Object.keys(expected.facts), ...Object.keys(actual.facts)]))
    if (!Object.is(expected.facts[key], actual.facts[key]))
      return `fact ${key}: ${expected.facts[key]} -> ${actual.facts[key]}`;
  return 'records differ outside steps, rejection and facts';
}
/** Rejection messages added to or removed from each frozen source. */
function vocabularyChanges(expected, actual) {
  const changes = [];
  for (const file of catalogue.FROZEN_REJECTION_SOURCES_3D) {
    const before = [...(expected[file] ?? [])],
      added = [];
    for (const message of actual[file] ?? []) {
      const at = before.indexOf(message);
      if (at < 0) added.push(message);
      else before.splice(at, 1);
    }
    if (added.length || before.length) changes.push({ file, added, removed: before });
  }
  return changes;
}

let failures = 0;
if (mode === 'record') {
  const source = options.commit ? await extractCommit(options.commit) : null,
    bundle = await bundleEngine(source?.root ?? process.cwd(), 'frozen'),
    record = await recorder(bundle);
  const previous = existsSync(FREEZE_FILE) ? JSON.parse(await readFile(FREEZE_FILE, 'utf8')) : null;
  // A partial selection updates only its own cases, so the engine must be the recorded one.
  if (options.select !== 'all' && previous?.engine?.sourceSha256 !== bundle.sourceSha256)
    throw Error('A partial record needs the engine sources the freeze file already names.');
  const cases = {};
  for (const frozen of selected) {
    const result = record(frozen, 'frozen');
    cases[frozen.id] = { why: frozen.why, heavy: frozen.heavy, ...result.record };
    say({ case: frozen.id, ...summary(result.record), cpuMs: Math.round(result.cpuMs) });
  }
  const merged = options.select === 'all' ? cases : { ...previous.cases, ...cases },
    ordered = {};
  for (const frozen of catalogue.FROZEN_CASES_3D)
    if (merged[frozen.id]) ordered[frozen.id] = merged[frozen.id];
  const freeze = {
    schema: 'liquid-contact-freeze-1',
    note: 'Exact behaviour of the named engine sources, including their rejections. Written only by scripts/freeze_liquid_contact.mjs record. A rejection recorded here is evidence of that behaviour, not a passing result.',
    engine: { sourceSha256: bundle.sourceSha256, commit: source?.sha ?? null },
    runtime: { node: runtime.node, v8: runtime.v8 },
    rejections: bundle.rejections,
    cases: ordered,
  };
  // One line per case for its steps keeps the file reviewable.
  const text = JSON.stringify(freeze, null, 2).replace(
    /"steps": \[\n([^\]]*)\]/g,
    (_, body) => `"steps": [${body.replace(/\s*\n\s*/g, ' ').trim()}]`,
  );
  if (!same(JSON.parse(text), freeze)) throw Error('Freeze file formatting changed its data.');
  await writeFile(FREEZE_FILE, text + '\n');
  await writeFile(
    resolve(output, 'provenance.json'),
    JSON.stringify({ ...provenance, engine: { ...bundle, commit: source?.sha ?? null } }, null, 2) +
      '\n',
  );
  say({ stage: 'recorded', file: FREEZE_FILE, cases: Object.keys(ordered).length, output });
} else {
  const candidate = await bundleEngine(process.cwd(), 'candidate'),
    recordCandidate = await recorder(candidate);
  let expected,
    frozenBundle = null,
    frozenRejections;
  if (mode === 'check') {
    const freeze = JSON.parse(await readFile(FREEZE_FILE, 'utf8'));
    if (freeze.runtime.v8 !== runtime.v8)
      throw Error(
        `The freeze file was recorded on V8 ${freeze.runtime.v8}; exact comparison needs that runtime, not ${runtime.v8}.`,
      );
    frozenRejections = freeze.rejections;
    expected = (frozen) => {
      const { why: _why, heavy: _heavy, ...record } = freeze.cases[frozen.id] ?? {};
      return freeze.cases[frozen.id] ? { record, cpuMs: null } : null;
    };
    say({
      stage: 'engine',
      frozen: freeze.engine,
      candidateSourceSha256: candidate.sourceSha256,
      sameSources: freeze.engine.sourceSha256 === candidate.sourceSha256,
    });
  } else {
    const { sha, root } = await extractCommit(options.commit);
    frozenBundle = { ...(await bundleEngine(root, 'frozen')), commit: sha };
    frozenRejections = frozenBundle.rejections;
    const recordFrozen = await recorder(frozenBundle);
    expected = (frozen) => recordFrozen(frozen, 'frozen');
    say({
      stage: 'engine',
      frozenCommit: sha,
      sameSources: frozenBundle.sourceSha256 === candidate.sourceSha256,
    });
  }
  const vocabulary = vocabularyChanges(frozenRejections, candidate.rejections);
  for (const change of vocabulary) {
    failures++;
    say({ rejections: change });
  }
  const rows = [];
  for (const frozen of selected) {
    const before = expected(frozen);
    if (!before) {
      failures++;
      say({ case: frozen.id, error: 'not in the freeze file' });
      continue;
    }
    const after = recordCandidate(frozen, 'candidate'),
      changed = difference(before.record, after.record);
    if (changed) failures++;
    const row = {
      case: frozen.id,
      exact: changed === null,
      ...(changed ? { difference: changed, frozen: summary(before.record) } : {}),
      candidate: summary(after.record),
      ...(before.cpuMs === null ? {} : { frozenCpuMs: Math.round(before.cpuMs) }),
      candidateCpuMs: Math.round(after.cpuMs),
    };
    rows.push({ ...row, frozenRecord: before.record, candidateRecord: after.record });
    say(row);
  }
  await writeFile(
    resolve(output, 'report.json'),
    JSON.stringify(
      { ...provenance, frozen: frozenBundle, candidate, vocabulary, failures, rows },
      null,
      2,
    ) + '\n',
  );
  say({ stage: 'compared', cases: selected.length, different: failures, output });
}
process.exitCode = failures ? 1 : 0;
