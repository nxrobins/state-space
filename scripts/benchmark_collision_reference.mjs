/** prepare is static; run enters the existing supervisor before importing physics. */
import { parseArgs } from 'node:util';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpus, platform, release, arch, totalmem } from 'node:os';
import {
  ROOT,
  preparePacket,
  readPacket,
  json,
  hash,
  holdRecord,
} from './collision-reference/packet.mjs';
import { PROTOCOL } from './collision-reference/protocol.mjs';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    output: { type: 'string' },
    packet: { type: 'string' },
    python: { type: 'string' },
  },
});
if (positionals.length !== 1 || !['prepare', 'run'].includes(positionals[0]))
  throw Error(
    'Usage: benchmark_collision_reference.mjs prepare --output NEW_DIRECTORY | run --packet DIRECTORY --python PYTHON',
  );
if (positionals[0] === 'prepare') {
  if (!values.output || values.packet || values.python)
    throw Error('prepare accepts only --output');
  const output = resolve(values.output);
  const packet = await preparePacket(output);
  console.log(
    JSON.stringify(
      {
        status: packet.state,
        output,
        sourceFiles: packet.files.length,
        hold: packet.holdAtPreparation,
        acceptance: packet.protocol.acceptance,
      },
      null,
      2,
    ),
  );
} else {
  if (!values.packet || !values.python || values.output)
    throw Error('run requires --packet and --python');
  // guardNode checks the hard hold even if a verification-job environment variable exists.
  const { guardNode } = await import('./verification_guard.mjs');
  await guardNode('cpu', PROTOCOL.supervisorSeconds);
  if (
    !process.env.STATE_SPACE_VERIFICATION_JOB ||
    process.env.STATE_SPACE_VERIFICATION_KIND !== 'cpu'
  )
    throw Error('Existing CPU supervisor context required');
  const directory = resolve(values.packet),
    { packet, sha256 } = readPacket(directory);
  const output = join(directory, 'run-' + randomUUID());
  mkdirSync(output);
  const host = {
    node: process.version,
    nodeExecutableSha256: hash(readFileSync(process.execPath)),
    platform: platform(),
    release: release(),
    arch: arch(),
    cpu: cpus()[0]?.model ?? 'unknown',
    logicalCpus: cpus().length,
    ramBytes: totalmem(),
    supervisorJob: process.env.STATE_SPACE_VERIFICATION_JOB,
    holdAtRun: holdRecord(),
    packetSha256: sha256,
    startedAt: new Date().toISOString(),
  };
  json(join(output, 'environment.json'), host);
  const { benchmarkWorldReplay, benchmarkRigid } =
    await import('./collision-reference/state-space.mjs');
  const { assembleReport, markdownReport } = await import('./collision-reference/report.mjs');
  let api, worldReplay;
  try {
    api = await import(pathToFileURL(join(directory, 'engine.mjs')).href);
    console.log('Checking LEG-WORKER exact world replay');
    worldReplay = await benchmarkWorldReplay(api);
  } catch (error) {
    worldReplay = { status: 'failed', error: String(error), partial: error.partial ?? null };
  }
  json(join(output, 'world-replay.json'), worldReplay);
  const stateRows = [];
  // A failed world replay blocks the dependent comparison cohort.
  if (worldReplay.status === 'completed')
    for (const scene of packet.fixtures)
      for (const dt of PROTOCOL.timesteps) {
        console.log(JSON.stringify({ backend: 'state-space-rigid', scene: scene.id, dt }));
        let row;
        try {
          row = benchmarkRigid(api, scene, dt);
        } catch (error) {
          row = {
            status: 'failed',
            backend: 'state-space-rigid',
            scene: scene.id,
            dt,
            error: String(error),
            partial: error.partial ?? null,
            timing: null,
          };
        }
        stateRows.push(row);
        json(join(output, `${scene.id}-${dt}-state-space.json`), row);
      }
  const mujocoPath = join(output, 'mujoco.json');
  let mujoco = { rows: [], status: 'not-run' };
  if (worldReplay.status === 'completed') {
    const child = spawnSync(
      resolve(values.python),
      [
        join(ROOT, 'scripts/collision-reference/mujoco_runner.py'),
        '--packet',
        join(directory, 'packet.json'),
        '--output',
        mujocoPath,
      ],
      {
        cwd: ROOT,
        windowsHide: true,
        stdio: 'inherit',
        timeout: 300000,
        env: {
          ...process.env,
          OMP_NUM_THREADS: '1',
          OPENBLAS_NUM_THREADS: '1',
          MKL_NUM_THREADS: '1',
        },
      },
    );
    try {
      mujoco = JSON.parse(readFileSync(mujocoPath, 'utf8'));
    } catch (error) {
      mujoco = { rows: [], error: String(error) };
    }
    mujoco.process = {
      exitCode: child.status,
      signal: child.signal,
      error: child.error ? String(child.error) : null,
    };
    if (mujoco.packetSha256 !== sha256)
      mujoco = { ...mujoco, rows: [], error: 'Missing or mismatched MuJoCo packet binding' };
  }
  const report = {
    ...assembleReport(packet, stateRows, mujoco.rows, worldReplay),
    environment: host,
    mujocoEnvironment: mujoco.environment ?? null,
    mujocoProcess: mujoco.process ?? null,
    mujocoError: mujoco.error ?? null,
  };
  if (mujoco.error || mujoco.process?.exitCode !== 0) report.status = 'incomplete';
  // Recheck bound inputs so mid-run source changes cannot produce accepted-looking evidence.
  try {
    readPacket(directory);
  } catch (error) {
    report.status = 'incomplete';
    report.sourceDrift = String(error);
  }
  if (JSON.stringify(holdRecord()) !== JSON.stringify(host.holdAtRun)) {
    report.status = 'incomplete';
    report.holdChanged = true;
  }
  json(join(output, 'report.json'), report);
  writeFileSync(join(output, 'report.md'), markdownReport(report), { flag: 'wx' });
  console.log(JSON.stringify({ output, status: report.status }));
  if (report.status !== 'diagnostic-complete') process.exitCode = 1;
}
