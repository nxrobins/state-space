import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { pythonInterpreter } from './test-support/python-interpreter.mjs';
import { createMaterialRegistry } from './registry.js';
import * as S from './structure.js';
import { STRUCTURE_MUTANTS as M } from './test-support/structure-mutants.js';
import { loadMutant, stateOf, type Fixture } from './test-support/structure-fixtures.js';

// The same corpus as the native fixture, planned by the bulk Python planner alone:
// the executed source mutants below need no adapter, so they run under `npm test`.
let fixtures: Fixture[], models: S.StructuralRules[];

beforeAll(async () => {
  const python = pythonInterpreter();
  const { stdout } = await promisify(execFile)(python, ['-m', 'tests.structure_cpu_cases'], {
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 20 * 1024 * 1024,
  });
  fixtures = JSON.parse(stdout);
  models = await Promise.all(
    fixtures.map(
      async (fixture) =>
        new S.StructuralRules(fixture.materials, await createMaterialRegistry(fixture.catalog)),
    ),
  );
}, 60_000);

describe('C6 prototype executed source mutants and structural lint (CPU)', () => {
  it('executes negative controls for no motion, lost energy, automatic welding and missing load remainder', () => {
    const i = fixtures.findIndex((value) => value.name === 'floating-plate'),
      fixture = fixtures[i],
      state = stateOf(fixture);
    const noop = loadMutant(M.noMotion);
    expect(noop.planStructure(state, fixture.width, fixture.height, models[i]).sources).not.toEqual(
      fixture.steps[0].sources,
    );
    const energy = loadMutant(M.lostEnergy);
    const broken = energy
      .planStructure(state, fixture.width, fixture.height, models[i])
      .apply(state, fixture.width, fixture.height);
    expect([...broken.energyQ]).not.toEqual(fixture.steps[0].energyQ);
    const j = fixtures.findIndex((value) => value.name === 'contact-without-welding'),
      contact = stateOf(fixtures[j]);
    const welding = loadMutant(M.automaticWelding);
    expect(welding.normalizeBonds(contact.grid, contact.structure, 3, 5, models[j])).not.toEqual(
      contact.structure,
    );
    const k = fixtures.findIndex((value) => value.name === 'exact-odd-load-split');
    const remainder = loadMutant(M.missingLoadRemainder);
    expect(() => remainder.planStructure(stateOf(fixtures[k]), 3, 3, models[k])).toThrow(/balance/);
  });

  it('executes fractional and 32-bit capacity arithmetic controls', () => {
    const i = fixtures.findIndex((value) => value.name === 'high-id-warm-capacity'),
      fixture = fixtures[i];
    const state = stateOf(fixture);
    const fractional = loadMutant(M.fractionalCapacity);
    expect(
      fractional
        .planStructure(state, 5, 3, models[i])
        .capacities.some((value) => !Number.isSafeInteger(value)),
    ).toBe(true);
    const narrow = loadMutant(M.narrowCapacity);
    expect(narrow.planStructure(state, 5, 3, models[i]).capacities).not.toEqual(
      fixture.steps[0].capacities,
    );
    expect(S.planStructure(state, 5, 3, models[i]).capacities.every(Number.isSafeInteger)).toBe(
      true,
    );
  });

  it('lints unrounded and narrowed structural arithmetic', async () => {
    // @ts-expect-error Standalone JavaScript checker deliberately has no build dependency.
    const { lintSource } = await import('./lint_ts.mjs');
    expect(lintSource(readFileSync('engine/structure.ts', 'utf8'), 'structure.ts')).toEqual([]);
    for (const source of [
      'const capacity = nominal * 255 / 64;',
      'const weight = supportedWeight | 0;',
      'const capacity = (nominal * 255 * 16384) >>> 0;',
    ]) {
      expect(
        lintSource(source, 'structure.ts').some((issue: string) => issue.startsWith('SS033')),
      ).toBe(true);
    }
    expect(lintSource('const capacity = Math.floor(nominal * 255 / 64);', 'structure.ts')).toEqual(
      [],
    );
    expect(
      lintSource('execFileSync(python, args);', 'conformance.test.ts').some((issue: string) =>
        issue.startsWith('SS039'),
      ),
    ).toBe(true);
    expect(lintSource('await execFile(python, args);', 'conformance.test.ts')).toEqual([]);
  });
});
