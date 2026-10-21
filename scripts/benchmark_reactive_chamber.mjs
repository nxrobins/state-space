// Fixed seven-profile, two-tick CPU diagnostic. No browser or GPU workloads.
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { guardNode, verificationYield } from './verification_guard.mjs';
await guardNode('cpu', 60);
const root = `dist/verification/reactive-profile-${Date.now()}`;
await mkdir(root, { recursive: true });
const bundle = await build({
  entryPoints: ['examples/reactive-chamber/profiling.ts'],
  outfile: `${root}/profile.mjs`,
  bundle: true,
  format: 'esm',
  platform: 'node',
  metafile: true,
});
const sourceHashes = {};
for (const path of [
  ...Object.keys(bundle.metafile.inputs),
  'scripts/benchmark_reactive_chamber.mjs',
  'scripts/verification_guard.mjs',
].sort())
  sourceHashes[path] = createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
const { profileChamber } = await import(`../${root}/profile.mjs`);
const runs = [];
for (const scenario of [
  'chamber',
  'collapse',
  'flow',
  'chain',
  'conduction',
  'insulation',
  'wax',
]) {
  for (let sample = 0; sample < 3; sample++) {
    console.log(`Profiling ${scenario} sample ${sample + 1}/3`);
    runs.push(await profileChamber(scenario));
    await verificationYield();
  }
}
const report = {
  sourceHashes,
  node: process.version,
  platform: process.platform,
  samplesPerScenario: 3,
  runs,
  maxRssKiB: process.resourceUsage().maxRSS,
  heapUsedBytes: process.memoryUsage().heapUsed,
  supervisorJob: process.env.STATE_SPACE_VERIFICATION_JOB,
};
await writeFile(`${root}/report.json`, JSON.stringify(report, null, 2) + '\n');
console.log(`${root}/report.json`);
