/** Bounded tactical path observations. Disposable, never authoritative saves. */
import { copyMotionPaths3D, type MaterialMotionPaths3D } from './motion-paths.js';
import { copyMotionTrace3D, motionTraceEntries3D, type MaterialMotionTrace3D } from './motion-trace.js';
import type { TacticalRevision3D } from './tactical/tactical-session-view.js';
import type { ChangeTarget3D } from './change-reports.js';
import type { GeometryStamp3D } from './gameplay-geometry.js';

export const PATH_JOURNAL_RULES_3D = 'tactical-paths-1';
export const PATH_JOURNAL_LIMITS_3D = Object.freeze({records: 256, entries: 65536});
export type PathJournalFrame3D = {domain: string | null; operation: number; motion: MaterialMotionTrace3D; paths: MaterialMotionPaths3D};
export type PathJournalData3D = {status: 'disabled' | 'complete' | 'overflow'; recordsObserved: number; entries: number; frames: PathJournalFrame3D[]};
export type PathJournal3D = PathJournalData3D & {
  rulesVersion: typeof PATH_JOURNAL_RULES_3D; scope: 'simulation-ticks';
  from: Readonly<TacticalRevision3D>; to: Readonly<ChangeTarget3D>;
  includesInterventions: false; includesSubpassPaths: true; requiresReexecution: boolean;
};
export type TickMovement3D = {
  rulesVersion: typeof PATH_JOURNAL_RULES_3D; scope: 'logical-tick-domain';
  from: Readonly<GeometryStamp3D>; to: Readonly<GeometryStamp3D>;
  status: 'disabled' | 'complete' | 'overflow'; requiresReexecution: boolean;
  motion: MaterialMotionTrace3D | null; paths: MaterialMotionPaths3D | null;
};
const observations = new WeakMap<TickMovement3D, {from: Readonly<GeometryStamp3D>; to: Readonly<GeometryStamp3D>; frame?: PathJournalFrame3D; before: object; after: object}>();
/** Internal provenance, independent of mutations to the public observation copy. */
export function tickMovementSource3D(value: TickMovement3D) {
  const source = observations.get(value); if (!source) throw Error('Expected a live tick movement observation.'); return source;
}
export function createPathJournal3D(enabled: boolean): PathJournalData3D {
  return {status: enabled ? 'complete' : 'disabled', recordsObserved: 0, entries: 0, frames: []};
}
export function motionPathEntries3D(paths: MaterialMotionPaths3D): number {
  return paths.passes.reduce((count, pass) => count + 1 + pass.segments.length, 0);
}
function copyFrame(frame: PathJournalFrame3D): PathJournalFrame3D {
  return {...frame, motion: copyMotionTrace3D(frame.motion), paths: copyMotionPaths3D(frame.paths)};
}
/** Trusted coordinator input, after both portable records have been validated. */
export function appendPathFrame3D(data: PathJournalData3D, frame: PathJournalFrame3D): void {
  if (data.status === 'disabled') throw Error('Path journal capture is disabled.');
  data.recordsObserved++;
  if (data.status === 'overflow') return;
  const entries = 1 + motionTraceEntries3D(frame.motion) + motionPathEntries3D(frame.paths);
  if (frame.motion.status !== 'complete' || frame.paths.status !== 'complete' || data.recordsObserved > PATH_JOURNAL_LIMITS_3D.records || data.entries + entries > PATH_JOURNAL_LIMITS_3D.entries) {
    data.status = 'overflow'; data.frames = []; data.entries = 0; return;
  }
  data.entries += entries; data.frames.push(frame);
}
export function readPathJournal3D(data: PathJournalData3D, from: Readonly<TacticalRevision3D>, to: ChangeTarget3D): PathJournal3D {
  return {...data, frames: data.frames.map(copyFrame), rulesVersion: PATH_JOURNAL_RULES_3D, scope: 'simulation-ticks',
    from: Object.freeze({...from}), to: to.kind === 'committed' ? Object.freeze({...to, revision: Object.freeze({...to.revision})}) : Object.freeze({...to, base: Object.freeze({...to.base})}),
    includesInterventions: false, includesSubpassPaths: true, requiresReexecution: data.status !== 'complete'};
}
function stamp(value: GeometryStamp3D): Readonly<GeometryStamp3D> {
  return value.kind === 'committed' ? Object.freeze({...value, revision: Object.freeze({...value.revision})}) : Object.freeze({...value, base: Object.freeze({...value.base})});
}
export function tickMovement3D(from: GeometryStamp3D, to: GeometryStamp3D, frame?: PathJournalFrame3D, sources?: {before: object; after: object}): TickMovement3D {
  const status = !frame ? 'disabled' : frame.paths.status === 'complete' && frame.motion.status === 'complete' ? 'complete' : 'overflow';
  const result: TickMovement3D = {rulesVersion: PATH_JOURNAL_RULES_3D, scope: 'logical-tick-domain', from: stamp(from), to: stamp(to), status,
    requiresReexecution: status !== 'complete', motion: frame ? copyMotionTrace3D(frame.motion) : null, paths: frame ? copyMotionPaths3D(frame.paths) : null};
  if (sources) observations.set(result, {from: result.from, to: result.to, frame, ...sources});
  return result;
}
