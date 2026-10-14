import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const hash = value => createHash('sha256').update(typeof value === 'string' || value instanceof Uint8Array ? value : JSON.stringify(value)).digest('hex');
export function sources() {
  const paths = ['package.json', 'engine/tsconfig.sdk.json', 'engine/vite.sdk.config.ts', 'engine/vite.volume.config.ts', 'dist/sdk/state-space-3d.js'];
  for (const directory of ['engine/experimental', 'examples/volume-lab']) for (const name of readdirSync(resolve(ROOT, directory))) if (/\.(ts|js|html|css)$/.test(name)) paths.push(`${directory}/${name}`);
  for (const name of ['thermal.ts', 'registry.ts', 'validation.ts', 'materials.json', 'generated/materials.ts']) paths.push(`engine/${name}`);
  for (const name of readdirSync(resolve(ROOT, 'scripts'))) if (/volume.*\.(mjs|py)$/.test(name)) paths.push(`scripts/${name}`);
  return Object.fromEntries(paths.sort().map(p => [p, hash(readFileSync(resolve(ROOT, p)))]));
}
export function save(path, report) { const absolute = resolve(ROOT, path); mkdirSync(dirname(absolute), { recursive: true }); writeFileSync(absolute, JSON.stringify(report, null, 2) + '\n'); return relative(ROOT, absolute); }
export const distribution = values => { const sorted = [...values].sort((a,b) => a-b); return { count: values.length, samples: values, min: sorted[0], median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.ceil(sorted.length * .95) - 1], max: sorted.at(-1) }; };
