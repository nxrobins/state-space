import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { hash, ROOT } from './volume_evidence.mjs';
export { hash, save } from './volume_evidence.mjs';
export function sources() {
  const paths = [
    'engine/sdk-build.mjs',
    'scripts/build_sdk.mjs',
    'engine/portable-data.ts',
    'package.json',
    'engine/vitest.config.ts',
    'scripts/verification_guard.py',
    'scripts/verification_guard.mjs',
    'scripts/verify_checks.mjs',
    'tests/test_verification_guard.py',
    'engine/tsconfig.sdk.json',
    'engine/vite.volume.config.ts',
    'engine/vite.volume-gpu.config.ts',
    'engine/lint_ts.mjs',
    'dist/sdk/state-space.js',
    'dist/sdk/state-space-3d.js',
    'dist/sdk/state-space-3d-gpu.js',
    'web/rendering.test.mjs',
    'web/frame-pump.js',
    'web/frame-clock.js',
    'engine/thermal.ts',
    'engine/registry.ts',
    'engine/validation.ts',
    'engine/materials.json',
    'engine/generated/materials.ts',
    'examples/volume-lab/scenes.js',
    'scripts/volume_evidence.mjs',
  ];
  for (const dir of ['engine/experimental', 'examples/first-person'])
    for (const name of readdirSync(resolve(ROOT, dir), { recursive: true }))
      if (/\.(ts|js|mjs|html|css)$/.test(name)) paths.push(`${dir}/${name}`);
  for (const name of readdirSync(resolve(ROOT, 'scripts')))
    if (/volume_m2.*\.(mjs|py)$/.test(name)) paths.push(`scripts/${name}`);
  return Object.fromEntries(
    [...new Set(paths)].sort().map((p) => [p, hash(readFileSync(resolve(ROOT, p)))]),
  );
}
