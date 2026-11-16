/** Private entry. Python attests live Job membership before any engine import. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, readPacket, json } from './packet.mjs';

if (process.argv.length !== 3) throw Error('Private CPU case invocation required');
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
const { packet, sha256 } = readPacket(attested.benchmark.directory);
if (sha256 !== attested.benchmark.packetSha256) throw Error('Attested packet mismatch');
const { benchmarkWorldReplay, benchmarkRigid } = await import('./state-space.mjs');
const api = await import(pathToFileURL(join(attested.benchmark.directory, 'engine.mjs')).href);
let result;
if (attested.case === 'world-reference') {
  try {
    result = await benchmarkWorldReplay(api);
  } catch (error) {
    result = { status: 'failed', error: String(error), partial: error.partial ?? null };
  }
  json(join(attempt, 'result.json'), result);
  if (result.status !== 'completed') process.exitCode = 1;
} else {
  const scene = packet.fixtures.find((scene) => 'ss-' + scene.id === attested.case);
  if (!scene) throw Error('Unknown fixed CPU fixture');
  const rows = [];
  for (const dt of packet.protocol.timesteps) {
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
    rows.push(row);
    json(join(attempt, 'row-' + dt + '.json'), row);
    if (row.status !== 'completed') {
      process.exitCode = 1;
      break;
    }
  }
  result = { packetSha256: sha256, rows };
  json(join(attempt, 'result.json'), result);
}
readPacket(attested.benchmark.directory);
