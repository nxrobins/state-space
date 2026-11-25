import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const out = 'dist/liquid-contact/replay-fixtures';
const bundle = resolve(out, 'historical.mjs');
await build({ entryPoints: ['prior-engine/engine/experimental/multiphysics.ts'], outfile: bundle, bundle: true, platform: 'node', format: 'esm', target: 'es2022' });
const historical = await import(pathToFileURL(bundle).href);
const profiles = await historical.createMultiphysicsProfiles3D();
const world = historical.createMultiphysicsWorld3D(profiles, historical.createMultiphysicsDemonstration3D(profiles, 'combined-failure'));
for (let pair = 0; pair < 12; ++pair) {
  const candidate = world.prepare([], 2);
  while (candidate.progress().status === 'running') candidate.advance(256);
  world.commit(candidate);
}
await writeFile(resolve(out, 'combined-v1-tick24.json'), JSON.stringify(world.snapshot(), null, 2) + '\n');
