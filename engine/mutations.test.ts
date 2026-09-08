import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { MAT, buildColdTable } from './generated/materials';
import { packVoxel } from './browser_state_space';
import { type PhysicsState } from './thermal';
import { createPhysicsState } from './structure.js';
import { DEFAULT_REGISTRY } from './registry.js';
import * as original from './cpu_physics';

// Load mutated copies in memory; working-tree source and module cache stay intact.
function mutatedBackend(before: string, after: string): typeof original {
  const root = resolve('engine/cpu_physics.ts');
  const cache = new Map<string, { exports: unknown }>();
  function load(path: string): unknown {
    if (cache.has(path)) return cache.get(path)!.exports;
    let source = readFileSync(path, 'utf8');
    if (path === root) {
      expect(source).toContain(before);
      source = source.replace(before, after);
    }
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const module = { exports: {} };
    cache.set(path, module);
    const require = (name: string) => name.startsWith('.') ? load(resolve(dirname(path), `${name.replace(/\.js$/, '')}.ts`)) : createRequire(path)(name);
    new Function('require', 'module', 'exports', compiled)(require, module, module.exports);
    return module.exports;
  }
  return load(root) as typeof original;
}

describe('conformance properties reject reproduced regression classes', () => {
  it('detects duplicated oxygen claims when mutual ownership is removed', () => {
    const mutant = mutatedBackend('chosenFuel(air) === index', 'true');
    const grid = Uint32Array.of(packVoxel(MAT.WOOD, 255), packVoxel(MAT.AIR), packVoxel(MAT.WOOD, 255));
    const countFuel = (state: PhysicsState) => [...state.grid].filter(v => (v & 255) === MAT.WOOD).length;
    expect(countFuel(original.runCpuPass(createPhysicsState(grid, grid.length, 1, DEFAULT_REGISTRY), 3, 1, buildColdTable(), 'combustion'))).toBe(1);
    expect(countFuel(mutant.runCpuPass(createPhysicsState(grid, grid.length, 1, DEFAULT_REGISTRY), 3, 1, buildColdTable(), 'combustion'))).toBe(0);
  });

  it('detects floating-point hash multiplication and blocked positive behavior', () => {
    const mutant = mutatedBackend('Math.imul(h ^ (h >>> 13), 1274126177)', '((h ^ (h >>> 13)) * 1274126177)');
    const coordinates = [[0, 0, 1], [1000, 1000, 3], [16, 18, 2]];
    expect(coordinates.some(([x, y, salt]) => mutant.hashPair(x, y, salt) !== original.hashPair(x, y, salt))).toBe(true);
    const noop = mutatedBackend('const output = input.slice();', 'const output = input.slice(); return { grid: output, energyQ: inputEnergy.slice() };');
    const grid = Uint32Array.of(packVoxel(MAT.SMOKE, 200), packVoxel(MAT.AIR));
    expect([...original.runCpuPass(createPhysicsState(grid, grid.length, 1, DEFAULT_REGISTRY), 2, 1, buildColdTable(), 'gas_spread0_s0').grid]).not.toEqual([...noop.runCpuPass(createPhysicsState(grid, grid.length, 1, DEFAULT_REGISTRY), 2, 1, buildColdTable(), 'gas_spread0_s0').grid]);
  });

  it('detects pass-input mutation with the TypeScript AST checker', async () => {
    // @ts-expect-error Standalone JavaScript checker deliberately has no build dependency.
    const { lintSource } = await import('./lint_ts.mjs');
    expect(lintSource(readFileSync('engine/cpu_physics.ts', 'utf8'))).toEqual([]);
    for (const source of ['input[0] = 0;', 'input.fill(0);', 'input[0]++;', 'inputEnergy[0] = 0;', 'inputEnergy.fill(0);', 'inputStructure[0] = 0;', 'inputStructure.fill(0);']) expect(lintSource(source).some((issue: string) => issue.startsWith('SS009'))).toBe(true);
    expect(lintSource('function hashPair(x) { return x * 1274126177; }').some((issue: string) => issue.startsWith('SS008'))).toBe(true);
    expect(lintSource('export function seed(cold = buildColdTable()) {}').some((issue: string) => issue.startsWith('SS016'))).toBe(true);
    expect(lintSource('export function seed(cold: Uint32Array = buildColdTable()) {}')).toEqual([]);
  });

  it('detects movement that transports packed cells without their energy', () => {
    const mutant = mutatedBackend('outputEnergy[a] = inputEnergy[b];', 'outputEnergy[a] = inputEnergy[a];');
    const state = createPhysicsState(Uint32Array.of(packVoxel(MAT.SMOKE, 200), packVoxel(MAT.AIR, 20)), 2, 1, DEFAULT_REGISTRY);
    const correct = original.runCpuPass(state, 2, 1, buildColdTable(), 'gas_spread0_s0');
    const broken = mutant.runCpuPass(state, 2, 1, buildColdTable(), 'gas_spread0_s0');
    expect([...broken.grid]).toEqual([...correct.grid]);
    expect([...broken.energyQ]).not.toEqual([...correct.energyQ]);
    expect([...correct.energyQ].reduce((a, b) => a + b, 0)).toBe(220 * 256);
  });

  it('executes an illegal pin-displacement mutation and lints the missing destination guard', async () => {
    const state = createPhysicsState(Uint32Array.of(packVoxel(MAT.METAL), packVoxel(MAT.WOOD)), 1, 2, DEFAULT_REGISTRY);
    state.structure.set([0, 4096]);
    const mutant = mutatedBackend(' && !bound(target)', '');
    expect([...original.runCpuPass(state, 1, 2, buildColdTable(), 'vertical0').grid]).toEqual([...state.grid]);
    const moved = mutant.runCpuPass(state, 1, 2, buildColdTable(), 'vertical0');
    expect([...moved.grid]).toEqual([...state.grid].reverse());
    expect([...moved.structure]).toEqual([4096, 0]);
    // @ts-expect-error Standalone JavaScript checker deliberately has no build dependency.
    const { lintSource } = await import('./lint_ts.mjs');
    const source = readFileSync('engine/cpu_physics.ts', 'utf8').replace(' && !bound(target)', '');
    expect(lintSource(source).some((issue: string) => issue.startsWith('SS040'))).toBe(true);
  });
});
