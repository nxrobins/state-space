/** Profiling attribution and transparent API observation. No engine/inspector import. */
import { performance } from 'node:perf_hooks';
import { same } from './replay.mjs';
import { decodeExact } from './exact-state.mjs';

export function instrumentRigidApi(api, clock = () => performance.now()) {
  const metrics = {
    create: { calls: 0, wallMs: 0 },
    next: { calls: 0, wallMs: 0 },
    close: { calls: 0, wallMs: 0 },
    completed: 0,
    yielded: { assembly: 0, sweep: 0, contact: 0, fracture: 0 },
  };
  const wrapped = {
    ...api,
    createRigidStep3D: function profileKernelCreate(...args) {
      let job;
      const started = clock();
      metrics.create.calls++;
      try {
        job = Reflect.apply(api.createRigidStep3D, api, args);
      } finally {
        metrics.create.wallMs += clock() - started;
      }
      return {
        next: function profileKernelNext(...values) {
          const started = clock();
          metrics.next.calls++;
          let result;
          try {
            result = Reflect.apply(job.next, job, values);
          } finally {
            metrics.next.wallMs += clock() - started;
          }
          if (result.done) metrics.completed++;
          else if (Object.hasOwn(metrics.yielded, result.value?.phase))
            metrics.yielded[result.value.phase]++;
          return result;
        },
        return: function profileKernelReturn(...values) {
          const started = clock();
          metrics.close.calls++;
          try {
            return Reflect.apply(job.return, job, values);
          } finally {
            metrics.close.wallMs += clock() - started;
          }
        },
        throw(...values) {
          return Reflect.apply(job.throw, job, values);
        },
        [Symbol.iterator]() {
          return this;
        },
      };
    },
  };
  return { api: wrapped, metrics };
}

export function assertExactCapture(current, baseline) {
  // The persisted JSON value is illustrative; the encoding preserves signed zero.
  const restored = decodeExact(current.encoding, current.sha256);
  same(restored, current.value, 'profile capture consistency');
  same(
    restored,
    decodeExact(baseline.encoding, baseline.sha256),
    'profile complete exact baseline',
  );
  same(current.sha256, baseline.sha256, 'profile exact baseline digest');
}

export function assertBaseline(row, baseline) {
  if (!baseline || row.status !== 'completed' || baseline.status !== 'completed')
    throw Error('Missing completed profiling baseline');
  assertExactCapture(row.exact, baseline.exact);
  for (const key of [
    'backend',
    'scene',
    'dt',
    'ticks',
    'duration',
    'phaseWork',
    'replay',
    'diagnostic',
  ])
    same(row[key], baseline[key], 'profile baseline ' + key);
  same(
    JSON.parse(JSON.stringify(row.trajectory)),
    baseline.trajectory,
    'profile stored observations',
  );
  if (row.timing.samplesMs.length !== 7) throw Error('Profiling changed the sample count');
}

export function summarizeCpuProfile(profile, bundleText) {
  if (
    !Array.isArray(profile.nodes) ||
    !Array.isArray(profile.samples) ||
    !Array.isArray(profile.timeDeltas) ||
    profile.samples.length !== profile.timeDeltas.length ||
    !Number.isFinite(profile.startTime) ||
    !Number.isFinite(profile.endTime) ||
    profile.endTime < profile.startTime ||
    !profile.samples.length
  )
    throw Error('Missing or malformed sampled CPU profile');
  const nodes = new Map(),
    parents = new Map();
  for (const node of profile.nodes) {
    if (!Number.isSafeInteger(node.id) || nodes.has(node.id) || !node.callFrame)
      throw Error('Invalid CPU profile node');
    nodes.set(node.id, node);
    for (const child of node.children ?? []) {
      if (parents.has(child)) throw Error('Ambiguous CPU profile ancestry');
      parents.set(child, node.id);
    }
  }
  const sections = [];
  bundleText.split('\n').forEach((line, index) => {
    const match = /^\/\/ (engine\/.*\.ts)$/.exec(line);
    if (match) sections.push({ line: index, file: match[1] });
  });
  const describe = (node) => {
    const frame = node.callFrame;
    const url = (frame.url || '').replaceAll('\\', '/');
    let source = url;
    if (url.endsWith('/engine.mjs'))
      source = sections.findLast((section) => section.line <= frame.lineNumber)?.file ?? url;
    return {
      function: frame.functionName || '(anonymous)',
      source,
      generatedLine: frame.lineNumber + 1,
      column: frame.columnNumber + 1,
    };
  };
  const keyOf = (frame) => JSON.stringify(frame);
  const buckets = {},
    functions = new Map(),
    kernelFunctions = new Map();
  function increment(map, frame, field) {
    const key = keyOf(frame);
    if (!map.has(key)) map.set(key, { ...frame, selfSamples: 0, inclusiveSamples: 0 });
    map.get(key)[field]++;
  }
  for (const id of profile.samples) {
    const stack = [],
      seen = new Set();
    let current = id;
    while (current !== undefined) {
      if (seen.has(current) || !nodes.has(current)) throw Error('Invalid CPU profile ancestry');
      seen.add(current);
      stack.push(describe(nodes.get(current)));
      current = parents.get(current);
    }
    const leaf = stack[0];
    const has = (name) => stack.some((frame) => frame.function === name);
    const kernel = has('profileKernelCreate')
      ? 'kernel-create'
      : has('profileKernelNext')
        ? 'kernel-next'
        : has('profileKernelReturn')
          ? 'kernel-close'
          : null;
    const bucket =
      leaf.function === '(garbage collector)'
        ? 'garbage-collection'
        : leaf.function === '(idle)'
          ? 'idle'
          : (kernel ??
            (stack.some((frame) => frame.source.endsWith('/exact-state.mjs'))
              ? 'harness-exact-state'
              : 'harness-other-or-profiler'));
    buckets[bucket] = (buckets[bucket] ?? 0) + 1;
    increment(functions, leaf, 'selfSamples');
    if (kernel && leaf.source.startsWith('engine/'))
      increment(kernelFunctions, leaf, 'selfSamples');
    for (const frame of new Map(stack.map((frame) => [keyOf(frame), frame])).values()) {
      increment(functions, frame, 'inclusiveSamples');
      if (kernel && frame.source.startsWith('engine/')) {
        increment(kernelFunctions, frame, 'inclusiveSamples');
      }
    }
  }
  const deltas = profile.timeDeltas;
  if (deltas.some((x) => !Number.isFinite(x) || x < 0)) throw Error('Invalid CPU sample interval');
  const order = (a, b) => b.inclusiveSamples - a.inclusiveSamples || b.selfSamples - a.selfSamples;
  return {
    samples: profile.samples.length,
    buckets,
    kernelFunctions: [...kernelFunctions.values()].sort(order),
    functions: [...functions.values()].sort((a, b) => b.selfSamples - a.selfSamples),
    intervals: {
      requestedMicros: 1000,
      totalMicros: deltas.reduce((a, b) => a + b, 0),
      maximumMicros: Math.max(...deltas),
      over10ms: deltas.filter((x) => x > 10000).length,
    },
    interpretation:
      'Sample counts, not CPU-time percentages. Inclusive stacks overlap. Long scheduling gaps are retained and are not charged as CPU time. Source labels map generated function start lines to esbuild module boundaries.',
  };
}
