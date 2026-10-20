/** Shared SDK build metadata. Export/declaration manifests are checked mirrors. */
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
export const SDK_ROOT = fileURLToPath(new URL('../', import.meta.url));
export const SDK_ENTRIES = Object.freeze(JSON.parse(readFileSync(new URL('./sdk-entries.json', import.meta.url), 'utf8')).map(Object.freeze));
export function sdkExports(entries = SDK_ENTRIES) {
  return Object.fromEntries(entries.map(entry => [entry.key, {
    types: './dist/sdk/types/' + entry.source.slice('engine/'.length).replace(/\.ts$/, '.d.ts'),
    import: './dist/sdk/' + entry.filename,
  }]));
}
export function validateSdkMetadata(packageData, declarations, entries = SDK_ENTRIES) {
  for (const field of ['key', 'source', 'filename']) {
    if (new Set(entries.map(entry => entry[field])).size !== entries.length) throw Error(`Duplicate SDK ${field}.`);
  }
  if (!entries.length || entries[0].key !== '.') throw Error('The root SDK entry must build first.');
  if (!isDeepStrictEqual(packageData.exports, sdkExports(entries))) throw Error('package.json exports differ from engine/sdk-entries.json.');
  const expected = entries.map(entry => entry.source.slice('engine/'.length)).sort();
  if (!isDeepStrictEqual([...declarations.include].sort(), expected)) throw Error('tsconfig.sdk.json include differs from engine/sdk-entries.json.');
}
export function sdkConfig(key) {
  const entry = SDK_ENTRIES.find(entry => entry.key === key);
  if (!entry) throw Error(`Unknown SDK entry: ${key}`);
  return {
    root: SDK_ROOT,
    configFile: false,
    build: {
      ...(entry.target ? {target: entry.target} : {}),
      outDir: resolve(SDK_ROOT, 'dist/sdk'),
      emptyOutDir: entry.key === '.',
      minify: false,
      lib: {entry: resolve(SDK_ROOT, entry.source), formats: ['es'], fileName: () => entry.filename},
    },
  };
}
