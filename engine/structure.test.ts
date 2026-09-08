import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';
import { createMaterialRegistry, type MaterialCatalog } from './registry.js';
import * as S from './structure.js';

interface Step {
  cells: number[]; energyQ: number[]; structure: number[]; sources: number[];
  loads: number[]; capacities: number[]; reactions: number[]; distances: number[];
  components: S.ComponentReport[]; supportedWeight: number;
}
interface Fixture {
  name: string; width: number; height: number; cells: number[]; energyQ: number[]; structure: number[];
  materials: S.StructuralMaterial[]; catalog: MaterialCatalog; steps: Step[];
}
let fixtures: Fixture[], models: S.StructuralRules[];
const stateOf = (value: Pick<Fixture, 'cells' | 'energyQ' | 'structure'>): S.StructuralState => ({
  grid: Uint32Array.from(value.cells), energyQ: Uint32Array.from(value.energyQ), structure: Uint32Array.from(value.structure),
});

beforeAll(async () => {
  const python = process.env.STATE_SPACE_PYTHON ?? (existsSync('.venv/Scripts/python.exe') ? resolve('.venv/Scripts/python.exe') : 'python');
  const { stdout } = await promisify(execFile)(python, ['-m', 'engine.structure_conformance'], {
    encoding: 'utf8', timeout: 60_000, maxBuffer: 20 * 1024 * 1024,
  });
  const report = JSON.parse(stdout);
  fixtures = report.cases;
  models = await Promise.all(fixtures.map(async fixture => new S.StructuralRules(fixture.materials, await createMaterialRegistry(fixture.catalog))));
}, 60_000);

function loadMutant(before: string, after: string): typeof S {
  const root = resolve('engine/structure.ts'), cache = new Map<string, { exports: unknown }>();
  function load(path: string): unknown {
    if (cache.has(path)) return cache.get(path)!.exports;
    let source = readFileSync(path, 'utf8');
    if (path === root) { expect(source).toContain(before); source = source.replace(before, after); }
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const module = { exports: {} };
    cache.set(path, module);
    const require = (name: string): unknown => name.startsWith('.') ? load(resolve(dirname(path), `${name.replace(/\.js$/, '')}.ts`)) : createRequire(path)(name);
    new Function('require', 'module', 'exports', compiled)(require, module, module.exports);
    return module.exports;
  }
  return load(root) as typeof S;
}

describe('C6 prototype independent planner/native transport conformance', () => {
  it('compares every state coordinate, support diagnostic, component and source permutation', () => {
    expect(fixtures).toHaveLength(25);
    let comparisons = 0, moving = 0, damaged = 0;
    for (let index = 0; index < fixtures.length; index += 1) {
      const fixture = fixtures[index], model = models[index];
      let state = stateOf(fixture);
      const materialCounts = [...state.grid].map(cell => cell & 255).sort((a, b) => a - b);
      const energy = [...state.energyQ].reduce((sum, value) => sum + BigInt(value), 0n);
      for (const [tick, expected] of fixture.steps.entries()) {
        const plan = S.planStructure(state, fixture.width, fixture.height, model);
        for (const name of ['sources', 'loads', 'capacities', 'reactions', 'distances', 'components', 'supportedWeight'] as const) {
          expect(plan[name], `${fixture.name} step ${tick}: ${name}`).toEqual(expected[name]);
        }
        expect(plan.structure, fixture.name).toEqual(expected.structure);
        const next = plan.apply(state, fixture.width, fixture.height);
        expect(next, fixture.name).toEqual(stateOf(expected));
        expect(S.validateStructure(next, fixture.width, fixture.height, model)).toEqual(next);
        expect([...next.grid].map(cell => cell & 255).sort((a, b) => a - b)).toEqual(materialCounts);
        expect([...next.energyQ].reduce((sum, value) => sum + BigInt(value), 0n)).toBe(energy);
        expect([...plan.sources].sort((a, b) => a - b)).toEqual(Array.from({ length: state.grid.length }, (_, i) => i));
        moving += plan.components.filter(component => component.moving).length;
        damaged += plan.sources.filter((source, destination) => (plan.structure[destination] & 255) < (state.structure[source] & 255)).length;
        state = next;
        comparisons += 1;
      }
    }
    expect(comparisons).toBe(101);
    expect(moving).toBeGreaterThan(0);
    expect(damaged).toBeGreaterThan(0);
    console.info(`C6 prototype: ${fixtures.length} scenes, ${comparisons} complete planner/native GPU comparisons; movement and damage observed.`);
  });

  it('requires positive span support, exact reactions, shape retention, fracture and full-temperature softening', () => {
    const fixture = (name: string) => fixtures.find(value => value.name === name)!;
    const span = fixture('supported-span');
    expect(span.steps.every(step => step.sources.every((source, i) => source === i))).toBe(true);
    const floating = fixture('floating-plate');
    const metal = floating.cells.flatMap((cell, i) => (cell & 255) === 5 ? [i] : []);
    for (const i of metal) expect(floating.steps[0].sources[i + floating.width]).toBe(i);
    const weak = fixture('cantilever-fatigue');
    expect(weak.steps[0].structure[9] & 255).toBe(192);
    expect(weak.steps.some(step => (step.structure[9] & 255) === 0 && step.components.some(component => component.moving))).toBe(true);
    const split = fixture('exact-odd-load-split').steps[0];
    expect(split.reactions[3]).toBe(2);
    expect(split.reactions[5]).toBe(1);
    expect(split.supportedWeight).toBe(3);
    expect(fixture('shared-load-junction').steps[0].reactions[4]).toBe(12);
    expect(Math.max(...fixture('long-load-path').steps[0].distances)).toBeGreaterThan(250);
    const hot = fixture('high-id-hot-softening').steps[0], warm = fixture('high-id-warm-capacity').steps[0];
    expect(Math.max(...hot.capacities)).toBe(0);
    expect(Math.max(...warm.capacities)).toBeGreaterThan(0);
    expect(fixture('interlocking-free').steps[0].components.every(component => component.moving)).toBe(true);
    expect(fixture('interlocking-pinned').steps[0].components.every(component => !component.moving)).toBe(true);
  });

  it('repeats and continues from serialized complete prototype state exactly', () => {
    for (let i = 0; i < fixtures.length; i += 1) {
      const fixture = fixtures[i], model = models[i];
      let state = stateOf(fixture), resumed = stateOf(fixture);
      for (let step = 0; step < fixture.steps.length; step += 1) {
        const a = S.planStructure(state, fixture.width, fixture.height, model), b = S.planStructure(resumed, fixture.width, fixture.height, model);
        expect(a.sources).toEqual(b.sources);
        state = a.apply(state, fixture.width, fixture.height);
        resumed = b.apply(resumed, fixture.width, fixture.height);
        if (step === 1) resumed = stateOf(JSON.parse(JSON.stringify({ cells: [...resumed.grid], energyQ: [...resumed.energyQ], structure: [...resumed.structure] })));
        expect(resumed).toEqual(state);
      }
    }
  });

  it('rejects stale full state and same-length geometry changes; plan views cannot mutate the result', () => {
    const i = fixtures.findIndex(value => value.name === 'high-id-warm-capacity'), fixture = fixtures[i];
    const state = stateOf(fixture), plan = S.planStructure(state, 5, 3, models[i]);
    expect(() => plan.apply(state, 3, 5)).toThrow(/dimensions changed/);
    for (const name of ['grid', 'energyQ', 'structure'] as const) {
      const changed = stateOf(fixture);
      changed[name][6] ^= 1;
      expect(() => plan.apply(changed, 5, 3)).toThrow(/input changed/);
    }
    for (const name of ['sources', 'structure', 'loads', 'capacities', 'reactions', 'distances'] as const) {
      expect(() => { (plan[name] as number[])[0] = 123; }).toThrow(TypeError);
    }
    expect(() => { (plan.components[0].cells as number[])[0] = 123; }).toThrow(TypeError);
    const output = plan.apply(state, 5, 3);
    output.grid.fill(0); output.energyQ.fill(0); output.structure.fill(0);
    expect(plan.apply(state, 5, 3)).toEqual(stateOf(fixture.steps[0]));
  });

  it('validates coefficients and structural words before typed-array coercion', async () => {
    const fixture = fixtures[0], registry = await createMaterialRegistry(fixture.catalog);
    const rows = structuredClone(fixture.materials);
    const rules = new S.StructuralRules(rows, registry);
    rows[1].cohesion = 0;
    expect(rules.material(1).cohesion).toBe(255);
    expect(() => { (rules.material(1) as S.StructuralMaterial).cohesion = 0; }).toThrow(TypeError);
    for (const bad of [NaN, Infinity, -1, 256, 0.5, true]) {
      const records = structuredClone(fixture.materials);
      records[1].cohesion = bad as number;
      expect(() => new S.StructuralRules(records, registry)).toThrow();
    }
    expect(() => new S.StructuralRules(rows.slice(1), registry)).toThrow(/same material IDs/);
    const state = stateOf(fixture);
    for (const [index, word] of [[0, 255], [0, S.FRESH], [0, 0xffffffff], [19, 255]]) {
      const bad = stateOf(fixture); bad.structure[index] = word;
      expect(() => S.planStructure(bad, fixture.width, fixture.height, rules)).toThrow();
    }
    expect(() => S.seedStructure(state.grid, fixture.width, fixture.height, rules, [0])).toThrow(/Only cohesive/);
    expect([...S.seedStructure(state.grid, fixture.width, fixture.height, rules)]).toEqual(fixture.structure);
  });

  it('only explicit fresh requests create new reciprocal bonds', () => {
    const i = fixtures.findIndex(value => value.name === 'contact-without-welding'), fixture = fixtures[i], state = stateOf(fixture);
    expect(S.normalizeBonds(state.grid, state.structure, 3, 5, models[i])).toEqual(state.structure);
    state.structure[4] |= S.FRESH;
    const welded = S.normalizeBonds(state.grid, state.structure, 3, 5, models[i]);
    expect(welded[4] & S.BOND_BITS[3]).toBe(S.BOND_BITS[3]);
    expect(welded[7] & S.BOND_BITS[2]).toBe(S.BOND_BITS[2]);
    expect(welded.some(word => (word & S.FRESH) !== 0)).toBe(false);
  });

  it('executes negative controls for no motion, lost energy, automatic welding and missing load remainder', () => {
    const i = fixtures.findIndex(value => value.name === 'floating-plate'), fixture = fixtures[i], state = stateOf(fixture);
    const noop = loadMutant('moving[index] = 1;', 'moving[index] = 0;');
    expect(noop.planStructure(state, fixture.width, fixture.height, models[i]).sources).not.toEqual(fixture.steps[0].sources);
    const energy = loadMutant('Uint32Array.from(sources, i => energyQ[i])', 'energyQ.slice()');
    const broken = energy.planStructure(state, fixture.width, fixture.height, models[i]).apply(state, fixture.width, fixture.height);
    expect([...broken.energyQ]).not.toEqual(fixture.steps[0].energyQ);
    const j = fixtures.findIndex(value => value.name === 'contact-without-welding'), contact = stateOf(fixtures[j]);
    const welding = loadMutant('if (reciprocal || ((structure[i] | structure[j]) & FRESH))', 'if (true)');
    expect(welding.normalizeBonds(contact.grid, contact.structure, 3, 5, models[j])).not.toEqual(contact.structure);
    const k = fixtures.findIndex(value => value.name === 'exact-odd-load-split');
    const remainder = loadMutant('share + (rank < remainder ? 1 : 0)', 'share');
    expect(() => remainder.planStructure(stateOf(fixtures[k]), 3, 3, models[k])).toThrow(/balance/);
  });

  it('executes fractional and 32-bit capacity arithmetic controls', () => {
    const i = fixtures.findIndex(value => value.name === 'high-id-warm-capacity'), fixture = fixtures[i];
    const state = stateOf(fixture);
    const before = 'Math.floor(nominal * integrity * remaining / (255 * 64 * ENERGY_SCALE))';
    const fractional = loadMutant(before, '(nominal * integrity * remaining / (255 * 64 * ENERGY_SCALE))');
    expect(fractional.planStructure(state, 5, 3, models[i]).capacities.some(value => !Number.isSafeInteger(value))).toBe(true);
    const narrow = loadMutant(before, 'Math.floor((nominal * integrity * remaining | 0) / (255 * 64 * ENERGY_SCALE))');
    expect(narrow.planStructure(state, 5, 3, models[i]).capacities).not.toEqual(fixture.steps[0].capacities);
    expect(S.planStructure(state, 5, 3, models[i]).capacities.every(Number.isSafeInteger)).toBe(true);
  });

  it('lints unrounded and narrowed structural arithmetic', async () => {
    // @ts-expect-error Standalone JavaScript checker deliberately has no build dependency.
    const { lintSource } = await import('./lint_ts.mjs');
    expect(lintSource(readFileSync('engine/structure.ts', 'utf8'), 'structure.ts')).toEqual([]);
    for (const source of ['const capacity = nominal * 255 / 64;', 'const weight = supportedWeight | 0;', 'const capacity = (nominal * 255 * 16384) >>> 0;']) {
      expect(lintSource(source, 'structure.ts').some((issue: string) => issue.startsWith('SS033'))).toBe(true);
    }
    expect(lintSource('const capacity = Math.floor(nominal * 255 / 64);', 'structure.ts')).toEqual([]);
    expect(lintSource('execFileSync(python, args);', 'conformance.test.ts').some((issue: string) => issue.startsWith('SS039'))).toBe(true);
    expect(lintSource('await execFile(python, args);', 'conformance.test.ts')).toEqual([]);
  });
});
