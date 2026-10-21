/** Bounded subpass history for one acknowledged action; never authoritative state. */
import {
  readMotionTraceDomain3D,
  motionTraceEntries3D,
  MOTION_TRACE_LIMITS_3D,
  type MaterialMotionTrace3D,
} from '../motion-trace.js';
import {
  readMotionPathsDomain3D,
  MOTION_PATH_LIMITS_3D,
  type MaterialMotionPaths3D,
} from '../gameplay/motion-paths.js';
import {
  motionPathEntries3D,
  PATH_JOURNAL_RULES_3D,
  PATH_JOURNAL_LIMITS_3D,
  type PathJournal3D,
} from '../gameplay/path-journal.js';
import { TACTICAL_SESSION_LIMITS_3D } from './tactical-session-core.js';
import { fields, sameRevision } from './tactical-worker-wire.js';
import { checkedInteger } from '../../validation.js';
import type { TacticalPreviewCapture3D } from './tactical-preview-capture.js';
import type {
  TacticalRevision3D,
  TacticalSessionSnapshot3D,
  TacticalValue,
} from './tactical-session-view.js';

function frames(value: unknown): unknown[] {
  if (
    !Array.isArray(value) ||
    value.length > PATH_JOURNAL_LIMITS_3D.records ||
    Reflect.ownKeys(value).length !== value.length + 1
  )
    throw Error('Invalid bounded worker path frames.');
  const result: unknown[] = [];
  for (let i = 0; i < value.length; i++) {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (!d || !('value' in d) || !d.enumerable) throw Error('Invalid worker path frame data.');
    result.push(d.value);
  }
  return result;
}
export function pathJournalData(
  value: unknown,
  from: Readonly<TacticalRevision3D>,
  to: Readonly<TacticalRevision3D>,
  snapshot: TacticalSessionSnapshot3D<TacticalValue>,
  capture: TacticalPreviewCapture3D,
): PathJournal3D {
  fields(value, [
    'rulesVersion',
    'scope',
    'from',
    'to',
    'status',
    'recordsObserved',
    'entries',
    'frames',
    'includesInterventions',
    'includesSubpassPaths',
    'requiresReexecution',
  ]);
  fields(value.to, ['kind', 'revision']);
  if (
    value.rulesVersion !== PATH_JOURNAL_RULES_3D ||
    value.scope !== 'simulation-ticks' ||
    !sameRevision(value.from, from) ||
    value.to.kind !== 'committed' ||
    !sameRevision(value.to.revision, to) ||
    value.includesInterventions !== false ||
    value.includesSubpassPaths !== true ||
    !['disabled', 'complete', 'overflow'].includes(value.status as string) ||
    value.requiresReexecution !== (value.status !== 'complete')
  )
    throw Error('Worker path journal identity differs.');
  const horizon = checkedInteger(
    to.tick - from.tick,
    0,
    TACTICAL_SESSION_LIMITS_3D.horizonTicks,
    'path horizon',
  );
  const domains = [{ id: null, terrain: snapshot.terrain }, ...snapshot.reservoirs],
    expectedRecords = horizon * domains.length;
  const recordsObserved = checkedInteger(
    value.recordsObserved as number,
    0,
    expectedRecords,
    'observed path records',
  );
  const entries = checkedInteger(
      value.entries as number,
      0,
      PATH_JOURNAL_LIMITS_3D.entries,
      'path journal entries',
    ),
    input = frames(value.frames);
  if (value.status === 'disabled') {
    if (capture.paths || recordsObserved || entries || input.length)
      throw Error('Requested path capture is missing.');
  } else if (recordsObserved !== expectedRecords)
    throw Error('Worker path horizon coverage differs.');
  if (value.status === 'overflow' && (!expectedRecords || entries || input.length))
    throw Error('Overflow paths must not expose partial detail.');
  if (value.status === 'complete' && input.length !== expectedRecords)
    throw Error('Incomplete worker path domain coverage.');
  let used = 0,
    previousOperation = 0;
  const parsed = input.map((raw, i) => {
    fields(raw, ['domain', 'operation', 'motion', 'paths']);
    const domainIndex = i % domains.length,
      tickIndex = Math.floor(i / domains.length),
      { id, terrain } = domains[domainIndex];
    const operation = checkedInteger(
      raw.operation as number,
      1,
      TACTICAL_SESSION_LIMITS_3D.operations,
      'path operation',
    );
    if (
      raw.domain !== id ||
      (i > 0 &&
        operation !==
          previousOperation +
            Number(domainIndex === 0 && tickIndex % TACTICAL_SESSION_LIMITS_3D.requestTicks === 0))
    )
      throw Error('Worker path domain or operation order differs.');
    previousOperation = operation;
    // Reserve frame overhead before either nested decoder allocates detail.
    if (++used > PATH_JOURNAL_LIMITS_3D.entries)
      throw Error('Worker path history exceeds its shared budget.');
    const domain = { ...terrain, cellCount: terrain.packedCells.length },
      tick = from.tick + tickIndex;
    const motion = readMotionTraceDomain3D(
      raw.motion as MaterialMotionTrace3D,
      domain,
      tick,
      tick + 1,
      Math.min(
        capture.motion?.maxEntries ?? MOTION_TRACE_LIMITS_3D.defaultEntries,
        PATH_JOURNAL_LIMITS_3D.entries - used,
      ),
    );
    if (motion.status !== 'complete')
      throw Error('Complete path journal contains incomplete motion.');
    used += motionTraceEntries3D(motion);
    const paths = readMotionPathsDomain3D(
      raw.paths as MaterialMotionPaths3D,
      motion,
      domain,
      tick,
      tick + 1,
      Math.min(
        capture.paths?.maxEntries ?? MOTION_PATH_LIMITS_3D.defaultEntries,
        PATH_JOURNAL_LIMITS_3D.entries - used,
      ),
    );
    if (paths.status !== 'complete')
      throw Error('Complete path journal contains incomplete paths.');
    used += motionPathEntries3D(paths);
    return { domain: id, operation, motion, paths };
  });
  if (used !== entries) throw Error('Worker path entry count differs.');
  return {
    rulesVersion: PATH_JOURNAL_RULES_3D,
    scope: 'simulation-ticks',
    from: Object.freeze({ ...from }),
    to: Object.freeze({ kind: 'committed', revision: Object.freeze({ ...to }) }),
    status: value.status as PathJournal3D['status'],
    requiresReexecution: value.status !== 'complete',
    includesInterventions: false,
    includesSubpassPaths: true,
    recordsObserved,
    entries,
    frames: parsed,
  };
}
