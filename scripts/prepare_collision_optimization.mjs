/** Static baseline capture; never imports or executes engine code. */
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { ROOT, hash, json } from './collision-reference/packet.mjs';
const directory = join(ROOT, 'dist/verification/collision-owned-review-20261108');
const oldPacket = JSON.parse(
  readFileSync(
    join(ROOT, 'dist/verification/collision-reference-20261108-cpu-v2/packet.json'),
    'utf8',
  ),
);
const built = await build({
  absWorkingDir: ROOT,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  write: false,
  metafile: true,
  outfile: 'rigid-before.mjs',
  logLevel: 'silent',
  stdin: {
    contents:
      "export { createRigidStep3D, rigidAssemblyMassProperties3D, validateRigidAssemblyMotion3D } from './engine/experimental/multiphysics/rigid.ts';\nexport { cuboidMassProperties } from './engine/experimental/multiphysics/math.ts';",
    resolveDir: ROOT,
    loader: 'ts',
  },
});
const files = Object.keys(built.metafile.inputs)
  .filter((path) => path !== '<stdin>')
  .sort()
  .map((path) => {
    if (/gpu|worker|\.wgsl/i.test(path)) throw Error('Unexpected baseline dependency');
    const digest = hash(readFileSync(resolve(ROOT, path)));
    if (oldPacket.files.find((file) => file.path === path)?.sha256 !== digest)
      throw Error('Baseline source changed: ' + path);
    return { path, sha256: digest };
  });
const bytes = built.outputFiles[0].contents;
writeFileSync(join(directory, 'rigid-before.mjs'), bytes, { flag: 'wx' });
const manifest = {
  schema: 'rigid-optimization-baseline-v1',
  engineSources: files,
  bundleSha256: hash(bytes),
  sourceCommit: oldPacket.sourceCommit,
  builder: 'esbuild static bundling; no engine evaluation',
};
json(join(directory, 'baseline.json'), manifest);
console.log(
  JSON.stringify({
    ...manifest,
    manifestSha256: hash(readFileSync(join(directory, 'baseline.json'))),
  }),
);
