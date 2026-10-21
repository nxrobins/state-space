/** Resumable global endpoint diagnostics. Proposed support-solver state is discarded. */
import { PHASE_SHIFT } from '../../generated/materials.js';
import { temperatureQ } from '../../thermal.js';
import { ANCHOR_3D } from '../structural-mechanics.js';
import {
  reactiveFields3D,
  reactiveInteger3D,
  reactiveRegistrySource3D,
  type ReactiveMaterialRegistry3D,
} from './reactive-registry.js';
import {
  reactiveGeometrySource3D,
  type ReactiveGameplayGeometry3D,
  type ReactiveGeometryStamp3D,
} from './reactive-geometry.js';
import {
  readReactiveWorldSnapshot3D,
  reactiveSnapshotHolds3D,
  type ReactiveWorldSnapshot3D,
} from './reactive-world-tick.js';
import { overlayReactiveHolds3D } from './reactive-holds.js';
import {
  createReactiveStructureJob3D,
  type ReactiveStructureJob3D,
  type ReactiveStructureReport3D,
} from './reactive-structure.js';
export const REACTIVE_CHANGE_RULES_3D = 'reactive-changes-1';
export const REACTIVE_CHANGE_LIMITS_3D = Object.freeze({ defaultRuns: 256, runs: 8192, work: 256 });
export const REACTIVE_CHANGE_CHANNELS_3D = Object.freeze([
  'packed',
  'material',
  'phase',
  'energy',
  'temperature',
  'structure',
  'constraints',
  'support',
] as const);
export type ReactiveChangeChannel3D = (typeof REACTIVE_CHANGE_CHANNELS_3D)[number];
export type ReactiveChangeOptions3D = { maxRuns?: number };
export type ReactiveChangedCells3D = {
  mode: 'unchanged' | 'runs' | 'bounds';
  count: number;
  bounds: { min: [number, number, number]; max: [number, number, number] } | null;
  runs: [number, number][];
  requiresFullRead: boolean;
};
export type ReactiveChangeReport3D = {
  rulesVersion: typeof REACTIVE_CHANGE_RULES_3D;
  scope: 'endpoints';
  from: Readonly<ReactiveGeometryStamp3D>;
  to: Readonly<ReactiveGeometryStamp3D>;
  width: number;
  height: number;
  depth: number;
  channels: Record<ReactiveChangeChannel3D, ReactiveChangedCells3D>;
  runBudget: number;
  supportMeaning: 'global-endpoint-assessment';
  motion: { status: 'not-observed'; requiresExecutionTrace: true };
};
export type ReactiveChangeProgress3D = {
  status: 'running' | 'complete' | 'cancelled';
  phase: 'scan' | 'support-before' | 'support-after' | 'support-compare' | 'complete';
  scannedCells: number;
  comparedSupportCells: number;
  totalCells: number;
};
export interface ReactiveChangeJob3D {
  progress(): ReactiveChangeProgress3D;
  advance(work?: number): ReactiveChangeProgress3D;
  cancel(): boolean;
  result(): ReactiveChangeReport3D;
}
export function readReactiveChangeOptions3D(raw: ReactiveChangeOptions3D = {}) {
  reactiveFields3D(raw, [], ['maxRuns']);
  return {
    maxRuns: Object.hasOwn(raw, 'maxRuns')
      ? reactiveInteger3D(raw.maxRuns, 0, REACTIVE_CHANGE_LIMITS_3D.runs)
      : REACTIVE_CHANGE_LIMITS_3D.defaultRuns,
  };
}
function collector(width: number, height: number, budget: { remaining: number }) {
  const result: ReactiveChangedCells3D = {
    mode: 'unchanged',
    count: 0,
    bounds: null,
    runs: [],
    requiresFullRead: false,
  };
  return {
    result,
    add(i: number) {
      const c: [number, number, number] = [
        i % width,
        Math.floor(i / width) % height,
        Math.floor(i / (width * height)),
      ];
      result.count++;
      if (!result.bounds)
        result.bounds = { min: [...c], max: c.map((v) => v + 1) as [number, number, number] };
      else
        for (let a = 0; a < 3; a++) {
          result.bounds.min[a] = Math.min(result.bounds.min[a], c[a]);
          result.bounds.max[a] = Math.max(result.bounds.max[a], c[a] + 1);
        }
      if (result.requiresFullRead) return;
      const last = result.runs[result.runs.length - 1];
      if (last && last[0] + last[1] === i) {
        last[1]++;
        return;
      }
      if (budget.remaining === 0) {
        result.mode = 'bounds';
        result.requiresFullRead = true;
        result.runs = [];
        return;
      }
      budget.remaining--;
      result.mode = 'runs';
      result.runs.push([i, 1]);
    },
  };
}
export function createReactiveChangeJob3D(
  registry: ReactiveMaterialRegistry3D,
  before: ReactiveGameplayGeometry3D,
  after: ReactiveGameplayGeometry3D,
  options: ReactiveChangeOptions3D = {},
): ReactiveChangeJob3D {
  const { maxRuns } = readReactiveChangeOptions3D(options),
    sourceA = reactiveGeometrySource3D(before),
    sourceB = reactiveGeometrySource3D(after);
  const from = structuredClone(before.stamp),
    to = structuredClone(after.stamp);
  const ra = from.kind === 'committed' ? from.revision : from.base,
    rb = to.kind === 'committed' ? to.revision : to.base;
  if (
    from.domain !== to.domain ||
    ra.worldId !== rb.worldId ||
    ra.gameRulesVersion !== rb.gameRulesVersion ||
    ra.materialCatalogHash !== rb.materialCatalogHash ||
    sourceA.shape.some((v, i) => v !== sourceB.shape[i])
  )
    throw Error('Reactive change endpoints differ.');
  let a: ReactiveWorldSnapshot3D | null = readReactiveWorldSnapshot3D(registry, sourceA.token),
    b: ReactiveWorldSnapshot3D | null = readReactiveWorldSnapshot3D(registry, sourceB.token);
  const [width, height, depth] = sourceA.shape,
    totalCells = width * height * depth,
    cold = reactiveRegistrySource3D(registry).cold;
  const holds = (s: ReactiveWorldSnapshot3D) => {
    const cells = new Map<number, { id: string; expiresAtTick: number }>();
    for (const h of reactiveSnapshotHolds3D(s))
      for (const i of h.cells) cells.set(i, { id: h.id, expiresAtTick: h.expiresAtTick });
    return cells;
  };
  const ha = holds(a),
    hb = holds(b),
    budget = { remaining: maxRuns };
  const records = Object.fromEntries(
    REACTIVE_CHANGE_CHANNELS_3D.map((k) => [k, collector(width, height, budget)]),
  ) as Record<ReactiveChangeChannel3D, ReturnType<typeof collector>>;
  let status: ReactiveChangeProgress3D['status'] = 'running',
    phase: ReactiveChangeProgress3D['phase'] = 'scan',
    scannedCells = 0,
    comparedSupportCells = 0;
  let supportChanged = false,
    supportJob: ReactiveStructureJob3D | null = null,
    sa: ReactiveStructureReport3D | null = null,
    sb: ReactiveStructureReport3D | null = null;
  let report: ReactiveChangeReport3D | null = null;
  const progress = (): ReactiveChangeProgress3D => ({
    status,
    phase,
    scannedCells,
    comparedSupportCells,
    totalCells,
  });
  const release = () => {
    supportJob?.cancel();
    supportJob = null;
    a = null;
    b = null;
    sa = null;
    sb = null;
    ha.clear();
    hb.clear();
  };
  const complete = () => {
    report = {
      rulesVersion: REACTIVE_CHANGE_RULES_3D,
      scope: 'endpoints',
      from,
      to,
      width,
      height,
      depth,
      channels: Object.fromEntries(
        REACTIVE_CHANGE_CHANNELS_3D.map((k) => [k, records[k].result]),
      ) as ReactiveChangeReport3D['channels'],
      runBudget: maxRuns,
      supportMeaning: 'global-endpoint-assessment',
      motion: { status: 'not-observed', requiresExecutionTrace: true },
    };
    release();
    phase = 'complete';
    status = 'complete';
  };
  const cancel = () => {
    if (status !== 'running') return false;
    release();
    for (const r of Object.values(records)) {
      r.result.runs = [];
      r.result.bounds = null;
    }
    status = 'cancelled';
    return true;
  };
  return Object.freeze({
    progress,
    cancel,
    advance(work = 64) {
      reactiveInteger3D(work, 1, REACTIVE_CHANGE_LIMITS_3D.work);
      if (status !== 'running' || !a || !b) throw Error('Reactive change job is not running.');
      try {
        if (phase === 'scan') {
          const end = Math.min(totalCells, scannedCells + work),
            left = a.block,
            right = b.block;
          for (; scannedCells < end; scannedCells++) {
            const i = scannedCells,
              pa = left.packedCells[i],
              pb = right.packedCells[i],
              qa = left.energyQ[i],
              qb = right.energyQ[i],
              wa = left.structure[i],
              wb = right.structure[i];
            if (pa !== pb) records.packed.add(i);
            if ((pa & 255) !== (pb & 255)) records.material.add(i);
            if (((pa >>> PHASE_SHIFT) & 15) !== ((pb >>> PHASE_SHIFT) & 15)) records.phase.add(i);
            if (qa !== qb) records.energy.add(i);
            if (
              (pa !== pb || qa !== qb) &&
              temperatureQ(pa, qa, cold) !== temperatureQ(pb, qb, cold)
            )
              records.temperature.add(i);
            if (wa !== wb) records.structure.add(i);
            const x = ha.get(i),
              y = hb.get(i);
            if (x?.id !== y?.id || x?.expiresAtTick !== y?.expiresAtTick)
              records.constraints.add(i);
            if (pa !== pb || qa !== qb || (wa | (x ? ANCHOR_3D : 0)) !== (wb | (y ? ANCHOR_3D : 0)))
              supportChanged = true;
          }
          if (scannedCells === totalCells) {
            if (supportChanged) phase = 'support-before';
            else {
              comparedSupportCells = totalCells;
              complete();
            }
          }
        } else if (phase === 'support-before' || phase === 'support-after') {
          if (!supportJob) {
            const s = phase === 'support-before' ? a : b;
            supportJob = createReactiveStructureJob3D(
              registry,
              overlayReactiveHolds3D(s.block, reactiveSnapshotHolds3D(s)),
            );
          } else if (supportJob.advance(work).status === 'complete') {
            if (phase === 'support-before') {
              sa = supportJob.result().report;
              phase = 'support-after';
            } else {
              sb = supportJob.result().report;
              phase = 'support-compare';
            }
            supportJob = null;
          }
        } else if (phase === 'support-compare') {
          const end = Math.min(totalCells, comparedSupportCells + work);
          for (; comparedSupportCells < end; comparedSupportCells++) {
            const i = comparedSupportCells;
            if (
              sa!.distances[i] !== sb!.distances[i] ||
              sa!.loads[i] !== sb!.loads[i] ||
              sa!.capacities[i] !== sb!.capacities[i] ||
              sa!.reactions[i] !== sb!.reactions[i]
            )
              records.support.add(i);
          }
          if (comparedSupportCells === totalCells) complete();
        }
      } catch (error) {
        cancel();
        throw error;
      }
      return progress();
    },
    result() {
      if (!report || status !== 'complete') throw Error('Reactive change report is incomplete.');
      return structuredClone(report);
    },
  });
}
