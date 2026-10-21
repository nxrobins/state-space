/** One complete movement/reaction/structural tick. No old-world or native execution. */
import { readReactiveMaterialBlock3D, reactiveEnergyTotalQ3D, type ReactiveMaterialBlock3D } from './reactive-block.js';
import { reactiveFields3D, reactiveInteger3D, cloneReactiveData3D, type ReactiveMaterialRegistry3D } from './reactive-registry.js';
import { REACTIVE_HOLD_RULES_3D, validateReactiveHolds3D, copyReactiveHolds3D, reactiveHeldCells3D, overlayReactiveHolds3D,
  stripReactiveHoldAnchors3D, retireReactiveHolds3D, type ReactiveHold3D, type ReactiveHoldTickReport3D } from './reactive-holds.js';
import { startReactiveEvolutionJob3D, REACTIVE_EVOLUTION_RULES_3D,
  type ReactiveEvolutionState3D, type ReactiveEvolutionJob3D, type ReactiveEvolutionResult3D, type ReactiveEvolutionReport3D } from './reactive-evolution.js';
import { startReactiveStructureJob3D, REACTIVE_STRUCTURE_RULES_3D, REACTIVE_STRUCTURE_MAX_WORK_3D,
  type ReactiveStructureJob3D, type ReactiveStructureProgress3D, type ReactiveStructureResult3D, type ReactiveStructureReport3D } from './reactive-structure.js';
import { readReactiveTickOptions3D, createReactiveMotionCapture3D, type ReactiveTickOptions3D, type ReactiveMotionReport3D } from './reactive-motion-capture.js';

export const REACTIVE_WORLD_RULES_3D = 'reactive-world-1';
export const REACTIVE_WORLD_SCHEMA_3D = 1;
export const REACTIVE_CONSTRAINED_WORLD_RULES_3D = 'reactive-world-2';
export const REACTIVE_CONSTRAINED_WORLD_SCHEMA_3D = 2;
export const REACTIVE_WORLD_COMPONENTS_3D = Object.freeze({evolution: REACTIVE_EVOLUTION_RULES_3D, structure: REACTIVE_STRUCTURE_RULES_3D});
export type ReactiveUnconstrainedWorldSnapshot3D = {schemaVersion: 1; rulesVersion: typeof REACTIVE_WORLD_RULES_3D; tick: number; block: ReactiveMaterialBlock3D};
export type ReactiveConstrainedWorldSnapshot3D = {schemaVersion: 2; rulesVersion: typeof REACTIVE_CONSTRAINED_WORLD_RULES_3D;
  holdRulesVersion: typeof REACTIVE_HOLD_RULES_3D; tick: number; block: ReactiveMaterialBlock3D; holds: ReactiveHold3D[]};
export type ReactiveWorldSnapshot3D = ReactiveUnconstrainedWorldSnapshot3D | ReactiveConstrainedWorldSnapshot3D;
export const reactiveSnapshotHolds3D = (snapshot: ReactiveWorldSnapshot3D): readonly ReactiveHold3D[] => snapshot.schemaVersion === 2 ? snapshot.holds : [];
export type ReactiveWorldTickReport3D = {
  rulesVersion: typeof REACTIVE_WORLD_RULES_3D | typeof REACTIVE_CONSTRAINED_WORLD_RULES_3D; materialCatalogHash: string; fromTick: number; toTick: number;
  /** Present only for v2; component reports observe effective temporary anchors. */
  holds?: ReactiveHoldTickReport3D;
  changedCells: number[]; touchedCells: number[]; touchedOrigins: number[]; moves: {from: number; to: number}[];
  /** Evolution indices use tick-start coordinates; its reactions use the post-movement frame. */
  evolution: ReactiveEvolutionReport3D;
  /** Structural indices use the complete post-evolution input, before settlement. */
  structure: ReactiveStructureReport3D;
  energy: {beforeQ: string; afterQ: string; externalQ: '0'; driftQ: '0'};
};
export type ReactiveWorldTickResult3D = {state: ReactiveWorldSnapshot3D; report: ReactiveWorldTickReport3D};
export type ReactiveWorldTickPhase3D = 'evolution' | 'structure-prepare' | 'structure' | 'publish' | 'complete';
export type ReactiveWorldTickProgress3D = {status: 'running' | 'complete' | 'cancelled'; phase: ReactiveWorldTickPhase3D;
  evolutionPasses: number; structure: ReactiveStructureProgress3D | null};
export interface ReactiveWorldTickJob3D {
  progress(): ReactiveWorldTickProgress3D;
  advance(structuralWork?: number): ReactiveWorldTickProgress3D;
  cancel(): boolean;
  result(): ReactiveWorldTickResult3D;
  motion(): ReactiveMotionReport3D;
}
export function createReactiveWorldSnapshot3D(registry: ReactiveMaterialRegistry3D, block: ReactiveMaterialBlock3D, tick: number = 0): ReactiveWorldSnapshot3D {
  return {schemaVersion: 1, rulesVersion: REACTIVE_WORLD_RULES_3D, tick: reactiveInteger3D(tick, 0, Number.MAX_SAFE_INTEGER),
    block: readReactiveMaterialBlock3D(registry, block)};
}
export function createConstrainedReactiveWorldSnapshot3D(registry: ReactiveMaterialRegistry3D, block: ReactiveMaterialBlock3D, tick: number = 0, holds: readonly ReactiveHold3D[] = []): ReactiveConstrainedWorldSnapshot3D {
  tick = reactiveInteger3D(tick, 0, Number.MAX_SAFE_INTEGER); const owned = readReactiveMaterialBlock3D(registry, block);
  return {schemaVersion: 2, rulesVersion: REACTIVE_CONSTRAINED_WORLD_RULES_3D, holdRulesVersion: REACTIVE_HOLD_RULES_3D,
    tick, block: owned, holds: validateReactiveHolds3D(registry, holds, tick, owned)};
}
export function readReactiveWorldSnapshot3D(registry: ReactiveMaterialRegistry3D, raw: unknown): ReactiveWorldSnapshot3D {
  reactiveFields3D(raw, ['schemaVersion', 'rulesVersion', 'tick', 'block'], ['holdRulesVersion', 'holds']);
  if (raw.schemaVersion === 1 && raw.rulesVersion === REACTIVE_WORLD_RULES_3D) {
    reactiveFields3D(raw, ['schemaVersion', 'rulesVersion', 'tick', 'block']);
    return createReactiveWorldSnapshot3D(registry, raw.block as ReactiveMaterialBlock3D, reactiveInteger3D(raw.tick, 0, Number.MAX_SAFE_INTEGER));
  }
  if (raw.schemaVersion === 2 && raw.rulesVersion === REACTIVE_CONSTRAINED_WORLD_RULES_3D && raw.holdRulesVersion === REACTIVE_HOLD_RULES_3D) {
    reactiveFields3D(raw, ['schemaVersion', 'rulesVersion', 'tick', 'block', 'holdRulesVersion', 'holds']);
    if (!Array.isArray(raw.holds)) throw Error('Reactive constrained snapshots require explicit hold records.');
    return createConstrainedReactiveWorldSnapshot3D(registry, raw.block as ReactiveMaterialBlock3D, reactiveInteger3D(raw.tick, 0, Number.MAX_SAFE_INTEGER), raw.holds as ReactiveHold3D[]);
  }
  throw Error('Incompatible reactive world snapshot.');
}
const total = (block: ReactiveMaterialBlock3D) => reactiveEnergyTotalQ3D(block.energyQ);
function compose(before: ReactiveWorldSnapshot3D, evolution: ReactiveEvolutionResult3D, structural: ReactiveStructureResult3D, holdReport?: ReactiveHoldTickReport3D): ReactiveWorldTickResult3D {
  const block = structural.block, n = block.packedCells.length, initialQ = total(before.block), finalQ = total(block);
  if (initialQ !== finalQ || BigInt(evolution.report.reactions.energy.beforeQ) !== initialQ ||
    BigInt(evolution.report.reactions.energy.afterQ) !== initialQ || BigInt(structural.report.energy.beforeQ) !== initialQ ||
    BigInt(structural.report.energy.afterQ) !== initialQ) throw Error('Reactive world tick lost conserved energy.');
  const evolutionDestinations = new Int32Array(n), structuralDestinations = new Int32Array(n);
  for (let i = 0; i < n; i++) evolutionDestinations[i] = structuralDestinations[i] = i;
  const origins = new Int32Array(n), touched = new Uint8Array(n), touchedOrigins = new Uint8Array(n);
  for (const move of evolution.report.movement.moves) evolutionDestinations[move.from] = move.to;
  for (let i = 0; i < n; i++) origins[evolutionDestinations[i]] = i;
  for (const i of evolution.report.touchedCells) touched[i] = 1;
  for (const i of evolution.report.movement.touchedOrigins) touchedOrigins[i] = 1;
  for (const i of structural.report.changedCells) touched[i] = 1;
  for (const move of structural.report.moves) {
    structuralDestinations[move.from] = move.to; touched[move.from] = touched[move.to] = 1; touchedOrigins[origins[move.from]] = 1;
  }
  const report: ReactiveWorldTickReport3D = {rulesVersion: before.rulesVersion, materialCatalogHash: block.materialCatalogHash,
    fromTick: before.tick, toTick: before.tick + 1, changedCells: [], touchedCells: [], touchedOrigins: [], moves: [],
    evolution: evolution.report, structure: structural.report, energy: {beforeQ: initialQ.toString(), afterQ: finalQ.toString(), externalQ: '0', driftQ: '0'}};
  for (let i = 0; i < n; i++) {
    const destination = structuralDestinations[evolutionDestinations[i]];
    if (destination !== i) report.moves.push({from: i, to: destination});
    if (touched[i]) report.touchedCells.push(i); if (touchedOrigins[i]) report.touchedOrigins.push(i);
    if (block.packedCells[i] !== before.block.packedCells[i] || block.energyQ[i] !== before.block.energyQ[i] || block.structure[i] !== before.block.structure[i]) report.changedCells.push(i);
  }
  if (holdReport) report.holds = holdReport;
  const state: ReactiveWorldSnapshot3D = before.schemaVersion === 2 ? {...before, tick: before.tick + 1, block, holds: holdReport!.after} : {...before, tick: before.tick + 1, block};
  return {state, report};
}

type EvolutionStage = ReturnType<typeof startReactiveEvolutionJob3D>;
type StructureStage = ReturnType<typeof startReactiveStructureJob3D>;
/** One evolution pass, preparation boundary, bounded graph slice, or publication per call.
 * Evolution, allocation, validation and publication are still full-block O(cells).
 */
export function createReactiveWorldTickJob3D(registry: ReactiveMaterialRegistry3D, raw: ReactiveWorldSnapshot3D, options: ReactiveTickOptions3D = {}): ReactiveWorldTickJob3D {
  const captureOptions = readReactiveTickOptions3D(options);
  return worldTickJob(registry, readReactiveWorldSnapshot3D(registry, raw), captureOptions);
}
/** Internal only: an owned validated snapshot whose block and holds the job reads without copying. */
export function startReactiveWorldTickJob3D(registry: ReactiveMaterialRegistry3D, owned: ReactiveWorldSnapshot3D, options: ReactiveTickOptions3D = {}): ReactiveWorldTickJob3D {
  return worldTickJob(registry, owned, readReactiveTickOptions3D(options));
}
function worldTickJob(registry: ReactiveMaterialRegistry3D, owned: ReactiveWorldSnapshot3D, captureOptions: ReturnType<typeof readReactiveTickOptions3D>): ReactiveWorldTickJob3D {
  let before: ReactiveWorldSnapshot3D | null = owned;
  if (before.tick === Number.MAX_SAFE_INTEGER) throw Error('Reactive world tick would overflow.');
  const initialHolds = copyReactiveHolds3D(reactiveSnapshotHolds3D(before)), movementCells = reactiveHeldCells3D(initialHolds);
  const capture = createReactiveMotionCapture3D(before, captureOptions);
  let structureHolds: ReactiveHold3D[] = [], retired: ReactiveHoldTickReport3D['retired'] = [];
  const initialEvolution: ReactiveEvolutionState3D = {schemaVersion: 1, rulesVersion: REACTIVE_EVOLUTION_RULES_3D, tick: before.tick,
    block: initialHolds.length ? overlayReactiveHolds3D(before.block, initialHolds) : before.block};
  let evolution: EvolutionStage | null = startReactiveEvolutionJob3D(registry, initialEvolution, captureOptions.enabled ? {
    swap: capture.swap, pass: (index, block) => capture.pass(index, capture.recording() && initialHolds.length ? stripReactiveHoldAnchors3D(before!.block, block, initialHolds) : block),
  } : undefined);
  let evolutionResult: ReactiveEvolutionResult3D | null = null, structure: StructureStage | null = null;
  let result: ReactiveWorldTickResult3D | null = null, structureProgress: ReactiveStructureProgress3D | null = null;
  let motion: ReactiveMotionReport3D | null = null;
  let status: ReactiveWorldTickProgress3D['status'] = 'running', phase: ReactiveWorldTickPhase3D = 'evolution', evolutionPasses = 0;
  const progress = (): ReactiveWorldTickProgress3D => ({status, phase, evolutionPasses, structure: structureProgress ? {...structureProgress} : null});
  const release = () => {before = null; evolution = null; evolutionResult = null; structure = null;};
  const cancel = () => {
    if (status !== 'running') return false;
    evolution?.job.cancel(); structure?.job.cancel(); if (structure) structureProgress = structure.job.progress();
    release(); capture.release(); status = 'cancelled'; return true;
  };
  return Object.freeze({progress, cancel,
    advance(structuralWork: number = 64) {
      reactiveInteger3D(structuralWork, 1, REACTIVE_STRUCTURE_MAX_WORK_3D);
      if (status !== 'running' || !before) throw Error('Reactive world tick job is no longer running.');
      try {
        if (phase === 'evolution') {
          evolutionPasses = evolution!.job.advance().completedPasses;
          if (evolutionPasses === 28) phase = 'structure-prepare';
        } else if (phase === 'structure-prepare') {
          evolutionResult = evolution!.output(); evolution = null;
          if (initialHolds.length) {
            const touched = new Set(evolutionResult.report.movement.touchedOrigins);
            if (movementCells.some(i => touched.has(i))) throw Error('Held reactive matter moved during evolution.');
            const reactions = evolutionResult.report.reactions, transformed = new Set([...reactions.phaseChangedCells, ...reactions.extinguishedCells]);
            for (const pair of reactions.reactedPairs) {transformed.add(pair.fuel); transformed.add(pair.oxidizer);}
            evolutionResult.state.block = stripReactiveHoldAnchors3D(before.block, evolutionResult.state.block, initialHolds);
            const retirement = retireReactiveHolds3D(registry, before.block, evolutionResult.state.block, initialHolds, transformed);
            structureHolds = retirement.holds; retired = retirement.retired;
          }
          const structuralInput = structureHolds.length ? overlayReactiveHolds3D(evolutionResult.state.block, structureHolds) : evolutionResult.state.block;
          structure = startReactiveStructureJob3D(registry, structuralInput); structureProgress = structure.job.progress(); phase = 'structure';
        } else if (phase === 'structure') {
          structureProgress = structure!.job.advance(structuralWork); if (structureProgress.status === 'complete') phase = 'publish';
        } else if (phase === 'publish') {
          const structural = structure!.output(), structureCells = reactiveHeldCells3D(structureHolds), moved = new Set(structural.report.moves.map(m => m.from));
          if (structureCells.some(i => moved.has(i))) throw Error('Held reactive matter moved during structural settlement.');
          if (structureHolds.length) structural.block = stripReactiveHoldAnchors3D(evolutionResult!.state.block, structural.block, structureHolds);
          const holdReport: ReactiveHoldTickReport3D | undefined = before.schemaVersion === 2 ? {rulesVersion: REACTIVE_HOLD_RULES_3D,
            before: initialHolds, after: copyReactiveHolds3D(structureHolds.filter(h => h.expiresAtTick > before!.tick + 1)),
            expired: initialHolds.filter(h => h.expiresAtTick <= before!.tick + 1).map(h => h.id), retired, movementCells, structureCells} : undefined;
          const composed = compose(before, evolutionResult!, structural, holdReport);
          if (captureOptions.enabled) {capture.structure(structural.report); capture.pass(28, structural.block);}
          motion = capture.result(); capture.release();
          // Surviving holds are validated against the published block before the snapshot is handed over.
          const state = composed.state;
          result = state.schemaVersion === 2 ? {...composed, state: {schemaVersion: 2, rulesVersion: REACTIVE_CONSTRAINED_WORLD_RULES_3D, holdRulesVersion: REACTIVE_HOLD_RULES_3D,
            tick: state.tick, block: state.block, holds: validateReactiveHolds3D(registry, state.holds, state.tick, state.block)}} : composed;
          release(); status = 'complete'; phase = 'complete';
        }
      } catch (error) {cancel(); throw error;}
      return progress();
    },
    result() {if (!result || status !== 'complete') throw Error('Reactive world tick result is not complete.'); return cloneReactiveData3D(result);},
    motion() {if (!motion || status !== 'complete') throw Error('Reactive world motion is not complete.'); return cloneReactiveData3D(motion);},
  });
}
