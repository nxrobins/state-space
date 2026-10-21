/** Profile-aware, resumable whole-block support and one-cell fragment settlement.
 * This is a separate mechanical operation, not an evolution tick or M5 replay.
 */
import {
  COLD_STRIDE,
  COLD_COHESION,
  COLD_DENSITY,
  COLD_SOFTENING,
  PHASE_SHIFT,
  PHASE,
} from '../../generated/materials.js';
import { temperatureQ, ENERGY_SCALE } from '../../thermal.js';
import { INTEGRITY_3D, BONDS_3D, ANCHOR_3D, structuralNeighbor } from '../structural-mechanics.js';
import { readReactiveMaterialBlock3D, type ReactiveMaterialBlock3D } from './reactive-block.js';
import {
  reactiveInteger3D,
  reactiveRegistrySource3D,
  cloneReactiveData3D,
  type ReactiveMaterialRegistry3D,
} from './reactive-registry.js';

export const REACTIVE_STRUCTURE_RULES_3D = 'reactive-structure-1';
export const REACTIVE_STRUCTURE_MAX_WORK_3D = 256;
export type ReactiveStructureStage3D =
  | 'ready'
  | 'roots'
  | 'reach'
  | 'weights'
  | 'loads'
  | 'damage'
  | 'edges'
  | 'components'
  | 'dependencies'
  | 'blocked'
  | 'moving'
  | 'permutation'
  | 'publish'
  | 'report'
  | 'complete';
export type ReactiveStructureReport3D = {
  rulesVersion: typeof REACTIVE_STRUCTURE_RULES_3D;
  materialCatalogHash: string;
  /** All arrays index the input, before damage and motion, except changedCells. */
  distances: number[];
  loads: number[];
  capacities: number[];
  reactions: number[];
  /** Post-damage bonded components, canonical minimum input index; -1 if inactive. */
  componentIds: number[];
  movingCells: number[];
  brokenCells: number[];
  supportedWeight: number;
  moves: { from: number; to: number }[];
  changedCells: number[];
  energy: { beforeQ: string; afterQ: string; externalQ: '0'; driftQ: '0' };
};
export type ReactiveStructureResult3D = {
  block: ReactiveMaterialBlock3D;
  report: ReactiveStructureReport3D;
};
export type ReactiveStructureProgress3D = {
  status: 'running' | 'complete' | 'cancelled';
  stage: ReactiveStructureStage3D;
  completedWork: number;
  lastAdvanceWork: number;
  maxTotalWork: number;
};
export interface ReactiveStructureJob3D {
  progress(): ReactiveStructureProgress3D;
  advance(maxWork?: number): ReactiveStructureProgress3D;
  cancel(): boolean;
  result(): ReactiveStructureResult3D;
}

/** Each step visits at most one vertex and six neighbors, or one dependency edge.
 * Allocations and public input validation/copying are O(cells), outside this budget.
 * An explicit stepper rather than a generator: every former yield is one step, in the same order.
 */
function solve(input: ReactiveMaterialBlock3D, cold: Uint32Array) {
  const { packedCells: grid, energyQ, structure } = input,
    n = grid.length,
    w = input.width,
    h = input.height,
    d = input.depth;
  const neighbor = (i: number, dir: number) => structuralNeighbor(i, dir, input);
  const density = (i: number) => cold[(grid[i] & 255) * COLD_STRIDE + COLD_DENSITY];
  const active = (i: number, words: ArrayLike<number> = structure) =>
    i >= 0 && (words[i] & INTEGRITY_3D) !== 0;
  const obstructed = (i: number, j: number) => {
    const phase = (grid[j] >>> PHASE_SHIFT) & 15;
    const fixed =
      (phase === PHASE.SOLID || phase === PHASE.FROZEN) &&
      cold[(grid[j] & 255) * COLD_STRIDE + COLD_COHESION] === 0;
    return fixed || (structure[j] & ANCHOR_3D) !== 0 || density(i) <= density(j);
  };
  const distances = new Int32Array(n).fill(-1),
    loads = new Uint32Array(n),
    reactions = new Uint32Array(n);
  const capacities = new Uint32Array(n),
    damaged = new Uint32Array(n),
    edges = new Uint32Array(n);
  const ids = new Int32Array(n).fill(-1),
    blocked = new Uint8Array(n),
    moving = new Uint8Array(n);
  const queue = new Uint32Array(n),
    sources = new Uint32Array(n),
    destinations = new Uint32Array(n),
    visited = new Uint8Array(n);
  const dependents: number[][] = [],
    brokenCells: number[] = [],
    movingCells: number[] = [];
  let length = 0,
    supportedWeight = 0,
    reactionTotal = 0;
  const block = {
    ...input,
    packedCells: new Array<number>(n),
    energyQ: new Array<number>(n),
    structure: new Array<number>(n),
  };
  // Exact under REACTIVE_BLOCK_LIMITS_3D: 32768 cells at MAX_ENERGY_Q stay far below 2^53.
  let beforeQ = 0,
    afterQ = 0;
  const report: ReactiveStructureReport3D = {
    rulesVersion: REACTIVE_STRUCTURE_RULES_3D,
    materialCatalogHash: input.materialCatalogHash,
    distances: [],
    loads: [],
    capacities: [],
    reactions: [],
    componentIds: [],
    movingCells,
    brokenCells,
    supportedWeight,
    moves: [],
    changedCells: [],
    energy: { beforeQ: '', afterQ: '', externalQ: '0', driftQ: '0' },
  };
  let phase = 1,
    i = 0,
    k = 0,
    head = 0,
    root = 0,
    rootVisited = false,
    bfs = false,
    z = 0,
    x = 0,
    y = 0,
    top = -1;
  let output: ReactiveStructureResult3D | null = null;
  const step = (): ReactiveStructureStage3D | null => {
    for (;;) {
      switch (phase) {
        case 1: {
          if (i >= n) {
            phase = 2;
            head = 0;
            continue;
          }
          if (active(i)) {
            const below = neighbor(i, 3);
            if (structure[i] & ANCHOR_3D || below < 0 || (!active(below) && obstructed(i, below))) {
              distances[i] = 0;
              queue[length++] = i;
            }
          }
          i++;
          return 'roots';
        }
        case 2: {
          if (head >= length) {
            phase = 3;
            k = 0;
            continue;
          }
          const v = queue[head];
          for (let dir = 0; dir < 6; dir++) {
            const j = neighbor(v, dir);
            if (active(j) && distances[j] < 0 && (structure[v] & BONDS_3D[dir] || dir === 2)) {
              distances[j] = distances[v] + 1;
              queue[length++] = j;
            }
          }
          head++;
          return 'reach';
        }
        case 3: {
          if (k >= length) {
            phase = 4;
            k = length - 1;
            continue;
          }
          const v = queue[k];
          loads[v] = Math.max(1, Math.ceil(density(v) / 64));
          supportedWeight += loads[v];
          k++;
          return 'weights';
        }
        case 4: {
          if (k < 0) {
            if (reactionTotal !== supportedWeight)
              throw Error('Reactive support reactions do not balance.');
            phase = 5;
            i = 0;
            continue;
          }
          const v = queue[k];
          if (distances[v] === 0) {
            reactions[v] = loads[v];
            reactionTotal += loads[v];
          } else {
            const supports: number[] = [];
            for (let dir = 0; dir < 6; dir++) {
              const j = neighbor(v, dir);
              if (
                active(j) &&
                distances[j] === distances[v] - 1 &&
                (structure[v] & BONDS_3D[dir] || dir === 3)
              )
                supports.push(j);
            }
            supports.sort((a, b) => a - b);
            if (!supports.length) throw Error('Incomplete reactive support graph.');
            const share = Math.floor(loads[v] / supports.length),
              remainder = loads[v] % supports.length;
            for (let r = 0; r < supports.length; r++)
              loads[supports[r]] += share + (r < remainder ? 1 : 0);
          }
          k--;
          return 'loads';
        }
        case 5: {
          if (i >= n) {
            phase = 6;
            i = 0;
            continue;
          }
          damaged[i] = structure[i];
          if (active(i)) {
            const at = (grid[i] & 255) * COLD_STRIDE,
              integrity = structure[i] & INTEGRITY_3D;
            const nominal = cold[at + COLD_COHESION] * 16,
              softening = cold[at + COLD_SOFTENING];
            const remaining = softening
              ? Math.max(
                  0,
                  Math.min(
                    64 * ENERGY_SCALE,
                    (softening + 64) * ENERGY_SCALE - temperatureQ(grid[i], energyQ[i], cold),
                  ),
                )
              : 64 * ENERGY_SCALE;
            const capacity = Math.floor(
              (Math.floor((nominal * integrity) / 255) * remaining) / (64 * ENERGY_SCALE),
            );
            capacities[i] = capacity;
            const loss =
              capacity === 0
                ? integrity
                : loads[i] > capacity
                  ? Math.min(
                      integrity,
                      Math.max(1, Math.floor(((loads[i] - capacity) * 255) / nominal)),
                    )
                  : 0;
            damaged[i] = (structure[i] & ~INTEGRITY_3D) | (integrity - loss);
            if (loss === integrity) brokenCells.push(i);
          }
          i++;
          return 'damage';
        }
        case 6: {
          // Prune only. Fresh placement never implicitly welds adjacent cells here.
          if (i >= n) {
            phase = 7;
            root = 0;
            rootVisited = false;
            bfs = false;
            continue;
          }
          edges[i] = damaged[i] & (INTEGRITY_3D | ANCHOR_3D);
          if (active(i, damaged))
            for (let dir = 0; dir < 6; dir++) {
              const j = neighbor(i, dir);
              if (
                active(j, damaged) &&
                damaged[i] & BONDS_3D[dir] &&
                damaged[j] & BONDS_3D[dir ^ 1]
              )
                edges[i] |= BONDS_3D[dir];
            }
          i++;
          return 'edges';
        }
        case 7: {
          if (root >= n) {
            phase = 8;
            i = 0;
            continue;
          }
          if (!bfs) {
            if (!rootVisited) {
              rootVisited = true;
              if (active(root, edges) && ids[root] < 0) {
                ids[root] = root;
                length = 1;
                queue[0] = root;
                head = 0;
                bfs = true;
              }
            }
            if (!bfs) {
              rootVisited = false;
              root++;
              return 'components';
            }
          }
          const v = queue[head];
          for (let dir = 0; dir < 6; dir++)
            if (edges[v] & BONDS_3D[dir]) {
              const j = neighbor(v, dir);
              if (j < 0 || !active(j, edges)) throw Error('Invalid reactive component adjacency.');
              if (ids[j] < 0) {
                ids[j] = root;
                queue[length++] = j;
              }
            }
          head++;
          if (head >= length) bfs = false;
          return 'components';
        }
        case 8: {
          if (i >= n) {
            phase = 9;
            length = 0;
            i = 0;
            continue;
          }
          const r = ids[i];
          if (r >= 0) {
            const below = neighbor(i, 3);
            if (
              edges[i] & ANCHOR_3D ||
              below < 0 ||
              (!active(below, edges) && obstructed(i, below))
            )
              blocked[r] = 1;
            else if (ids[below] >= 0 && ids[below] !== r) (dependents[ids[below]] ??= []).push(r);
          }
          i++;
          return 'dependencies';
        }
        case 9: {
          if (i >= n) {
            phase = 10;
            head = 0;
            k = 0;
            continue;
          }
          if (blocked[i]) queue[length++] = i;
          i++;
          return 'blocked';
        }
        case 10: {
          if (head >= length) {
            phase = 11;
            i = 0;
            continue;
          }
          const deps = dependents[queue[head]];
          if (deps && k < deps.length) {
            const above = deps[k];
            if (!blocked[above]) {
              blocked[above] = 1;
              queue[length++] = above;
            }
            k++;
            return 'blocked';
          }
          head++;
          k = 0;
          return 'blocked';
        }
        case 11: {
          if (i >= n) {
            phase = 12;
            z = x = y = 0;
            top = -1;
            continue;
          }
          if (ids[i] >= 0 && !blocked[ids[i]]) {
            moving[i] = 1;
            movingCells.push(i);
          }
          sources[i] = i;
          i++;
          return 'moving';
        }
        case 12: {
          if (z >= d) {
            phase = 13;
            i = 0;
            continue;
          }
          if (y === 0) top = -1;
          const v = x + w * (y + h * z);
          if (moving[v]) {
            if (y + 1 === h) throw Error('Reactive fragment crossed the floor.');
            if (top < 0) top = v;
            sources[v + w] = v;
          } else if (top >= 0) {
            sources[top] = v;
            top = -1;
          }
          y++;
          if (y >= h) {
            y = 0;
            x++;
            if (x >= w) {
              x = 0;
              z++;
            }
          }
          return 'permutation';
        }
        case 13: {
          if (i >= n) {
            phase = 14;
            i = 0;
            continue;
          }
          const source = sources[i];
          if (visited[source]) throw Error('Reactive fragment motion is not a permutation.');
          visited[source] = 1;
          destinations[source] = i;
          block.packedCells[i] = grid[source];
          block.energyQ[i] = energyQ[source];
          block.structure[i] = edges[source];
          beforeQ += energyQ[i];
          afterQ += block.energyQ[i];
          report.distances.push(distances[i]);
          report.loads.push(loads[i]);
          report.capacities.push(capacities[i]);
          report.reactions.push(reactions[i]);
          report.componentIds.push(ids[i]);
          if (
            block.packedCells[i] !== grid[i] ||
            block.energyQ[i] !== energyQ[i] ||
            block.structure[i] !== structure[i]
          )
            report.changedCells.push(i);
          i++;
          return 'publish';
        }
        case 14: {
          if (i >= n) {
            if (!Number.isSafeInteger(beforeQ) || !Number.isSafeInteger(afterQ))
              throw Error('Reactive energy total exceeds exact integer range.');
            if (beforeQ !== afterQ) throw Error('Reactive structure lost conserved energy.');
            report.supportedWeight = supportedWeight;
            report.energy.beforeQ = String(beforeQ);
            report.energy.afterQ = String(afterQ);
            output = { block, report };
            phase = 15;
            return null;
          }
          if (destinations[i] !== i) report.moves.push({ from: i, to: destinations[i] });
          i++;
          return 'report';
        }
        default:
          throw Error('Reactive structure solver is complete.');
      }
    }
  };
  return { step, output: () => output };
}

/** Owned validated input only. Public entries validate first and never hand over uncopied results. */
function structureJob(registry: ReactiveMaterialRegistry3D, input: ReactiveMaterialBlock3D) {
  const maxTotalWork = 20 * input.packedCells.length + 16;
  let solver: ReturnType<typeof solve> | null = solve(
    input,
    reactiveRegistrySource3D(registry).cold,
  );
  let status: ReactiveStructureProgress3D['status'] = 'running',
    stage: ReactiveStructureStage3D = 'ready';
  let completedWork = 0,
    lastAdvanceWork = 0,
    result: ReactiveStructureResult3D | null = null;
  const progress = (): ReactiveStructureProgress3D => ({
    status,
    stage,
    completedWork,
    lastAdvanceWork,
    maxTotalWork,
  });
  const cancel = () => {
    if (status !== 'running') return false;
    solver = null;
    status = 'cancelled';
    return true;
  };
  const job: ReactiveStructureJob3D = Object.freeze({
    progress,
    cancel,
    advance(maxWork: number = 64) {
      reactiveInteger3D(maxWork, 1, REACTIVE_STRUCTURE_MAX_WORK_3D);
      if (status !== 'running' || !solver)
        throw Error('Reactive structure job is no longer running.');
      lastAdvanceWork = 0;
      try {
        while (lastAdvanceWork < maxWork) {
          const next = solver.step();
          completedWork++;
          lastAdvanceWork++;
          if (completedWork > maxTotalWork) throw Error('Reactive structure work bound exceeded.');
          if (next === null) {
            result = solver.output();
            solver = null;
            status = 'complete';
            stage = 'complete';
            break;
          }
          stage = next;
        }
      } catch (error) {
        cancel();
        throw error;
      }
      return progress();
    },
    result() {
      if (status !== 'complete' || !result)
        throw Error('Reactive structure result is not complete.');
      return cloneReactiveData3D(result);
    },
  });
  return {
    job,
    output() {
      if (status !== 'complete' || !result)
        throw Error('Reactive structure result is not complete.');
      return result;
    },
  };
}
export function createReactiveStructureJob3D(
  registry: ReactiveMaterialRegistry3D,
  raw: ReactiveMaterialBlock3D,
): ReactiveStructureJob3D {
  return structureJob(registry, readReactiveMaterialBlock3D(registry, raw)).job;
}
/** Internal only: owned validated input and an uncopied result hand-off. */
export function startReactiveStructureJob3D(
  registry: ReactiveMaterialRegistry3D,
  input: ReactiveMaterialBlock3D,
) {
  return structureJob(registry, input);
}
