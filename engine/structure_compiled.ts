/** Exact compiled global transport. Diagnostic planners remain independent. */
import { STRUCTURE_WASM } from './generated/structure_solver.js';
import * as C from './generated/materials.js';
import { planStructure, rulesForRegistry, validateStructure, type StructuralState, type StructuralStateInput } from './structure.js';
import { requireRegistry, type MaterialRegistry } from './registry.js';
import { validateDimensions, validatePackedCells } from './validation.js';

interface SolverExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  __heap_base: WebAssembly.Global;
  abi_version(): number;
  solve(width: number, height: number, base: number): number;
  validate(width: number, height: number, base: number): number;
}
const TABLE_WORDS = 256 * (24 + 12), FIELD_COUNT = 15;
let solver: SolverExports | undefined;
let unavailable = false;
const tables = new WeakMap<MaterialRegistry, Uint32Array>();

/** Private solver rows: an exact cold-table copy, then derived thermal rows. */
export function solverTables(registry: MaterialRegistry): Uint32Array {
  let table = tables.get(registry);
  if (table) return table;
  table = new Uint32Array(TABLE_WORDS);
  table.set(registry.coldTable());
  for (const id of registry.materialIds) {
    const offset = id * C.COLD_STRIDE, target = 256 * C.COLD_STRIDE + id * 12;
    // Thermal slot 0 is a private presence marker; the cold rows stay an exact
    // copy of the registry table, so no physical property has a second meaning.
    table[target] = 1;
    table[target + 1] = table[offset + C.COLD_PHASE_ENERGY] * 256;
    table[target + 2] = table[offset + C.COLD_FUEL_ENERGY] * 256;
    const boil = table[offset + C.COLD_BOILS_INTO], freeze = table[offset + C.COLD_FREEZES_INTO];
    table[target + 3] = (boil || table[offset + C.COLD_MELTS_INTO]) || 256;
    table[target + 4] = table[offset + (boil ? C.COLD_BOIL_POINT : C.COLD_MELT_POINT)] * 256;
    table[target + 5] = (freeze || table[offset + C.COLD_CONDENSES_INTO]) || 256;
    table[target + 6] = table[offset + (freeze ? C.COLD_FREEZE_POINT : C.COLD_CONDENSE_POINT)] * 256;
  }
  tables.set(registry, table);
  return table;
}

function getSolver(): SolverExports | undefined {
  if (!solver && !unavailable) {
    try {
      const bytes = Uint8Array.from(atob(STRUCTURE_WASM), char => char.charCodeAt(0));
      const module = new WebAssembly.Module(bytes);
      if (WebAssembly.Module.imports(module).length) throw new Error('Structural solver must have no host imports.');
      solver = new WebAssembly.Instance(module).exports as SolverExports;
    } catch {
      // CSP can disable Wasm compilation. Preserve exact physics through the
      // independent planner; callers still receive isolated complete state.
      unavailable = true;
    }
  }
  if (solver && solver.abi_version() !== 1) throw new Error('Unsupported structural solver ABI.');
  return solver;
}

function validatedWorkspace(input: StructuralStateInput, width: number, height: number, registry: MaterialRegistry): {
  state: StructuralState; engine?: SolverExports; storage?: Uint32Array;
} {
  const count = validateDimensions(width, height);
  requireRegistry(registry);
  const engine = getSolver();
  if (!engine) return { state: validateStructure(input, width, height, rulesForRegistry(registry)) };
  const state = { grid: validatePackedCells(input.grid, count), energyQ: validatePackedCells(input.energyQ, count), structure: validatePackedCells(input.structure, count) };
  const base = Number(engine.__heap_base.value);
  const needed = base + (TABLE_WORDS + FIELD_COUNT * count) * 4;
  if (needed > 0xffffffff) throw new Error('World exceeds compiled planner linear memory limit.');
  if (engine.memory.buffer.byteLength < needed) engine.memory.grow(Math.ceil((needed - engine.memory.buffer.byteLength) / 65536));
  const storage = new Uint32Array(engine.memory.buffer, base, TABLE_WORDS + FIELD_COUNT * count);
  storage.set(solverTables(registry));
  storage.set(state.grid, TABLE_WORDS); storage.set(state.energyQ, TABLE_WORDS + count); storage.set(state.structure, TABLE_WORDS + count * 2);
  if (engine.validate(width, height, base)) {
    validateStructure(state, width, height, rulesForRegistry(registry));
    throw new Error('Compiled complete-state validator disagrees with the reference.');
  }
  return { state, engine, storage };
}

/** Copies and checks every coordinate before committing state or planning. */
export function validateCompiledStructure(input: StructuralStateInput, width: number, height: number, registry: MaterialRegistry): StructuralState {
  return validatedWorkspace(input, width, height, registry).state;
}

/** Takes ownership through validation, then returns independent output storage. */
export function compiledStructuralPlan(input: StructuralState, width: number, height: number, registry: MaterialRegistry): {
  sources: Uint32Array; structure: Uint32Array; apply(): StructuralState;
} {
  const { state, engine, storage } = validatedWorkspace(input, width, height, registry);
  if (!engine || !storage) {
    const plan = planStructure(state, width, height, rulesForRegistry(registry));
    return { sources: Uint32Array.from(plan.sources), structure: Uint32Array.from(plan.structure), apply: () => plan.apply(state, width, height) };
  }
  const count = width * height;
  const status = engine.solve(width, height, Number(engine.__heap_base.value));
  if (status) throw new Error(`Global structural solver invariant failed: ${status}`);
  const sources = storage.slice(TABLE_WORDS + count * 3, TABLE_WORDS + count * 4);
  const structure = storage.slice(TABLE_WORDS + count * 4, TABLE_WORDS + count * 5);
  return { sources, structure, apply() {
    return { grid: Uint32Array.from(sources, i => state.grid[i]), energyQ: Uint32Array.from(sources, i => state.energyQ[i]), structure: structure.slice() };
  } };
}
