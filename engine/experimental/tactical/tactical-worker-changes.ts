/** Validate portable endpoint reports without re-running a structural solve. */
import {
  CHANGE_REPORT_RULES_VERSION_3D,
  CHANGE_REPORT_LIMITS_3D,
  type ChangeReportOptions3D,
  type GameplayChangeReport3D,
} from '../gameplay/change-reports.js';
import { copyPortableValue } from '../../portable-data.js';
import { checkedInteger } from '../../validation.js';
import { fields, sameRevision } from './tactical-worker-wire.js';
import type {
  TacticalRevision3D,
  TacticalSessionSnapshot3D,
  TacticalValue,
} from './tactical-session-view.js';

const channels = [
  'material',
  'phase',
  'energy',
  'temperature',
  'structure',
  'constraints',
  'support',
];
export function changeOptionsData(value: ChangeReportOptions3D = {}): { maxRuns: number } {
  fields(value, [], ['maxRuns']);
  return {
    maxRuns: checkedInteger(
      value.maxRuns === undefined ? CHANGE_REPORT_LIMITS_3D.defaultRuns : value.maxRuns,
      0,
      CHANGE_REPORT_LIMITS_3D.maxRuns,
      'change report run budget',
    ),
  };
}
export function portableChanges(value: GameplayChangeReport3D): GameplayChangeReport3D {
  return copyPortableValue(value as unknown as TacticalValue) as unknown as GameplayChangeReport3D;
}
function integer(value: unknown, min: number, max: number) {
  return checkedInteger(value as number, min, max, 'worker change report');
}
export function changeReportData(
  raw: unknown,
  from: Readonly<TacticalRevision3D>,
  to: Readonly<TacticalRevision3D>,
  snapshot: TacticalSessionSnapshot3D<TacticalValue>,
  maxRuns: number,
): GameplayChangeReport3D {
  const report = copyPortableValue(raw as TacticalValue);
  fields(report, [
    'rulesVersion',
    'scope',
    'from',
    'to',
    'domains',
    'gameChanged',
    'accountingChanged',
    'supportMeaning',
    'motion',
    'runBudget',
  ]);
  fields(report.to, ['kind', 'revision']);
  fields(report.motion, ['status', 'reason', 'requiresExecutionTrace']);
  if (
    report.rulesVersion !== CHANGE_REPORT_RULES_VERSION_3D ||
    report.scope !== 'endpoints' ||
    !sameRevision(report.from, from) ||
    report.to.kind !== 'committed' ||
    !sameRevision(report.to.revision, to) ||
    report.runBudget !== maxRuns ||
    typeof report.gameChanged !== 'boolean' ||
    typeof report.accountingChanged !== 'boolean' ||
    report.supportMeaning !== 'global-endpoint-assessment' ||
    report.motion.status !== 'not-observed' ||
    report.motion.reason !== 'endpoint-states-do-not-identify-matter' ||
    report.motion.requiresExecutionTrace !== true
  )
    throw Error('Worker change report identity differs.');
  validateDomains(report.domains, snapshot, from.tick, to.tick, maxRuns);
  return report as unknown as GameplayChangeReport3D;
}
/** Shared bounded shape validation; does not recompute support or endpoint state. */
export function boundaryChangesData(
  raw: unknown,
  snapshot: TacticalSessionSnapshot3D<TacticalValue>,
  fromTick: number,
  toTick: number,
  maxRuns: number,
) {
  const value = copyPortableValue(raw as TacticalValue);
  fields(value, ['domains', 'gameChanged', 'accountingChanged', 'supportMeaning']);
  if (
    typeof value.gameChanged !== 'boolean' ||
    typeof value.accountingChanged !== 'boolean' ||
    value.supportMeaning !== 'global-endpoint-assessment'
  )
    throw Error('Invalid action change metadata.');
  validateDomains(value.domains, snapshot, fromTick, toTick, maxRuns);
  return value as unknown as Pick<
    GameplayChangeReport3D,
    'domains' | 'gameChanged' | 'accountingChanged' | 'supportMeaning'
  >;
}
function validateDomains(
  value: unknown,
  snapshot: TacticalSessionSnapshot3D<TacticalValue>,
  fromTick: number,
  toTick: number,
  maxRuns: number,
) {
  const domains = [{ id: null, terrain: snapshot.terrain }, ...snapshot.reservoirs];
  if (!Array.isArray(value) || value.length !== domains.length)
    throw Error('Worker change report domain count differs.');
  let usedRuns = 0;
  value.forEach((record: unknown, domainIndex: number) => {
    fields(record, ['domain', 'width', 'height', 'depth', 'fromTick', 'toTick', 'channels']);
    fields(record.channels, channels);
    const { id, terrain } = domains[domainIndex],
      shape = [terrain.width, terrain.height, terrain.depth],
      size = terrain.packedCells.length;
    if (
      record.domain !== id ||
      record.width !== shape[0] ||
      record.height !== shape[1] ||
      record.depth !== shape[2] ||
      record.fromTick !== fromTick ||
      record.toTick !== toTick
    )
      throw Error('Worker change report domain identity differs.');
    for (const name of channels) {
      const c = record.channels[name];
      fields(c, ['mode', 'count', 'bounds', 'runs', 'requiresFullRead']);
      const count = integer(c.count, 0, size);
      if (!Array.isArray(c.runs) || typeof c.requiresFullRead !== 'boolean')
        throw Error('Invalid worker changed-cell data.');
      if (count === 0) {
        if (c.mode !== 'unchanged' || c.bounds !== null || c.runs.length || c.requiresFullRead)
          throw Error('Invalid unchanged worker channel.');
        continue;
      }
      fields(c.bounds, ['min', 'max']);
      const { min, max } = c.bounds;
      if (!Array.isArray(min) || !Array.isArray(max) || min.length !== 3 || max.length !== 3)
        throw Error('Invalid change bounds.');
      let volume = 1;
      for (let axis = 0; axis < 3; axis++) {
        const lo = integer(min[axis], 0, shape[axis] - 1),
          hi = integer(max[axis], lo + 1, shape[axis]);
        volume *= hi - lo;
      }
      if (count > volume) throw Error('Change count exceeds its bounds.');
      if (c.mode === 'bounds') {
        if (!c.requiresFullRead || c.runs.length)
          throw Error('Coarse change channel must not include a partial run list.');
        continue;
      }
      if (c.mode !== 'runs' || c.requiresFullRead || c.runs.length === 0)
        throw Error('Invalid detailed change channel.');
      usedRuns += c.runs.length;
      if (usedRuns > maxRuns) throw Error('Worker change report exceeds its shared run budget.');
      let end = -1,
        total = 0;
      const lo = shape.slice(),
        hi = [0, 0, 0],
        width = shape[0],
        plane = width * shape[1];
      for (const run of c.runs) {
        if (!Array.isArray(run) || run.length !== 2) throw Error('Invalid changed-cell run.');
        const start = integer(run[0], 0, size - 1),
          length = integer(run[1], 1, size - start),
          last = start + length - 1;
        if (start <= end)
          throw Error('Worker change runs overlap, are out of order or are not coalesced.');
        end = start + length;
        total += length;
        const a = [start % width, Math.floor(start / width) % shape[1], Math.floor(start / plane)];
        const b = [last % width, Math.floor(last / width) % shape[1], Math.floor(last / plane)];
        if (Math.floor(start / width) !== Math.floor(last / width)) {
          a[0] = 0;
          b[0] = width - 1;
        }
        if (a[2] !== b[2]) {
          a[1] = 0;
          b[1] = shape[1] - 1;
        }
        for (let axis = 0; axis < 3; axis++) {
          lo[axis] = Math.min(lo[axis], a[axis]);
          hi[axis] = Math.max(hi[axis], b[axis] + 1);
        }
      }
      if (total !== count || lo.some((v, axis) => v !== min[axis] || hi[axis] !== max[axis]))
        throw Error('Worker change runs differ from count or complete bounds.');
    }
  });
}
