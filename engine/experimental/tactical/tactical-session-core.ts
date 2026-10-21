import {
  copyPortableValue as copyTacticalValue,
  PORTABLE_VALUE_LIMITS,
} from '../../portable-data.js';
/** Snapshot transaction coordinator. Native execution is supplied by the public entry. */
import {
  createGameplayGeometry3D,
  GEOMETRY_RULES_VERSION_3D,
  type GeometryStamp3D,
} from '../gameplay-geometry.js';
import {
  readMotionPaths3D,
  motionPathLimits3D,
  type MaterialMotionPaths3D,
} from '../motion-paths.js';
import {
  createPathJournal3D,
  appendPathFrame3D,
  readPathJournal3D,
  motionPathEntries3D,
  tickMovement3D,
  type PathJournalData3D,
  type PathJournalFrame3D,
} from '../path-journal.js';
import {
  createActionJournal3D,
  appendActionEvent3D,
  readActionJournal3D,
  actionRunLimit3D,
  type ActionJournalData3D,
  type ActionKind3D,
  type RawAction3D,
} from '../action-journal.js';
import {
  compareGameplayChanges3D,
  observeSupport3D,
  type SupportObserver3D,
  type ChangeReportOptions3D,
  type ChangeTarget3D,
} from '../change-reports.js';
import {
  appendMotionFrame3D,
  readMotionTrace3D,
  motionJournal3D,
  motionEntryLimit3D,
  motionTraceEntries3D,
  type MotionJournalData3D,
  type MaterialMotionTrace3D,
} from '../motion-trace.js';
import {
  MATERIAL_RESERVOIR_RULES_VERSION_3D,
  copyReservoirs3D,
  validateReservoirs3D,
  compatibleReservoirs3D,
  reservoirEnergyQ3D,
  transferMaterial3D,
  type MaterialReservoir3D,
  type MaterialTransferReceipt3D,
} from '../material-reservoirs.js';
import {
  TEMPORARY_HOLD_RULES_VERSION_3D,
  copyHolds3D,
  validateHolds3D,
  addHold3D,
  removeHold3D,
  holdsAfterEdits3D,
  overlayHolds3D,
  stripHoldAnchors3D,
  holdsAfterTick3D,
  applyThermalDeltas3D,
  type ThermalInterventionReceipt3D,
} from './tactical-actions.js';
import { checkedInteger } from '../../validation.js';
import {
  createTacticalSnapshotReuse3D,
  attachTacticalSnapshotReuse3D,
  type TacticalSnapshotReuseOptions3D,
} from './tactical-snapshot-reuse.js';
import {
  applyStructuralEdits3D,
  validateStructuralSnapshot3D,
  type StructuralSnapshot3D,
} from '../structural/structural-world-core.js';
import {
  INTERVENTION_RULES_VERSION_3D,
  translateStructuralRegion3D,
  type TranslationReceipt3D,
  type TranslationRequest3D,
} from '../interventions.js';
import {
  translateStructuralRegionWithPaths3D,
  copyTranslationReceipt3D,
  translationMovement3D,
  type TranslationAction3D,
  type TranslationPathOptions3D,
} from '../translation-paths.js';
import type {
  TacticalValue,
  ThermalAccounting3D,
  TacticalSessionInitial3D,
  TacticalSessionSnapshot3D,
  TacticalRevision3D,
  TacticalBranch3D,
  TacticalBranchStatus3D,
  TacticalSession3D,
  TacticalSessionPolicy3D,
  TacticalQueryOptions3D,
  TacticalBranchOptions3D,
} from './tactical-session-view.js';

export const TACTICAL_SESSION_RULES_VERSION_3D = 'tactical-session-3';
export const TACTICAL_SESSION_LIMITS_3D = Object.freeze({
  branches: 4,
  horizonTicks: 1024,
  requestTicks: 32,
  operations: 256,
  gameNodes: PORTABLE_VALUE_LIMITS.nodes,
  gameDepth: PORTABLE_VALUE_LIMITS.depth,
  gameCharacters: PORTABLE_VALUE_LIMITS.characters,
});

/** Internal seam for inert scheduling tests, not a public alternative physics API. */
export type TacticalSimulationDriver3D = {
  load(snapshot: StructuralSnapshot3D): void | Promise<void>;
  step(): void | Promise<void>;
  motion?(): MaterialMotionTrace3D | Promise<MaterialMotionTrace3D>;
  paths?(): MaterialMotionPaths3D | Promise<MaterialMotionPaths3D>;
  snapshot(): StructuralSnapshot3D | Promise<StructuralSnapshot3D>;
  close(): void | Promise<void>;
};
export type TacticalSimulationFactory3D = (
  snapshot: StructuralSnapshot3D,
  domain: string | null,
  captureMotion: boolean,
  motionMaxEntries: number,
  capturePaths: boolean,
  pathMaxEntries: number,
) => TacticalSimulationDriver3D | Promise<TacticalSimulationDriver3D>;

function fields(
  value: object,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    required.some((key) => !Object.hasOwn(value, key)) ||
    Reflect.ownKeys(value).some(
      (key) => typeof key !== 'string' || ![...required, ...optional].includes(key),
    ) ||
    Object.values(Object.getOwnPropertyDescriptors(value)).some(
      (d) => !('value' in d) || !d.enumerable,
    )
  ) {
    throw Error('Invalid tactical record fields.');
  }
}
function identity(value: string): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(value))
    throw Error('Invalid tactical identity.');
  return value;
}
export { copyPortableValue as copyTacticalValue } from '../../portable-data.js';
function copyTerrain(terrain: StructuralSnapshot3D): StructuralSnapshot3D {
  return {
    ...terrain,
    packedCells: terrain.packedCells.slice(),
    energyQ: terrain.energyQ.slice(),
    structure: terrain.structure.slice(),
  };
}
function validTerrain(terrain: StructuralSnapshot3D): StructuralSnapshot3D {
  const state = validateStructuralSnapshot3D(terrain);
  return {
    ...terrain,
    packedCells: Array.from(state.grid),
    energyQ: Array.from(state.energyQ),
    structure: Array.from(state.structure),
  };
}
function total(terrain: StructuralSnapshot3D): bigint {
  // M5 total at its maximum cell/energy bounds remains below Number.MAX_SAFE_INTEGER.
  let sum = 0;
  for (const q of terrain.energyQ) sum += q;
  return BigInt(sum);
}
function accounting(
  value: ThermalAccounting3D,
  terrain: StructuralSnapshot3D,
  reservoirs: readonly MaterialReservoir3D[],
): ThermalAccounting3D {
  fields(value, ['initialQ', 'externalQ']);
  for (const q of [value.initialQ, value.externalQ]) {
    if (typeof q !== 'string' || q.length > 32 || !/^(0|-?[1-9][0-9]*)$/.test(q))
      throw Error('Invalid portable thermal accounting.');
  }
  if (
    BigInt(value.initialQ) < 0n ||
    BigInt(value.initialQ) + BigInt(value.externalQ) !==
      total(terrain) + reservoirEnergyQ3D(reservoirs)
  )
    throw Error('Tactical thermal accounting does not balance.');
  return { ...value };
}
function copySnapshot<T extends TacticalValue>(
  s: TacticalSessionSnapshot3D<T>,
): TacticalSessionSnapshot3D<T> {
  return {
    ...s,
    terrain: copyTerrain(s.terrain),
    game: copyTacticalValue(s.game),
    accounting: { ...s.accounting },
    holds: copyHolds3D(s.holds),
    reservoirs: copyReservoirs3D(s.reservoirs),
  };
}
// Canonical snapshots are private and replace-only. Forks share them; public reads,
// policy arguments and simulation inputs still cross an owned-copy boundary.
function revision<T extends TacticalValue>(
  s: TacticalSessionSnapshot3D<T>,
): Readonly<TacticalRevision3D> {
  return Object.freeze({
    worldId: s.worldId,
    revision: s.revision,
    tick: s.terrain.tick,
    gameRulesVersion: s.gameRulesVersion,
    physicsRulesVersion: s.terrain.rulesVersion,
    materialCatalogHash: s.terrain.materialCatalogHash,
    interventionRulesVersion: s.interventionRulesVersion,
    sessionRulesVersion: s.rulesVersion,
    constraintRulesVersion: s.constraintRulesVersion,
    storageRulesVersion: s.storageRulesVersion,
  });
}
function compatible(a: StructuralSnapshot3D, b: StructuralSnapshot3D): void {
  for (const key of [
    'schemaVersion',
    'rulesVersion',
    'worldVersion',
    'materialCatalogHash',
    'width',
    'height',
    'depth',
    'chunkSize',
  ] as const) {
    if (a[key] !== b[key]) throw Error('Tactical terrain identity/geometry changed.');
  }
}
function synchronous<T>(result: T): T {
  if (
    result &&
    typeof result === 'object' &&
    'then' in result &&
    typeof result.then === 'function'
  ) {
    // Reject asynchronous policy without leaving a rejected promise unobserved.
    void Promise.resolve(result).catch(() => {});
    throw Error('Tactical game policy must be synchronous.');
  }
  return result;
}

type Record3D<T extends TacticalValue> = {
  capturePaths: boolean;
  pathMaxEntries: number;
  paths: PathJournalData3D;
  captureJournal: boolean;
  journalMaxRuns: number;
  journal: ActionJournalData3D;
  captureMotion: boolean;
  motionMaxEntries: number;
  motion: MotionJournalData3D;
  previewId: number;
  base: Readonly<TacticalRevision3D>;
  horizon: number;
  completed: number;
  inFlightCompleted: number;
  operations: number;
  status: TacticalBranchStatus3D;
  pending: boolean;
  draft?: TacticalSessionSnapshot3D<T>;
};

/** Internal coordinator; the public factory always supplies the real M5 CPU driver. */
export function createTacticalSessionCore3D<T extends TacticalValue>(
  initial: TacticalSessionInitial3D<T>,
  factory: TacticalSimulationFactory3D,
  policy: TacticalSessionPolicy3D<T> = {},
  yieldBoundary: () => Promise<void> = () => new Promise((resolve) => setTimeout(resolve, 0)),
  supportObserver: SupportObserver3D = observeSupport3D,
  reuseOptions: TacticalSnapshotReuseOptions3D = {},
): TacticalSession3D<T> {
  const reuse = createTacticalSnapshotReuse3D(copySnapshot<T>, reuseOptions);
  fields(
    initial,
    ['worldId', 'gameRulesVersion', 'terrain', 'game'],
    ['accounting', 'holds', 'reservoirs'],
  );
  fields(policy, [], ['reduceTick', 'validateGame', 'requiresPaths', 'reduceTranslation']);
  for (const fn of [policy.reduceTick, policy.validateGame, policy.reduceTranslation])
    if (fn !== undefined && typeof fn !== 'function') throw Error('Invalid tactical policy.');
  // Copy function references so callers cannot replace rules during a pending branch.
  const reduceTick = policy.reduceTick,
    validateGame = policy.validateGame,
    reduceTranslation = policy.reduceTranslation;
  const requiresPaths =
    !Object.hasOwn(policy, 'requiresPaths') || policy.requiresPaths === undefined
      ? false
      : policy.requiresPaths;
  if (typeof requiresPaths !== 'boolean' || (requiresPaths && !reduceTick))
    throw Error('Path requirements need a synchronous game reducer.');
  const terrain = validTerrain(initial.terrain);
  const reservoirs = validateReservoirs3D(
    initial.reservoirs === undefined ? [] : initial.reservoirs,
    terrain,
  );
  let live: TacticalSessionSnapshot3D<T> = reuse.retain({
    schemaVersion: 3,
    storageRulesVersion: MATERIAL_RESERVOIR_RULES_VERSION_3D,
    reservoirs,
    constraintRulesVersion: TEMPORARY_HOLD_RULES_VERSION_3D,
    holds: validateHolds3D(initial.holds === undefined ? [] : initial.holds, terrain),
    rulesVersion: TACTICAL_SESSION_RULES_VERSION_3D,
    interventionRulesVersion: INTERVENTION_RULES_VERSION_3D,
    worldId: identity(initial.worldId),
    gameRulesVersion: identity(initial.gameRulesVersion),
    revision: 0,
    terrain,
    game: copyTacticalValue(initial.game),
    accounting: accounting(
      initial.accounting === undefined
        ? { initialQ: (total(terrain) + reservoirEnergyQ3D(reservoirs)).toString(), externalQ: '0' }
        : initial.accounting,
      terrain,
      reservoirs,
    ),
  });
  const validate = (s: TacticalSessionSnapshot3D<T>) => {
    if (
      validateGame &&
      synchronous(
        validateGame({
          game: copyTacticalValue(s.game),
          terrain: copyTerrain(s.terrain),
          holds: copyHolds3D(s.holds),
          reservoirs: copyReservoirs3D(s.reservoirs),
        }),
      ) !== true
    )
      throw Error('Game policy rejected the transaction.');
  };
  validate(live);
  const records = new WeakMap<TacticalBranch3D<T>, Record3D<T>>(),
    active = new Set<Record3D<T>>();
  let advancing: Record3D<T> | undefined,
    publishing = false,
    mutating = false,
    lastPreviewId = 0;
  const unlocked = () => {
    if (publishing || mutating) throw Error('Tactical publication or edit is in progress.');
  };
  const stop = (r: Record3D<T>, status: TacticalBranchStatus3D) => {
    r.status = status;
    r.draft = undefined;
    r.motion = { status: 'disabled', recordsObserved: 0, entries: 0, frames: [] };
    r.paths = createPathJournal3D(false);
    r.journal = createActionJournal3D(false, r.base.tick);
    if (!r.pending) active.delete(r);
  };
  const current = (r: Record3D<T>) => {
    if (r.base.revision !== live.revision && (r.status === 'ready' || r.status === 'running'))
      stop(r, 'stale');
    if (r.status !== 'ready' && r.status !== 'running')
      throw Error('Tactical branch is ' + r.status + '.');
  };
  const ready = (r: Record3D<T>) => {
    unlocked();
    current(r);
    if (r.status !== 'ready') throw Error('Tactical branch has an operation in flight.');
  };
  const invalidateOthers = () => {
    for (const r of active)
      if (r.base.revision !== live.revision && (r.status === 'ready' || r.status === 'running'))
        stop(r, 'stale');
  };
  function captureAction(
    r: Record3D<T>,
    journal: ActionJournalData3D,
    before: TacticalSessionSnapshot3D<T>,
    after: TacticalSessionSnapshot3D<T>,
    action: RawAction3D,
    completedTicks: number,
    motion: { domain: string | null; trace: MaterialMotionTrace3D }[] = [],
  ) {
    if (!r.captureJournal) return;
    appendActionEvent3D(journal, {
      operation: r.operations,
      fromTick: before.terrain.tick,
      toTick: after.terrain.tick,
      completedTicks,
      action,
      domainCount: 1 + after.reservoirs.length,
      motion,
      changes: () => {
        const previousGuard = mutating;
        mutating = true;
        try {
          return compareGameplayChanges3D(
            before,
            after,
            r.base,
            {
              kind: 'preview',
              base: r.base,
              branchId: r.previewId,
              operation: r.operations,
              horizonTicks: r.horizon,
              completedTicks,
            },
            { maxRuns: r.journalMaxRuns },
            supportObserver,
          );
        } finally {
          mutating = previousGuard;
        }
      },
    });
    current(r);
  }
  function intervention(
    kind: Exclude<ActionKind3D, 'tick'>,
    before: TacticalSessionSnapshot3D<T>,
    after: TacticalSessionSnapshot3D<T>,
    result: unknown,
  ): RawAction3D {
    if (kind === 'translate') return { kind, receipt: result as TranslationReceipt3D };
    if (kind === 'transfer') return { kind, receipt: result as MaterialTransferReceipt3D };
    if (kind === 'energy') return { kind, receipt: result as ThermalInterventionReceipt3D };
    if (kind === 'hold' || kind === 'release-hold') {
      const left = kind === 'hold' ? after.holds : before.holds,
        right = kind === 'hold' ? before.holds : after.holds;
      const hold = left.find((h) => !right.some((other) => other.id === h.id));
      if (!hold) throw Error('Missing constraint intervention receipt.');
      return { kind, hold };
    }
    return {
      kind,
      externalEnergyQ: (
        BigInt(after.accounting.externalQ) - BigInt(before.accounting.externalQ)
      ).toString(),
    };
  }
  function change<R>(
    r: Record3D<T>,
    kind: Exclude<ActionKind3D, 'tick'>,
    work: (draft: TacticalSessionSnapshot3D<T>) => {
      draft: TacticalSessionSnapshot3D<T>;
      result: R;
    },
  ): R {
    ready(r);
    mutating = true;
    r.status = 'running';
    try {
      checkedInteger(++r.operations, 1, TACTICAL_SESSION_LIMITS_3D.operations, 'branch operations');
      const next = work(r.draft!);
      current(r);
      const journal = { ...r.journal, events: r.journal.events.slice() };
      if (r.captureJournal)
        captureAction(
          r,
          journal,
          r.draft!,
          next.draft,
          intervention(kind, r.draft!, next.draft, next.result),
          r.completed,
        );
      r.draft = reuse.retain(next.draft);
      r.journal = journal;
      r.status = 'ready';
      return next.result;
    } catch (error) {
      if (r.status === 'running') stop(r, 'failed');
      throw error;
    } finally {
      mutating = false;
    }
  }
  const readChanges = (
    before: TacticalSessionSnapshot3D<T>,
    after: TacticalSessionSnapshot3D<T>,
    base: Readonly<TacticalRevision3D>,
    target: ChangeTarget3D,
    options: ChangeReportOptions3D,
  ) => {
    unlocked();
    mutating = true;
    try {
      return compareGameplayChanges3D(before, after, base, target, options, supportObserver);
    } finally {
      mutating = false;
    }
  };
  const geometryDomain = (
    snapshot: Pick<TacticalSessionSnapshot3D<T>, 'terrain' | 'reservoirs'>,
    options: TacticalQueryOptions3D,
  ) => {
    fields(options, [], ['domain']);
    const domain =
      !Object.hasOwn(options, 'domain') || options.domain === undefined ? null : options.domain;
    if (domain === null) return { domain, terrain: snapshot.terrain };
    if (typeof domain !== 'string') throw Error('Invalid query domain.');
    const reservoir = snapshot.reservoirs.find((r) => r.id === domain);
    if (!reservoir) throw Error('Unknown query domain.');
    return { domain, terrain: reservoir.terrain };
  };
  function translate(
    r: Record3D<T>,
    request: TranslationRequest3D,
    options?: TranslationPathOptions3D,
  ): { receipt: TranslationReceipt3D; action?: TranslationAction3D } {
    let action: TranslationAction3D | undefined;
    const receipt = change(r, 'translate', (draft) => {
      const input = overlayHolds3D(draft.terrain, draft.holds);
      const observed =
        options !== undefined || reduceTranslation
          ? translateStructuralRegionWithPaths3D(input, request, options)
          : undefined;
      const result = observed ?? translateStructuralRegion3D(input, request);
      const held = new Set(draft.holds.flatMap((h) => h.cells));
      if (result.receipt.sources.some((i) => held.has(i)))
        throw Error('Release held matter before translating it.');
      const terrain = stripHoldAnchors3D(draft.terrain, result.snapshot, draft.holds);
      let game = draft.game;
      if (observed) {
        const paths = observed.paths,
          beforeTerrain = draft.terrain;
        const to: GeometryStamp3D = {
          rulesVersion: GEOMETRY_RULES_VERSION_3D,
          kind: 'preview' as const,
          base: r.base,
          branchId: r.previewId,
          operation: r.operations,
          horizonTicks: r.horizon,
          completedTicks: r.completed,
          tick: terrain.tick,
          domain: null,
        };
        const from = { ...to, operation: to.operation - 1 };
        let beforeView: ReturnType<typeof createGameplayGeometry3D> | undefined,
          afterView: ReturnType<typeof createGameplayGeometry3D> | undefined;
        const beforeQueries = () => (beforeView ??= createGameplayGeometry3D(beforeTerrain, from));
        const queries = () => (afterView ??= createGameplayGeometry3D(terrain, to));
        const movement = () => translationMovement3D(from, to, paths, beforeTerrain, terrain);
        action = Object.freeze({
          receipt: copyTranslationReceipt3D(result.receipt),
          beforeQueries,
          queries,
          movement,
        });
        if (reduceTranslation)
          game = copyTacticalValue(
            synchronous(
              reduceTranslation({
                game: copyTacticalValue(game),
                receipt: copyTranslationReceipt3D(result.receipt),
                tick: terrain.tick,
                beforeQueries,
                queries,
                movement,
              }),
            ),
          );
      }
      return { draft: { ...draft, terrain, game }, result: result.receipt };
    });
    return { receipt, action };
  }
  const session = Object.freeze<TacticalSession3D<T>>({
    get revision() {
      return revision(live);
    },
    snapshot: () => copySnapshot(live),
    queries(options = {}) {
      const committed = live,
        selected = geometryDomain(committed, options);
      return createGameplayGeometry3D(selected.terrain, {
        rulesVersion: GEOMETRY_RULES_VERSION_3D,
        kind: 'committed',
        revision: revision(committed),
        tick: selected.terrain.tick,
        domain: selected.domain,
      });
    },
    branch(options: TacticalBranchOptions3D) {
      unlocked();
      fields(
        options,
        ['horizonTicks'],
        [
          'captureMotion',
          'motionMaxEntries',
          'captureJournal',
          'journalMaxRuns',
          'capturePaths',
          'pathMaxEntries',
        ],
      );
      const capturePaths =
        Object.hasOwn(options, 'capturePaths') && options.capturePaths !== undefined
          ? options.capturePaths
          : requiresPaths;
      if (typeof capturePaths !== 'boolean' || (requiresPaths && !capturePaths))
        throw Error('Invalid or disabled required path capture.');
      const pathMaxEntries = motionPathLimits3D({
        maxPathEntries: Object.hasOwn(options, 'pathMaxEntries')
          ? options.pathMaxEntries
          : undefined,
      }).pathLimit;
      if (
        !capturePaths &&
        Object.hasOwn(options, 'pathMaxEntries') &&
        options.pathMaxEntries !== undefined
      )
        throw Error('Path detail options require capture.');
      const captureJournal =
        Object.hasOwn(options, 'captureJournal') && options.captureJournal !== undefined
          ? options.captureJournal
          : false;
      if (typeof captureJournal !== 'boolean')
        throw Error('Invalid action journal capture option.');
      const journalMaxRuns = actionRunLimit3D(
        Object.hasOwn(options, 'journalMaxRuns') ? options.journalMaxRuns : undefined,
      );
      if (
        !captureJournal &&
        Object.hasOwn(options, 'journalMaxRuns') &&
        options.journalMaxRuns !== undefined
      )
        throw Error('Journal detail options require capture.');
      const captureMotion =
        Object.hasOwn(options, 'captureMotion') && options.captureMotion !== undefined
          ? options.captureMotion
          : captureJournal || capturePaths;
      if (typeof captureMotion !== 'boolean') throw Error('Invalid motion capture option.');
      if (captureJournal && !captureMotion) throw Error('Action journal requires motion capture.');
      if (capturePaths && !captureMotion) throw Error('Path capture requires net motion capture.');
      const motionMaxEntries = motionEntryLimit3D({
        maxEntries: Object.hasOwn(options, 'motionMaxEntries')
          ? options.motionMaxEntries
          : undefined,
      });
      if (
        !captureMotion &&
        Object.hasOwn(options, 'motionMaxEntries') &&
        options.motionMaxEntries !== undefined
      )
        throw Error('Motion detail options require capture.');
      const horizon = checkedInteger(
        options.horizonTicks,
        0,
        TACTICAL_SESSION_LIMITS_3D.horizonTicks,
        'branch horizon',
      );
      checkedInteger(live.terrain.tick + horizon, 0, Number.MAX_SAFE_INTEGER, 'branch end tick');
      invalidateOthers();
      if (active.size >= TACTICAL_SESSION_LIMITS_3D.branches)
        throw Error('Tactical branch budget exhausted; discard a branch first.');
      const r: Record3D<T> = {
        capturePaths,
        pathMaxEntries,
        paths: createPathJournal3D(capturePaths),
        captureJournal,
        journalMaxRuns,
        journal: createActionJournal3D(captureJournal, live.terrain.tick),
        captureMotion,
        motionMaxEntries,
        motion: {
          status: captureMotion ? 'complete' : 'disabled',
          recordsObserved: 0,
          entries: 0,
          frames: [],
        },
        previewId: (lastPreviewId = checkedInteger(
          lastPreviewId + 1,
          1,
          Number.MAX_SAFE_INTEGER,
          'preview identity',
        )),
        base: revision(live),
        horizon,
        completed: 0,
        inFlightCompleted: 0,
        operations: 0,
        status: 'ready',
        pending: false,
        draft: reuse.fork(live),
      };
      const branch = Object.freeze<TacticalBranch3D<T>>({
        get base() {
          return r.base;
        },
        get status() {
          return r.status;
        },
        get progress() {
          return {
            horizonTicks: r.horizon,
            completedTicks: r.completed,
            inFlightCompletedTicks: r.inFlightCompleted,
          };
        },
        inspect() {
          ready(r);
          return {
            ...copySnapshot(r.draft!),
            preview: {
              base: r.base,
              branchId: r.previewId,
              operation: r.operations,
              horizonTicks: r.horizon,
              completedTicks: r.completed,
            },
          };
        },
        queries(options = {}) {
          ready(r);
          const selected = geometryDomain(r.draft!, options);
          return createGameplayGeometry3D(selected.terrain, {
            rulesVersion: GEOMETRY_RULES_VERSION_3D,
            kind: 'preview',
            base: r.base,
            branchId: r.previewId,
            operation: r.operations,
            horizonTicks: r.horizon,
            completedTicks: r.completed,
            tick: selected.terrain.tick,
            domain: selected.domain,
          });
        },
        motion() {
          ready(r);
          return motionJournal3D(r.motion, r.base, {
            kind: 'preview',
            base: r.base,
            branchId: r.previewId,
            operation: r.operations,
            horizonTicks: r.horizon,
            completedTicks: r.completed,
          });
        },
        paths() {
          ready(r);
          return readPathJournal3D(r.paths, r.base, {
            kind: 'preview',
            base: r.base,
            branchId: r.previewId,
            operation: r.operations,
            horizonTicks: r.horizon,
            completedTicks: r.completed,
          });
        },
        journal() {
          ready(r);
          return readActionJournal3D(r.journal, r.base, {
            kind: 'preview',
            base: r.base,
            branchId: r.previewId,
            operation: r.operations,
            horizonTicks: r.horizon,
            completedTicks: r.completed,
          });
        },
        changes(options = {}) {
          ready(r);
          return readChanges(
            live,
            r.draft!,
            r.base,
            {
              kind: 'preview',
              base: r.base,
              branchId: r.previewId,
              operation: r.operations,
              horizonTicks: r.horizon,
              completedTicks: r.completed,
            },
            options,
          );
        },
        edit(edits) {
          change(r, 'edit', (draft) => {
            const state = validateStructuralSnapshot3D(draft.terrain);
            const edited = applyStructuralEdits3D(state, edits, draft.terrain);
            const next = {
              ...draft,
              holds: holdsAfterEdits3D(draft.holds, edits, draft.terrain),
              terrain: {
                ...draft.terrain,
                packedCells: Array.from(edited.state.grid),
                energyQ: Array.from(edited.state.energyQ),
                structure: Array.from(edited.state.structure),
              },
              accounting: {
                ...draft.accounting,
                externalQ: (BigInt(draft.accounting.externalQ) + edited.externalQ).toString(),
              },
            };
            accounting(next.accounting, next.terrain, next.reservoirs);
            return { draft: next, result: undefined };
          });
        },
        translate(request) {
          return translate(r, request).receipt;
        },
        translateWithMotion(request, options = {}) {
          return translate(r, request, options).action!;
        },
        transfer(request) {
          return change(r, 'transfer', (draft) => {
            const result = transferMaterial3D(
              overlayHolds3D(draft.terrain, draft.holds),
              draft.reservoirs,
              request,
            );
            const held = new Set(draft.holds.flatMap((h) => h.cells));
            if (result.receipt.from === null && result.receipt.sources.some((i) => held.has(i)))
              throw Error('Release held matter before transferring it.');
            const next = {
              ...draft,
              terrain: stripHoldAnchors3D(draft.terrain, result.terrain, draft.holds),
              reservoirs: result.reservoirs,
            };
            accounting(next.accounting, next.terrain, next.reservoirs);
            return { draft: next, result: result.receipt };
          });
        },
        hold(request) {
          change(r, 'hold', (draft) => ({
            draft: { ...draft, holds: addHold3D(draft.terrain, draft.holds, request) },
            result: undefined,
          }));
        },
        releaseHold(id) {
          change(r, 'release-hold', (draft) => ({
            draft: { ...draft, holds: removeHold3D(draft.holds, id) },
            result: undefined,
          }));
        },
        addEnergy(deltas) {
          return change(r, 'energy', (draft) => {
            const result = applyThermalDeltas3D(draft.terrain, deltas);
            const next = {
              ...draft,
              terrain: result.terrain,
              accounting: {
                ...draft.accounting,
                externalQ: (
                  BigInt(draft.accounting.externalQ) + BigInt(result.receipt.externalQ)
                ).toString(),
              },
            };
            accounting(next.accounting, next.terrain, next.reservoirs);
            return { draft: next, result: result.receipt };
          });
        },
        setGame(game) {
          change(r, 'game', (draft) => ({
            draft: { ...draft, game: copyTacticalValue(game) },
            result: undefined,
          }));
        },
        updateGame(reducer) {
          change(r, 'game', (draft) => {
            if (typeof reducer !== 'function')
              throw Error('Game update requires a synchronous reducer.');
            const game = copyTacticalValue(synchronous(reducer(copyTacticalValue(draft.game))));
            return { draft: { ...draft, game }, result: undefined };
          });
        },
        async advance(ticks, options = {}) {
          ready(r);
          if (advancing) throw Error('A tactical advancement is already in flight.');
          r.status = 'running';
          r.pending = true;
          advancing = r;
          try {
            fields(options, [], ['signal']);
            if (options.signal !== undefined && !(options.signal instanceof AbortSignal))
              throw Error('Invalid cancellation signal.');
            checkedInteger(ticks, 0, TACTICAL_SESSION_LIMITS_3D.requestTicks, 'advancement ticks');
            checkedInteger(r.completed + ticks, 0, r.horizon, 'completed horizon');
            checkedInteger(
              ++r.operations,
              1,
              TACTICAL_SESSION_LIMITS_3D.operations,
              'branch operations',
            );
            const signal = options.signal;
            const checkpoint = () => {
              if (signal?.aborted && r.status === 'running') stop(r, 'discarded');
              current(r);
            };
            checkpoint();
            let working = reuse.fork(r.draft!);
            const motion: MotionJournalData3D = { ...r.motion, frames: r.motion.frames.slice() };
            const pathJournal: PathJournalData3D = { ...r.paths, frames: r.paths.frames.slice() };
            const journal: ActionJournalData3D = { ...r.journal, events: r.journal.events.slice() };
            if (ticks) {
              await yieldBoundary();
              checkpoint();
              const drivers: TacticalSimulationDriver3D[] = [];
              const closeAll = async () => {
                const errors: unknown[] = [];
                while (drivers.length) {
                  const driver = drivers.pop()!;
                  try {
                    await driver.close();
                  } catch (error) {
                    errors.push(error);
                  }
                }
                return errors;
              };
              let hadHolds = working.holds.length > 0;
              try {
                drivers.push(
                  await factory(
                    overlayHolds3D(working.terrain, working.holds),
                    null,
                    r.captureMotion,
                    r.motionMaxEntries,
                    r.capturePaths,
                    r.pathMaxEntries,
                  ),
                );
                checkpoint();
                for (const reservoir of working.reservoirs) {
                  await yieldBoundary();
                  checkpoint();
                  drivers.push(
                    await factory(
                      copyTerrain(reservoir.terrain),
                      reservoir.id,
                      r.captureMotion,
                      r.motionMaxEntries,
                      r.capturePaths,
                      r.pathMaxEntries,
                    ),
                  );
                  checkpoint();
                }
                for (let k = 0; k < ticks; k++) {
                  if (k) {
                    await yieldBoundary();
                    checkpoint();
                    if (hadHolds) {
                      await drivers[0].load(overlayHolds3D(working.terrain, working.holds));
                      checkpoint();
                    }
                  }
                  hadHolds = working.holds.length > 0;
                  let next = working.terrain;
                  const reservoirs: MaterialReservoir3D[] = [];
                  const tickMotion: { domain: string | null; trace: MaterialMotionTrace3D }[] = [];
                  const tickPaths = new Map<string | null, PathJournalFrame3D>();
                  // Separate domains share a logical tick but never overlap execution.
                  // No game policy or branch state observes a partial domain boundary.
                  for (let i = 0; i < drivers.length; i++) {
                    if (i) {
                      await yieldBoundary();
                      checkpoint();
                    }
                    await drivers[i].step();
                    checkpoint();
                    const published = validTerrain(await drivers[i].snapshot());
                    checkpoint();
                    const previous = i ? working.reservoirs[i - 1].terrain : working.terrain;
                    compatible(previous, published);
                    if (published.tick !== previous.tick + 1)
                      throw Error('Simulation did not publish exactly one complete tick.');
                    if (total(published) !== total(previous))
                      throw Error('Closed simulation changed total energy.');
                    if (r.captureMotion) {
                      const driver = drivers[i];
                      if (!driver.motion)
                        throw Error('Simulation driver did not provide requested motion capture.');
                      const trace = readMotionTrace3D(await driver.motion(), previous, published);
                      checkpoint();
                      if (motionTraceEntries3D(trace) > r.motionMaxEntries)
                        throw Error('Simulation motion exceeded its requested detail budget.');
                      if (r.capturePaths) {
                        if (!driver.paths)
                          throw Error('Simulation driver did not provide requested paths.');
                        const paths = readMotionPaths3D(
                          await driver.paths(),
                          trace,
                          previous,
                          published,
                        );
                        checkpoint();
                        if (motionPathEntries3D(paths) > r.pathMaxEntries)
                          throw Error('Simulation paths exceeded their requested detail budget.');
                        const frame = {
                          domain: i ? working.reservoirs[i - 1].id : null,
                          operation: r.operations,
                          motion: trace,
                          paths,
                        };
                        appendPathFrame3D(pathJournal, frame);
                        tickPaths.set(frame.domain, frame);
                      }
                      appendMotionFrame3D(motion, {
                        domain: i ? working.reservoirs[i - 1].id : null,
                        operation: r.operations,
                        trace,
                      });
                      if (r.captureJournal)
                        tickMotion.push({ domain: i ? working.reservoirs[i - 1].id : null, trace });
                    }
                    if (i === 0)
                      next = stripHoldAnchors3D(working.terrain, published, working.holds);
                    else reservoirs.push({ id: working.reservoirs[i - 1].id, terrain: published });
                  }
                  const holds = holdsAfterTick3D(working.terrain, next, working.holds);
                  // Retained lazy queries need this tick's terrain, not prior game/AP data.
                  const tickBoundary = { terrain: next, reservoirs };
                  const beforeBoundary = {
                    terrain: working.terrain,
                    reservoirs: working.reservoirs,
                  };
                  const tickIdentity = {
                    rulesVersion: GEOMETRY_RULES_VERSION_3D,
                    kind: 'preview',
                    base: r.base,
                    branchId: r.previewId,
                    operation: r.operations,
                    horizonTicks: r.horizon,
                    completedTicks: r.completed + k + 1,
                    tick: next.tick,
                  } as const;
                  const beforeIdentity = {
                    ...tickIdentity,
                    completedTicks: tickIdentity.completedTicks - 1,
                    tick: working.terrain.tick,
                  };
                  const queryViews = new Map<
                    string | null,
                    ReturnType<typeof createGameplayGeometry3D>
                  >();
                  const beforeViews = new Map<
                    string | null,
                    ReturnType<typeof createGameplayGeometry3D>
                  >();
                  const queries = (options: TacticalQueryOptions3D = {}) => {
                    const selected = geometryDomain(tickBoundary, options);
                    let view = queryViews.get(selected.domain);
                    if (!view) {
                      view = createGameplayGeometry3D(selected.terrain, {
                        ...tickIdentity,
                        domain: selected.domain,
                      });
                      queryViews.set(selected.domain, view);
                    }
                    return view;
                  };
                  const beforeQueries = (options: TacticalQueryOptions3D = {}) => {
                    const selected = geometryDomain(beforeBoundary, options);
                    let view = beforeViews.get(selected.domain);
                    if (!view) {
                      view = createGameplayGeometry3D(selected.terrain, {
                        ...beforeIdentity,
                        domain: selected.domain,
                      });
                      beforeViews.set(selected.domain, view);
                    }
                    return view;
                  };
                  const movement = (options: TacticalQueryOptions3D = {}) => {
                    const selected = geometryDomain(tickBoundary, options),
                      { domain } = selected;
                    return tickMovement3D(
                      { ...beforeIdentity, domain },
                      { ...tickIdentity, domain },
                      tickPaths.get(domain),
                      {
                        before: geometryDomain(beforeBoundary, options).terrain,
                        after: selected.terrain,
                      },
                    );
                  };
                  const game = reduceTick
                    ? copyTacticalValue(
                        synchronous(
                          reduceTick({
                            game: copyTacticalValue(working.game),
                            terrain: copyTerrain(next),
                            holds: copyHolds3D(holds),
                            reservoirs: copyReservoirs3D(reservoirs),
                            tick: next.tick,
                            queries,
                            beforeQueries,
                            movement,
                          }),
                        ),
                      )
                    : working.game;
                  checkpoint();
                  const boundary = reuse.retain({
                    ...working,
                    terrain: next,
                    holds,
                    reservoirs,
                    game,
                  });
                  captureAction(
                    r,
                    journal,
                    working,
                    boundary,
                    { kind: 'tick' },
                    r.completed + k + 1,
                    tickMotion,
                  );
                  checkpoint();
                  working = boundary;
                  r.inFlightCompleted = k + 1;
                }
              } catch (error) {
                const cleanup = await closeAll();
                if (cleanup.length)
                  throw new AggregateError([error, ...cleanup], 'Simulation and cleanup failed.');
                throw error;
              }
              const cleanup = await closeAll();
              if (cleanup.length) throw new AggregateError(cleanup, 'Simulation cleanup failed.');
              await yieldBoundary();
              checkpoint();
            }
            accounting(working.accounting, working.terrain, working.reservoirs);
            r.draft = working;
            r.motion = motion;
            r.paths = pathJournal;
            r.journal = journal;
            r.completed += ticks;
            r.status = 'ready';
          } catch (error) {
            if (r.status === 'running') stop(r, 'failed');
            throw error;
          } finally {
            r.pending = false;
            r.inFlightCompleted = 0;
            advancing = undefined;
            if (r.status !== 'ready') active.delete(r);
          }
        },
        discard() {
          unlocked();
          if (r.status === 'committed') throw Error('Committed branch cannot be discarded.');
          if (r.status === 'ready' || r.status === 'running') stop(r, 'discarded');
        },
      });
      records.set(branch, r);
      active.add(r);
      return branch;
    },
    commit(branch: TacticalBranch3D<T>) {
      unlocked();
      const r = records.get(branch);
      if (!r) throw Error('Foreign or forged tactical branch.');
      ready(r);
      if (r.completed !== r.horizon) throw Error('Tactical preview horizon is incomplete.');
      publishing = true;
      try {
        const before = live,
          motion = r.motion,
          journal = r.journal,
          paths = r.paths;
        const next = reuse.retain({
          ...r.draft!,
          revision: checkedInteger(live.revision + 1, 0, Number.MAX_SAFE_INTEGER, 'revision'),
        });
        accounting(next.accounting, next.terrain, next.reservoirs);
        validate(next);
        const result = {
          snapshot: copySnapshot(next),
          motion: () =>
            motionJournal3D(motion, r.base, { kind: 'committed', revision: revision(next) }),
          paths: () =>
            readPathJournal3D(paths, r.base, { kind: 'committed', revision: revision(next) }),
          journal: () =>
            readActionJournal3D(journal, r.base, { kind: 'committed', revision: revision(next) }),
          changes: (options: ChangeReportOptions3D = {}) =>
            readChanges(
              before,
              next,
              r.base,
              { kind: 'committed', revision: revision(next) },
              options,
            ),
          receipt: {
            base: r.base,
            revision: next.revision,
            horizonTicks: r.horizon,
            endTick: next.terrain.tick,
            externalEnergyQ: (
              BigInt(next.accounting.externalQ) - BigInt(live.accounting.externalQ)
            ).toString(),
          },
        };
        // No callbacks, awaits or fallible copies after this publication point.
        stop(r, 'committed');
        live = next;
        invalidateOthers();
        return result;
      } catch (error) {
        if (r.status === 'ready') stop(r, 'failed');
        throw error;
      } finally {
        publishing = false;
      }
    },
    restore(saved: TacticalSessionSnapshot3D<T>) {
      unlocked();
      publishing = true;
      try {
        fields(saved, [
          'schemaVersion',
          'rulesVersion',
          'interventionRulesVersion',
          'worldId',
          'gameRulesVersion',
          'revision',
          'terrain',
          'game',
          'accounting',
          'constraintRulesVersion',
          'holds',
          'storageRulesVersion',
          'reservoirs',
        ]);
        if (
          saved.schemaVersion !== 3 ||
          saved.storageRulesVersion !== MATERIAL_RESERVOIR_RULES_VERSION_3D ||
          saved.constraintRulesVersion !== TEMPORARY_HOLD_RULES_VERSION_3D ||
          saved.rulesVersion !== TACTICAL_SESSION_RULES_VERSION_3D ||
          saved.interventionRulesVersion !== INTERVENTION_RULES_VERSION_3D ||
          saved.worldId !== live.worldId ||
          saved.gameRulesVersion !== live.gameRulesVersion
        )
          throw Error('Incompatible tactical snapshot.');
        checkedInteger(saved.revision, 0, Number.MAX_SAFE_INTEGER, 'saved revision');
        const terrain = validTerrain(saved.terrain);
        compatible(live.terrain, terrain);
        const reservoirs = validateReservoirs3D(saved.reservoirs, terrain);
        compatibleReservoirs3D(live.reservoirs, reservoirs);
        const next = reuse.retain({
          ...saved,
          terrain,
          reservoirs,
          holds: validateHolds3D(saved.holds, terrain),
          game: copyTacticalValue(saved.game),
          accounting: accounting(saved.accounting, terrain, reservoirs),
          revision: checkedInteger(live.revision + 1, 0, Number.MAX_SAFE_INTEGER, 'revision'),
        });
        validate(next);
        const result = copySnapshot(next);
        live = next;
        invalidateOthers();
        return result;
      } finally {
        publishing = false;
      }
    },
  });
  attachTacticalSnapshotReuse3D(session, reuse.stats);
  return session;
}
