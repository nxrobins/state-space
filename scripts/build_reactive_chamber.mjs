// Compile public SDK clients only; never starts a worker, simulation, browser or GPU.
import {build} from 'esbuild';
import {mkdir, copyFile, writeFile} from 'node:fs/promises';
const outdir = 'dist/reactive-chamber';
await mkdir(outdir, {recursive: true});
const result = await build({entryPoints: {app: 'examples/reactive-chamber/browser-entry.ts', worker: 'examples/reactive-chamber/worker-entry.ts',
  verification: 'examples/reactive-chamber/verification.ts'}, outdir, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', metafile: true});
for (const file of ['index.html', 'style.css']) await copyFile(`examples/reactive-chamber/${file}`, `${outdir}/${file}`);
await writeFile(`${outdir}/bundle-inputs.json`, JSON.stringify(result.metafile, null, 2) + '\n');
console.log(`Built reactive chamber in ${outdir}`);
