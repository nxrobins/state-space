/** Profile-aware, resumable whole-block support and one-cell fragment settlement.
 * This is a separate mechanical operation, not an evolution tick or M5 replay.
 */
import { COLD_STRIDE, COLD_COHESION, COLD_DENSITY, COLD_SOFTENING, PHASE_SHIFT, PHASE } from '../generated/materials.js';
import { temperatureQ, ENERGY_SCALE } from '../thermal.js';
import { INTEGRITY_3D, BONDS_3D, ANCHOR_3D, structuralNeighbor } from './structural-mechanics.js';
import { readReactiveMaterialBlock3D, type ReactiveMaterialBlock3D } from './reactive-block.js';
import { reactiveInteger3D, reactiveRegistrySource3D, type ReactiveMaterialRegistry3D } from './reactive-registry.js';

export const REACTIVE_STRUCTURE_RULES_3D = 'reactive-structure-1';
export const REACTIVE_STRUCTURE_MAX_WORK_3D = 256;
export type ReactiveStructureStage3D = 'ready' | 'roots' | 'reach' | 'weights' | 'loads' | 'damage' | 'edges' |
  'components' | 'dependencies' | 'blocked' | 'moving' | 'permutation' | 'publish' | 'report' | 'complete';
export type ReactiveStructureReport3D = {
  rulesVersion: typeof REACTIVE_STRUCTURE_RULES_3D; materialCatalogHash: string;
  /** All arrays index the input, before damage and motion, except changedCells. */
  distances: number[]; loads: number[]; capacities: number[]; reactions: number[];
  /** Post-damage bonded components, canonical minimum input index; -1 if inactive. */
  componentIds: number[]; movingCells: number[]; brokenCells: number[]; supportedWeight: number;
  moves: {from: number; to: number}[]; changedCells: number[];
  energy: {beforeQ: string; afterQ: string; externalQ: '0'; driftQ: '0'};
};
export type ReactiveStructureResult3D = {block: ReactiveMaterialBlock3D; report: ReactiveStructureReport3D};
export type ReactiveStructureProgress3D = {status: 'running' | 'complete' | 'cancelled'; stage: ReactiveStructureStage3D;
  completedWork: number; lastAdvanceWork: number; maxTotalWork: number};
export interface ReactiveStructureJob3D {
  progress(): ReactiveStructureProgress3D;
  advance(maxWork?: number): ReactiveStructureProgress3D;
  cancel(): boolean;
  result(): ReactiveStructureResult3D;
}

/** Each yield visits at most one vertex and six neighbors, or one dependency edge.
 * Allocations and public input validation/copying are O(cells), outside this budget.
 */
function solve(input: ReactiveMaterialBlock3D, cold: Uint32Array): Generator<ReactiveStructureStage3D, ReactiveStructureResult3D, void> {
  const {packedCells: grid, energyQ, structure} = input, n = grid.length;
  const neighbor = (i: number, dir: number) => structuralNeighbor(i, dir, input);
  const density = (i: number) => cold[(grid[i] & 255) * COLD_STRIDE + COLD_DENSITY];
  const active = (i: number, words: ArrayLike<number> = structure) => i >= 0 && (words[i] & INTEGRITY_3D) !== 0;
  const obstructed = (i: number, j: number) => {
    const phase = grid[j] >>> PHASE_SHIFT & 15;
    const fixed = (phase === PHASE.SOLID || phase === PHASE.FROZEN) && cold[(grid[j] & 255) * COLD_STRIDE + COLD_COHESION] === 0;
    return fixed || (structure[j] & ANCHOR_3D) !== 0 || density(i) <= density(j);
  };
  const distances = new Int32Array(n).fill(-1), loads = new Uint32Array(n), reactions = new Uint32Array(n);
  const capacities = new Uint32Array(n), damaged = new Uint32Array(n), edges = new Uint32Array(n);
  const ids = new Int32Array(n).fill(-1), blocked = new Uint8Array(n), moving = new Uint8Array(n);
  const queue = new Uint32Array(n), sources = new Uint32Array(n), destinations = new Uint32Array(n), visited = new Uint8Array(n);
  const dependents: number[][] = [], brokenCells: number[] = [], movingCells: number[] = [];
  let length = 0, supportedWeight = 0, reactionTotal = 0;
  const block = {...input, packedCells: new Array<number>(n), energyQ: new Array<number>(n), structure: new Array<number>(n)};
  let beforeQ = 0n, afterQ = 0n;
  const report: ReactiveStructureReport3D = {rulesVersion: REACTIVE_STRUCTURE_RULES_3D, materialCatalogHash: input.materialCatalogHash,
    distances: [], loads: [], capacities: [], reactions: [], componentIds: [], movingCells, brokenCells, supportedWeight,
    moves: [], changedCells: [], energy: {beforeQ: '', afterQ: '', externalQ: '0', driftQ: '0'}};
  function* run(): Generator<ReactiveStructureStage3D, ReactiveStructureResult3D, void> {
    for (let i = 0; i < n; i++) {
      if (active(i)) {
        const below = neighbor(i, 3);
        if ((structure[i] & ANCHOR_3D) || below < 0 || (!active(below) && obstructed(i, below))) {distances[i] = 0; queue[length++] = i;}
      }
      yield 'roots';
    }
    for (let head = 0; head < length; head++) {
      const i = queue[head];
      for (let dir = 0; dir < 6; dir++) {
        const j = neighbor(i, dir);
        if (active(j) && distances[j] < 0 && ((structure[i] & BONDS_3D[dir]) || dir === 2)) {distances[j] = distances[i] + 1; queue[length++] = j;}
      }
      yield 'reach';
    }
    for (let k = 0; k < length; k++) {const i = queue[k]; loads[i] = Math.max(1, Math.ceil(density(i) / 64)); supportedWeight += loads[i]; yield 'weights';}
    for (let k = length - 1; k >= 0; k--) {
      const i = queue[k];
      if (distances[i] === 0) {reactions[i] = loads[i]; reactionTotal += loads[i];}
      else {
        const supports: number[] = [];
        for (let dir = 0; dir < 6; dir++) {
          const j = neighbor(i, dir);
          if (active(j) && distances[j] === distances[i] - 1 && ((structure[i] & BONDS_3D[dir]) || dir === 3)) supports.push(j);
        }
        supports.sort((a, b) => a - b);
        if (!supports.length) throw Error('Incomplete reactive support graph.');
        const share = Math.floor(loads[i] / supports.length), remainder = loads[i] % supports.length;
        for (let r = 0; r < supports.length; r++) loads[supports[r]] += share + (r < remainder ? 1 : 0);
      }
      yield 'loads';
    }
    if (reactionTotal !== supportedWeight) throw Error('Reactive support reactions do not balance.');
    for (let i = 0; i < n; i++) {
      damaged[i] = structure[i];
      if (active(i)) {
        const at = (grid[i] & 255) * COLD_STRIDE, integrity = structure[i] & INTEGRITY_3D;
        const nominal = cold[at + COLD_COHESION] * 16, softening = cold[at + COLD_SOFTENING];
        const remaining = softening ? Math.max(0, Math.min(64 * ENERGY_SCALE, (softening + 64) * ENERGY_SCALE - temperatureQ(grid[i], energyQ[i], cold))) : 64 * ENERGY_SCALE;
        const capacity = Math.floor(Math.floor(nominal * integrity / 255) * remaining / (64 * ENERGY_SCALE));
        capacities[i] = capacity;
        const loss = capacity === 0 ? integrity : loads[i] > capacity ? Math.min(integrity, Math.max(1, Math.floor((loads[i] - capacity) * 255 / nominal))) : 0;
        damaged[i] = (structure[i] & ~INTEGRITY_3D) | (integrity - loss);
        if (loss === integrity) brokenCells.push(i);
      }
      yield 'damage';
    }
    // Prune only. Fresh placement never implicitly welds adjacent cells here.
    for (let i = 0; i < n; i++) {
      edges[i] = damaged[i] & (INTEGRITY_3D | ANCHOR_3D);
      if (active(i, damaged)) for (let dir = 0; dir < 6; dir++) {
        const j = neighbor(i, dir);
        if (active(j, damaged) && (damaged[i] & BONDS_3D[dir]) && (damaged[j] & BONDS_3D[dir ^ 1])) edges[i] |= BONDS_3D[dir];
      }
      yield 'edges';
    }
    for (let root = 0; root < n; root++) {
      if (active(root, edges) && ids[root] < 0) {
        ids[root] = root; length = 1; queue[0] = root;
        for (let head = 0; head < length; head++) {
          const i = queue[head];
          for (let dir = 0; dir < 6; dir++) if (edges[i] & BONDS_3D[dir]) {
            const j = neighbor(i, dir);
            if (j < 0 || !active(j, edges)) throw Error('Invalid reactive component adjacency.');
            if (ids[j] < 0) {ids[j] = root; queue[length++] = j;}
          }
          yield 'components';
        }
      }
      yield 'components';
    }
    for (let i = 0; i < n; i++) {
      const root = ids[i];
      if (root >= 0) {
        const below = neighbor(i, 3);
        if ((edges[i] & ANCHOR_3D) || below < 0 || (!active(below, edges) && obstructed(i, below))) blocked[root] = 1;
        else if (ids[below] >= 0 && ids[below] !== root) (dependents[ids[below]] ??= []).push(root);
      }
      yield 'dependencies';
    }
    length = 0;
    for (let i = 0; i < n; i++) {if (blocked[i]) queue[length++] = i; yield 'blocked';}
    for (let head = 0; head < length; head++) {
      for (const above of dependents[queue[head]] ?? []) {
        if (!blocked[above]) {blocked[above] = 1; queue[length++] = above;}
        yield 'blocked';
      }
      yield 'blocked';
    }
    for (let i = 0; i < n; i++) {if (ids[i] >= 0 && !blocked[ids[i]]) {moving[i] = 1; movingCells.push(i);} sources[i] = i; yield 'moving';}
    for (let z = 0; z < input.depth; z++) for (let x = 0; x < input.width; x++) {
      let top = -1;
      for (let y = 0; y < input.height; y++) {
        const i = x + input.width * (y + input.height * z);
        if (moving[i]) {
          if (y + 1 === input.height) throw Error('Reactive fragment crossed the floor.');
          if (top < 0) top = i; sources[i + input.width] = i;
        } else if (top >= 0) {sources[top] = i; top = -1;}
        yield 'permutation';
      }
    }
    for (let i = 0; i < n; i++) {
      const source = sources[i];
      if (visited[source]) throw Error('Reactive fragment motion is not a permutation.');
      visited[source] = 1; destinations[source] = i;
      block.packedCells[i] = grid[source]; block.energyQ[i] = energyQ[source]; block.structure[i] = edges[source];
      beforeQ += BigInt(energyQ[i]); afterQ += BigInt(block.energyQ[i]);
      report.distances.push(distances[i]); report.loads.push(loads[i]); report.capacities.push(capacities[i]);
      report.reactions.push(reactions[i]); report.componentIds.push(ids[i]);
      if (block.packedCells[i] !== grid[i] || block.energyQ[i] !== energyQ[i] || block.structure[i] !== structure[i]) report.changedCells.push(i);
      yield 'publish';
    }
    for (let i = 0; i < n; i++) {if (destinations[i] !== i) report.moves.push({from: i, to: destinations[i]}); yield 'report';}
    if (beforeQ !== afterQ) throw Error('Reactive structure lost conserved energy.');
    report.supportedWeight = supportedWeight;
    report.energy.beforeQ = beforeQ.toString(); report.energy.afterQ = afterQ.toString();
    return {block, report};
  }
  return run();
}

export function createReactiveStructureJob3D(registry: ReactiveMaterialRegistry3D, raw: ReactiveMaterialBlock3D): ReactiveStructureJob3D {
  const input = readReactiveMaterialBlock3D(registry, raw), maxTotalWork = 20 * input.packedCells.length + 16;
  let iterator: ReturnType<typeof solve> | null = solve(input, reactiveRegistrySource3D(registry).cold);
  let status: ReactiveStructureProgress3D['status'] = 'running', stage: ReactiveStructureStage3D = 'ready';
  let completedWork = 0, lastAdvanceWork = 0, result: ReactiveStructureResult3D | null = null;
  const progress = (): ReactiveStructureProgress3D => ({status, stage, completedWork, lastAdvanceWork, maxTotalWork});
  const cancel = () => {if (status !== 'running') return false; iterator?.return(undefined as never); iterator = null; status = 'cancelled'; return true;};
  return Object.freeze({progress, cancel,
    advance(maxWork: number = 64) {
      reactiveInteger3D(maxWork, 1, REACTIVE_STRUCTURE_MAX_WORK_3D);
      if (status !== 'running' || !iterator) throw Error('Reactive structure job is no longer running.');
      lastAdvanceWork = 0;
      try {
        while (lastAdvanceWork < maxWork) {
          const next = iterator.next(); completedWork++; lastAdvanceWork++;
          if (completedWork > maxTotalWork) throw Error('Reactive structure work bound exceeded.');
          if (next.done) {result = next.value; iterator = null; status = 'complete'; stage = 'complete'; break;}
          stage = next.value;
        }
      } catch (error) {cancel(); throw error;}
      return progress();
    },
    result() {if (status !== 'complete' || !result) throw Error('Reactive structure result is not complete.'); return structuredClone(result);},
  });
}
