/** Fixed current-engine stack profiling; live Job attestation precedes engine/profiler imports. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { ROOT, readPacket, hash, json } from './packet.mjs';
if (process.argv.length !== 3) throw Error('Private fixed solver profiling invocation required');
const attempt = resolve(process.argv[2]),
  review = JSON.parse(readFileSync(join(attempt, '../review.json'), 'utf8'));
const python = Object.keys(review.binaries).find((p) => /[\\/]python\.exe$/i.test(p));
if (!python) throw Error('Missing reviewed Python identity');
const attested = JSON.parse(
  execFileSync(
    python,
    ['-I', '-B', join(ROOT, 'scripts/collision_cpu_leaf.py'), '--claim-node', attempt],
    { encoding: 'utf8', windowsHide: true, timeout: 10000 },
  ),
);
const config = attested.cacheSolver;
if (config?.kind !== 'rigid-stack-cache-solver-profile-v1')
  throw Error('Unknown solver profiling recipe');
for (const key of [
  'baseline',
  'baselinePacket',
  'regressionBaseline',
  'originalBundle',
  'priorProfile',
  'coverageBaseline',
])
  if (hash(readFileSync(join(ROOT, config[key]))) !== config[key + 'Sha256'])
    throw Error('Changed solver profile baseline');
const { packet, sha256 } = readPacket(attested.benchmark.directory);
if (sha256 !== attested.benchmark.packetSha256 || packet.bundleSha256 !== config.bundleSha256)
  throw Error('Changed profiled engine');
const baseline = JSON.parse(readFileSync(join(ROOT, config.baseline), 'utf8'));
const bundlePath = join(attested.benchmark.directory, 'engine.mjs'),
  bundleUrl = pathToFileURL(bundlePath).href;
const api = await import(bundleUrl);
const { benchmarkRigid, benchmarkWorldReplay } = await import('./state-space.mjs');
const { instrumentRigidApi, assertBaseline, assertExactCapture } =
  await import('./profile-data.mjs');
const { same } = await import('./replay.mjs');
const result = {
  kind: config.kind,
  packetSha256: sha256,
  status: 'failed',
  acceptance: packet.protocol.acceptance,
};
const write = (name, value) => {
  if (Buffer.byteLength(JSON.stringify(value)) > config.maxProfileBytes)
    throw Error('Solver profile artifact budget exceeded');
  json(join(attempt, name), value);
};
try {
  if (attested.case === 'ss-owned-regression') {
    const old = await import(pathToFileURL(join(ROOT, config.regressionBaseline)).href);
    const { checkOwnedRegression } = await import('./owned-regression.mjs');
    result.regression = checkOwnedRegression(old, api);
  } else if (attested.case === 'ss-normal-cache-regression') {
    const old = await import(pathToFileURL(join(ROOT, config.originalBundle)).href);
    const { checkNormalCacheRegression } = await import('./normal-cache-regression.mjs');
    result.contactRegression = checkNormalCacheRegression(old, api);
  } else if (attested.case === 'world-reference') {
    result.world = await benchmarkWorldReplay(api);
    assertExactCapture(result.world.exact, baseline.worldReplay.exact);
    same(
      { ...result.world, exact: result.world.exact.sha256 },
      { ...baseline.worldReplay, exact: baseline.worldReplay.exact.sha256 },
      'solver profile world baseline',
    );
  } else {
    const counts = attested.case === 'ss-stack-solver-counts';
    if (!counts && !/^ss-stack-solver-profile-[123]$/.test(attested.case))
      throw Error('Unknown fixed solver profile case');
    const { Session, url } = await import('node:inspector');
    if (url() !== undefined) throw Error('An inspector listener is outside this CPU scope');
    const scene = packet.fixtures.find((s) => s.id === config.scene);
    result.rows = [];
    for (const dt of counts ? [config.coverageDt] : packet.protocol.timesteps) {
      const session = new Session(),
        post = (method, params = {}) =>
          new Promise((resolve, reject) =>
            session.post(method, params, (error, value) =>
              error ? reject(error) : resolve(value),
            ),
          );
      const measured = instrumentRigidApi(api);
      let row,
        profile,
        coverage,
        clocks,
        failure,
        started = false;
      try {
        session.connect();
        await post('Profiler.enable');
        if (counts)
          await post('Profiler.startPreciseCoverage', {
            callCount: config.coverageCallCount,
            detailed: config.coverageDetailed,
            allowTriggeredUpdates: false,
          });
        else {
          await post('Profiler.setSamplingInterval', { interval: config.samplingIntervalMicros });
          await post('Profiler.start');
        }
        started = true;
        const cpu = process.cpuUsage(),
          thread = process.threadCpuUsage(),
          start = performance.now();
        try {
          row = benchmarkRigid(measured.api, scene, dt);
        } finally {
          const wallMs = performance.now() - start,
            threadUsed = process.threadCpuUsage(thread),
            used = process.cpuUsage(cpu);
          const kernelWallMs =
            measured.metrics.create.wallMs +
            measured.metrics.next.wallMs +
            measured.metrics.close.wallMs;
          clocks = {
            wallMs,
            kernelWallMs,
            outsideKernelWallMs: wallMs - kernelWallMs,
            threadUserMs: threadUsed.user / 1000,
            threadSystemMs: threadUsed.system / 1000,
            processUserMs: used.user / 1000,
            processSystemMs: used.system / 1000,
            metrics: measured.metrics,
          };
        }
      } catch (error) {
        failure = error;
      } finally {
        try {
          if (started) {
            if (counts) {
              coverage = await post('Profiler.takePreciseCoverage');
              await post('Profiler.stopPreciseCoverage');
            } else profile = (await post('Profiler.stop')).profile;
          }
          await post('Profiler.disable');
        } catch (error) {
          failure ??= error;
        } finally {
          session.disconnect();
        }
      }
      if (profile) write('profile-' + dt + '.cpuprofile', profile);
      if (coverage) write('coverage-' + dt + '.json', coverage);
      if (failure) {
        write('failure-' + dt + '.json', {
          error: String(failure),
          partial: failure.partial ?? null,
          clocks,
        });
        throw failure;
      }
      if (!clocks || !(counts ? coverage : profile))
        throw Error('Missing solver profiling evidence');
      assertBaseline(
        row,
        baseline.rows.find(
          (r) => r.backend === 'state-space-rigid' && r.scene === scene.id && r.dt === dt,
        ),
      );
      const ticks = Math.round(0.048 / dt);
      same(measured.metrics.create.calls, 15 * ticks - 3, 'profile invocation count');
      same(measured.metrics.completed, 15 * ticks - 4, 'profile completion count');
      same(measured.metrics.close.calls, 15 * ticks - 3, 'profile cancellation/closure count');
      const stored = {
        ...row,
        profiling: {
          mode: counts ? 'precise-coverage' : 'sampling',
          clocks,
          artifact: counts ? 'coverage-' + dt + '.json' : 'profile-' + dt + '.cpuprofile',
          purpose: counts
            ? 'Call counts only; precise coverage disables optimized execution. Not timing evidence.'
            : 'Sample counts only; long sampling intervals are never treated as CPU execution.',
        },
      };
      write('row-' + dt + '.json', stored);
      result.rows.push(stored);
    }
  }
  result.status = 'completed';
} catch (error) {
  result.error = String(error);
  result.stack = error.stack;
  process.exitCode = 1;
}
write('result.json', result);
readPacket(attested.benchmark.directory);
for (const key of [
  'baseline',
  'baselinePacket',
  'regressionBaseline',
  'originalBundle',
  'priorProfile',
  'coverageBaseline',
])
  if (hash(readFileSync(join(ROOT, config[key]))) !== config[key + 'Sha256'])
    throw Error('Solver profiling baseline drift');
