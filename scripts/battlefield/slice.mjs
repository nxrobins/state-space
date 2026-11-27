import {
  createMultiphysicsProfiles3D,
  createMultiphysicsWorld3D,
} from 'state-space-engine/experimental/3d/multiphysics';

export const startTick = 92;
export const sliceTicks = 4;
export const sliceCount = 24;

// Ordinary JSON erases signed zero, which participates in the frozen v2 comparisons.
export const pack = (value) => JSON.stringify(value, (_, v) => (Object.is(v, -0) ? '~f64:-0' : v));
export const unpack = (text) => JSON.parse(text, (_, v) => (v === '~f64:-0' ? -0 : v));

// Diagnose the same ordered portable data that pack compares, including signed zero.
export function firstDifference(expected, actual, path = '$') {
  if (Object.is(expected, actual)) return null;
  if (
    expected &&
    actual &&
    typeof expected === 'object' &&
    typeof actual === 'object' &&
    Array.isArray(expected) === Array.isArray(actual)
  ) {
    const keys = Object.keys(expected),
      other = Object.keys(actual);
    if (keys.length !== other.length || keys.some((k, i) => k !== other[i]))
      return { path, expectedKeys: keys, actualKeys: other };
    for (const key of keys) {
      const difference = firstDifference(expected[key], actual[key], path + '.' + key);
      if (difference) return difference;
    }
    return null;
  }
  const describe = (value) => {
    if (typeof value !== 'number')
      return {
        type: typeof value,
        value: typeof value === 'object' && value !== null ? '[object]' : value,
      };
    const bits = new DataView(new ArrayBuffer(8));
    bits.setFloat64(0, value);
    return { value, bits: bits.getBigUint64(0).toString(16).padStart(16, '0') };
  };
  return { path, expected: describe(expected), actual: describe(actual) };
}

export function viewOf(snapshot) {
  const bodies = snapshot.parcels.filter(
    (p) => ['engineer', 'unit', 'deck'].includes(p.id) || p.id.startsWith('water-'),
  );
  return {
    tick: snapshot.tick,
    intact: snapshot.bonds.some((b) => b.a === 'abutment' && b.b === 'deck'),
    bodies: bodies.map(({ id, center, orientation }) => ({ id, center, orientation })),
  };
}

export function distribution(values) {
  if (!values.length || !values.every((v) => Number.isFinite(v) && v >= 0))
    throw Error('Invalid timing samples');
  const ordered = [...values].sort((a, b) => a - b);
  const q = (p) => ordered[Math.ceil(p * ordered.length) - 1];
  return { count: ordered.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: ordered.at(-1) };
}

// One authoritative snapshot and at most one unpublished branch. Four one-tick public
// transactions on the private world preserve the actual edit and report boundaries.
export async function createSliceSession() {
  const profiles = await createMultiphysicsProfiles3D();
  let live,
    candidate,
    history = [];
  return function handle({ kind, snapshot, tick, edits }) {
    if (kind === 'init') {
      if (snapshot.tick !== startTick || snapshot.rules !== 'multiphysics-world-2')
        throw Error('Invalid crossing start');
      live = createMultiphysicsWorld3D(profiles, snapshot).snapshot();
      candidate = undefined;
      history = [];
      return { tick: live.tick };
    }
    if (!live || tick !== live.tick) throw Error('Stale battlefield request');
    if (kind === 'audit') return { history, live };
    if (kind === 'commit') {
      if (!candidate) throw Error('No prepared slice');
      live = candidate.at(-1).snapshot;
      history.push(...candidate);
      candidate = undefined;
      return viewOf(live);
    }
    if (
      kind !== 'preview' ||
      candidate ||
      edits?.length !== sliceTicks ||
      live.tick >= startTick + sliceCount * sliceTicks
    )
      throw Error('Invalid battlefield preview');
    const started = performance.now();
    const fork = createMultiphysicsWorld3D(profiles, live);
    const results = edits.map((batch) => {
      const plan = fork.prepare(batch, 1);
      while (plan.advance(256).status === 'running') {
        /* bounded public tick */
      }
      return fork.commit(plan).result;
    });
    const views = results.map((r) => viewOf(r.snapshot));
    candidate = results;
    return { views, workerMs: performance.now() - started };
  };
}
