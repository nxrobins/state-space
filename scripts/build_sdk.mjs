/** Keep entries separate: each SDK bundle retains its existing private identities.
 * Shared entries (see SHARED_ENTRIES) are the one exception; other bundles import them as siblings.
 */
import { resolve } from 'node:path';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { build } from 'vite';
import { SDK_ROOT, SDK_ENTRIES, sdkConfig } from '../engine/sdk-build.mjs';
const args = process.argv.slice(2);
if (args.length && (args.length !== 1 || args[0] !== '--types-only'))
  throw Error('Usage: build_sdk.mjs [--types-only]');
if (!args.length) for (const entry of SDK_ENTRIES) await build(sdkConfig(entry.key));
// Keep the generated project inside the package so ambient types resolve locally.
// Export metadata remains the source of truth for declaration roots.
mkdirSync(resolve(SDK_ROOT, 'dist'), { recursive: true });
const temporary = mkdtempSync(resolve(SDK_ROOT, 'dist/.sdk-types-'));
try {
  const project = resolve(temporary, 'tsconfig.json');
  writeFileSync(
    project,
    JSON.stringify({
      extends: resolve(SDK_ROOT, 'engine/tsconfig.sdk.json'),
      files: SDK_ENTRIES.map((entry) => resolve(SDK_ROOT, entry.source)),
    }),
  );
  const result = spawnSync(
    process.execPath,
    [
      resolve(SDK_ROOT, 'node_modules/typescript/bin/tsc'),
      '--project',
      project,
      '--pretty',
      'false',
    ],
    { cwd: SDK_ROOT, stdio: ['ignore', 2, 2] },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
