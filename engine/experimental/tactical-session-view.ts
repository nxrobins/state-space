import type { PortableValue } from '../portable-data.js';
import type { MotionJournal3D } from './motion-trace.js';
import type { PathJournal3D, TickMovement3D } from './path-journal.js';
import type { ActionJournal3D } from './action-journal.js';
import type { GameplayChangeReport3D, ChangeReportOptions3D } from './change-reports.js';
import type { GameplayGeometry3D } from './gameplay-geometry.js';
import type { MaterialReservoir3D, MaterialTransferRequest3D, MaterialTransferReceipt3D } from './material-reservoirs.js';
import type { StructuralEdit3D, StructuralSnapshot3D } from './structural-world-core.js';
import type { TemporaryHold3D, TemporaryHoldRequest3D, ThermalDelta3D, ThermalInterventionReceipt3D } from './tactical-actions.js';
import type { TranslationReceipt3D, TranslationRequest3D } from './interventions.js';
import type { TranslationAction3D, TranslationMovement3D, TranslationPathOptions3D } from './translation-paths.js';

export type TacticalQueryOptions3D = {domain?: string | null};
export type TacticalBranchOptions3D = {horizonTicks: number; captureMotion?: boolean; motionMaxEntries?: number; captureJournal?: boolean; journalMaxRuns?: number; capturePaths?: boolean; pathMaxEntries?: number};
export type TacticalValue = PortableValue;
export type ThermalAccounting3D = { initialQ: string; externalQ: string };
export type TacticalSessionInitial3D<T extends TacticalValue> = {
  worldId: string; gameRulesVersion: string; terrain: StructuralSnapshot3D; game: T;
  accounting?: ThermalAccounting3D; holds?: readonly TemporaryHold3D[]; reservoirs?: readonly MaterialReservoir3D[];
};
export type TacticalSessionSnapshot3D<T extends TacticalValue> = {
  schemaVersion: 3; rulesVersion: 'tactical-session-3'; interventionRulesVersion: 'material-interventions-1';
  constraintRulesVersion: 'temporary-holds-1'; holds: TemporaryHold3D[];
  storageRulesVersion: 'material-reservoirs-1'; reservoirs: MaterialReservoir3D[];
  worldId: string; gameRulesVersion: string; revision: number;
  terrain: StructuralSnapshot3D; game: T; accounting: ThermalAccounting3D;
};
export type TacticalRevision3D = {
  worldId: string; revision: number; tick: number; gameRulesVersion: string;
  physicsRulesVersion: string; materialCatalogHash: string; interventionRulesVersion: string;
  sessionRulesVersion: string; constraintRulesVersion: string; storageRulesVersion: string;
};
export type TacticalBranchStatus3D = 'ready' | 'running' | 'failed' | 'discarded' | 'stale' | 'committed';
export type TacticalPreview3D<T extends TacticalValue> = TacticalSessionSnapshot3D<T> & {
  /** Distinguishes an inspected candidate from a committed save envelope. */
  preview: {base: Readonly<TacticalRevision3D>; branchId: number; operation: number; horizonTicks: number; completedTicks: number};
};
export type TacticalSessionPolicy3D<T extends TacticalValue> = {
  /** Frozen synchronous policy for conservative translations, before publication. */
  reduceTranslation?: (context: {game: T; receipt: TranslationReceipt3D; tick: number;
    beforeQueries: () => GameplayGeometry3D; queries: () => GameplayGeometry3D; movement: () => TranslationMovement3D}) => T;
  /** The reducer needs observed paths; branch options cannot disable them. */
  requiresPaths?: boolean;
  /** Pure synchronous game rule. Store all RNG/actor/turn state inside game. */
  reduceTick?: (context: {game: T; terrain: StructuralSnapshot3D; holds: TemporaryHold3D[]; reservoirs: MaterialReservoir3D[]; tick: number;
    /** Lazy isolated views of this complete tick; no physical stepping or support solve. */
    queries: (options?: TacticalQueryOptions3D) => GameplayGeometry3D;
    beforeQueries: (options?: TacticalQueryOptions3D) => GameplayGeometry3D;
    movement: (options?: TacticalQueryOptions3D) => TickMovement3D}) => T;
  /** Return exactly true to accept a complete game/terrain state. */
  validateGame?: (context: {game: T; terrain: StructuralSnapshot3D; holds: TemporaryHold3D[]; reservoirs: MaterialReservoir3D[]}) => boolean;
};
export interface TacticalBranch3D<T extends TacticalValue> {
  readonly base: Readonly<TacticalRevision3D>;
  readonly status: TacticalBranchStatus3D;
  readonly progress: {horizonTicks: number; completedTicks: number; inFlightCompletedTicks: number};
  inspect(): TacticalPreview3D<T>;
  queries(options?: TacticalQueryOptions3D): GameplayGeometry3D;
  /** Explicit CPU endpoint inspection; may run global support assessments. */
  changes(options?: ChangeReportOptions3D): GameplayChangeReport3D;
  motion(): MotionJournal3D;
  paths(): PathJournal3D;
  /** Optional ordered intervention and complete-tick reports; may be coarse. */
  journal(): ActionJournal3D;
  edit(edits: readonly StructuralEdit3D[]): void;
  translate(request: TranslationRequest3D): TranslationReceipt3D;
  translateWithMotion(request: TranslationRequest3D, options?: TranslationPathOptions3D): TranslationAction3D;
  transfer(request: MaterialTransferRequest3D): MaterialTransferReceipt3D;
  hold(request: TemporaryHoldRequest3D): void;
  releaseHold(id: string): void;
  addEnergy(deltas: readonly ThermalDelta3D[]): ThermalInterventionReceipt3D;
  setGame(game: T): void;
  /** Pure synchronous transformation under the session's mutation guard. */
  updateGame(reducer: (game: T) => T): void;
  /** One request at a time; cancellation is observed at complete-tick boundaries. */
  advance(ticks: number, options?: {signal?: AbortSignal}): Promise<void>;
  discard(): void;
}
export type TacticalCommit3D<T extends TacticalValue> = {
  snapshot: TacticalSessionSnapshot3D<T>;
  /** Retained original endpoints; does not advance or mutate committed state. */
  changes(options?: ChangeReportOptions3D): GameplayChangeReport3D;
  motion(): MotionJournal3D;
  paths(): PathJournal3D;
  journal(): ActionJournal3D;
  receipt: {base: Readonly<TacticalRevision3D>; revision: number; horizonTicks: number; endTick: number; externalEnergyQ: string};
};
export interface TacticalSession3D<T extends TacticalValue> {
  readonly revision: Readonly<TacticalRevision3D>;
  snapshot(): TacticalSessionSnapshot3D<T>;
  queries(options?: TacticalQueryOptions3D): GameplayGeometry3D;
  branch(options: TacticalBranchOptions3D): TacticalBranch3D<T>;
  commit(branch: TacticalBranch3D<T>): TacticalCommit3D<T>;
  /** Restore every authoritative coordinate; increment the live revision. */
  restore(snapshot: TacticalSessionSnapshot3D<T>): TacticalSessionSnapshot3D<T>;
}
