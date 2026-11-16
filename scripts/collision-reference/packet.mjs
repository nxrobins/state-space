/** Static preparation and provenance; never imports an engine module. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { resolve, relative, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { PROTOCOL, fixtures } from './protocol.mjs';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const json = (path, value) =>
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
export function holdRecord(root = ROOT) {
  const path = resolve(root, 'dist/verification/safety-hold.json');
  if (!existsSync(path)) return { path, present: false, sha256: null, blocked: false };
  const bytes = readFileSync(path);
  // Any existing hold requires the existing supervisor's review/permit path.
  return { path, present: true, sha256: hash(bytes), blocked: true };
}
function sources() {
  const paths = [
    'scripts/benchmark_collision_reference.mjs',
    'package-lock.json',
    'scripts/verification_guard.mjs',
    'scripts/verification_guard.py',
    'scripts/verification_health.py',
    'scripts/verification_watchdog.py',
    'scripts/verification_journal.py',
  ];
  for (const name of readdirSync(resolve(ROOT, 'scripts/collision-reference')))
    if (/\.(mjs|ts|py|txt)$/.test(name)) paths.push('scripts/collision-reference/' + name);
  return paths;
}

export async function preparePacket(destination) {
  mkdirSync(destination, { recursive: false });
  // esbuild parses/bundles source only. The produced bridge is never imported here.
  const { build, version } = await import('esbuild');
  const built = await build({
    absWorkingDir: ROOT,
    entryPoints: ['scripts/collision-reference/engine-entry.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    write: false,
    metafile: true,
    outfile: 'engine.mjs',
    logLevel: 'silent',
  });
  const inputPaths = Object.keys(built.metafile.inputs);
  if (inputPaths.some((p) => /gpu|worker-host|worker-client|\.wgsl/i.test(p)))
    throw Error('Unexpected GPU/Worker dependency in CPU bridge');
  const files = [...new Set([...sources(), ...inputPaths])].sort().map((path) => ({
    path: path.replaceAll('\\', '/'),
    sha256: hash(readFileSync(resolve(ROOT, path))),
  }));
  const bundle = built.outputFiles[0].contents;
  writeFileSync(join(destination, 'engine.mjs'), bundle, { flag: 'wx' });
  const packet = {
    schema: PROTOCOL.schema,
    state: 'prepared-unexecuted',
    builder: { esbuild: version, node: process.version },
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
      windowsHide: true,
    }).trim(),
    preparedAt: new Date().toISOString(),
    protocol: PROTOCOL,
    fixtures: fixtures(),
    files,
    bundleSha256: hash(bundle),
    holdAtPreparation: holdRecord(),
    runtimeAcceptance: false,
    performanceAcceptance: false,
  };
  json(join(destination, 'packet.json'), packet);
  writeFileSync(
    join(destination, 'packet.sha256'),
    hash(readFileSync(join(destination, 'packet.json'))) + '\n',
    { flag: 'wx' },
  );
  return packet;
}

export function readPacket(directory) {
  const bytes = readFileSync(join(directory, 'packet.json'));
  if (hash(bytes) !== readFileSync(join(directory, 'packet.sha256'), 'utf8').trim())
    throw Error('Packet digest mismatch');
  const packet = JSON.parse(bytes);
  if (
    packet.schema !== PROTOCOL.schema ||
    JSON.stringify(packet.protocol) !== JSON.stringify(PROTOCOL) ||
    JSON.stringify(packet.fixtures) !== JSON.stringify(fixtures())
  )
    throw Error('Unknown or modified benchmark protocol');
  if (!Array.isArray(packet.files) || packet.files.length < sources().length)
    throw Error('Missing source manifest');
  const manifest = new Set();
  for (const row of packet.files) {
    const path = resolve(ROOT, row.path),
      rel = relative(ROOT, path);
    if (isAbsolute(row.path) || rel.startsWith('..') || manifest.has(row.path))
      throw Error('Invalid source path');
    manifest.add(row.path);
    if (hash(readFileSync(path)) !== row.sha256) throw Error(`Source drift: ${row.path}`);
  }
  for (const path of sources()) if (!manifest.has(path)) throw Error(`Missing source: ${path}`);
  if (hash(readFileSync(join(directory, 'engine.mjs'))) !== packet.bundleSha256)
    throw Error('Bundle drift');
  return { packet, sha256: hash(bytes) };
}
