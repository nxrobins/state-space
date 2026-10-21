/** Shared SDK build metadata. Export/declaration manifests are checked mirrors. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
export const SDK_ROOT = fileURLToPath(new URL('../', import.meta.url));
// These five entries retain their original target; other entries use Vite's default.
const ES2022_ENTRIES = new Set([
  '.',
  './experimental/3d',
  './experimental/3d/gpu',
  './experimental/3d/world',
  './experimental/3d/world/gpu',
]);
export function sdkEntries(exports) {
  const entries = Object.entries(exports).map(([key, value]) => {
    const source = value.types?.match(/^\.\/dist\/sdk\/types\/((?:[\w-]+\/)*[\w-]+)\.d\.ts$/);
    const output = value.import?.match(/^\.\/dist\/sdk\/([\w-]+\.js)$/);
    if (!source || !output) throw Error(`Invalid SDK export paths: ${key}`);
    return Object.freeze({
      key,
      source: `engine/${source[1]}.ts`,
      filename: output[1],
      ...(ES2022_ENTRIES.has(key) ? { target: 'es2022' } : {}),
    });
  });
  if (!entries.some((entry) => entry.key === '.')) throw Error('The root SDK export is required.');
  for (const field of ['source', 'filename']) {
    if (new Set(entries.map((entry) => entry[field])).size !== entries.length)
      throw Error(`Duplicate SDK ${field}.`);
  }
  return Object.freeze([
    ...entries.filter((entry) => entry.key === '.'),
    ...entries.filter((entry) => entry.key !== '.'),
  ]);
}
export const SDK_ENTRIES = sdkEntries(
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).exports,
);
// Entries that other bundles import as a sibling file instead of copying into themselves.
// Today: the embedded rock textures, reached by every GPU world bundle.
export const SHARED_ENTRIES = Object.freeze(
  SDK_ENTRIES.filter((entry) => entry.key === './experimental/3d/rock-textures').map((entry) =>
    Object.freeze({ ...entry, resolved: resolve(SDK_ROOT, entry.source) }),
  ),
);
export function sdkConfig(key) {
  const entry = SDK_ENTRIES.find((entry) => entry.key === key);
  if (!entry) throw Error(`Unknown SDK entry: ${key}`);
  const shared = SHARED_ENTRIES.filter((other) => other.key !== entry.key);
  const sharedFor = (id) => shared.find((other) => other.resolved === id);
  return {
    root: SDK_ROOT,
    configFile: false,
    build: {
      ...(entry.target ? { target: entry.target } : {}),
      outDir: resolve(SDK_ROOT, 'dist/sdk'),
      emptyOutDir: entry.key === '.',
      minify: false,
      lib: {
        entry: resolve(SDK_ROOT, entry.source),
        formats: ['es'],
        fileName: () => entry.filename,
      },
      rollupOptions: {
        // Rollup asks twice: with the specifier as written, then with the resolved file.
        external: (id, _importer, isResolved) => isResolved && sharedFor(id) !== undefined,
        output: { paths: (id) => (sharedFor(id) ? `./${sharedFor(id).filename}` : id) },
      },
    },
  };
}
