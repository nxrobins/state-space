/** Independent global support solver and persistent ca-v3 fragment state.
 * See docs/STRUCTURES.md for the approximation and diagnostic coordinates.
 */
import { PHASE_SOLID, PHASE_FROZEN, STRUCTURE_INTEGRITY_MASK, STRUCTURE_BOND_LEFT_MASK, STRUCTURE_BOND_RIGHT_MASK,
  STRUCTURE_BOND_UP_MASK, STRUCTURE_BOND_DOWN_MASK, STRUCTURE_ANCHOR_MASK, STRUCTURE_FRESH_MASK,
  STRUCTURE_COMPLETE_MASK, STRUCTURE_INTERNAL_MASK } from './generated/materials.js';
import { requireRegistry, type MaterialRegistry } from './registry.js';
import { ENERGY_SCALE, temperatureQ, validateEnergyState, seedState, type PhysicsState } from './thermal.js';
import { checkedInteger, validateDimensions, validatePackedCells } from './validation.js';

export const INTEGRITY_MASK = STRUCTURE_INTEGRITY_MASK;
export const BOND_BITS = Object.freeze([STRUCTURE_BOND_LEFT_MASK, STRUCTURE_BOND_RIGHT_MASK, STRUCTURE_BOND_UP_MASK, STRUCTURE_BOND_DOWN_MASK]);
export const ANCHOR = STRUCTURE_ANCHOR_MASK;
export const FRESH = STRUCTURE_FRESH_MASK;
const COMPLETE_MASK = STRUCTURE_COMPLETE_MASK, INTERNAL_MASK = STRUCTURE_INTERNAL_MASK;
const OPPOSITE = [1, 0, 3, 2];

export interface StructuralMaterial { id: number; density: number; cohesion: number; softening: number }
export interface StructuralState extends PhysicsState { structure: Uint32Array }
export interface StructuralStateInput { grid: ArrayLike<number>; energyQ: ArrayLike<number>; structure: ArrayLike<number> }

const registryRules = new WeakMap<MaterialRegistry, StructuralRules>();
export function rulesForRegistry(registry: MaterialRegistry): StructuralRules {
  requireRegistry(registry);
  let rules = registryRules.get(registry);
  if (!rules) {
    rules = new StructuralRules(registry.materialIds.map(id => {
      const p = registry.material(id).properties;
      return { id, density: p.density, cohesion: p.cohesion, softening: p.softening };
    }), registry);
    registryRules.set(registry, rules);
  }
  return rules;
}

/** Explicit creation from packed heat doses, never an implicit continuation. */
export function createPhysicsState(cells: ArrayLike<number>, width: number, height: number, registry: MaterialRegistry): StructuralState {
  const state = seedState(validatePackedCells(cells, validateDimensions(width, height)), registry.coldTable(), registry);
  return { ...state, structure: seedStructure(state.grid, width, height, rulesForRegistry(registry)) };
}

/** Explicit initial creation when the complete energy coordinate is supplied. */
export function seedStructureState(state: PhysicsState, width: number, height: number, registry: MaterialRegistry): StructuralState {
  const rules = rulesForRegistry(registry), validated = rules.validate(state.grid, state.energyQ, validateDimensions(width, height));
  return { ...validated, structure: seedStructure(validated.grid, width, height, rules) };
}

export function rewrittenStructure(before: number, after: number, word: number, rules: StructuralRules): number {
  if (!rules.eligible(after)) return 0;
  return !rules.eligible(before) || (before & 255) !== (after & 255) ? INTEGRITY_MASK | FRESH : word;
}

export function cloneStructure(state: StructuralState): StructuralState {
  return { grid: state.grid.slice(), energyQ: state.energyQ.slice(), structure: state.structure.slice() };
}

export class StructuralRules {
  readonly #records: Readonly<Record<number, Readonly<StructuralMaterial>>>;
  readonly #cold: Uint32Array;
  readonly #registry: MaterialRegistry;

  constructor(materials: readonly StructuralMaterial[], registry: MaterialRegistry) {
    if (!Array.isArray(materials) || !materials.length) throw new Error('Structural rules require material records.');
    const records: Record<number, Readonly<StructuralMaterial>> = {};
    for (const row of materials) {
      if (!row || typeof row !== 'object') throw new Error('Invalid structural material.');
      for (const name of ['id', 'density', 'cohesion', 'softening'] as const) checkedInteger(row[name], 0, 255, name);
      if (Object.hasOwn(records, row.id)) throw new Error('Duplicate structural material ID.');
      if (!row.cohesion && row.softening) throw new Error('Noncohesive material cannot have a softening threshold.');
      records[row.id] = Object.freeze({ id: row.id, density: row.density, cohesion: row.cohesion, softening: row.softening });
    }
    if (registry.materialIds.length !== materials.length || registry.materialIds.some(id => !Object.hasOwn(records, id))) {
      throw new Error('Structural and thermal registries must contain the same material IDs.');
    }
    this.#records = Object.freeze(records);
    this.#cold = registry.coldTable();
    this.#registry = registry;
    Object.freeze(this);
  }

  material(voxel: number): Readonly<StructuralMaterial> {
    const row = this.#records[voxel & 255];
    if (!row) throw new Error('Undefined structural material.');
    return row;
  }

  eligible(voxel: number): boolean {
    const row = this.material(voxel), phase = (voxel >>> 24) & 15;
    return row.cohesion > 0 && (phase === PHASE_SOLID || phase === PHASE_FROZEN);
  }

  validate(cells: ArrayLike<number>, energy: ArrayLike<number>, count: number): PhysicsState {
    return validateEnergyState(cells, energy, count, this.#cold, this.#registry);
  }

  temperature(voxel: number, energy: number): number { return temperatureQ(voxel, energy, this.#cold); }
}

function neighbors(index: number, width: number, height: number): number[] {
  const x = index % width, y = Math.floor(index / width);
  return [x ? index - 1 : -1, x + 1 < width ? index + 1 : -1,
    y ? index - width : -1, y + 1 < height ? index + width : -1];
}

export function normalizeBonds(cells: ArrayLike<number>, words: ArrayLike<number>, width: number, height: number, rules: StructuralRules): Uint32Array {
  const count = validateDimensions(width, height);
  const grid = validatePackedCells(cells, count), structure = validatePackedCells(words, count);
  const output = new Uint32Array(count), active = new Uint8Array(count);
  for (let i = 0; i < count; i += 1) {
    if (structure[i] > INTERNAL_MASK) throw new Error('Reserved structural bits must be zero.');
    if (rules.eligible(grid[i])) {
      output[i] = structure[i] & (INTEGRITY_MASK | ANCHOR);
      if (structure[i] & INTEGRITY_MASK) active[i] = 1;
    }
  }
  // Visit every undirected edge once; both reciprocal flags are written together.
  for (let i = 0; i < count; i += 1) {
    if (!active[i]) continue;
    const adjacent = neighbors(i, width, height);
    for (const direction of [1, 3]) {
      const j = adjacent[direction];
      if (j < 0 || !active[j]) continue;
      const reciprocal = (structure[i] & BOND_BITS[direction]) && (structure[j] & BOND_BITS[OPPOSITE[direction]]);
      if (reciprocal || ((structure[i] | structure[j]) & FRESH)) {
        output[i] |= BOND_BITS[direction];
        output[j] |= BOND_BITS[OPPOSITE[direction]];
      }
    }
  }
  return output;
}

export function seedStructure(cells: ArrayLike<number>, width: number, height: number, rules: StructuralRules, anchors: readonly number[] = []): Uint32Array {
  const grid = validatePackedCells(cells, validateDimensions(width, height));
  const words = Uint32Array.from(grid, cell => rules.eligible(cell) ? 255 | FRESH : 0);
  for (const value of anchors) {
    const index = checkedInteger(value, 0, grid.length - 1, 'anchor index');
    if (!words[index]) throw new Error('Only cohesive solid/frozen cells can be anchored.');
    words[index] |= ANCHOR;
  }
  return normalizeBonds(grid, words, width, height, rules);
}

export function validateStructure(state: StructuralStateInput, width: number, height: number, rules: StructuralRules, completed = true): StructuralState {
  const count = validateDimensions(width, height);
  const result = rules.validate(state.grid, state.energyQ, count);
  const words = validatePackedCells(state.structure, count);
  if (words.some(word => word > (completed ? COMPLETE_MASK : INTERNAL_MASK))) throw new Error('Structural state contains reserved or pending bits.');
  if (completed) {
    const normalized = normalizeBonds(result.grid, words, width, height, rules);
    if (normalized.some((word, index) => word !== words[index])) throw new Error('Structural bonds must be reciprocal, in bounds, and between intact cohesive cells.');
  } else if (words.some((word, i) => word !== 0 && !rules.eligible(result.grid[i]))) throw new Error('Noncohesive cells cannot carry structural state.');
  return { ...result, structure: words };
}

export interface ComponentReport { readonly id: number; readonly cells: readonly number[]; readonly moving: boolean; readonly anchored: boolean }
export interface StructuralPlan {
  readonly width: number; readonly height: number;
  readonly sources: readonly number[]; readonly structure: readonly number[];
  readonly loads: readonly number[]; readonly capacities: readonly number[];
  readonly reactions: readonly number[]; readonly distances: readonly number[];
  readonly components: readonly ComponentReport[]; readonly supportedWeight: number;
  apply(state: StructuralState, width: number, height: number): StructuralState;
}

/** Integer loads fit exactly in Number: <= 4 * MAX_CELLS < 2^32.
 * Capacity products are <= 4080 * 255 * 16384 < 2^35. Never narrow to i32/u32.
 */
export function planStructure(input: StructuralState, width: number, height: number, rules: StructuralRules): StructuralPlan {
  const { grid, energyQ, structure } = validateStructure(input, width, height, rules);
  const count = grid.length;
  const active = (index: number, words: Uint32Array = structure) => (words[index] & INTEGRITY_MASK) !== 0;
  const bound = (index: number, words: Uint32Array = structure) => neighbors(index, width, height)
    .filter((neighbor, direction) => neighbor >= 0 && (words[index] & BOND_BITS[direction]) !== 0);
  const blockedByGrain = (source: number, target: number) => (structure[target] & ANCHOR) !== 0 || rules.material(grid[source]).density <= rules.material(grid[target]).density;
  const distances = Array<number>(count).fill(-1), loads = Array<number>(count).fill(0), reactions = Array<number>(count).fill(0);
  const order: number[] = [];
  for (let i = 0; i < count; i += 1) {
    if (!active(i)) continue;
    if ((structure[i] & ANCHOR) || i + width >= count || (!active(i + width) && blockedByGrain(i, i + width))) {
      distances[i] = 0;
      order.push(i);
    }
  }
  // A queue over implicit adjacency, independent of the Python graph construction.
  for (let head = 0; head < order.length; head += 1) {
    const index = order[head], followers = new Set(bound(index));
    if (index >= width && active(index - width)) followers.add(index - width);
    for (const next of [...followers].sort((a, b) => a - b)) {
      if (distances[next] !== -1) continue;
      distances[next] = distances[index] + 1;
      order.push(next);
    }
  }
  let supportedWeight = 0;
  for (const index of order) {
    loads[index] = Math.max(1, Math.ceil(rules.material(grid[index]).density / 64));
    supportedWeight += loads[index];
  }
  for (let cursor = order.length - 1; cursor >= 0; cursor -= 1) {
    const index = order[cursor];
    if (distances[index] === 0) { reactions[index] = loads[index]; continue; }
    const candidates = new Set(bound(index));
    if (index + width < count && active(index + width)) candidates.add(index + width);
    const supports = [...candidates].filter(next => distances[next] === distances[index] - 1).sort((a, b) => a - b);
    if (!supports.length) throw new Error('Supported cell has no load predecessor.');
    const share = Math.floor(loads[index] / supports.length), remainder = loads[index] % supports.length;
    for (let rank = 0; rank < supports.length; rank += 1) loads[supports[rank]] += share + (rank < remainder ? 1 : 0);
  }
  if (reactions.reduce((total, value) => total + value, 0) !== supportedWeight) throw new Error('Support reactions must balance the supported weight exactly.');

  const capacities = Array<number>(count).fill(0), damaged = structure.slice();
  for (let i = 0; i < count; i += 1) {
    if (!active(i)) continue;
    const row = rules.material(grid[i]), integrity = structure[i] & INTEGRITY_MASK, nominal = row.cohesion * 16;
    const remaining = row.softening ? Math.max(0, Math.min(64 * ENERGY_SCALE, (row.softening + 64) * ENERGY_SCALE - rules.temperature(grid[i], energyQ[i]))) : 64 * ENERGY_SCALE;
    capacities[i] = Math.floor(nominal * integrity * remaining / (255 * 64 * ENERGY_SCALE));
    const loss = capacities[i] === 0 ? integrity : loads[i] > capacities[i] ? Math.min(integrity, Math.max(1, Math.floor((loads[i] - capacities[i]) * 255 / nominal))) : 0;
    damaged[i] = (structure[i] & ~INTEGRITY_MASK) | (integrity - loss);
  }
  const repairedEdges = normalizeBonds(grid, damaged, width, height, rules);

  // Union/find constructs post-damage components; the canonical root is the
  // smallest current index. Python uses DFS, providing a distinct implementation.
  const parents = new Int32Array(count).fill(-1);
  for (let i = 0; i < count; i += 1) if (active(i, repairedEdges)) parents[i] = i;
  const rootOf = (index: number): number => {
    let root = index;
    while (parents[root] !== root) root = parents[root];
    while (parents[index] !== index) { const next = parents[index]; parents[index] = root; index = next; }
    return root;
  };
  for (let i = 0; i < count; i += 1) {
    if (parents[i] < 0) continue;
    for (const j of bound(i, repairedEdges)) {
      if (j < i) continue;
      const a = rootOf(i), b = rootOf(j);
      parents[Math.max(a, b)] = Math.min(a, b);
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < count; i += 1) {
    if (parents[i] < 0) continue;
    const root = rootOf(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(i);
  }
  const blocked = new Set<number>(), dependents = new Map<number, Set<number>>();
  for (const root of groups.keys()) dependents.set(root, new Set());
  for (const [root, members] of groups) {
    for (const i of members) {
      if ((repairedEdges[i] & ANCHOR) || i + width >= count) { blocked.add(root); continue; }
      const below = i + width;
      if (parents[below] >= 0) {
        const lower = rootOf(below);
        if (lower !== root) dependents.get(lower)!.add(root);
      } else if (blockedByGrain(i, below)) blocked.add(root);
    }
  }
  const pending = [...blocked];
  for (let head = 0; head < pending.length; head += 1) {
    for (const next of dependents.get(pending[head])!) {
      if (!blocked.has(next)) { blocked.add(next); pending.push(next); }
    }
  }
  const moving = new Uint8Array(count), components: ComponentReport[] = [];
  for (const [id, cells] of groups) {
    const falls = !blocked.has(id);
    if (falls) for (const index of cells) moving[index] = 1;
    components.push(Object.freeze({ id, cells: Object.freeze(cells), moving: falls, anchored: cells.some(i => (repairedEdges[i] & ANCHOR) !== 0) }));
  }
  const sources = Array.from({ length: count }, (_, index) => index);
  // Rotate each column run in place in the source map, including the displaced
  // bottom occupant. Adjacent distinct bodies can share a run without welding.
  for (let x = 0; x < width; x += 1) {
    let top = -1;
    for (let index = x; index < count; index += width) {
      if (moving[index]) {
        if (top < 0) top = index;
        if (index + width >= count) throw new Error('Moving structure crossed the closed floor.');
        sources[index + width] = index;
      } else if (top >= 0) { sources[top] = index; top = -1; }
    }
  }
  const visits = new Uint8Array(count);
  for (const source of sources) {
    if (visits[source]) throw new Error('Structural transport must be a bijection.');
    visits[source] = 1;
  }
  const finalWords = sources.map(source => repairedEdges[source]);
  const normalized = normalizeBonds(sources.map(source => grid[source]), finalWords, width, height, rules);
  if (normalized.some((word, index) => word !== finalWords[index])) throw new Error('Structural transport broke reciprocal bonds.');
  // Clone inputs remain inside this closure. Exposed diagnostics are frozen
  // ordinary arrays, so callers cannot mutate the plan through a typed-array view.
  return Object.freeze({ width, height, sources: Object.freeze(sources), structure: Object.freeze(finalWords),
    loads: Object.freeze(loads), capacities: Object.freeze(capacities), reactions: Object.freeze(reactions), distances: Object.freeze(distances),
    components: Object.freeze(components), supportedWeight,
    apply(state: StructuralState, actualWidth: number, actualHeight: number): StructuralState {
      validateDimensions(actualWidth, actualHeight);
      if (actualWidth !== width || actualHeight !== height) throw new Error('Structural plan dimensions changed; recompute for the current geometry.');
      const current = [state.grid, state.energyQ, state.structure].map(values => validatePackedCells(values, count));
      if ([grid, energyQ, structure].some((values, coordinate) => values.some((value, i) => value !== current[coordinate][i]))) {
        throw new Error('Structural plan input changed; recompute against the current full state.');
      }
      return { grid: Uint32Array.from(sources, i => grid[i]), energyQ: Uint32Array.from(sources, i => energyQ[i]), structure: Uint32Array.from(finalWords) };
    },
  });
}
