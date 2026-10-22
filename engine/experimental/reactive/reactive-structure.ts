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
import { INTEGRITY_3D, BONDS_3D, ANCHOR_3D } from '../structural-mechanics.js';
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

const BOND_MASK_3D = BONDS_3D.reduce((mask, bond) => mask | bond, 0);

/** Each step visits at most one vertex and six neighbors, or one dependency edge.
 * Allocations and public input validation/copying are O(cells), outside this budget.
 * An explicit stepper: run(budget) executes up to budget steps in phase-local loops, and every former
 * yield is one loop iteration, in the same order. A stage transition is the first action of the step
 * after the exhausted stage and a throwing step is not counted, so any budget schedule sees the same
 * stage and work after each step and the same throw points.
 */
function solve(input: ReactiveMaterialBlock3D, cold: Uint32Array) {
  const { packedCells: grid, energyQ, structure } = input,
    n = grid.length,
    w = input.width,
    h = input.height,
    d = input.depth,
    layer = w * h;
  const density = (i: number) => cold[(grid[i] & 255) * COLD_STRIDE + COLD_DENSITY];
  const obstructed = (i: number, j: number) => {
    const phase = (grid[j] >>> PHASE_SHIFT) & 15;
    const fixed =
      (phase === PHASE.SOLID || phase === PHASE.FROZEN) &&
      cold[(grid[j] & 255) * COLD_STRIDE + COLD_COHESION] === 0;
    return fixed || (structure[j] & ANCHOR_3D) !== 0 || density(i) <= density(j);
  };
  /** The cell below i (direction 3), or -1 at the closed floor. */
  const below = (i: number) => ((((i / w) | 0) % h) + 1 < h ? i + w : -1);
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
  // The -Z, -Y, -X, +X, +Y, +Z neighbors present in any shape have ascending indices: no sort needed.
  const supports = new Int32Array(6);
  const dependents: number[][] = [],
    brokenCells: number[] = [],
    movingCells: number[] = [];
  let length = 0,
    supportedWeight = 0,
    reactionTotal = 0;
  // Publish writes every cell; slice() keeps a packed input packed for the next tick's readers.
  const block = {
    ...input,
    packedCells: grid.slice(),
    energyQ: energyQ.slice(),
    structure: structure.slice(),
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
    top = -1,
    materialised = false;
  let output: ReactiveStructureResult3D | null = null;
  // Steps completed by the current run, and the stage of the latest one (null before any).
  let executed = 0,
    last: ReactiveStructureStage3D | null = null;
  // The current phase batch: steps completed before a throwing step keep its stage.
  let batchBase = 0,
    batchStage: ReactiveStructureStage3D = 'ready';
  const run = (budget: number): ReactiveStructureStage3D | null => {
    executed = 0;
    last = null;
    try {
      for (;;) {
        switch (phase) {
          case 1: {
            if (i >= n) {
              phase = 2;
              head = 0;
              continue;
            }
            batchStage = 'roots';
            batchBase = executed;
            const end = Math.min(n, i + budget - executed);
            executed += end - i;
            for (; i < end; i++) {
              const word = structure[i];
              if ((word & INTEGRITY_3D) === 0) continue;
              const j = below(i);
              if (
                word & ANCHOR_3D ||
                j < 0 ||
                ((structure[j] & INTEGRITY_3D) === 0 && obstructed(i, j))
              ) {
                distances[i] = 0;
                queue[length++] = i;
              }
            }
            last = 'roots';
            if (executed >= budget) return last;
            continue;
          }
          case 2: {
            if (head >= length) {
              phase = 3;
              k = 0;
              continue;
            }
            batchStage = 'reach';
            batchBase = executed;
            while (head < length && executed < budget) {
              const v = queue[head],
                word = structure[v],
                next = distances[v] + 1;
              const vx = v % w,
                vy = ((v / w) | 0) % h,
                vz = (v / layer) | 0;
              let j: number;
              // Direction order 0..5 keeps the queue order; -Y (2) needs no bond.
              if (
                vx &&
                word & BONDS_3D[0] &&
                structure[(j = v - 1)] & INTEGRITY_3D &&
                distances[j] < 0
              ) {
                distances[j] = next;
                queue[length++] = j;
              }
              if (
                vx + 1 < w &&
                word & BONDS_3D[1] &&
                structure[(j = v + 1)] & INTEGRITY_3D &&
                distances[j] < 0
              ) {
                distances[j] = next;
                queue[length++] = j;
              }
              if (vy && structure[(j = v - w)] & INTEGRITY_3D && distances[j] < 0) {
                distances[j] = next;
                queue[length++] = j;
              }
              if (
                vy + 1 < h &&
                word & BONDS_3D[3] &&
                structure[(j = v + w)] & INTEGRITY_3D &&
                distances[j] < 0
              ) {
                distances[j] = next;
                queue[length++] = j;
              }
              if (
                vz &&
                word & BONDS_3D[4] &&
                structure[(j = v - layer)] & INTEGRITY_3D &&
                distances[j] < 0
              ) {
                distances[j] = next;
                queue[length++] = j;
              }
              if (
                vz + 1 < d &&
                word & BONDS_3D[5] &&
                structure[(j = v + layer)] & INTEGRITY_3D &&
                distances[j] < 0
              ) {
                distances[j] = next;
                queue[length++] = j;
              }
              head++;
              executed++;
            }
            last = 'reach';
            if (executed >= budget) return last;
            continue;
          }
          case 3: {
            if (k >= length) {
              phase = 4;
              k = length - 1;
              continue;
            }
            batchStage = 'weights';
            batchBase = executed;
            const end = Math.min(length, k + budget - executed);
            executed += end - k;
            for (; k < end; k++) {
              const v = queue[k];
              loads[v] = Math.max(1, Math.ceil(density(v) / 64));
              supportedWeight += loads[v];
            }
            last = 'weights';
            if (executed >= budget) return last;
            continue;
          }
          case 4: {
            if (k < 0) {
              if (reactionTotal !== supportedWeight)
                throw Error('Reactive support reactions do not balance.');
              phase = 5;
              i = 0;
              continue;
            }
            batchStage = 'loads';
            batchBase = executed;
            while (k >= 0 && executed < budget) {
              const v = queue[k];
              if (distances[v] === 0) {
                reactions[v] = loads[v];
                reactionTotal += loads[v];
              } else {
                const word = structure[v],
                  above = distances[v] - 1;
                const vx = v % w,
                  vy = ((v / w) | 0) % h,
                  vz = (v / layer) | 0;
                let count = 0,
                  j: number;
                // Ascending index order; +Y (3) needs no bond.
                if (
                  vz &&
                  word & BONDS_3D[4] &&
                  structure[(j = v - layer)] & INTEGRITY_3D &&
                  distances[j] === above
                )
                  supports[count++] = j;
                if (
                  vy &&
                  word & BONDS_3D[2] &&
                  structure[(j = v - w)] & INTEGRITY_3D &&
                  distances[j] === above
                )
                  supports[count++] = j;
                if (
                  vx &&
                  word & BONDS_3D[0] &&
                  structure[(j = v - 1)] & INTEGRITY_3D &&
                  distances[j] === above
                )
                  supports[count++] = j;
                if (
                  vx + 1 < w &&
                  word & BONDS_3D[1] &&
                  structure[(j = v + 1)] & INTEGRITY_3D &&
                  distances[j] === above
                )
                  supports[count++] = j;
                if (vy + 1 < h && structure[(j = v + w)] & INTEGRITY_3D && distances[j] === above)
                  supports[count++] = j;
                if (
                  vz + 1 < d &&
                  word & BONDS_3D[5] &&
                  structure[(j = v + layer)] & INTEGRITY_3D &&
                  distances[j] === above
                )
                  supports[count++] = j;
                if (!count) throw Error('Incomplete reactive support graph.');
                const share = Math.floor(loads[v] / count),
                  remainder = loads[v] % count;
                for (let r = 0; r < count; r++)
                  loads[supports[r]] += share + (r < remainder ? 1 : 0);
              }
              k--;
              executed++;
            }
            last = 'loads';
            if (executed >= budget) return last;
            continue;
          }
          case 5: {
            if (i >= n) {
              phase = 6;
              i = 0;
              continue;
            }
            batchStage = 'damage';
            batchBase = executed;
            const end = Math.min(n, i + budget - executed);
            executed += end - i;
            for (; i < end; i++) {
              const word = structure[i];
              damaged[i] = word;
              if ((word & INTEGRITY_3D) === 0) continue;
              const at = (grid[i] & 255) * COLD_STRIDE,
                integrity = word & INTEGRITY_3D;
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
              damaged[i] = (word & ~INTEGRITY_3D) | (integrity - loss);
              if (loss === integrity) brokenCells.push(i);
            }
            last = 'damage';
            if (executed >= budget) return last;
            continue;
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
            batchStage = 'edges';
            batchBase = executed;
            const end = Math.min(n, i + budget - executed);
            executed += end - i;
            for (; i < end; i++) {
              const word = damaged[i];
              let kept = word & (INTEGRITY_3D | ANCHOR_3D);
              // Without bond bits nothing is kept beyond integrity and anchor.
              if (word & INTEGRITY_3D && word & BOND_MASK_3D) {
                const vx = i % w,
                  vy = ((i / w) | 0) % h,
                  vz = (i / layer) | 0;
                let j: number;
                if (
                  word & BONDS_3D[0] &&
                  vx &&
                  damaged[(j = i - 1)] & INTEGRITY_3D &&
                  damaged[j] & BONDS_3D[1]
                )
                  kept |= BONDS_3D[0];
                if (
                  word & BONDS_3D[1] &&
                  vx + 1 < w &&
                  damaged[(j = i + 1)] & INTEGRITY_3D &&
                  damaged[j] & BONDS_3D[0]
                )
                  kept |= BONDS_3D[1];
                if (
                  word & BONDS_3D[2] &&
                  vy &&
                  damaged[(j = i - w)] & INTEGRITY_3D &&
                  damaged[j] & BONDS_3D[3]
                )
                  kept |= BONDS_3D[2];
                if (
                  word & BONDS_3D[3] &&
                  vy + 1 < h &&
                  damaged[(j = i + w)] & INTEGRITY_3D &&
                  damaged[j] & BONDS_3D[2]
                )
                  kept |= BONDS_3D[3];
                if (
                  word & BONDS_3D[4] &&
                  vz &&
                  damaged[(j = i - layer)] & INTEGRITY_3D &&
                  damaged[j] & BONDS_3D[5]
                )
                  kept |= BONDS_3D[4];
                if (
                  word & BONDS_3D[5] &&
                  vz + 1 < d &&
                  damaged[(j = i + layer)] & INTEGRITY_3D &&
                  damaged[j] & BONDS_3D[4]
                )
                  kept |= BONDS_3D[5];
              }
              edges[i] = kept;
            }
            last = 'edges';
            if (executed >= budget) return last;
            continue;
          }
          case 7: {
            if (root >= n) {
              phase = 8;
              i = 0;
              continue;
            }
            batchStage = 'components';
            batchBase = executed;
            while (root < n && executed < budget) {
              if (!bfs) {
                // One step per root: start its flood fill, or move past a visited or inactive cell.
                if (!rootVisited && edges[root] & INTEGRITY_3D && ids[root] < 0) {
                  rootVisited = true;
                  ids[root] = root;
                  length = 1;
                  queue[0] = root;
                  head = 0;
                  bfs = true;
                } else {
                  rootVisited = false;
                  root++;
                  executed++;
                  continue;
                }
              }
              const v = queue[head],
                word = edges[v];
              const vx = v % w,
                vy = ((v / w) | 0) % h,
                vz = (v / layer) | 0;
              let j: number;
              if (word & BONDS_3D[0]) {
                if (!vx || (edges[(j = v - 1)] & INTEGRITY_3D) === 0)
                  throw Error('Invalid reactive component adjacency.');
                if (ids[j] < 0) {
                  ids[j] = root;
                  queue[length++] = j;
                }
              }
              if (word & BONDS_3D[1]) {
                if (vx + 1 >= w || (edges[(j = v + 1)] & INTEGRITY_3D) === 0)
                  throw Error('Invalid reactive component adjacency.');
                if (ids[j] < 0) {
                  ids[j] = root;
                  queue[length++] = j;
                }
              }
              if (word & BONDS_3D[2]) {
                if (!vy || (edges[(j = v - w)] & INTEGRITY_3D) === 0)
                  throw Error('Invalid reactive component adjacency.');
                if (ids[j] < 0) {
                  ids[j] = root;
                  queue[length++] = j;
                }
              }
              if (word & BONDS_3D[3]) {
                if (vy + 1 >= h || (edges[(j = v + w)] & INTEGRITY_3D) === 0)
                  throw Error('Invalid reactive component adjacency.');
                if (ids[j] < 0) {
                  ids[j] = root;
                  queue[length++] = j;
                }
              }
              if (word & BONDS_3D[4]) {
                if (!vz || (edges[(j = v - layer)] & INTEGRITY_3D) === 0)
                  throw Error('Invalid reactive component adjacency.');
                if (ids[j] < 0) {
                  ids[j] = root;
                  queue[length++] = j;
                }
              }
              if (word & BONDS_3D[5]) {
                if (vz + 1 >= d || (edges[(j = v + layer)] & INTEGRITY_3D) === 0)
                  throw Error('Invalid reactive component adjacency.');
                if (ids[j] < 0) {
                  ids[j] = root;
                  queue[length++] = j;
                }
              }
              head++;
              if (head >= length) bfs = false;
              executed++;
            }
            last = 'components';
            if (executed >= budget) return last;
            continue;
          }
          case 8: {
            if (i >= n) {
              phase = 9;
              length = 0;
              i = 0;
              continue;
            }
            batchStage = 'dependencies';
            batchBase = executed;
            const end = Math.min(n, i + budget - executed);
            executed += end - i;
            for (; i < end; i++) {
              const r = ids[i];
              if (r < 0) continue;
              const j = below(i);
              if (
                edges[i] & ANCHOR_3D ||
                j < 0 ||
                ((edges[j] & INTEGRITY_3D) === 0 && obstructed(i, j))
              )
                blocked[r] = 1;
              else if (ids[j] >= 0 && ids[j] !== r) (dependents[ids[j]] ??= []).push(r);
            }
            last = 'dependencies';
            if (executed >= budget) return last;
            continue;
          }
          case 9: {
            if (i >= n) {
              phase = 10;
              head = 0;
              k = 0;
              continue;
            }
            batchStage = 'blocked';
            batchBase = executed;
            const end = Math.min(n, i + budget - executed);
            executed += end - i;
            for (; i < end; i++) if (blocked[i]) queue[length++] = i;
            last = 'blocked';
            if (executed >= budget) return last;
            continue;
          }
          case 10: {
            if (head >= length) {
              phase = 11;
              i = 0;
              continue;
            }
            batchStage = 'blocked';
            batchBase = executed;
            while (head < length && executed < budget) {
              const deps = dependents[queue[head]];
              if (deps && k < deps.length) {
                const above = deps[k];
                if (!blocked[above]) {
                  blocked[above] = 1;
                  queue[length++] = above;
                }
                k++;
              } else {
                head++;
                k = 0;
              }
              executed++;
            }
            last = 'blocked';
            if (executed >= budget) return last;
            continue;
          }
          case 11: {
            if (i >= n) {
              phase = 12;
              z = x = y = 0;
              top = -1;
              continue;
            }
            batchStage = 'moving';
            batchBase = executed;
            const end = Math.min(n, i + budget - executed);
            executed += end - i;
            for (; i < end; i++) {
              const r = ids[i];
              if (r >= 0 && !blocked[r]) {
                moving[i] = 1;
                movingCells.push(i);
              }
              sources[i] = i;
            }
            last = 'moving';
            if (executed >= budget) return last;
            continue;
          }
          case 12: {
            if (z >= d) {
              phase = 13;
              i = 0;
              continue;
            }
            batchStage = 'permutation';
            batchBase = executed;
            while (executed < budget) {
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
              executed++;
              if (y >= h) {
                y = 0;
                x++;
                if (x >= w) {
                  x = 0;
                  z++;
                  if (z >= d) break;
                }
              }
            }
            last = 'permutation';
            if (executed >= budget) return last;
            continue;
          }
          case 13: {
            if (i >= n) {
              phase = 14;
              i = 0;
              continue;
            }
            batchStage = 'publish';
            batchBase = executed;
            if (!materialised) {
              // The report arrays are final here and internal until completion: copy them once.
              materialised = true;
              const D = new Array<number>(n),
                L = new Array<number>(n),
                C = new Array<number>(n),
                R = new Array<number>(n),
                I = new Array<number>(n);
              for (let q = 0; q < n; q++) {
                D[q] = distances[q];
                L[q] = loads[q];
                C[q] = capacities[q];
                R[q] = reactions[q];
                I[q] = ids[q];
              }
              report.distances = D;
              report.loads = L;
              report.capacities = C;
              report.reactions = R;
              report.componentIds = I;
            }
            const end = Math.min(n, i + budget - executed);
            for (; i < end; i++) {
              const source = sources[i];
              if (visited[source]) throw Error('Reactive fragment motion is not a permutation.');
              visited[source] = 1;
              destinations[source] = i;
              const packed = grid[source],
                q = energyQ[source],
                word = edges[source];
              block.packedCells[i] = packed;
              block.energyQ[i] = q;
              block.structure[i] = word;
              beforeQ += energyQ[i];
              afterQ += q;
              if (packed !== grid[i] || q !== energyQ[i] || word !== structure[i])
                report.changedCells.push(i);
              executed++;
            }
            last = 'publish';
            if (executed >= budget) return last;
            continue;
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
              executed++;
              last = null;
              return null;
            }
            batchStage = 'report';
            batchBase = executed;
            const end = Math.min(n, i + budget - executed);
            executed += end - i;
            for (; i < end; i++)
              if (destinations[i] !== i) report.moves.push({ from: i, to: destinations[i] });
            last = 'report';
            if (executed >= budget) return last;
            continue;
          }
          default:
            throw Error('Reactive structure solver is complete.');
        }
      }
    } catch (error) {
      if (executed > batchBase) last = batchStage;
      throw error;
    }
  };
  return { run, executed: () => executed, last: () => last, output: () => output };
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
      const stepper = solver;
      lastAdvanceWork = 0;
      try {
        while (lastAdvanceWork < maxWork) {
          // A batch never crosses the work bound; the one step past it counts, sets no stage and throws.
          const room = maxTotalWork - completedWork,
            budget = Math.min(maxWork - lastAdvanceWork, room > 0 ? room : 1);
          let next: ReactiveStructureStage3D | null;
          try {
            next = stepper.run(budget);
          } finally {
            // Steps completed before a throwing step still count, and the stage follows the last of them.
            const done = stepper.executed(),
              reached = stepper.last();
            completedWork += done;
            lastAdvanceWork += done;
            if (reached !== null && room > 0) stage = reached;
          }
          if (completedWork > maxTotalWork) throw Error('Reactive structure work bound exceeded.');
          if (next === null) {
            result = stepper.output();
            solver = null;
            status = 'complete';
            stage = 'complete';
            break;
          }
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
