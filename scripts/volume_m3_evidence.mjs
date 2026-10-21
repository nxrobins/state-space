import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { gzipSync } from 'node:zlib';
import { sources as previousSources } from './volume_m2_evidence.mjs';
export { hash } from './volume_evidence.mjs';
import { hash } from './volume_evidence.mjs';
export function sources() {
  const result = previousSources();
  for (const p of [
    'engine/vite.world.config.ts',
    'engine/vite.world-gpu.config.ts',
    'dist/sdk/state-space-world.js',
    'dist/sdk/state-space-world-gpu.js',
    ...readdirSync('examples/cavern').map((n) => 'examples/cavern/' + n),
    ...readdirSync('scripts')
      .filter((n) => /volume_m3.*\.(mjs|py)$/.test(n))
      .map((n) => 'scripts/' + n),
  ])
    result[p] = hash(readFileSync(p));
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}
export function save(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}
export function fixture(dir, name, value) {
  const bytes = Buffer.from(JSON.stringify(value)),
    path = resolve(dir, `${name}.json.gz`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, gzipSync(bytes, { level: 9 }));
  return {
    path: path.replaceAll('\\', '/').replace(resolve('.').replaceAll('\\', '/') + '/', ''),
    sha256: hash(bytes),
    compressedSha256: hash(readFileSync(path)),
  };
}
