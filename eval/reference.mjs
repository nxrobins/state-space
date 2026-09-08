// Independent CPU implementation, compiled from the exact checkout under test.
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temp = await mkdtemp(join(tmpdir(), 'state-space-reference-'));
try {
  async function compile(directory, destination) {
    await mkdir(destination, { recursive: true });
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name === 'generated') await compile(join(directory, entry.name), join(destination, entry.name));
      if (!entry.isFile() || !entry.name.endsWith('.ts') || entry.name.includes('.test.') || entry.name.startsWith('vite')) continue;
      const source = await readFile(join(directory, entry.name), 'utf8');
      const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
      await writeFile(join(destination, entry.name.replace(/\.ts$/, '.js')), compiled.outputText);
    }
  }
  await writeFile(join(temp, 'package.json'), '{"type":"module"}');
  await compile(join(root, 'engine'), temp);
  const { runCpuTick } = await import(pathToFileURL(join(temp, 'cpu_physics.js')));
  const { createMaterialRegistry } = await import(pathToFileURL(join(temp, 'registry.js')));
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const cases = JSON.parse(input);
  if (!Array.isArray(cases) || cases.length === 0) throw new Error('Reference cases must be nonempty');
  const output = [];
  for (const scene of cases) {
    const registry = await createMaterialRegistry(scene.catalog);
    const cold = registry.coldTable();
    let state = { grid: Uint32Array.from(scene.cells), energyQ: Uint32Array.from(scene.energyQ), structure: Uint32Array.from(scene.structure) };
    const passes = [];
    for (let tick = scene.tick; tick < scene.tick + scene.ticks; tick += 1) {
      state = runCpuTick(state, scene.width, scene.height, cold, tick, (id, value) => {
        passes.push({ tick, id, cells: Array.from(value.grid), energyQ: Array.from(value.energyQ), structure: Array.from(value.structure) });
      }, registry);
    }
    output.push({ name: scene.name, passes });
  }
  process.stdout.write(JSON.stringify(output));
} finally {
  const relativeTemp = relative(resolve(tmpdir()), resolve(temp));
  if (isAbsolute(relativeTemp) || relativeTemp.startsWith('..') || !relativeTemp.startsWith('state-space-reference-')) throw new Error('Unexpected reference cleanup path');
  await rm(temp, { recursive: true, force: true });
}
