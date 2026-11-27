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
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { version as esbuildVersion } from 'esbuild';
import {
  BUNDLE,
  frozenDifference,
  bundleEngine,
  extractCommit,
  loadCatalogue,
  readOptions,
  readDensityCubeFreeze,
  requireLiquidContactReference,
  selectCases,
} from './liquid_contact_engine.mjs';
import { guardNode } from './verification_guard.mjs';

const CURRENT_FREEZE = 'engine/experimental/multiphysics/liquid-contact-freeze.json';
const LEGACY_FREEZE = 'engine/test-support/fixtures/liquid-contact-world-1.json';
const USAGE =
  'Usage: node scripts/freeze_liquid_contact.mjs record [--commit <sha>] | check | check-legacy | compare --commit <sha>\n' +
  '  [--select light|heavy|all|<id-substring>] [--timeout <seconds, at most 1800>]';

const [mode, ...rest] = process.argv.slice(2);
const options = readOptions(rest, { commit: undefined, select: 'all', timeout: '600' }, USAGE);
if (
  !['record', 'check', 'check-legacy', 'compare'].includes(mode) ||
  ((mode === 'check' || mode === 'check-legacy') && options.commit !== undefined) ||
  (mode === 'compare' && options.commit === undefined)
)
  throw Error(USAGE);
await guardNode('cpu', Number(options.timeout));

const { reference } = await readDensityCubeFreeze();
if (mode === 'record') await requireLiquidContactReference(reference);

const output = resolve('dist/liquid-contact', `${mode}-${randomUUID()}`);
await mkdir(output, { recursive: true });
const say = (row) => console.log(JSON.stringify(row));
const catalogue = await loadCatalogue(output);
const selected = selectCases(catalogue, options.select);

// The archived cases create their initial state through these four factories. Reconstruct
// their original v1 inputs, then exercise the production readers, tick jobs and previews.
function legacyFixtureEngine(engine) {
  const fixture = { ...engine };
  for (const factory of [
    'createMultiphysicsSnapshot3D',
    'createMultiphysicsDemonstration3D',
    'createMultiphysicsTimedCup3D',
    'createMultiphysicsResolvedTank3D',
  ]) {
    fixture[factory] = (...args) => ({
      ...engine[factory](...args),
      rules: 'multiphysics-world-1',
    });
  }
  return fixture;
}

async function recorder(bundle) {
  const module = await import(pathToFileURL(bundle.path).href),
    engine = mode === 'check-legacy' ? legacyFixtureEngine(module) : module,
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
  reference,
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
  const source = options.commit ? await extractCommit(options.commit, output) : null,
    bundle = await bundleEngine(source?.root ?? process.cwd(), output, 'frozen', catalogue),
    record = await recorder(bundle);
  const previous = existsSync(CURRENT_FREEZE)
    ? JSON.parse(await readFile(CURRENT_FREEZE, 'utf8'))
    : null;
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
  await writeFile(CURRENT_FREEZE, text + '\n');
  await writeFile(
    resolve(output, 'provenance.json'),
    JSON.stringify({ ...provenance, engine: { ...bundle, commit: source?.sha ?? null } }, null, 2) +
      '\n',
  );
  say({ stage: 'recorded', file: CURRENT_FREEZE, cases: Object.keys(ordered).length, output });
} else {
  const candidate = await bundleEngine(process.cwd(), output, 'candidate', catalogue),
    recordCandidate = await recorder(candidate);
  let expected,
    frozenBundle = null,
    frozenRejections;
  if (mode === 'check' || mode === 'check-legacy') {
    const freeze = JSON.parse(
      await readFile(mode === 'check-legacy' ? LEGACY_FREEZE : CURRENT_FREEZE, 'utf8'),
    );
    if (freeze.runtime.v8 !== reference.v8 || freeze.runtime.node !== reference.node)
      throw Error('Unexpected recording runtime in the frozen catalogue.');
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
    const { sha, root } = await extractCommit(options.commit, output);
    frozenBundle = { ...(await bundleEngine(root, output, 'frozen', catalogue)), commit: sha };
    frozenRejections = frozenBundle.rejections;
    const recordFrozen = await recorder(frozenBundle);
    expected = (frozen) => recordFrozen(frozen, 'frozen');
    say({
      stage: 'engine',
      frozenCommit: sha,
      sameSources: frozenBundle.sourceSha256 === candidate.sourceSha256,
    });
  }
  // The combined implementation has one source vocabulary. The current freeze checks it;
  // legacy failures are compared by their actual message, work and stage in every case.
  const vocabulary =
    mode === 'check-legacy' ? [] : vocabularyChanges(frozenRejections, candidate.rejections);
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
      changed = frozenDifference(before.record, after.record, catalogue.encodeFrozen3D);
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
