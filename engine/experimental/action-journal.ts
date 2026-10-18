/** Derived, ordered action boundaries. Never authoritative replay state. */
import { CHANGE_REPORT_LIMITS_3D, type GameplayChangeReport3D, type ChangeTarget3D } from './change-reports.js';
import { copyMotionTrace3D, motionTraceEntries3D, type MaterialMotionTrace3D } from './motion-trace.js';
import type { TranslationReceipt3D } from './interventions.js';
import type { MaterialTransferReceipt3D } from './material-reservoirs.js';
import type { TemporaryHold3D, ThermalInterventionReceipt3D } from './tactical-actions.js';
import type { TacticalRevision3D } from './tactical-session-view.js';

export const ACTION_JOURNAL_RULES_3D = 'action-boundaries-1';
export const ACTION_JOURNAL_LIMITS_3D = Object.freeze({events: 256, domainTicks: 256, entries: 65536});
export type ActionBoundary3D = {sequence: number; tick: number; completedTicks: number};
export type ActionBoundaryChanges3D = Pick<GameplayChangeReport3D, 'domains' | 'gameChanged' | 'accountingChanged' | 'supportMeaning'>;
export type PortableTranslationReceipt3D = Omit<TranslationReceipt3D, 'externalEnergyQ' | 'sources' | 'destinations' | 'releasedAnchors' | 'editedCells'> & {
  externalEnergyQ: string; sources: number[]; destinations: number[]; releasedAnchors: number[]; editedCells: number[];
};
export type ActionIntervention3D =
  | {kind: 'edit' | 'game'; externalEnergyQ: string}
  | {kind: 'translate'; receipt: PortableTranslationReceipt3D}
  | {kind: 'transfer'; receipt: MaterialTransferReceipt3D}
  | {kind: 'energy'; receipt: ThermalInterventionReceipt3D}
  | {kind: 'hold' | 'release-hold'; hold: TemporaryHold3D}
  | {kind: 'tick'};
export type ActionKind3D = ActionIntervention3D['kind'];
export type ActionJournalEvent3D = {
  operation: number; from: ActionBoundary3D; to: ActionBoundary3D; action: ActionIntervention3D;
  changes: ActionBoundaryChanges3D;
  /** Complete logical-tick domains only. Direct intervention receipts are above. */
  motion: {domain: string | null; trace: MaterialMotionTrace3D}[];
};
export type ActionJournal3D = {
  rulesVersion: typeof ACTION_JOURNAL_RULES_3D; scope: 'action-boundaries';
  from: Readonly<TacticalRevision3D>; to: Readonly<ChangeTarget3D>;
  status: 'disabled' | 'complete' | 'coarse' | 'overflow'; requiresReexecution: boolean; requiresFullRead: boolean;
  recordsObserved: number; domainTicksObserved: number; entries: number; events: ActionJournalEvent3D[];
  includesInterventions: true; includesSubpassPaths: false;
};
/** Internal receipt has not yet been made portable or exposed to the caller. */
export type RawAction3D = Exclude<ActionIntervention3D, {kind: 'translate'}> | {kind: 'translate'; receipt: TranslationReceipt3D};
export type ActionJournalData3D = Pick<ActionJournal3D, 'status' | 'recordsObserved' | 'domainTicksObserved' | 'entries' | 'events'> & {
  lastTick: number; completedTicks: number; lastOperation: number; lastKind?: ActionKind3D;
};
export function createActionJournal3D(enabled: boolean, tick: number): ActionJournalData3D {
  return {status: enabled ? 'complete' : 'disabled', recordsObserved: 0, domainTicksObserved: 0, entries: 0,
    events: [], lastTick: tick, completedTicks: 0, lastOperation: 0};
}
export function actionRunLimit3D(value: number | undefined): number {
  const limit = value === undefined ? CHANGE_REPORT_LIMITS_3D.defaultRuns : value;
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > CHANGE_REPORT_LIMITS_3D.maxRuns) throw Error('Invalid action journal run budget.');
  return limit === 0 ? 0 : limit;
}
function actionEntries(action: RawAction3D): number {
  if (action.kind === 'translate') {
    const r = action.receipt;
    return r.sources.length + r.destinations.length + r.path.length + r.cutBonds.length + r.releasedAnchors.length + r.editedCells.length;
  }
  if (action.kind === 'transfer') {
    const r = action.receipt;
    return r.sources.length + r.destinations.length + r.cutBonds.length + r.releasedAnchors.length + r.sourceEditedCells.length + r.destinationEditedCells.length;
  }
  if (action.kind === 'energy') return action.receipt.changes.length;
  if (action.kind === 'hold' || action.kind === 'release-hold') return action.hold.cells.length;
  return 0;
}
function portableAction(action: RawAction3D): ActionIntervention3D {
  if (action.kind !== 'translate') return structuredClone(action);
  const r = action.receipt;
  return {kind: 'translate', receipt: {...r, externalEnergyQ: r.externalEnergyQ.toString(),
    sources: Array.from(r.sources), destinations: Array.from(r.destinations), releasedAnchors: Array.from(r.releasedAnchors), editedCells: Array.from(r.editedCells),
    path: r.path.map(p => [p[0], p[1], p[2]]), cutBonds: r.cutBonds.map(p => [p[0], p[1]])}};
}

/** Trusted session producer; no raw public event insertion or journal restore. */
export function appendActionEvent3D(data: ActionJournalData3D, input: {
  operation: number; fromTick: number; toTick: number; completedTicks: number; action: RawAction3D;
  domainCount: number;
  /** Lazy so a known-overflow journal adds no extra support solves or copies. */
  changes: () => GameplayChangeReport3D;
  motion: {domain: string | null; trace: MaterialMotionTrace3D}[];
}): void {
  if (data.status === 'disabled') throw Error('Action journal capture is disabled.');
  const tick = input.action.kind === 'tick', elapsed = Number(tick);
  if (!Number.isSafeInteger(input.operation) || input.operation < 1 || input.operation > 256 || input.operation < data.lastOperation ||
      !Number.isSafeInteger(input.domainCount) || input.domainCount < 1 || input.domainCount > 9 ||
      (input.operation === data.lastOperation && (!tick || data.lastKind !== 'tick')) || input.fromTick !== data.lastTick ||
      input.toTick !== input.fromTick + elapsed || input.completedTicks !== data.completedTicks + elapsed ||
      input.motion.length !== (tick ? input.domainCount : 0)) throw Error('Invalid action journal boundary.');
  const from = {sequence: data.recordsObserved, tick: data.lastTick, completedTicks: data.completedTicks};
  data.recordsObserved++; data.domainTicksObserved += input.motion.length;
  data.lastTick = input.toTick; data.completedTicks = input.completedTicks; data.lastOperation = input.operation; data.lastKind = input.action.kind;
  const overflow = () => {data.status = 'overflow'; data.entries = 0; data.events = [];};
  if (data.status === 'overflow') return;
  let entries = actionEntries(input.action) + input.motion.reduce((sum, frame) => sum + motionTraceEntries3D(frame.trace), 0);
  if (data.recordsObserved > ACTION_JOURNAL_LIMITS_3D.events || data.domainTicksObserved > ACTION_JOURNAL_LIMITS_3D.domainTicks ||
      data.entries + entries > ACTION_JOURNAL_LIMITS_3D.entries || input.motion.some(frame => frame.trace.status !== 'complete')) {overflow(); return;}
  const report = input.changes();
  if (report.domains.length !== input.domainCount || report.domains.some((domain, i) => domain.fromTick !== input.fromTick || domain.toTick !== input.toTick ||
      (tick && input.motion[i].domain !== domain.domain))) throw Error('Action report domain coverage differs.');
  for (const frame of input.motion) if (frame.trace.fromTick !== input.fromTick || frame.trace.toTick !== input.toTick) throw Error('Action motion tick differs.');
  let coarse = data.status === 'coarse';
  for (const domain of report.domains) for (const channel of Object.values(domain.channels)) {
    entries += channel.runs.length; coarse ||= channel.requiresFullRead;
  }
  if (data.entries + entries > ACTION_JOURNAL_LIMITS_3D.entries) {overflow(); return;}
  const event: ActionJournalEvent3D = {operation: input.operation, from,
    to: {sequence: data.recordsObserved, tick: data.lastTick, completedTicks: data.completedTicks},
    action: portableAction(input.action),
    changes: structuredClone({domains: report.domains, gameChanged: report.gameChanged, accountingChanged: report.accountingChanged, supportMeaning: report.supportMeaning}),
    motion: input.motion.map(frame => ({domain: frame.domain, trace: copyMotionTrace3D(frame.trace)}))};
  data.events.push(event); data.entries += entries; data.status = coarse ? 'coarse' : 'complete';
}

export function readActionJournal3D(data: ActionJournalData3D, from: Readonly<TacticalRevision3D>, to: ChangeTarget3D): ActionJournal3D {
  return {rulesVersion: ACTION_JOURNAL_RULES_3D, scope: 'action-boundaries',
    from: Object.freeze({...from}), to: to.kind === 'committed' ? Object.freeze({...to, revision: Object.freeze({...to.revision})}) : Object.freeze({...to, base: Object.freeze({...to.base})}),
    status: data.status, requiresReexecution: data.status === 'disabled' || data.status === 'overflow', requiresFullRead: data.status === 'coarse',
    recordsObserved: data.recordsObserved, domainTicksObserved: data.domainTicksObserved, entries: data.entries, events: structuredClone(data.events),
    includesInterventions: true, includesSubpassPaths: false};
}
