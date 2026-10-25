/** An explicit, supervised, CPU-only experiment. Never clears an incident hold. */
import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { cpus } from 'node:os';
import { guardNode } from './verification_guard.mjs';

const mode = process.argv[2];
if (process.argv.length !== 3 || !['pilot', 'profile'].includes(mode))
  throw Error('Usage: node scripts/profile_coupled_solver.mjs pilot|profile');
await guardNode('cpu', mode === 'pilot' ? 30 : 90);

const output = resolve('dist/verification/coupled-solver-study', randomUUID());
await mkdir(output, { recursive: true });
const files = [
  'engine/experimental/multiphysics/fluids.ts',
  'engine/experimental/multiphysics/math.ts',
  'engine/experimental/multiphysics/conservation.ts',
  'engine/portable-data.ts',
  'engine/experimental/multiphysics/projection-study.ts',
  'engine/experimental/multiphysics/fluid-solver-study.runtime-cases.ts',
  'engine/test-support/multiphysics-fluid-fixtures.ts',
  'engine/vitest.coupled-solver-study.config.ts',
  'scripts/profile_coupled_solver.mjs',
  'scripts/verification_guard.mjs',
  'scripts/verification_guard.py',
  'scripts/verification_health.py',
  'scripts/verification_watchdog.py',
  'scripts/verification_journal.py',
  'package-lock.json',
];
const sourceHashes = {};
for (const file of files)
  sourceHashes[file] = createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
await writeFile(
  resolve(output, 'provenance.json'),
  JSON.stringify(
    {
      mode,
      sourceHashes,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpuModel: cpus()[0]?.model,
      supervisorJob: process.env.STATE_SPACE_VERIFICATION_JOB,
      scope:
        'Frozen fluid/rigid CPU step and captured active-face replay; no world or GPU qualification.',
    },
    null,
    2,
  ) + '\n',
);
console.log(JSON.stringify({ stage: 'study-start', mode, output }));
const child = spawn(
  process.execPath,
  [
    'node_modules/vitest/vitest.mjs',
    'run',
    '--reporter=dot',
    '--config',
    'engine/vitest.coupled-solver-study.config.ts',
  ],
  {
    stdio: 'inherit',
    windowsHide: true,
    env: {
      ...process.env,
      STATE_SPACE_SOLVER_STUDY_MODE: mode,
      STATE_SPACE_SOLVER_STUDY_OUTPUT: output,
    },
  },
);
const code = await new Promise((done, reject) => {
  child.once('error', reject);
  child.once('exit', (status) => done(status ?? 1));
});
const changedSources = [];
for (const file of files)
  if (
    createHash('sha256')
      .update(await readFile(file))
      .digest('hex') !== sourceHashes[file]
  )
    changedSources.push(file);
const finalCode = changedSources.length ? 1 : code;
await writeFile(
  resolve(output, 'completion.json'),
  JSON.stringify({ code: finalCode, changedSources }, null, 2) + '\n',
);
console.log(JSON.stringify({ stage: 'study-finished', mode, output, code: finalCode }));
process.exitCode = finalCode;
