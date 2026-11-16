/** Fixed profiling entry; live Windows Job attestation precedes engine/profiler imports. */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { ROOT, readPacket, hash, json } from './packet.mjs';

if (process.argv.length !== 3) throw Error('Private CPU profile invocation required');
const attempt = resolve(process.argv[2]);
const review = JSON.parse(readFileSync(join(attempt, '../review.json'), 'utf8'));
const python = Object.keys(review.binaries).find((path) => /[\\/]python\.exe$/i.test(path));
if (!python) throw Error('Missing reviewed Python identity');
const attested = JSON.parse(
  execFileSync(
    python,
    ['-I', '-B', join(ROOT, 'scripts/collision_cpu_leaf.py'), '--claim-node', attempt],
    { encoding: 'utf8', windowsHide: true, timeout: 10000 },
  ),
);
const config = attested.profile;
if (
  config?.kind !== 'state-space-cpu-profile-v1' ||
  config.samplingIntervalMicros !== 1000 ||
  config.maxProfileBytes !== 16 * 1024 * 1024
)
  throw Error('Unreviewed profiling recipe');
const { packet, sha256 } = readPacket(attested.benchmark.directory);
if (sha256 !== attested.benchmark.packetSha256 || packet.bundleSha256 !== config.bundleSha256)
  throw Error('Attested profiling packet mismatch');
const baselineBytes = readFileSync(join(ROOT, config.baseline));
if (hash(baselineBytes) !== config.baselineSha256) throw Error('Completed baseline changed');
const baseline = JSON.parse(baselineBytes);
if (baseline.status !== 'diagnostic-complete') throw Error('Incomplete baseline');
const { benchmarkWorldReplay, benchmarkRigid } = await import('./state-space.mjs');
const { same } = await import('./replay.mjs');
const { instrumentRigidApi, assertBaseline, assertExactCapture, summarizeCpuProfile } =
  await import('./profile-data.mjs');
const bundlePath = join(attested.benchmark.directory, 'engine.mjs');
const bundleText = readFileSync(bundlePath, 'utf8');
const api = await import(pathToFileURL(bundlePath).href);

if (attested.case === 'world-reference') {
  let result;
  try {
    result = await benchmarkWorldReplay(api);
    assertExactCapture(result.exact, baseline.worldReplay.exact);
    same(
      { ...result, exact: result.exact.sha256 },
      { ...baseline.worldReplay, exact: baseline.worldReplay.exact.sha256 },
      'profile world baseline',
    );
  } catch (error) {
    result = { status: 'failed', error: String(error), partial: error.partial ?? null };
  }
  json(join(attempt, 'result.json'), result);
  if (result.status !== 'completed') process.exitCode = 1;
} else {
  const scene = packet.fixtures.find((scene) => 'ss-' + scene.id === attested.case);
  if (!scene) throw Error('Unknown fixed CPU profiling fixture');
  const { Session, url } = await import('node:inspector');
  if (url() !== undefined) throw Error('An inspector listener is outside this CPU scope');
  const rows = [];
  for (const dt of packet.protocol.timesteps) {
    const session = new Session();
    const post = (method, params = {}) =>
      new Promise((resolve, reject) =>
        session.post(method, params, (error, result) => (error ? reject(error) : resolve(result))),
      );
    const measured = instrumentRigidApi(api);
    let row,
      profile,
      failure,
      profiling,
      started = false;
    try {
      session.connect(); // In-process connection only; never inspector.open().
      await post('Profiler.enable');
      await post('Profiler.setSamplingInterval', { interval: config.samplingIntervalMicros });
      await post('Profiler.start');
      started = true;
      const cpu = process.cpuUsage(),
        t0 = performance.now();
      try {
        row = benchmarkRigid(measured.api, scene, dt);
      } finally {
        const wallMs = performance.now() - t0;
        const used = process.cpuUsage(cpu);
        const kernelWallMs =
          measured.metrics.create.wallMs +
          measured.metrics.next.wallMs +
          measured.metrics.close.wallMs;
        profiling = {
          wallMs,
          processUserMs: used.user / 1000,
          processSystemMs: used.system / 1000,
          kernelWallMs,
          outsideKernelWallMs: wallMs - kernelWallMs,
          metrics: measured.metrics,
        };
      }
    } catch (error) {
      failure = error;
    } finally {
      try {
        if (started) profile = (await post('Profiler.stop')).profile;
        await post('Profiler.disable');
      } catch (error) {
        failure ??= error;
      } finally {
        session.disconnect();
      }
    }
    try {
      if (profile) {
        const text = JSON.stringify(profile);
        if (Buffer.byteLength(text) > config.maxProfileBytes)
          throw Error('CPU profile output budget exceeded');
        writeFileSync(join(attempt, 'profile-' + dt + '.cpuprofile'), text, { flag: 'wx' });
        profiling.sampling = summarizeCpuProfile(profile, bundleText);
      }
      if (failure) throw failure;
      if (!profile || !profiling) throw Error('Missing profiler evidence');
      assertBaseline(
        row,
        baseline.rows.find(
          (r) => r.backend === 'state-space-rigid' && r.scene === scene.id && r.dt === dt,
        ),
      );
      row = {
        ...row,
        profiling: {
          ...profiling,
          baselineExactMatched: true,
          baselineSha256: config.baselineSha256,
          timingPurpose: 'Instrumented diagnostics only; not replacement benchmark timings.',
        },
      };
    } catch (error) {
      row = {
        status: 'failed',
        backend: 'state-space-rigid',
        scene: scene.id,
        dt,
        error: String(error),
        partial: error.partial ?? null,
        profiling,
        timing: null,
      };
    }
    rows.push(row);
    json(join(attempt, 'row-' + dt + '.json'), row);
    if (row.status !== 'completed') {
      process.exitCode = 1;
      break;
    }
  }
  json(join(attempt, 'result.json'), {
    kind: config.kind,
    packetSha256: sha256,
    rows,
    acceptance: packet.protocol.acceptance,
  });
}
readPacket(attested.benchmark.directory);
if (hash(readFileSync(join(ROOT, config.baseline))) !== config.baselineSha256)
  throw Error('Profiling baseline changed during execution');
