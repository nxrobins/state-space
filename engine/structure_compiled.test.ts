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
