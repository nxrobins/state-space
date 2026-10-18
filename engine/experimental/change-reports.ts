/** Complete endpoint comparisons. Motion requires an execution trace, not a diff. */
import { PHASE_SHIFT, buildColdTable } from '../generated/materials.js';
import { temperatureQ } from '../thermal.js';
import { ANCHOR_3D, solveStructure3D } from './structural-mechanics.js';
import { overlayHolds3D, type TemporaryHold3D } from './tactical-actions.js';
import type { StructuralSnapshot3D } from './structural-world-core.js';
import type { TacticalRevision3D, TacticalSessionSnapshot3D, TacticalValue } from './tactical-session-view.js';

export const CHANGE_REPORT_RULES_VERSION_3D = 'gameplay-changes-1';
export const CHANGE_REPORT_LIMITS_3D = Object.freeze({defaultRuns: 2048, maxRuns: 4096});
export type ChangeReportOptions3D = {maxRuns?: number};
export type ChangeChannel3D = 'material' | 'phase' | 'energy' | 'temperature' | 'structure' | 'constraints' | 'support';
export type ChangedCells3D = {
  mode: 'unchanged' | 'runs' | 'bounds'; count: number;
  /** Integer cell coordinates, minimum inclusive / maximum exclusive. */
  bounds: {min: [number, number, number]; max: [number, number, number]} | null;
  /** [global x-major start, number of cells]; empty on overflow, never truncated. */
  runs: [number, number][]; requiresFullRead: boolean;
};
export type ChangeTarget3D = {kind: 'committed'; revision: Readonly<TacticalRevision3D>} | {
  kind: 'preview'; base: Readonly<TacticalRevision3D>; branchId: number;
  operation: number; horizonTicks: number; completedTicks: number;
};
export type DomainChangeReport3D = {
  domain: string | null; width: number; height: number; depth: number;
  fromTick: number; toTick: number;
  channels: Record<ChangeChannel3D, ChangedCells3D>;
};
export type GameplayChangeReport3D = {
  rulesVersion: typeof CHANGE_REPORT_RULES_VERSION_3D;
  scope: 'endpoints'; from: Readonly<TacticalRevision3D>; to: Readonly<ChangeTarget3D>;
  domains: DomainChangeReport3D[]; gameChanged: boolean; accountingChanged: boolean;
  supportMeaning: 'global-endpoint-assessment';
  motion: {status: 'not-observed'; reason: 'endpoint-states-do-not-identify-matter'; requiresExecutionTrace: true};
  runBudget: number;
};

/** Internal observation seam for inert tests. Not an alternative physics API. */
export type SupportObservation3D = {distances: Int32Array; loads: Uint32Array; capacities: Uint32Array; reactions: Uint32Array};
export type SupportObserver3D = (snapshot: StructuralSnapshot3D) => SupportObservation3D;
export const observeSupport3D: SupportObserver3D = snapshot => {
  // This is the existing global solve on private input. Its proposed state and
  // motion are discarded; no physical tick is advanced or published.
  const plan = solveStructure3D({grid: Uint32Array.from(snapshot.packedCells), energyQ: Uint32Array.from(snapshot.energyQ), structure: Uint32Array.from(snapshot.structure)}, snapshot);
  return {distances: plan.distances, loads: plan.loads, capacities: plan.capacities, reactions: plan.reactions};
};
const cold = buildColdTable();
const channels: ChangeChannel3D[] = ['material', 'phase', 'energy', 'temperature', 'structure', 'constraints', 'support'];
function options(value: ChangeReportOptions3D): number {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) ||
      Reflect.ownKeys(value).some(k => k !== 'maxRuns') ||
      Object.values(Object.getOwnPropertyDescriptors(value)).some(d => !('value' in d) || !d.enumerable)) throw Error('Invalid change report options.');
  const maximum = Object.hasOwn(value, 'maxRuns') && value.maxRuns !== undefined ? value.maxRuns : CHANGE_REPORT_LIMITS_3D.defaultRuns;
  if (!Number.isSafeInteger(maximum) || maximum < 0 || maximum > CHANGE_REPORT_LIMITS_3D.maxRuns) throw Error('Invalid change report run budget.');
  return maximum;
}
function collector(s: StructuralSnapshot3D, budget: {remaining: number}) {
  const result: ChangedCells3D = {mode: 'unchanged', count: 0, bounds: null, runs: [], requiresFullRead: false};
  return {result, add(i: number) {
    const x = i % s.width, y = Math.floor(i / s.width) % s.height, z = Math.floor(i / (s.width * s.height));
    result.count++;
    if (!result.bounds) result.bounds = {min: [x, y, z], max: [x + 1, y + 1, z + 1]};
    else {
      const {min, max} = result.bounds;
      min[0] = Math.min(min[0], x); min[1] = Math.min(min[1], y); min[2] = Math.min(min[2], z);
      max[0] = Math.max(max[0], x + 1); max[1] = Math.max(max[1], y + 1); max[2] = Math.max(max[2], z + 1);
    }
    if (result.requiresFullRead) return;
    const last = result.runs[result.runs.length - 1];
    if (last && last[0] + last[1] === i) {last[1]++; return;}
    if (budget.remaining === 0) {
      result.mode = 'bounds'; result.requiresFullRead = true; result.runs = []; return;
    }
    // Do not recycle discarded runs: the budget also bounds cumulative allocation.
    budget.remaining--; result.mode = 'runs'; result.runs.push([i, 1]);
  }};
}
function holdCells(holds: readonly TemporaryHold3D[]) {
  const cells = new Map<number, TemporaryHold3D>(); for (const hold of holds) for (const i of hold.cells) cells.set(i, hold); return cells;
}
function observation(value: SupportObservation3D, n: number): void {
  if (!(value?.distances instanceof Int32Array) || ['loads', 'capacities', 'reactions'].some(k => !(value[k as keyof SupportObservation3D] instanceof Uint32Array)) ||
      Object.values(value).some(a => a.length !== n) || value.distances.some(d => d < -1 || d >= n)) throw Error('Invalid global support observation.');
}
function targetCopy(value: ChangeTarget3D): Readonly<ChangeTarget3D> {
  return value.kind === 'committed' ? Object.freeze({...value, revision: Object.freeze({...value.revision})}) : Object.freeze({...value, base: Object.freeze({...value.base})});
}

/** Trusted, isolated session endpoints only. The public API supplies identities. */
export function compareGameplayChanges3D<T extends TacticalValue>(
  before: TacticalSessionSnapshot3D<T>, after: TacticalSessionSnapshot3D<T>,
  from: Readonly<TacticalRevision3D>, to: ChangeTarget3D, request: ChangeReportOptions3D = {}, observe: SupportObserver3D = observeSupport3D,
): GameplayChangeReport3D {
  const runBudget = options(request), budget = {remaining: runBudget};
  const left = [{id: null, terrain: before.terrain}, ...before.reservoirs], right = [{id: null, terrain: after.terrain}, ...after.reservoirs];
  if (left.length !== right.length) throw Error('Change report domain topology differs.');
  const domains: DomainChangeReport3D[] = [];
  for (let domain = 0; domain < left.length; domain++) {
    const a = left[domain].terrain, b = right[domain].terrain;
    if (left[domain].id !== right[domain].id || ['width', 'height', 'depth', 'chunkSize', 'schemaVersion', 'rulesVersion', 'worldVersion', 'materialCatalogHash'].some(k => a[k as keyof StructuralSnapshot3D] !== b[k as keyof StructuralSnapshot3D])) throw Error('Change report domain identity differs.');
    const n = a.packedCells.length;
    if ([a.energyQ, a.structure, b.packedCells, b.energyQ, b.structure].some(values => values.length !== n)) throw Error('Change report state lengths differ.');
    const record = Object.fromEntries(channels.map(name => [name, collector(a, budget)])) as Record<ChangeChannel3D, ReturnType<typeof collector>>;
    const beforeHolds = domain === 0 ? before.holds : [], afterHolds = domain === 0 ? after.holds : [];
    const h0 = holdCells(beforeHolds), h1 = holdCells(afterHolds);
    let supportInputsChanged = false;
    for (let i = 0; i < n; i++) {
      const va = a.packedCells[i], vb = b.packedCells[i], qa = a.energyQ[i], qb = b.energyQ[i], sa = a.structure[i], sb = b.structure[i];
      if ((va & 255) !== (vb & 255)) record.material.add(i);
      if (((va >>> PHASE_SHIFT) & 15) !== ((vb >>> PHASE_SHIFT) & 15)) record.phase.add(i);
      if (qa !== qb) record.energy.add(i);
      if ((va !== vb || qa !== qb) && temperatureQ(va, qa, cold) !== temperatureQ(vb, qb, cold)) record.temperature.add(i);
      if (sa !== sb) record.structure.add(i);
      const ha = h0.get(i), hb = h1.get(i);
      if (ha?.id !== hb?.id || ha?.expiresAtTick !== hb?.expiresAtTick) record.constraints.add(i);
      const anchoredA = sa | (ha ? ANCHOR_3D : 0), anchoredB = sb | (hb ? ANCHOR_3D : 0);
      if (va !== vb || qa !== qb || anchoredA !== anchoredB) supportInputsChanged = true;
    }
    if (supportInputsChanged) {
      const pa = observe(overlayHolds3D(a, beforeHolds)); observation(pa, n);
      const pb = observe(overlayHolds3D(b, afterHolds)); observation(pb, n);
      // Global scan is essential: support can change far beyond edited cells.
      for (let i = 0; i < n; i++) if (pa.distances[i] !== pb.distances[i] || pa.loads[i] !== pb.loads[i] || pa.capacities[i] !== pb.capacities[i] || pa.reactions[i] !== pb.reactions[i]) record.support.add(i);
    }
    domains.push({domain: left[domain].id, width: a.width, height: a.height, depth: a.depth, fromTick: a.tick, toTick: b.tick,
      channels: Object.fromEntries(channels.map(name => [name, record[name].result])) as Record<ChangeChannel3D, ChangedCells3D>});
  }
  return {rulesVersion: CHANGE_REPORT_RULES_VERSION_3D, scope: 'endpoints', from: Object.freeze({...from}), to: targetCopy(to), domains,
    gameChanged: JSON.stringify(before.game) !== JSON.stringify(after.game),
    accountingChanged: before.accounting.initialQ !== after.accounting.initialQ || before.accounting.externalQ !== after.accounting.externalQ,
    supportMeaning: 'global-endpoint-assessment', motion: {status: 'not-observed', reason: 'endpoint-states-do-not-identify-matter', requiresExecutionTrace: true}, runBudget};
}
