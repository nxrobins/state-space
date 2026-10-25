/** Restore the measured pre-optimization source from Git and compile it without
 * running physics. Never changes a safety hold or overwrites retained evidence. */
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { build, version } from 'esbuild';

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--output'))
  throw Error('Usage: node scripts/prepare_fluid_baseline.mjs [--output <new-directory>]');
const checkpoint = JSON.parse(await readFile('docs/checkpoints/COUPLED_SOLVER_CPU.json', 'utf8'));
const reference = checkpoint.baseline.manifest;
if (version !== reference.esbuild)
  throw Error('Restore package-lock.json dependencies before preparing the baseline.');
const base = resolve('dist/verification/coupled-solver-study');
await mkdir(base, { recursive: true });
const pointerPath = resolve(base, 'coordinate-optimization-baseline.json');
const hash = (data) => createHash('sha256').update(data).digest('hex');
let existing;
if (!args.length) {
  try {
    existing = JSON.parse(await readFile(pointerPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
if (existing) {
  const data = await readFile(resolve(existing.path, 'manifest.json'));
  if (hash(data) !== existing.manifestSha256) throw Error('Existing baseline manifest changed.');
  const manifest = JSON.parse(data);
  for (const [file, sha256] of Object.entries(reference.sources))
    if (manifest.sources[file] !== sha256) throw Error('Existing baseline source differs: ' + file);
  if (
    manifest.esbuild !== version ||
    JSON.stringify(manifest.bundleOptions) !== JSON.stringify(reference.bundleOptions)
  )
    throw Error('Existing baseline build settings differ.');
  if (hash(await readFile(resolve(existing.path, 'baseline.mjs'))) !== reference.bundleSha256)
    throw Error('Existing baseline bundle differs.');
  console.log(
    JSON.stringify({
      stage: 'baseline-verified',
      path: existing.path,
      sha256: reference.bundleSha256,
    }),
  );
} else {
  const output = resolve(args[1] ?? resolve(base, 'coordinate-baseline-' + randomUUID()));
  if (!output.startsWith(base + sep))
    throw Error('Output must be a new directory under dist/verification/coupled-solver-study.');
  // A collision or existing directory fails rather than replacing a prior capture.
  await mkdir(output);
  const sourceRoot = resolve(output, 'source');
  const run = promisify(execFile);
  for (const [file, sha256] of Object.entries(reference.sources)) {
    let stdout;
    try {
      ({ stdout } = await run('git', ['show', checkpoint.baseline.commit + ':' + file], {
        encoding: 'buffer',
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
      }));
    } catch (cause) {
      throw Error(
        `Cannot read baseline ${checkpoint.baseline.commit}; fetch that Git revision before preparing.`,
        { cause },
      );
    }
    if (hash(stdout) !== sha256) throw Error('Pinned baseline source hash differs: ' + file);
    const target = resolve(sourceRoot, file);
    if (!target.startsWith(sourceRoot + sep)) throw Error('Invalid baseline source path.');
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, stdout);
  }
  await build({
    ...reference.bundleOptions,
    absWorkingDir: sourceRoot,
    entryPoints: ['engine/experimental/multiphysics/fluids.ts'],
    outfile: resolve(output, 'baseline.mjs'),
  });
  if (hash(await readFile(resolve(output, 'baseline.mjs'))) !== reference.bundleSha256)
    throw Error(
      'Reconstructed bundle differs from the measured baseline. Retained output was not published as the active baseline.',
    );
  const manifest = { ...reference, sourceBase: checkpoint.baseline.commit, node: process.version };
  const data = JSON.stringify(manifest, null, 2) + '\n';
  await writeFile(resolve(output, 'manifest.json'), data);
  const pointer = { path: output, manifestSha256: hash(data) };
  await writeFile(
    args.length ? resolve(output, 'pointer.json') : pointerPath,
    JSON.stringify(pointer, null, 2) + '\n',
    { flag: 'wx' },
  );
  console.log(
    JSON.stringify({ stage: 'baseline-prepared', path: output, sha256: reference.bundleSha256 }),
  );
}
