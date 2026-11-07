/** Shared shape and helpers for the C6 structural corpus. `engine/structure.test.ts` reads
 * it from the native fixture (`engine.structure_conformance`, GPU transport) and
 * `engine/structure.cpu.test.ts` from the bulk Python planner alone
 * (`tests.structure_cpu_cases`). */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import ts from '@typescript/typescript6';
import type { MaterialCatalog } from '../registry.js';
import type * as S from '../structure.js';
import type { SourceMutant } from './structure-mutants.js';

export interface Step {
  cells: number[];
  energyQ: number[];
  structure: number[];
  sources: number[];
  loads: number[];
  capacities: number[];
  reactions: number[];
  distances: number[];
  components: S.ComponentReport[];
  supportedWeight: number;
}
export interface Fixture {
  name: string;
  width: number;
  height: number;
  cells: number[];
  energyQ: number[];
  structure: number[];
  materials: S.StructuralMaterial[];
  catalog: MaterialCatalog;
  steps: Step[];
}
export const stateOf = (
  value: Pick<Fixture, 'cells' | 'energyQ' | 'structure'>,
): S.StructuralState => ({
  grid: Uint32Array.from(value.cells),
  energyQ: Uint32Array.from(value.energyQ),
  structure: Uint32Array.from(value.structure),
});

/** Load `engine/structure.ts` with one exact source edit applied, as an isolated module graph. */
export function loadMutant({ before, after }: SourceMutant): typeof S {
  const root = resolve('engine/structure.ts'),
    cache = new Map<string, { exports: unknown }>();
  function load(path: string): unknown {
    if (cache.has(path)) return cache.get(path)!.exports;
    let source = readFileSync(path, 'utf8');
    if (path === root) {
      if (!source.includes(before))
        throw new Error(`Mutant anchor missing from engine/structure.ts: ${before}`);
      source = source.replace(before, after);
    }
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const module = { exports: {} };
    cache.set(path, module);
    const require = (name: string): unknown =>
      name.startsWith('.')
        ? load(resolve(dirname(path), `${name.replace(/\.js$/, '')}.ts`))
        : createRequire(path)(name);
    new Function('require', 'module', 'exports', compiled)(require, module, module.exports);
    return module.exports;
  }
  return load(root) as typeof S;
}
