/** Derived provenance from executed permutations. Never a physical coordinate. */
import type { StructuralGeometry, StructuralPlan3D } from './structural-mechanics.js';
import type { StructuralSnapshot3D } from './structural/structural-world-core.js';
import type { TacticalRevision3D } from './tactical/tactical-session-view.js';
import type { ChangeTarget3D } from './change-reports.js';

export const MOTION_TRACE_RULES_3D = 'material-motion-1';
export const MOTION_JOURNAL_RULES_3D = 'motion-journal-1';
export const MOTION_TRACE_LIMITS_3D = Object.freeze({
  defaultEntries: 4096,
  maxEntries: 65536,
  journalEntries: 65536,
  journalRecords: 256,
});
export type MotionTraceOptions3D = { maxEntries?: number };
export type MotionFragment3D = { id: number; cells: number; sourceRuns: [number, number][] };
export type MaterialMotionTrace3D = StructuralGeometry & {
  rulesVersion: typeof MOTION_TRACE_RULES_3D;
  physicsRulesVersion: string;
  materialCatalogHash: string;
  fromTick: number;
  toTick: number;
  status: 'complete' | 'overflow';
  requiresReexecution: boolean;
  movedCells: number;
  touchedCells: number;
  fragmentCount: number;
  fragmentCells: number;
  /** Sorted original source, final destination, cell count. Omitted cells stay. */
  moves: [number, number, number][];
  /** Original identities that moved in any pass, even when ending at their start. */
  touched: [number, number][];
  /** Post-damage structural-pass components, each displaced by +1 Y. */
  fragments: MotionFragment3D[];
};
export type ProvenancePass3D = {
  input: Uint32Array;
  output: Uint32Array;
  touched: Uint8Array;
  /** Internal, optional observer of the executed swap, using pre-pass identities. */
  pathSwap?: (source: number, target: number, sourceOrigin: number, targetOrigin: number) => void;
};
function fields(value: object, names: readonly string[], optional: readonly string[] = []): void {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) ||
    names.some((k) => !Object.hasOwn(value, k)) ||
    Reflect.ownKeys(value).some(
      (k) => typeof k !== 'string' || ![...names, ...optional].includes(k),
    ) ||
    Object.values(Object.getOwnPropertyDescriptors(value)).some(
      (d) => !('value' in d) || !d.enumerable,
    )
  )
    throw Error('Invalid motion record.');
}
function integer(value: number, lo: number, hi: number): number {
  if (!Number.isSafeInteger(value) || value < lo || value > hi)
    throw Error('Invalid motion integer.');
  return value === 0 ? 0 : value;
}
function dense<T>(value: readonly T[], maximum: number): T[] {
  if (
    !Array.isArray(value) ||
    value.length > maximum ||
    Reflect.ownKeys(value).length !== value.length + 1
  )
    throw Error('Invalid bounded motion array.');
  const result: T[] = [];
  for (let i = 0; i < value.length; i++) {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (!d || !('value' in d) || !d.enumerable) throw Error('Invalid motion array data.');
    result.push(d.value);
  }
  return result;
}
export function motionEntryLimit3D(options: MotionTraceOptions3D = {}): number {
  fields(options, [], ['maxEntries']);
  return integer(
    Object.hasOwn(options, 'maxEntries') && options.maxEntries !== undefined
      ? options.maxEntries
      : MOTION_TRACE_LIMITS_3D.defaultEntries,
    0,
    MOTION_TRACE_LIMITS_3D.maxEntries,
  );
}

/** Internal recorder; the solver and material kernel supply actual permutations. */
export function createMotionRecorder3D(
  plan: StructuralPlan3D,
  g: StructuralGeometry,
  fromTick: number,
  identity: { physicsRulesVersion: string; materialCatalogHash: string },
  maximum: number,
) {
  const n = g.width * g.height * g.depth,
    moving = plan.moving,
    componentIds = plan.componentIds;
  if (plan.sources.length !== n || plan.moving.length !== n || plan.componentIds.length !== n)
    throw Error('Invalid motion plan lengths.');
  integer(maximum, 0, MOTION_TRACE_LIMITS_3D.maxEntries);
  const provenance: ProvenancePass3D = {
    input: plan.sources.slice(),
    output: new Uint32Array(n),
    touched: new Uint8Array(n),
  };
  for (let i = 0; i < n; i++) {
    const source = integer(plan.sources[i], 0, n - 1);
    if (source !== i) provenance.touched[source] = 1;
  }
  return {
    provenance,
    endPass() {
      [provenance.input, provenance.output] = [provenance.output, provenance.input];
    },
    finish(): MaterialMotionTrace3D {
      const destinations = new Uint32Array(n),
        seen = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        const source = integer(provenance.input[i], 0, n - 1);
        if (seen[source]) throw Error('Motion trace is not a permutation.');
        seen[source] = 1;
        destinations[source] = i;
      }
      seen.fill(0);
      let entries = 0,
        overflow = false,
        movedCells = 0,
        touchedCells = 0,
        fragmentCount = 0,
        fragmentCells = 0;
      const moves: [number, number, number][] = [],
        touched: [number, number][] = [],
        fragments = new Map<number, MotionFragment3D>();
      const reserve = () => {
        if (overflow || entries === maximum) {
          overflow = true;
          return false;
        }
        entries++;
        return true;
      };
      const addRun = (runs: [number, number][], i: number) => {
        if (overflow) return;
        const last = runs[runs.length - 1];
        if (last && last[0] + last[1] === i) last[1]++;
        else if (reserve()) runs.push([i, 1]);
      };
      // Detail priority is structural fragments, net correspondence, then touched IDs.
      for (let i = 0; i < n; i++)
        if (moving[i]) {
          const root = integer(componentIds[i], 0, i);
          fragmentCells++;
          if (!seen[root]) {
            if (root !== i) throw Error('Fragment root is not its minimum moving source.');
            seen[root] = 1;
            fragmentCount++;
            if (reserve()) fragments.set(root, { id: root, cells: 0, sourceRuns: [] });
          }
          if (!overflow) {
            const fragment = fragments.get(root)!;
            fragment.cells++;
            addRun(fragment.sourceRuns, i);
          }
          if (
            Math.floor(i / g.width) % g.height === g.height - 1 ||
            destinations[i] !== i + g.width
          )
            throw Error('Structural fragment correspondence differs from executed descent.');
        }
      for (let i = 0; i < n; i++) {
        const destination = destinations[i];
        if (destination !== i) {
          movedCells++;
          if (!provenance.touched[i]) throw Error('Moved matter lacks a touched identity.');
          if (!overflow) {
            const last = moves[moves.length - 1];
            if (last && last[0] + last[2] === i && last[1] + last[2] === destination) last[2]++;
            else if (reserve()) moves.push([i, destination, 1]);
          }
        }
        if (provenance.touched[i]) touchedCells++;
      }
      for (let i = 0; i < n; i++) if (provenance.touched[i]) addRun(touched, i);
      return {
        width: g.width,
        height: g.height,
        depth: g.depth,
        ...identity,
        rulesVersion: MOTION_TRACE_RULES_3D,
        fromTick,
        toTick: fromTick + 1,
        status: overflow ? 'overflow' : 'complete',
        requiresReexecution: overflow,
        movedCells,
        touchedCells,
        fragmentCount,
        fragmentCells,
        moves: overflow ? [] : moves,
        touched: overflow ? [] : touched,
        fragments: overflow ? [] : [...fragments.values()].sort((a, b) => a.id - b.id),
      };
    },
  };
}

type Run = [number, number];
function runs(value: readonly Run[], n: number, budget: { remaining: number }): Run[] {
  const input = dense(value, budget.remaining);
  budget.remaining -= input.length;
  const result: Run[] = [];
  let end = 0;
  for (const entry of input) {
    const r = dense(entry, 2);
    if (r.length !== 2) throw Error('Invalid motion run.');
    const start = integer(r[0], end, n - 1),
      count = integer(r[1], 1, n - start);
    if (result.length && start === end) throw Error('Adjacent motion runs must coalesce.');
    result.push([start, count]);
    end = start + count;
  }
  return result;
}
function union(input: Run[]): Run[] {
  const result: Run[] = [];
  for (const r of [...input].sort((a, b) => a[0] - b[0])) {
    const last = result[result.length - 1];
    if (last && last[0] + last[1] > r[0]) throw Error('Overlapping motion identities.');
    if (last && last[0] + last[1] === r[0]) last[1] += r[1];
    else result.push([...r]);
  }
  return result;
}
function covered(subset: Run[], superset: Run[]): void {
  let at = 0;
  for (const [start, count] of subset) {
    let p = start;
    while (p < start + count) {
      while (at < superset.length && superset[at][0] + superset[at][1] <= p) at++;
      if (at === superset.length || superset[at][0] > p) throw Error('Incomplete motion coverage.');
      p = Math.min(start + count, superset[at][0] + superset[at][1]);
    }
  }
}
export function motionTraceEntries3D(trace: MaterialMotionTrace3D): number {
  return (
    trace.moves.length +
    trace.touched.length +
    trace.fragments.reduce((n, f) => n + 1 + f.sourceRuns.length, 0)
  );
}
export function copyMotionTrace3D(t: MaterialMotionTrace3D): MaterialMotionTrace3D {
  return {
    ...t,
    moves: t.moves.map((r) => [...r]),
    touched: t.touched.map((r) => [...r]),
    fragments: t.fragments.map((f) => ({ ...f, sourceRuns: f.sourceRuns.map((r) => [...r]) })),
  };
}
/** Validate portable driver output before attaching it to a complete boundary. */
export function readMotionTrace3D(
  value: MaterialMotionTrace3D,
  before: StructuralSnapshot3D,
  after: StructuralSnapshot3D,
): MaterialMotionTrace3D {
  return readMotionTraceDomain3D(
    value,
    { ...before, cellCount: before.packedCells.length },
    before.tick,
    after.tick,
  );
}
/** Metadata-only validation for derived transport records; no per-tick state copies. */
export type MotionTraceDomain3D = StructuralGeometry & {
  rulesVersion: string;
  materialCatalogHash: string;
  cellCount: number;
};
export function readMotionTraceDomain3D(
  value: MaterialMotionTrace3D,
  domain: MotionTraceDomain3D,
  fromTick: number,
  toTick: number,
  maximum: number = MOTION_TRACE_LIMITS_3D.maxEntries,
): MaterialMotionTrace3D {
  integer(maximum, 0, MOTION_TRACE_LIMITS_3D.maxEntries);
  fields(value, [
    'rulesVersion',
    'physicsRulesVersion',
    'materialCatalogHash',
    'width',
    'height',
    'depth',
    'fromTick',
    'toTick',
    'status',
    'requiresReexecution',
    'movedCells',
    'touchedCells',
    'fragmentCount',
    'fragmentCells',
    'moves',
    'touched',
    'fragments',
  ]);
  if (
    value.rulesVersion !== MOTION_TRACE_RULES_3D ||
    value.physicsRulesVersion !== domain.rulesVersion ||
    value.materialCatalogHash !== domain.materialCatalogHash ||
    ['width', 'height', 'depth'].some(
      (k) => value[k as keyof StructuralGeometry] !== domain[k as keyof StructuralGeometry],
    ) ||
    value.fromTick !== fromTick ||
    value.toTick !== toTick ||
    value.toTick !== value.fromTick + 1 ||
    !['complete', 'overflow'].includes(value.status) ||
    value.requiresReexecution !== (value.status === 'overflow')
  )
    throw Error('Incompatible motion trace identity.');
  const n = domain.cellCount;
  integer(value.movedCells, 0, n);
  integer(value.touchedCells, value.movedCells, n);
  integer(value.fragmentCells, 0, value.movedCells);
  integer(value.fragmentCount, 0, value.fragmentCells);
  const budget: { remaining: number } = { remaining: maximum },
    moveEntries = dense(value.moves, maximum);
  budget.remaining -= moveEntries.length;
  const moves: [number, number, number][] = [];
  let end = 0;
  for (const entry of moveEntries) {
    const r = dense(entry, 3);
    if (r.length !== 3) throw Error('Invalid motion correspondence.');
    const source = integer(r[0], end, n - 1),
      destination = integer(r[1], 0, n - 1),
      count = integer(r[2], 1, Math.min(n - source, n - destination));
    if (source === destination) throw Error('Identity correspondence must be omitted.');
    const last = moves[moves.length - 1];
    if (last && last[0] + last[2] === source && last[1] + last[2] === destination)
      throw Error('Adjacent correspondence must coalesce.');
    moves.push([source, destination, count]);
    end = source + count;
  }
  const touched = runs(value.touched, n, budget),
    fragments: MotionFragment3D[] = [];
  let lastRoot = -1,
    memberCount = 0;
  const fragmentEntries = dense(value.fragments, budget.remaining);
  budget.remaining -= fragmentEntries.length;
  for (const f of fragmentEntries) {
    fields(f, ['id', 'cells', 'sourceRuns']);
    const id = integer(f.id, lastRoot + 1, n - 1),
      cells = integer(f.cells, 1, n - memberCount),
      sourceRuns = runs(f.sourceRuns, n, budget);
    if (sourceRuns[0]?.[0] !== id || sourceRuns.reduce((sum, r) => sum + r[1], 0) !== cells)
      throw Error('Invalid structural fragment membership.');
    memberCount += cells;
    lastRoot = id;
    fragments.push({ id, cells, sourceRuns });
  }
  const trace = { ...value, moves, touched, fragments };
  if (motionTraceEntries3D(trace) > maximum) throw Error('Motion detail exceeds its budget.');
  if (value.status === 'overflow') {
    if (motionTraceEntries3D(trace))
      throw Error('Overflow motion must not expose incomplete detail.');
    return trace;
  }
  if (
    moves.reduce((sum, r) => sum + r[2], 0) !== value.movedCells ||
    touched.reduce((sum, r) => sum + r[1], 0) !== value.touchedCells ||
    fragments.length !== value.fragmentCount ||
    memberCount !== value.fragmentCells
  )
    throw Error('Motion counts disagree with detail.');
  const origins = union(moves.map((r) => [r[0], r[2]])),
    destinations = union(moves.map((r) => [r[1], r[2]]));
  if (JSON.stringify(origins) !== JSON.stringify(destinations))
    throw Error('Motion correspondence is not a closed permutation.');
  covered(origins, touched);
  const members = union(fragments.flatMap((f) => f.sourceRuns)),
    downward = moves.filter((r) => r[1] - r[0] === domain.width).map((r) => [r[0], r[2]] as Run);
  covered(members, downward);
  for (const [start, count] of members) {
    const floor =
      Math.floor(start / (domain.width * domain.height)) * domain.width * domain.height +
      (domain.height - 1) * domain.width;
    if (start + count > floor) throw Error('Fragment motion crosses the closed floor.');
  }
  return trace;
}

export type MotionJournalFrame3D = {
  domain: string | null;
  operation: number;
  trace: MaterialMotionTrace3D;
};
export type MotionJournalData3D = {
  status: 'disabled' | 'complete' | 'overflow';
  recordsObserved: number;
  entries: number;
  frames: MotionJournalFrame3D[];
};
export type MotionJournal3D = MotionJournalData3D & {
  rulesVersion: typeof MOTION_JOURNAL_RULES_3D;
  scope: 'simulation-ticks';
  from: Readonly<TacticalRevision3D>;
  to: Readonly<ChangeTarget3D>;
  includesInterventions: false;
  includesSubpassPaths: false;
  requiresReexecution: boolean;
};
export function appendMotionFrame3D(data: MotionJournalData3D, frame: MotionJournalFrame3D): void {
  if (data.status === 'disabled') throw Error('Motion capture is disabled.');
  data.recordsObserved++;
  if (data.status === 'overflow') return;
  const entries = motionTraceEntries3D(frame.trace);
  if (
    frame.trace.status === 'overflow' ||
    data.recordsObserved > MOTION_TRACE_LIMITS_3D.journalRecords ||
    data.entries + entries > MOTION_TRACE_LIMITS_3D.journalEntries
  ) {
    data.status = 'overflow';
    data.frames = [];
    data.entries = 0;
    return;
  }
  data.entries += entries;
  data.frames.push(frame);
}
export function motionJournal3D(
  data: MotionJournalData3D,
  from: Readonly<TacticalRevision3D>,
  to: ChangeTarget3D,
): MotionJournal3D {
  return {
    ...data,
    frames: data.frames.map((f) => ({ ...f, trace: copyMotionTrace3D(f.trace) })),
    rulesVersion: MOTION_JOURNAL_RULES_3D,
    scope: 'simulation-ticks',
    from: Object.freeze({ ...from }),
    to:
      to.kind === 'committed'
        ? Object.freeze({ ...to, revision: Object.freeze({ ...to.revision }) })
        : Object.freeze({ ...to, base: Object.freeze({ ...to.base }) }),
    includesInterventions: false,
    includesSubpassPaths: false,
    requiresReexecution: data.status !== 'complete',
  };
}
