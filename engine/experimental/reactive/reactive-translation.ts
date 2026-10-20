/** Existing-matter translation for reactive worlds. No placement or time advancement. */
import { MAT, PHASE, PHASE_SHIFT, COLD_STRIDE, COLD_COHESION } from '../../generated/materials.js';
import { ANCHOR_3D, BONDS_3D, structuralNeighbor } from '../structural-mechanics.js';
import { reactiveArray3D, reactiveFields3D, reactiveInteger3D, reactiveRegistrySource3D, type ReactiveMaterialRegistry3D } from './reactive-registry.js';
import { readReactiveWorldSnapshot3D, reactiveSnapshotHolds3D, type ReactiveWorldSnapshot3D } from './reactive-world-tick.js';
import { reactiveHeldCells3D } from './reactive-holds.js';

export const REACTIVE_TRANSLATION_RULES_3D = 'reactive-translation-1';
export const REACTIVE_TRANSLATION_LIMITS_3D = Object.freeze({cells: 32768, path: 384, cellSteps: 262144});
export type ReactiveTranslationCoordinate3D = readonly [number, number, number];
export type ReactiveTranslationRequest3D = {
  cells: readonly ReactiveTranslationCoordinate3D[]; path: readonly ReactiveTranslationCoordinate3D[];
  externalBonds?: 'reject' | 'cut'; anchors?: 'reject' | 'release'; displacement?: 'air' | 'mobile';
};
export type ReactiveTranslationStep3D = {
  /** Paired in the original selected-source order, using this step's spatial frame. */
  selectedSources: number[]; selectedDestinations: number[];
  /** Terminal occupants rotate directly to run heads; this is not a swept path. */
  displaced: {from: number; to: number; origin: number}[];
};
export type ReactiveTranslationReceipt3D = {
  rulesVersion: typeof REACTIVE_TRANSLATION_RULES_3D; materialCatalogHash: string; tick: number; externalEnergyQ: '0';
  sources: number[]; destinations: number[]; path: ReactiveTranslationCoordinate3D[];
  cutBonds: [number, number][]; releasedAnchors: number[]; changedCells: number[];
  steps: ReactiveTranslationStep3D[];
  movement: {moves: {from: number; to: number}[]; touchedCells: number[]; touchedOrigins: number[]};
  energy: {beforeQ: string; afterQ: string; driftQ: '0'};
};
export type ReactiveTranslationResult3D = {state: ReactiveWorldSnapshot3D; receipt: ReactiveTranslationReceipt3D};
export type ReactiveTranslationProgress3D = {status: 'running' | 'complete' | 'cancelled'; phase: 'translate' | 'publish' | 'complete'; completedSteps: number; totalSteps: number};
export interface ReactiveTranslationJob3D {
  progress(): ReactiveTranslationProgress3D;
  advance(): ReactiveTranslationProgress3D;
  cancel(): boolean;
  result(): ReactiveTranslationResult3D;
}
function coordinate(value: unknown): ReactiveTranslationCoordinate3D {
  const array = reactiveArray3D(value, 3); if (array.length !== 3) throw Error('Translation needs three coordinates.');
  return array.map(v => reactiveInteger3D(v, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)) as [number, number, number];
}
function requestData(raw: ReactiveTranslationRequest3D) {
  reactiveFields3D(raw, ['cells', 'path'], ['externalBonds', 'anchors', 'displacement']);
  const rawCells = reactiveArray3D(raw.cells, REACTIVE_TRANSLATION_LIMITS_3D.cells), rawPath = reactiveArray3D(raw.path, REACTIVE_TRANSLATION_LIMITS_3D.path);
  if (!rawCells.length || !rawPath.length || rawCells.length * (rawPath.length + 1) > REACTIVE_TRANSLATION_LIMITS_3D.cellSteps) throw Error('Reactive translation exceeds its cell/path budget.');
  const cells = rawCells.map(coordinate), path = rawPath.map(coordinate);
  const directions = path.map(step => {
    if (step.some(v => v < -1 || v > 1) || step.reduce((sum, v) => sum + Math.abs(v), 0) !== 1) throw Error('Translation path requires cardinal unit steps.');
    const axis = step.findIndex(v => v !== 0); return axis * 2 + Number(step[axis] > 0);
  });
  const externalBonds = Object.hasOwn(raw, 'externalBonds') ? raw.externalBonds : 'reject';
  const anchors = Object.hasOwn(raw, 'anchors') ? raw.anchors : 'reject';
  const displacement = Object.hasOwn(raw, 'displacement') ? raw.displacement : 'air';
  if (!['reject', 'cut'].includes(externalBonds as string) || !['reject', 'release'].includes(anchors as string) ||
    !['air', 'mobile'].includes(displacement as string)) throw Error('Invalid reactive translation policy.');
  return {cells, path, directions, externalBonds, anchors, displacement};
}

/** One path step per advance, then whole-block validation/publication. All work is
 * bounded by the block and cell-step limits, not by a wall-clock latency promise.
 */
export function createReactiveTranslationJob3D(registry: ReactiveMaterialRegistry3D, raw: ReactiveWorldSnapshot3D, request: ReactiveTranslationRequest3D): ReactiveTranslationJob3D {
  let before: ReactiveWorldSnapshot3D | null = readReactiveWorldSnapshot3D(registry, raw);
  let current: ReactiveWorldSnapshot3D | null = structuredClone(before);
  const data = requestData(request), cold = reactiveRegistrySource3D(registry).cold, shape = [before.block.width, before.block.height, before.block.depth];
  const n = before.block.packedCells.length, initialQ = before.block.energyQ.reduce((sum, q) => sum + BigInt(q), 0n);
  const held = new Set(reactiveHeldCells3D(reactiveSnapshotHolds3D(before)));
  let origins: Int32Array | null = Int32Array.from({length: n}, (_, i) => i);
  let touched: Uint8Array | null = new Uint8Array(n), touchedOrigins: Uint8Array | null = new Uint8Array(n);
  let selected: number[] = data.cells.map(c => {
    if (c.some((v, axis) => v < 0 || v >= shape[axis])) throw Error('Selected reactive cell is outside the world.');
    const i = c[0] + shape[0] * (c[1] + shape[1] * c[2]);
    if (held.has(i)) throw Error('Explicitly release the reactive hold before translation.');
    if ((before!.block.packedCells[i] & 255) === MAT.AIR) throw Error('Translation must select existing matter, not air.'); return i;
  }).sort((a, b) => a - b);
  if (selected.some((i, k) => k > 0 && i === selected[k - 1])) throw Error('Duplicate reactive translation cell.');
  const sources = selected.slice(), members = new Set(selected), cutBonds: [number, number][] = [], releasedAnchors: number[] = [];
  for (const i of selected) {
    if (current.block.structure[i] & ANCHOR_3D) {
      if (data.anchors !== 'release') throw Error('Explicitly release selected reactive anchors.');
      current.block.structure[i] &= ~ANCHOR_3D; releasedAnchors.push(i);
    }
    for (let dir = 0; dir < 6; dir++) if (current.block.structure[i] & BONDS_3D[dir]) {
      const j = structuralNeighbor(i, dir, current.block);
      if (members.has(j)) continue;
      if (data.externalBonds !== 'cut') throw Error('Explicitly cut external reactive bonds.');
      current.block.structure[i] &= ~BONDS_3D[dir]; current.block.structure[j] &= ~BONDS_3D[dir ^ 1];
      cutBonds.push([Math.min(i, j), Math.max(i, j)]);
    }
  }
  cutBonds.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let expectedStructure: number[] | null = current.block.structure.slice(), steps: ReactiveTranslationStep3D[] | null = [];
  let completedSteps = 0, status: ReactiveTranslationProgress3D['status'] = 'running', phase: ReactiveTranslationProgress3D['phase'] = 'translate';
  let result: ReactiveTranslationResult3D | null = null;
  const progress = (): ReactiveTranslationProgress3D => ({status, phase, completedSteps, totalSteps: data.path.length});
  const release = () => {before = current = null; origins = null; touched = touchedOrigins = null; expectedStructure = null; steps = null; selected = []; members.clear();};
  const cancel = () => {if (status !== 'running') return false; release(); status = 'cancelled'; return true;};
  return Object.freeze({progress, cancel,
    advance() {
      if (status !== 'running' || !before || !current || !origins || !touched || !touchedOrigins || !expectedStructure || !steps) throw Error('Reactive translation job is no longer running.');
      try {
        if (phase === 'translate') {
          const state = current.block, dir = data.directions[completedSteps], neighbor = (i: number, direction: number) => structuralNeighbor(i, direction, state);
          members.clear(); for (const i of selected) members.add(i);
          const destinations = selected.map(i => neighbor(i, dir));
          for (const j of destinations) {
            if (j < 0) throw Error('Reactive translation crosses a closed boundary.');
            if (members.has(j)) continue;
            const word = state.packedCells[j], materialPhase = word >>> PHASE_SHIFT & 15;
            const loose = [PHASE.GAS, PHASE.POWDER, PHASE.LIQUID, PHASE.VISCOUS, PHASE.MOLTEN].some(p => p === materialPhase);
            const cohesive = [PHASE.SOLID, PHASE.FROZEN].some(p => p === materialPhase) && cold[(word & 255) * COLD_STRIDE + COLD_COHESION] > 0;
            if (held.has(j) || state.structure[j] !== 0 || (word & 255) !== MAT.AIR && (data.displacement !== 'mobile' || !loose && !cohesive)) throw Error('Reactive translation path is obstructed.');
          }
          // Immutable captured tuples for the entire step, including terminal occupants.
          const carried = selected.map(i => ({word: state.packedCells[i], energy: state.energyQ[i], structure: state.structure[i], origin: origins![i]}));
          const displaced: {from: number; to: number; origin: number; word: number; energy: number; structure: number}[] = [];
          for (const head of selected) {
            if (members.has(neighbor(head, dir ^ 1))) continue;
            let terminal = neighbor(head, dir); while (members.has(terminal)) terminal = neighbor(terminal, dir);
            displaced.push({from: terminal, to: head, origin: origins[terminal], word: state.packedCells[terminal], energy: state.energyQ[terminal], structure: state.structure[terminal]});
          }
          for (let k = 0; k < selected.length; k++) {
            const i = destinations[k], cell = carried[k]; state.packedCells[i] = cell.word; state.energyQ[i] = cell.energy; state.structure[i] = cell.structure; origins[i] = cell.origin;
            touched[selected[k]] = touched[i] = 1; touchedOrigins[cell.origin] = 1;
          }
          for (const cell of displaced) {
            state.packedCells[cell.to] = cell.word; state.energyQ[cell.to] = cell.energy; state.structure[cell.to] = cell.structure; origins[cell.to] = cell.origin;
            touched[cell.from] = touched[cell.to] = 1; touchedOrigins[cell.origin] = 1;
          }
          steps.push({selectedSources: selected.slice(), selectedDestinations: destinations.slice(),
            displaced: displaced.map(({from, to, origin}) => ({from, to, origin})).sort((a, b) => a.from - b.from)});
          selected = destinations; completedSteps++; if (completedSteps === data.path.length) phase = 'publish';
        } else {
          const validated = readReactiveWorldSnapshot3D(registry, current), destinations = new Int32Array(n), visited = new Uint8Array(n);
          const receipt: ReactiveTranslationReceipt3D = {rulesVersion: REACTIVE_TRANSLATION_RULES_3D, materialCatalogHash: validated.block.materialCatalogHash,
            tick: before.tick, externalEnergyQ: '0', sources, destinations: selected.slice(), path: data.path, cutBonds, releasedAnchors, changedCells: [], steps,
            movement: {moves: [], touchedCells: [], touchedOrigins: []}, energy: {beforeQ: initialQ.toString(), afterQ: '', driftQ: '0'}};
          let finalQ = 0n;
          for (let i = 0; i < n; i++) {
            const origin = origins[i], out = validated.block, input = before.block;
            if (visited[origin] || out.packedCells[i] !== input.packedCells[origin] || out.energyQ[i] !== input.energyQ[origin] || out.structure[i] !== expectedStructure[origin]) throw Error('Reactive translation lost matter history.');
            visited[origin] = 1; destinations[origin] = i; finalQ += BigInt(out.energyQ[i]);
            if (out.packedCells[i] !== input.packedCells[i] || out.energyQ[i] !== input.energyQ[i] || out.structure[i] !== input.structure[i]) receipt.changedCells.push(i);
            if (touched[i]) receipt.movement.touchedCells.push(i); if (touchedOrigins[i]) receipt.movement.touchedOrigins.push(i);
          }
          for (let i = 0; i < n; i++) if (destinations[i] !== i) receipt.movement.moves.push({from: i, to: destinations[i]});
          if (finalQ !== initialQ) throw Error('Reactive translation lost conserved energy.'); receipt.energy.afterQ = finalQ.toString();
          result = {state: validated, receipt}; release(); status = 'complete'; phase = 'complete';
        }
      } catch (error) {cancel(); throw error;}
      return progress();
    },
    result() {if (status !== 'complete' || !result) throw Error('Reactive translation result is not complete.'); return structuredClone(result);},
  });
}
