/** Fixed optimization A/B recipe; attestation precedes any engine import. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, readPacket, hash, json } from './packet.mjs';
if (process.argv.length !== 3) throw Error('Private fixed optimization invocation required');
const attempt = resolve(process.argv[2]);
const review = JSON.parse(readFileSync(join(attempt, '../review.json'), 'utf8'));
const python = Object.keys(review.binaries).find((p) => /[\\/]python\.exe$/i.test(p));
if (!python) throw Error('Missing reviewed Python identity');
const attested = JSON.parse(
  execFileSync(
    python,
    ['-I', '-B', join(ROOT, 'scripts/collision_cpu_leaf.py'), '--claim-node', attempt],
    { encoding: 'utf8', windowsHide: true, timeout: 10000 },
  ),
);
const config = attested.offsetCache ?? attested.optimization;
const offsetCache = config?.kind === 'rigid-offset-cache-v1';
if (
  (!offsetCache && config?.kind !== 'rigid-owned-optimization-v1') ||
  config.freshBaselineControls !== true
)
  throw Error('Unknown optimization recipe');
for (const key of [
  'baseline',
  'baselinePacket',
  'baselineBundle',
  'regressionBaseline',
  'regressionManifest',
  ...(offsetCache ? ['sourceBaseline', 'coverageBaseline'] : []),
])
  if (hash(readFileSync(join(ROOT, config[key]))) !== config[key + 'Sha256'])
    throw Error('Frozen baseline changed');
const { packet, sha256 } = readPacket(attested.benchmark.directory);
if (sha256 !== attested.benchmark.packetSha256) throw Error('Attested benchmark mismatch');
const baseline = JSON.parse(readFileSync(join(ROOT, config.baseline), 'utf8'));
const { benchmarkWorldReplay, benchmarkRigid } = await import('./state-space.mjs');
const { assertExactCapture, assertBaseline } = await import('./profile-data.mjs');
const { same } = await import('./replay.mjs');
const api = await import(pathToFileURL(join(attested.benchmark.directory, 'engine.mjs')).href);
if (offsetCache && attested.case === 'ss-offset-cache-counts') {
  const { countOffsetCache } = await import('./offset-cache-counts.mjs');
  const result = await countOffsetCache(
    api,
    packet,
    config,
    baseline,
    attempt,
    attested.benchmark.directory,
  );
  json(join(attempt, 'result.json'), {
    ...result,
    packetSha256: sha256,
    acceptance: packet.protocol.acceptance,
  });
  if (result.status !== 'completed') process.exitCode = 1;
} else if (
  attested.case === 'ss-owned-regression' ||
  attested.case === 'world-reference' ||
  (offsetCache && attested.case === 'ss-normal-cache-regression')
) {
  let result;
  try {
    if (attested.case === 'ss-owned-regression') {
      const old = await import(pathToFileURL(join(ROOT, config.regressionBaseline)).href);
      const { checkOwnedRegression } = await import('./owned-regression.mjs');
      result = checkOwnedRegression(old, api);
    } else if (attested.case === 'ss-normal-cache-regression') {
      const old = await import(pathToFileURL(join(ROOT, config.baselineBundle)).href);
      const { checkNormalCacheRegression } = await import('./normal-cache-regression.mjs');
      result = checkNormalCacheRegression(old, api);
    } else {
      result = await benchmarkWorldReplay(api);
      assertExactCapture(result.exact, baseline.worldReplay.exact);
      same(
        { ...result, exact: result.exact.sha256 },
        { ...baseline.worldReplay, exact: baseline.worldReplay.exact.sha256 },
        'optimized world baseline',
      );
    }
  } catch (error) {
    result = {
      status: 'failed',
      error: String(error),
      stack: error.stack,
      partial: error.partial ?? null,
    };
  }
  json(join(attempt, 'result.json'), result);
  if (result.status !== 'completed') process.exitCode = 1;
} else {
  const sceneIndex = packet.fixtures.findIndex((scene) => 'ss-' + scene.id === attested.case);
  if (sceneIndex < 0) throw Error('Unknown optimization fixture');
  const scene = packet.fixtures[sceneIndex];
  const old = await import(pathToFileURL(join(ROOT, config.baselineBundle)).href);
  const rows = [];
  for (const [dtIndex, dt] of packet.protocol.timesteps.entries()) {
    const order =
      (sceneIndex + dtIndex) % 2 === 0 ? ['baseline', 'optimized'] : ['optimized', 'baseline'];
    let row, control;
    try {
      for (const which of order) {
        const measured = benchmarkRigid(which === 'baseline' ? old : api, scene, dt);
        assertBaseline(
          measured,
          baseline.rows.find(
            (r) => r.backend === 'state-space-rigid' && r.scene === scene.id && r.dt === dt,
          ),
        );
        if (which === 'baseline') {
          control = measured;
          json(join(attempt, 'control-row-' + dt + '.json'), control);
        } else row = measured;
      }
      assertBaseline(row, JSON.parse(JSON.stringify(control)));
      row = {
        ...row,
        baselineControl: {
          order,
          exactSha256: control.exact.sha256,
          rowSha256: hash(readFileSync(join(attempt, 'control-row-' + dt + '.json'))),
          timing: control.timing,
          baselineBundleSha256: config.baselineBundleSha256,
          historicalBaselineSha256: config.baselineSha256,
          exactMatch: true,
        },
      };
    } catch (error) {
      row = {
        status: 'failed',
        backend: 'state-space-rigid',
        scene: scene.id,
        dt,
        error: String(error),
        stack: error.stack,
        partial: error.partial ?? null,
        completedControl: control ?? null,
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
    packetSha256: sha256,
    rows,
    acceptance: packet.protocol.acceptance,
  });
}
readPacket(attested.benchmark.directory);
