// Compile the multiphysics builder against the public SDK; never starts a worker, simulation or GPU.
import { build } from 'esbuild';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
const outdir = 'dist/multiphysics-builder';
await mkdir(outdir, { recursive: true });
const result = await build({
  entryPoints: {
    app: 'examples/multiphysics-builder/browser-entry.ts',
    worker: 'examples/multiphysics-builder/worker-entry.ts',
    verification: 'examples/multiphysics-builder/verification.ts',
  },
  outdir,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  metafile: true,
});
for (const file of ['index.html', 'style.css'])
  await copyFile(`examples/multiphysics-builder/${file}`, `${outdir}/${file}`);
await writeFile(`${outdir}/bundle-inputs.json`, JSON.stringify(result.metafile, null, 2) + '\n');
console.log(`Built multiphysics builder in ${outdir}`);
