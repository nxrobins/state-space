/** Bounded CPU regression and paired timing against an immutable pre-change bundle. */
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build, version as esbuildVersion } from 'esbuild';
import { guardNode } from './verification_guard.mjs';

await guardNode('cpu', 90);
const base = resolve('dist/verification/coupled-solver-study');
const pointer = JSON.parse(
  await readFile(resolve(base, 'coordinate-optimization-baseline.json'), 'utf8'),
);
const hash = (data) => createHash('sha256').update(data).digest('hex');
const manifestData = await readFile(resolve(pointer.path, 'manifest.json'));
if (hash(manifestData) !== pointer.manifestSha256) throw Error('Frozen baseline manifest changed.');
const baseline = JSON.parse(manifestData);
if (esbuildVersion !== baseline.esbuild) throw Error('Baseline compiler version changed.');
const baselinePath = resolve(pointer.path, 'baseline.mjs');
if (hash(await readFile(baselinePath)) !== baseline.bundleSha256)
  throw Error('Frozen baseline bundle changed.');
const output = resolve(base, 'coordinate-comparison-' + randomUUID());
await mkdir(output, { recursive: true });
const files = [
  ...Object.keys(baseline.sources),
  'engine/test-support/multiphysics-fluid-fixtures.ts',
  'engine/experimental/multiphysics/fluids.test.ts',
  'engine/experimental/multiphysics/fluids-coordinate.test.ts',
  'engine/experimental/multiphysics/fluid-optimization.runtime-cases.ts',
  'engine/vitest.fluid-optimization.config.ts',
  'engine/vitest.shared.ts',
  'scripts/compare_fluid_optimizations.mjs',
  'scripts/verification_guard.mjs',
  'scripts/verification_guard.py',
  'scripts/verification_health.py',
  'scripts/verification_watchdog.py',
  'scripts/verification_journal.py',
  'package-lock.json',
];
const sourceSha256 = {};
for (const file of files) sourceSha256[file] = hash(await readFile(file));
const bundles = { baseline: baselinePath };
for (const [name, tuning] of [
  ['coordinate', { coordinateProjection: true, zeroViscosity: false }],
  ['zero-viscosity', { coordinateProjection: false, zeroViscosity: true }],
  ['combined', null],
]) {
  bundles[name] = resolve(output, name + '.mjs');
  const entry =
    tuning === null
      ? { entryPoints: ['engine/experimental/multiphysics/fluids.ts'] }
      : {
          stdin: {
            contents: `import { createFluidReferenceJob3D as create } from './engine/experimental/multiphysics/fluids.ts'; export const createFluidReferenceJob3D = (input, capture) => create(input, capture, ${JSON.stringify(tuning)});`,
            resolveDir: process.cwd(),
            sourcefile: name + '-entry.ts',
            loader: 'ts',
          },
        };
  await build({ ...baseline.bundleOptions, ...entry, outfile: bundles[name] });
}
const bundleSha256 = {};
for (const [name, file] of Object.entries(bundles)) bundleSha256[name] = hash(await readFile(file));
await writeFile(
  resolve(output, 'provenance.json'),
  JSON.stringify(
    {
      baseline: pointer,
      baselineManifest: baseline,
      sourceSha256,
      bundleSha256,
      node: process.version,
      esbuild: esbuildVersion,
      supervisorJob: process.env.STATE_SPACE_VERIFICATION_JOB,
      order:
        'Five rotating warmup rounds and fifteen rotating paired rounds per case; assertions outside timed windows.',
    },
    null,
    2,
  ) + '\n',
);
console.log(JSON.stringify({ stage: 'comparison-start', output }));
async function vitest(filters) {
  const child = spawn(
    process.execPath,
    [
      'node_modules/vitest/vitest.mjs',
      'run',
      '--reporter=dot',
      '--config',
      'engine/vitest.fluid-optimization.config.ts',
      ...filters,
    ],
    {
      stdio: 'inherit',
      windowsHide: true,
      env: {
        ...process.env,
        STATE_SPACE_FLUID_COMPARISON_OUTPUT: output,
        STATE_SPACE_FLUID_COMPARISON_BUNDLES: JSON.stringify(bundles),
      },
    },
  );
  return await new Promise((done, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => done(code ?? 1));
  });
}
let code = await vitest([
  'engine/experimental/multiphysics/fluids.test.ts',
  'engine/experimental/multiphysics/fluids-coordinate.test.ts',
]);
if (code === 0)
  code = await vitest(['engine/experimental/multiphysics/fluid-optimization.runtime-cases.ts']);
const changedSources = [];
for (const file of files)
  if (hash(await readFile(file)) !== sourceSha256[file]) changedSources.push(file);
for (const [name, file] of Object.entries(bundles))
  if (hash(await readFile(file)) !== bundleSha256[name]) changedSources.push(file);
if (changedSources.length) code = 1;
await writeFile(
  resolve(output, 'completion.json'),
  JSON.stringify({ code, changedSources }, null, 2) + '\n',
);
console.log(JSON.stringify({ stage: 'comparison-finished', output, code }));
process.exitCode = code;
