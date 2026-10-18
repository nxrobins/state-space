/** Read-only validation of captured correspondence; endpoints never imply motion. */
import { previewCaptureOptions3D, type TacticalPreviewCapture3D } from './tactical-preview-capture.js';
import { MOTION_JOURNAL_RULES_3D, MOTION_TRACE_LIMITS_3D, readMotionTraceDomain3D, motionTraceEntries3D,
  type MotionJournal3D, type MaterialMotionTrace3D } from './motion-trace.js';
import { TACTICAL_SESSION_LIMITS_3D } from './tactical-session-core.js';
import { checkedInteger } from '../validation.js';
import { fields, sameRevision } from './tactical-worker-wire.js';
import type { TacticalRevision3D, TacticalSessionSnapshot3D, TacticalValue } from './tactical-session-view.js';

export function captureData(value: unknown): TacticalPreviewCapture3D {
  const options = previewCaptureOptions3D(value as TacticalPreviewCapture3D);
  return {...(options.captureMotion ? {motion: {maxEntries: options.motionMaxEntries}} : {}),
    ...(options.capturePaths ? {paths: {maxEntries: options.pathMaxEntries}} : {}),
    ...(options.captureJournal ? {journal: {maxRuns: options.journalMaxRuns}} : {})};
}
function frames(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > MOTION_TRACE_LIMITS_3D.journalRecords || Reflect.ownKeys(value).length !== value.length + 1) throw Error('Invalid bounded worker motion frames.');
  const result: unknown[] = [];
  for (let i = 0; i < value.length; i++) {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (!d || !('value' in d) || !d.enumerable) throw Error('Invalid worker motion frame data.'); result.push(d.value);
  }
  return result;
}
export function motionJournalData(value: unknown, from: Readonly<TacticalRevision3D>, to: Readonly<TacticalRevision3D>,
  snapshot: TacticalSessionSnapshot3D<TacticalValue>, capture: TacticalPreviewCapture3D): MotionJournal3D {
  fields(value, ['rulesVersion', 'scope', 'from', 'to', 'status', 'recordsObserved', 'entries', 'frames', 'includesInterventions', 'includesSubpassPaths', 'requiresReexecution']);
  fields(value.to, ['kind', 'revision']);
  if (value.rulesVersion !== MOTION_JOURNAL_RULES_3D || value.scope !== 'simulation-ticks' || !sameRevision(value.from, from) ||
      value.to.kind !== 'committed' || !sameRevision(value.to.revision, to) || value.includesInterventions !== false || value.includesSubpassPaths !== false ||
      !['disabled', 'complete', 'overflow'].includes(value.status as string) || value.requiresReexecution !== (value.status !== 'complete')) throw Error('Worker motion journal identity differs.');
  const horizon = checkedInteger(to.tick - from.tick, 0, TACTICAL_SESSION_LIMITS_3D.horizonTicks, 'motion horizon');
  const domains = [{id: null, terrain: snapshot.terrain}, ...snapshot.reservoirs], expectedRecords = horizon * domains.length;
  const recordsObserved = checkedInteger(value.recordsObserved as number, 0, expectedRecords, 'observed motion records');
  const entries = checkedInteger(value.entries as number, 0, MOTION_TRACE_LIMITS_3D.journalEntries, 'motion journal entries');
  const input = frames(value.frames), required = Boolean(capture.motion || capture.paths || capture.journal);
  if (value.status === 'disabled') {
    if (required || recordsObserved || entries || input.length) throw Error('Requested motion capture is missing.');
  } else if (recordsObserved !== expectedRecords) throw Error('Worker motion horizon coverage differs.');
  if (value.status === 'overflow' && (!expectedRecords || entries || input.length)) throw Error('Overflow motion must not expose partial detail.');
  if (value.status === 'complete' && input.length !== expectedRecords) throw Error('Incomplete worker motion domain coverage.');
  let used = 0, previousOperation = 0;
  const parsed = input.map((raw, i) => {
    fields(raw, ['domain', 'operation', 'trace']);
    const domainIndex = i % domains.length, tickIndex = Math.floor(i / domains.length), {id, terrain} = domains[domainIndex];
    const operation = checkedInteger(raw.operation as number, 1, TACTICAL_SESSION_LIMITS_3D.operations, 'motion operation');
    // Preparation is synchronous, then each 32-tick request consumes one operation.
    if (raw.domain !== id || (i > 0 && operation !== previousOperation + Number(domainIndex === 0 && tickIndex % TACTICAL_SESSION_LIMITS_3D.requestTicks === 0))) throw Error('Worker motion domain or operation order differs.');
    previousOperation = operation;
    const trace = readMotionTraceDomain3D(raw.trace as MaterialMotionTrace3D, {...terrain, cellCount: terrain.packedCells.length},
      from.tick + tickIndex, from.tick + tickIndex + 1, Math.min(capture.motion?.maxEntries ?? MOTION_TRACE_LIMITS_3D.defaultEntries, MOTION_TRACE_LIMITS_3D.journalEntries - used));
    if (trace.status !== 'complete') throw Error('Complete journal contains incomplete motion.');
    used += motionTraceEntries3D(trace);
    return {domain: id, operation, trace};
  });
  if (used !== entries) throw Error('Worker motion entry count differs.');
  return {rulesVersion: MOTION_JOURNAL_RULES_3D, scope: 'simulation-ticks', from: Object.freeze({...from}),
    to: {kind: 'committed', revision: Object.freeze({...to})}, status: value.status as MotionJournal3D['status'],
    requiresReexecution: value.status !== 'complete', includesInterventions: false, includesSubpassPaths: false, recordsObserved, entries, frames: parsed};
}
