/** Validate captured action history without executing any physical rule. */
import { ACTION_JOURNAL_LIMITS_3D, ACTION_JOURNAL_RULES_3D, actionRunLimit3D, type ActionJournal3D, type ActionJournalEvent3D } from '../action-journal.js';
import { boundaryChangesData } from './tactical-worker-changes.js';
import { actionArray, actionInteger, actionReceiptData } from './tactical-worker-action.js';
import { readMotionTraceDomain3D, motionTraceEntries3D, MOTION_TRACE_LIMITS_3D, type MaterialMotionTrace3D } from '../motion-trace.js';
import { fields, sameRevision } from './tactical-worker-wire.js';
import { TACTICAL_SESSION_LIMITS_3D } from './tactical-session-core.js';
import type { ChangeTarget3D } from '../change-reports.js';
import type { TacticalPreviewCapture3D } from './tactical-preview-capture.js';
import type { TacticalRevision3D, TacticalSessionSnapshot3D, TacticalValue } from './tactical-session-view.js';

export function actionJournalData(raw: unknown, from: Readonly<TacticalRevision3D>, to: ChangeTarget3D,
  snapshot: TacticalSessionSnapshot3D<TacticalValue>, operation: number, capture: TacticalPreviewCapture3D, expectedExternalQ: bigint): ActionJournal3D {
  fields(raw, ['rulesVersion', 'scope', 'from', 'to', 'status', 'requiresReexecution', 'requiresFullRead', 'recordsObserved', 'domainTicksObserved', 'entries', 'events', 'includesInterventions', 'includesSubpassPaths']);
  fields(raw.to, Object.keys(to));
  const destination = raw.to;
  if (raw.rulesVersion !== ACTION_JOURNAL_RULES_3D || raw.scope !== 'action-boundaries' || !sameRevision(raw.from, from) || raw.to.kind !== to.kind ||
      raw.includesInterventions !== true || raw.includesSubpassPaths !== false || !['disabled', 'complete', 'coarse', 'overflow'].includes(raw.status as string) ||
      raw.requiresReexecution !== (raw.status === 'disabled' || raw.status === 'overflow') || raw.requiresFullRead !== (raw.status === 'coarse')) throw Error('Worker action journal identity differs.');
  if (to.kind === 'committed') {if (!sameRevision(raw.to.revision, to.revision)) throw Error('Action commit differs.');}
  else if (!sameRevision(destination.base, to.base) || ['branchId', 'operation', 'horizonTicks', 'completedTicks'].some(k => destination[k] !== to[k as keyof typeof to])) throw Error('Action preview differs.');
  const horizon = actionInteger(snapshot.terrain.tick - from.tick, 0, TACTICAL_SESSION_LIMITS_3D.horizonTicks);
  actionInteger(operation, 1, TACTICAL_SESSION_LIMITS_3D.operations);
  const prepared = operation - Math.max(1, Math.ceil(horizon / TACTICAL_SESSION_LIMITS_3D.requestTicks));
  if (prepared < 0) throw Error('Action preparation operation count differs.');
  const domains = [{id: null, terrain: snapshot.terrain}, ...snapshot.reservoirs], expected = prepared + horizon;
  const records = actionInteger(raw.recordsObserved, 0, expected), domainTicks = actionInteger(raw.domainTicksObserved, 0, horizon * domains.length);
  const entries = actionInteger(raw.entries, 0, ACTION_JOURNAL_LIMITS_3D.entries), input = actionArray(raw.events, ACTION_JOURNAL_LIMITS_3D.events);
  if (raw.status === 'disabled') {
    if (capture.journal || records || domainTicks || entries || input.length) throw Error('Requested action capture is missing.');
  } else {
    if (!capture.journal || records !== expected || domainTicks !== horizon * domains.length) throw Error('Action horizon coverage differs.');
    if (raw.status === 'overflow') {
      if (!expected || entries || input.length) throw Error('Overflow action journal must not expose a partial history.');
    } else if (input.length !== expected || domainTicks > ACTION_JOURNAL_LIMITS_3D.domainTicks) throw Error('Action journal coverage exceeds its budget.');
  }
  let used = 0, coarse = false, external = 0n;
  const events: ActionJournalEvent3D[] = input.map((value, i) => {
    fields(value, ['operation', 'from', 'to', 'action', 'changes', 'motion']);
    fields(value.from, ['sequence', 'tick', 'completedTicks']); fields(value.to, ['sequence', 'tick', 'completedTicks']);
    const ticking = i >= prepared, completed = Math.max(0, i - prepared), elapsed = Number(ticking), tick = from.tick + completed;
    const expectedOperation = ticking ? prepared + Math.floor(completed / TACTICAL_SESSION_LIMITS_3D.requestTicks) + 1 : i + 1;
    if (value.operation !== expectedOperation || value.from.sequence !== i || value.to.sequence !== i + 1 || value.from.tick !== tick || value.to.tick !== tick + elapsed ||
        value.from.completedTicks !== completed || value.to.completedTicks !== completed + elapsed) throw Error('Action event chronology differs.');
    const receipt = actionReceiptData(value.action, snapshot, tick, ACTION_JOURNAL_LIMITS_3D.entries - used); used += receipt.entries; external += receipt.external;
    if ((receipt.action.kind === 'tick') !== ticking) throw Error('Intervention and tick ordering differs.');
    const changes = boundaryChangesData(value.changes, snapshot, tick, tick + elapsed,
      Math.min(actionRunLimit3D(capture.journal?.maxRuns), ACTION_JOURNAL_LIMITS_3D.entries - used));
    if (changes.accountingChanged !== (receipt.external !== 0n)) throw Error('Action accounting flag differs.');
    for (const domain of changes.domains) for (const channel of Object.values(domain.channels)) {used += channel.runs.length; coarse ||= channel.requiresFullRead;}
    const frames = actionArray(value.motion, domains.length);
    if (frames.length !== (ticking ? domains.length : 0)) throw Error('Action motion domain count differs.');
    const motion = frames.map((frame, k) => {
      fields(frame, ['domain', 'trace']); const {id, terrain} = domains[k];
      if (frame.domain !== id) throw Error('Action motion domain order differs.');
      const trace = readMotionTraceDomain3D(frame.trace as MaterialMotionTrace3D, {...terrain, cellCount: terrain.packedCells.length}, tick, tick + 1,
        Math.min(capture.motion?.maxEntries ?? MOTION_TRACE_LIMITS_3D.defaultEntries, ACTION_JOURNAL_LIMITS_3D.entries - used));
      if (trace.status !== 'complete') throw Error('Complete action history contains incomplete motion.');
      used += motionTraceEntries3D(trace); return {domain: id, trace};
    });
    return {operation: expectedOperation, from: {sequence: i, tick, completedTicks: completed},
      to: {sequence: i + 1, tick: tick + elapsed, completedTicks: completed + elapsed}, action: receipt.action, changes, motion};
  });
  if (used !== entries || coarse !== (raw.status === 'coarse')) throw Error('Action detail count or coarse status differs.');
  if ((raw.status === 'complete' || raw.status === 'coarse') && external !== expectedExternalQ) throw Error('Action history differs from acknowledged energy accounting.');
  return {rulesVersion: ACTION_JOURNAL_RULES_3D, scope: 'action-boundaries', from: Object.freeze({...from}), to: structuredClone(to),
    status: raw.status as ActionJournal3D['status'], requiresReexecution: raw.requiresReexecution as boolean, requiresFullRead: coarse,
    recordsObserved: records, domainTicksObserved: domainTicks, entries, events, includesInterventions: true, includesSubpassPaths: false};
}
