import { afterEach, expect, it, vi } from 'vitest';
import { STRUCTURE_WASM } from './generated/structure_solver.js';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it('bundles an integer solver without any host imports', () => {
  const module = new WebAssembly.Module(Uint8Array.from(atob(STRUCTURE_WASM), c => c.charCodeAt(0)));
  expect(WebAssembly.Module.imports(module)).toEqual([]);
  const solver = new WebAssembly.Instance(module).exports;
  expect((solver.abi_version as () => number)()).toBe(1);
});

it('preserves exact CPU physics when CSP disables Wasm compilation', async () => {
  vi.resetModules();
  vi.stubGlobal('WebAssembly', undefined);
  const { createStateSpaceField } = await import('./browser_state_space.js');
  const field = createStateSpaceField(11, 13);
  for (let x = 2; x < 9; x += 1) field.setCell(x, 1, 5);
  field.setCell(4, 8, 2);
  field.setCell(4, 7, 3);
  const start = field.packedSnapshot();
  field.step(4, { inspect: true });
  const expected = field.packedSnapshot();
  field.restore(start);
  field.step(4);
  expect(field.packedSnapshot()).toEqual(expected);
  expect(field.energyBalance().driftQ).toBe(0n);
  field.close();
});

it('validates every tick state once and keeps public tick inputs checked', async () => {
  vi.resetModules();
  const calls: string[] = [];
  vi.doMock('./structure_compiled.js', async importOriginal => {
    const real = await importOriginal<typeof import('./structure_compiled.js')>();
    return {
      ...real,
      compiledStructuralPlan: (...args: Parameters<typeof real.compiledStructuralPlan>) => {
        calls.push(args[4] ? 'plan:committed' : 'plan:validated');
        return real.compiledStructuralPlan(...args);
      },
      validateCompiledStructure: (...args: Parameters<typeof real.validateCompiledStructure>) => {
        calls.push('commit');
        return real.validateCompiledStructure(...args);
      },
    };
  });
  const { createStateSpaceField, MAT } = await import('./browser_state_space.js');
  const { runCpuTick } = await import('./cpu_physics.js');
  const { FRESH } = await import('./structure.js');
  const field = createStateSpaceField(9, 7);
  for (let x = 1; x < 8; x += 1) field.setCell(x, 2, MAT.METAL);
  field.setCell(4, 5, MAT.WATER);
  field.setCell(3, 0, MAT.SAND);
  const start = field.snapshot();
  field.step(3);
  // Tick 0 starts from the committed state; ticks 1-2 validate the previous
  // tick's output in their plan; the final output is validated at commit.
  expect(calls).toEqual(['plan:committed', 'plan:validated', 'plan:validated', 'commit']);

  // The skipped validation never changes results: public calls validate every input.
  let state = { grid: start.grid, energyQ: start.energyQ, structure: start.structure };
  for (let tick = 0; tick < 3; tick += 1) state = runCpuTick(state, 9, 7, field.registry.coldTable(), tick, undefined, field.registry);
  const finished = field.snapshot();
  expect([...finished.grid]).toEqual([...state.grid]);
  expect([...finished.energyQ]).toEqual([...state.energyQ]);
  expect([...finished.structure]).toEqual([...state.structure]);
  const invalid = { ...start, structure: start.structure.map((word, index) => index === 13 ? word | FRESH : word) };
  expect(() => runCpuTick(invalid, 9, 7, field.registry.coldTable(), 0, undefined, field.registry)).toThrow();
  field.close();
  vi.doUnmock('./structure_compiled.js');
});

it('keeps the private cold rows an exact copy of the registry table', async () => {
  const { solverTables } = await import('./structure_compiled.js');
  const { DEFAULT_REGISTRY } = await import('./registry.js');
  const C = await import('./generated/materials.js');
  const table = solverTables(DEFAULT_REGISTRY), cold = DEFAULT_REGISTRY.coldTable();
  // No physical column carries a second meaning, including conductivity.
  expect([...table.subarray(0, cold.length)]).toEqual([...cold]);
  const thermal = table.subarray(256 * C.COLD_STRIDE);
  for (let id = 0; id < 256; id += 1) expect(thermal[id * 12]).toBe(DEFAULT_REGISTRY.materialIds.includes(id) ? 1 : 0);
});
