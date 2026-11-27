/** Shared by the supervised liquid/contact launchers: bundle the multiphysics engine from the
 * checkout or from a commit's own blobs, and load the frozen-case catalogue. Compiles only;
 * the callers run physics, inside their supervised job. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

export const CATALOGUE = 'engine/test-support/multiphysics-frozen-cases.ts';
export const SOURCES = 'engine/experimental/multiphysics';
export const ENTRY = 'engine/experimental/multiphysics.ts';
export const BUNDLE = { bundle: true, platform: 'node', format: 'esm', target: 'es2022' };
export const hash = (data) => createHash('sha256').update(data).digest('hex');

export const readDensityCubeFreeze = async () =>
  JSON.parse(
    await readFile(
      new URL('../engine/test-support/fixtures/density-cube-linux-x64.json', import.meta.url),
      'utf8',
    ),
  );

export async function requireLiquidContactReference(reference) {
  if (
    process.platform !== reference.platform ||
    process.arch !== reference.arch ||
    process.version !== reference.node ||
    process.versions.v8 !== reference.v8 ||
    hash(await readFile(process.execPath)) !== reference.executableSHA256
  )
    throw Error('The liquid/contact oracle requires the pinned Linux x64 Node executable.');
}

export async function loadCatalogue(output) {
  const outfile = resolve(output, 'catalogue.mjs');
  await build({ ...BUNDLE, entryPoints: [CATALOGUE], outfile, logLevel: 'warning' });
  return {
    sha256: hash(await readFile(CATALOGUE)),
    ...(await import(pathToFileURL(outfile).href)),
  };
}

/** Bundle one engine. `root` is the checkout or an extracted commit. Only sources reachable
 * from the public multiphysics entry are read; their hashes identify the recorded engine. */
export async function bundleEngine(root, output, name, catalogue) {
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
export async function extractCommit(commit, output) {
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

/** `--name value` pairs after the mode. Unknown names and missing values are usage errors. */
export function readOptions(args, defaults, usage) {
  const options = { ...defaults };
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i]?.replace(/^--/, '');
    if (!Object.hasOwn(defaults, name) || args[i + 1] === undefined) throw Error(usage);
    options[name] = args[i + 1];
  }
  if (!/^[1-9][0-9]{1,3}$/.test(options.timeout) || Number(options.timeout) > 1800)
    throw Error(usage);
  return options;
}

/** `light`, `heavy`, `all`, or one or more substrings of the case id, separated by commas. */
export function selectCases(catalogue, select) {
  const selected = catalogue.FROZEN_CASES_3D.filter((frozen) =>
    select === 'all'
      ? true
      : select === 'light'
        ? !frozen.heavy
        : select === 'heavy'
          ? frozen.heavy
          : select.split(',').some((part) => frozen.id.includes(part)),
  );
  if (!selected.length) throw Error('No frozen case matches --select.');
  return selected;
}

/** First place two records of one case part ways, in reading order. */
export function frozenDifference(expected, actual, encode) {
  const same = (a, b) => encode(a) === encode(b);
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
