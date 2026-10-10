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
