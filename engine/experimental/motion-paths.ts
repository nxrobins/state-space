/** Opt-in, derived movement chronology. It never becomes a physical coordinate. */
import { volumeSchedule, type VolumePass } from './3d-core.js';
import {
  motionEntryLimit3D,
  readMotionTraceDomain3D,
  type MotionTraceDomain3D,
  type MaterialMotionTrace3D,
} from './motion-trace.js';
import type { StructuralGeometry, StructuralPlan3D } from './structural-mechanics.js';
import {
  validateStructuralSnapshot3D,
  type StructuralSnapshot3D,
} from './structural/structural-world-core.js';

export const MOTION_PATH_RULES_3D = 'material-motion-paths-1';
export const MOTION_PATH_LIMITS_3D = Object.freeze({
  defaultEntries: 4096,
  maxEntries: 65536,
  passes: 28,
});
export type MotionPathOptions3D = { maxEntries?: number; maxPathEntries?: number };
export type MotionPathSegment3D = {
  origin: number;
  from: number;
  to: number;
  mode: 'linear' | 'relocation';
};
export type MotionPathPass3D = { index: number; segments: MotionPathSegment3D[] };
export type MaterialMotionPaths3D = StructuralGeometry & {
  rulesVersion: typeof MOTION_PATH_RULES_3D;
  physicsRulesVersion: string;
  materialCatalogHash: string;
  fromTick: number;
  toTick: number;
  status: 'complete' | 'overflow';
  requiresReexecution: boolean;
  passesObserved: number;
  cellTransfers: number;
  passes: MotionPathPass3D[];
};
export type MaterialMotionPathsResult3D = {
  motion: MaterialMotionTrace3D;
  paths: MaterialMotionPaths3D;
};

function fields(
  value: object,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) ||
    required.some((k) => !Object.hasOwn(value, k)) ||
    Reflect.ownKeys(value).some(
      (k) => typeof k !== 'string' || ![...required, ...optional].includes(k),
    ) ||
    Object.values(Object.getOwnPropertyDescriptors(value)).some(
      (d) => !('value' in d) || !d.enumerable,
    )
  )
    throw Error('Invalid motion path fields.');
}
function integer(value: number, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw Error('Invalid motion path integer.');
  return value === 0 ? 0 : value;
}
function dense<T>(value: readonly T[], maximum: number): T[] {
  if (
    !Array.isArray(value) ||
    value.length > maximum ||
    Reflect.ownKeys(value).length !== value.length + 1
  )
    throw Error('Motion path array exceeds its bounded budget.');
  const result: T[] = [];
  for (let i = 0; i < value.length; i++) {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (!d || !('value' in d) || !d.enumerable) throw Error('Motion paths require dense data.');
    result.push(d.value);
  }
  return result;
}
export function motionPathLimits3D(options: MotionPathOptions3D = {}): {
  motionLimit: number;
  pathLimit: number;
} {
  fields(options, [], ['maxEntries', 'maxPathEntries']);
  return {
    motionLimit: motionEntryLimit3D({
      maxEntries: Object.hasOwn(options, 'maxEntries') ? options.maxEntries : undefined,
    }),
    pathLimit: integer(
      Object.hasOwn(options, 'maxPathEntries') && options.maxPathEntries !== undefined
        ? options.maxPathEntries
        : MOTION_PATH_LIMITS_3D.defaultEntries,
      0,
      MOTION_PATH_LIMITS_3D.maxEntries,
    ),
  };
}
export function copyMotionPaths3D(value: MaterialMotionPaths3D): MaterialMotionPaths3D {
  return {
    ...value,
    passes: value.passes.map((p) => ({
      index: p.index,
      segments: p.segments.map((s) => ({ ...s })),
    })),
  };
}

/** Internal observer. Calls come only from the actual structural plan and swap sites. */
export function createMotionPathRecorder3D(
  plan: StructuralPlan3D,
  g: StructuralGeometry,
  fromTick: number,
  identity: { physicsRulesVersion: string; materialCatalogHash: string },
  maximum: number,
) {
  const n = g.width * g.height * g.depth,
    schedule = volumeSchedule(fromTick);
  integer(maximum, 0, MOTION_PATH_LIMITS_3D.maxEntries);
  if (plan.sources.length !== n || plan.moving.length !== n)
    throw Error('Invalid motion path plan.');
  let index = 0,
    entries = 0,
    transfers = 0,
    overflow = false,
    sealed = false;
  let passes: MotionPathPass3D[] = [],
    current: MotionPathSegment3D[] = [];
  const add = (segment: MotionPathSegment3D) => {
    transfers++;
    if (overflow) return;
    const required = 1 + Number(current.length === 0);
    if (entries + required > maximum) {
      overflow = true;
      passes = [];
      current = [];
      entries = 0;
      return;
    }
    entries += required;
    current.push(segment);
  };
  const end = () => {
    if (current.length) passes.push({ index, segments: current.sort((a, b) => a.from - b.from) });
    current = [];
    index++;
  };
  for (let to = 0; to < n; to++) {
    const from = integer(plan.sources[to], 0, n - 1);
    if (from !== to) {
      if (overflow) transfers++;
      else add({ origin: from, from, to, mode: plan.moving[from] ? 'linear' : 'relocation' });
    }
  }
  end();
  return {
    swap(a: number, b: number, aOrigin: number, bOrigin: number) {
      if (sealed || index > schedule.length || ['heat', 'phase'].includes(schedule[index - 1].kind))
        throw Error('Swap outside a movement pass.');
      for (const value of [a, b, aOrigin, bOrigin]) integer(value, 0, n - 1);
      if (a === b || aOrigin === bOrigin) throw Error('Invalid path swap.');
      if (overflow) {
        transfers += 2;
        return;
      }
      add({ origin: aOrigin, from: a, to: b, mode: 'linear' });
      add({ origin: bOrigin, from: b, to: a, mode: 'linear' });
    },
    endPass(pass: VolumePass) {
      if (sealed || index > schedule.length) throw Error('Unexpected motion pass.');
      fields(pass, ['kind', 'axis', 'parity', 'direction']);
      const expected = schedule[index - 1];
      if (
        Object.keys(expected).some(
          (k) => pass[k as keyof VolumePass] !== expected[k as keyof VolumePass],
        )
      )
        throw Error('Motion pass differs from the absolute-tick schedule.');
      end();
    },
    finish(motion: MaterialMotionTrace3D): MaterialMotionPaths3D {
      if (index !== MOTION_PATH_LIMITS_3D.passes) throw Error('Incomplete movement pass coverage.');
      sealed = true;
      const incomplete = overflow || motion.status !== 'complete';
      return copyMotionPaths3D({
        width: g.width,
        height: g.height,
        depth: g.depth,
        ...identity,
        rulesVersion: MOTION_PATH_RULES_3D,
        fromTick,
        toTick: fromTick + 1,
        status: incomplete ? 'overflow' : 'complete',
        requiresReexecution: incomplete,
        passesObserved: index,
        cellTransfers: transfers,
        passes: incomplete ? [] : passes,
      });
    },
  };
}

function coordinates(i: number, g: StructuralGeometry): [number, number, number] {
  return [i % g.width, Math.floor(i / g.width) % g.height, Math.floor(i / (g.width * g.height))];
}
function isPair(from: number, to: number, pass: VolumePass, g: StructuralGeometry): boolean {
  if (pass.kind === 'heat' || pass.kind === 'phase') return false;
  const vertical = ['gravity', 'diagonal', 'buoyancy'].includes(pass.kind),
    axis = vertical ? 1 : pass.axis;
  let a = coordinates(from, g),
    b = coordinates(to, g);
  if (a[axis] > b[axis]) [a, b] = [b, a];
  if (a[axis] % 2 !== pass.parity) return false;
  return a.every(
    (value, k) =>
      b[k] - value ===
      Number(k === axis) + (pass.kind === 'diagonal' && k === pass.axis ? pass.direction : 0),
  );
}

/** Decode before consumption. Validates chronology against a matching complete-tick trace. */
export function readMotionPaths3D(
  value: MaterialMotionPaths3D,
  motionValue: MaterialMotionTrace3D,
  before: StructuralSnapshot3D,
  after: StructuralSnapshot3D,
): MaterialMotionPaths3D {
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
    'passesObserved',
    'cellTransfers',
    'passes',
  ]);
  validateStructuralSnapshot3D(before);
  validateStructuralSnapshot3D(after);
  if (
    ['width', 'height', 'depth', 'chunkSize', 'rulesVersion', 'materialCatalogHash'].some(
      (k) => before[k as keyof StructuralSnapshot3D] !== after[k as keyof StructuralSnapshot3D],
    )
  )
    throw Error('Motion path snapshots are incompatible.');
  return readMotionPathsDomain3D(
    value,
    motionValue,
    { ...before, cellCount: before.packedCells.length },
    before.tick,
    after.tick,
  );
}
/** Internal metadata-only decoder for derived records; no fabricated tick snapshots. */
export function readMotionPathsDomain3D(
  value: MaterialMotionPaths3D,
  motionValue: MaterialMotionTrace3D,
  domain: MotionTraceDomain3D,
  fromTick: number,
  toTick: number,
  maximum: number = MOTION_PATH_LIMITS_3D.maxEntries,
): MaterialMotionPaths3D {
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
    'passesObserved',
    'cellTransfers',
    'passes',
  ]);
  integer(maximum, 0, MOTION_PATH_LIMITS_3D.maxEntries);
  const motion = readMotionTraceDomain3D(motionValue, domain, fromTick, toTick),
    n = domain.cellCount,
    schedule = volumeSchedule(fromTick);
  if (
    value.rulesVersion !== MOTION_PATH_RULES_3D ||
    value.physicsRulesVersion !== motion.physicsRulesVersion ||
    value.materialCatalogHash !== motion.materialCatalogHash ||
    ['width', 'height', 'depth', 'fromTick', 'toTick'].some(
      (k) => value[k as keyof typeof value] !== motion[k as keyof typeof motion],
    ) ||
    value.passesObserved !== MOTION_PATH_LIMITS_3D.passes ||
    !['complete', 'overflow'].includes(value.status) ||
    value.requiresReexecution !== (value.status === 'overflow')
  )
    throw Error('Incompatible motion path identity.');
  integer(value.cellTransfers, motion.touchedCells, n * MOTION_PATH_LIMITS_3D.passes);
  let remaining = maximum,
    last = -1,
    count = 0;
  const entries = dense(value.passes, Math.min(MOTION_PATH_LIMITS_3D.passes, remaining));
  remaining -= entries.length;
  const passes: MotionPathPass3D[] = [];
  for (const entry of entries) {
    fields(entry, ['index', 'segments']);
    const index = integer(entry.index, last + 1, MOTION_PATH_LIMITS_3D.passes - 1);
    last = index;
    const segments: MotionPathSegment3D[] = [],
      input = dense(entry.segments, remaining);
    remaining -= input.length;
    if (!input.length) throw Error('Empty path passes must be omitted.');
    let previous = -1;
    for (const segment of input) {
      fields(segment, ['origin', 'from', 'to', 'mode']);
      const from = integer(segment.from, previous + 1, n - 1),
        to = integer(segment.to, 0, n - 1),
        origin = integer(segment.origin, 0, n - 1);
      if (from === to || !['linear', 'relocation'].includes(segment.mode))
        throw Error('Invalid movement segment.');
      previous = from;
      segments.push({ origin, from, to, mode: segment.mode });
      count++;
    }
    passes.push({ index, segments });
  }
  if (value.status === 'overflow') {
    if (passes.length) throw Error('Overflow paths cannot expose partial detail.');
    return { ...value, passes };
  }
  if (
    motion.status !== 'complete' ||
    count !== value.cellTransfers ||
    motion.touchedCells > count ||
    motion.movedCells > count
  )
    throw Error('Incomplete or inconsistent motion paths.');
  const members = new Set<number>();
  for (const fragment of motion.fragments)
    for (const [start, length] of fragment.sourceRuns)
      for (let i = start; i < start + length; i++) members.add(i);
  const position = new Map<number, number>(),
    touched = new Set<number>(),
    fallen = new Set<number>();
  for (const pass of passes) {
    const byFrom = new Map(pass.segments.map((s) => [s.from, s])),
      destinations = new Set<number>();
    for (const segment of pass.segments) {
      const { origin, from, to, mode } = segment;
      if (!byFrom.has(to) || destinations.has(to) || (position.get(from) ?? from) !== origin)
        throw Error('Path pass is not a simultaneous identity permutation.');
      destinations.add(to);
      touched.add(origin);
      if (pass.index === 0) {
        const a = coordinates(from, domain),
          b = coordinates(to, domain),
          isMember = members.has(from);
        if (
          a[0] !== b[0] ||
          a[2] !== b[2] ||
          (isMember
            ? b[1] !== a[1] + 1 || mode !== 'linear'
            : b[1] >= a[1] || mode !== 'relocation')
        )
          throw Error('Invalid structural fall or displaced-cell relocation.');
        if (isMember) fallen.add(from);
      } else if (
        members.has(origin) ||
        mode !== 'linear' ||
        !isPair(from, to, schedule[pass.index - 1], domain) ||
        byFrom.get(to)?.to !== from
      )
        throw Error(
          'Segment differs from its scheduled disjoint swap or moves an intact fragment.',
        );
    }
    // Apply only after all origins were read: each pass is simultaneous.
    for (const { origin, to } of pass.segments) {
      if (origin === to) position.delete(to);
      else position.set(to, origin);
    }
  }
  if (
    fallen.size !== members.size ||
    touched.size !== motion.touchedCells ||
    position.size !== motion.movedCells
  )
    throw Error('Path totals disagree with net motion.');
  for (const [start, length] of motion.touched)
    for (let i = start; i < start + length; i++)
      if (!touched.has(i)) throw Error('Missing touched path identity.');
  for (const [from, to, length] of motion.moves)
    for (let i = 0; i < length; i++)
      if (position.get(to + i) !== from + i)
        throw Error('Path composition differs from net correspondence.');
  return { ...value, passes };
}
