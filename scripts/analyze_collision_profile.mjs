/** Data-only analysis, including optimized stacks that omit profiling wrapper frames. */
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, json } from './collision-reference/packet.mjs';
import { summarizeCpuProfile } from './collision-reference/profile-data.mjs';

export function analyzeProfile(profile, bundleText) {
  summarizeCpuProfile(profile, bundleText); // Validate raw graph and sampling intervals.
  const nodes = new Map(profile.nodes.map((n) => [n.id, n])),
    parent = new Map();
  for (const node of profile.nodes)
    for (const child of node.children ?? []) parent.set(child, node.id);
  const sections = [];
  bundleText.split('\n').forEach((line, i) => {
    const match = /^\/\/ (engine\/.*\.ts)$/.exec(line);
    if (match) sections.push({ line: i, path: match[1] });
  });
  const describe = (node) => {
    const f = node.callFrame,
      url = f.url.replaceAll('\\', '/');
    return {
      function: f.functionName || '(anonymous)',
      source: url.endsWith('/engine.mjs')
        ? (sections.findLast((s) => s.line <= f.lineNumber)?.path ?? url)
        : url,
      generatedLine: f.lineNumber + 1,
      column: f.columnNumber + 1,
    };
  };
  const buckets = {},
    kernelFunctions = new Map();
  const inclusive = {
    portableCopy: 0,
    parcelAdmission: 0,
    assemblyAdmission: 0,
    contactSolve: 0,
    timeOfImpact: 0,
  };
  let wrapperOmittedKernelSamples = 0;
  for (const id of profile.samples) {
    const stack = [];
    for (let current = id; current !== undefined; current = parent.get(current))
      stack.push(describe(nodes.get(current)));
    const leaf = stack[0];
    const rigid = (name) =>
      stack.some((f) => f.source.endsWith('/multiphysics/rigid.ts') && name.test(f.function));
    const wrapper = (name) =>
      stack.some((f) => f.source.endsWith('/profile-data.mjs') && f.function === name);
    const hasWrapper =
      wrapper('profileKernelCreate') ||
      wrapper('profileKernelNext') ||
      wrapper('profileKernelReturn');
    const kernel =
      wrapper('profileKernelCreate') || rigid(/^createRigidStep3D$/)
        ? 'kernel-create'
        : wrapper('profileKernelNext') || rigid(/^run$/)
          ? 'kernel-next'
          : wrapper('profileKernelReturn')
            ? 'kernel-close'
            : null;
    const bucket =
      leaf.function === '(garbage collector)'
        ? 'garbage-collection'
        : leaf.function === '(idle)'
          ? 'idle'
          : (kernel ??
            (stack.some((f) => f.source.endsWith('/exact-state.mjs'))
              ? 'harness-exact-state'
              : stack.some((f) => f.source.startsWith('engine/'))
                ? 'engine-outside-recognized-step'
                : 'harness-other-or-profiler'));
    buckets[bucket] = (buckets[bucket] ?? 0) + 1;
    if (!kernel || bucket === 'garbage-collection' || bucket === 'idle') continue;
    if (!hasWrapper) wrapperOmittedKernelSamples++;
    const predicates = {
      portableCopy: (f) =>
        f.source === 'engine/portable-data.ts' && /^(copy|copyPortableValue)$/.test(f.function),
      parcelAdmission: (f) =>
        /\/(rigid|conservation)\.ts$/.test(f.source) &&
        /^(readParcel|readMaterialParcel3D)$/.test(f.function),
      assemblyAdmission: (f) =>
        f.source.endsWith('/multiphysics/rigid.ts') &&
        /^(validateRigidAssemblyMotion3D|rigidAssemblyMassProperties3D)$/.test(f.function),
      contactSolve: (f) =>
        f.source.endsWith('/multiphysics/rigid.ts') && /^(solve\d*|project)$/.test(f.function),
      timeOfImpact: (f) =>
        f.source.endsWith('/multiphysics/rigid.ts') &&
        /^(nextImpact|translationImpact|boundedContactAdvance)$/.test(f.function),
    };
    for (const [name, predicate] of Object.entries(predicates))
      if (stack.some(predicate)) inclusive[name]++;
    for (const f of new Map(
      stack.filter((f) => f.source.startsWith('engine/')).map((f) => [JSON.stringify(f), f]),
    ).values()) {
      const key = JSON.stringify(f);
      if (!kernelFunctions.has(key))
        kernelFunctions.set(key, { ...f, selfSamples: 0, inclusiveSamples: 0 });
      kernelFunctions.get(key).inclusiveSamples++;
    }
    if (leaf.source.startsWith('engine/')) kernelFunctions.get(JSON.stringify(leaf)).selfSamples++;
  }
  return {
    samples: profile.samples.length,
    buckets,
    inclusive,
    wrapperOmittedKernelSamples,
    kernelFunctions: [...kernelFunctions.values()].sort(
      (a, b) => b.inclusiveSamples - a.inclusiveSamples,
    ),
  };
}

function aggregate(rows) {
  const out = {
    samples: 0,
    kernelSamples: 0,
    buckets: {},
    inclusive: {},
    wrapperOmittedKernelSamples: 0,
    wallMs: 0,
    kernelWallMs: 0,
    outsideKernelWallMs: 0,
    createWallMs: 0,
    nextWallMs: 0,
    createCalls: 0,
    nextCalls: 0,
    functions: [],
  };
  const functions = new Map();
  for (const row of rows) {
    const a = row.analysis,
      p = row.profiling;
    out.samples += a.samples;
    out.wrapperOmittedKernelSamples += a.wrapperOmittedKernelSamples;
    for (const key of ['wallMs', 'kernelWallMs', 'outsideKernelWallMs']) out[key] += p[key];
    for (const key of ['create', 'next']) {
      out[key + 'WallMs'] += p.metrics[key].wallMs;
      out[key + 'Calls'] += p.metrics[key].calls;
    }
    for (const [bucket, n] of Object.entries(a.buckets))
      out.buckets[bucket] = (out.buckets[bucket] ?? 0) + n;
    for (const [name, n] of Object.entries(a.inclusive))
      out.inclusive[name] = (out.inclusive[name] ?? 0) + n;
    for (const f of a.kernelFunctions) {
      const key = JSON.stringify([f.function, f.source, f.generatedLine, f.column]);
      if (!functions.has(key)) functions.set(key, { ...f, selfSamples: 0, inclusiveSamples: 0 });
      functions.get(key).selfSamples += f.selfSamples;
      functions.get(key).inclusiveSamples += f.inclusiveSamples;
    }
  }
  out.kernelSamples = ['kernel-create', 'kernel-next', 'kernel-close'].reduce(
    (n, k) => n + (out.buckets[k] ?? 0),
    0,
  );
  out.functions = [...functions.values()].sort((a, b) => b.inclusiveSamples - a.inclusiveSamples);
  return out;
}

export function analyzePacket(directory) {
  const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
  const sha = (path) => hash(readFileSync(path));
  const summaryPath = join(directory, 'profile-summary.json');
  const summary = read(summaryPath),
    review = read(join(directory, 'review.json'));
  if (
    summary.reviewSha256 !== sha(join(directory, 'review.json')) ||
    summary.status !== 'diagnostic-complete'
  )
    throw Error('A completed bound profile summary is required');
  const bundlePath = join(review.benchmark.directory, 'engine.mjs');
  if (sha(bundlePath) !== summary.bundleSha256) throw Error('Bundle changed');
  const bundle = readFileSync(bundlePath, 'utf8');
  const rows = summary.rows.map((row) => {
    if (sha(row.profilePath) !== row.profileSha256) throw Error('Raw profile changed');
    const analysis = analyzeProfile(read(row.profilePath), bundle);
    // 13 complete trajectories, two partial restarts, and one cancelled step per row.
    const ticks = Math.round(0.048 / row.dt);
    if (
      row.profiling.metrics.create.calls !== 15 * ticks - 3 ||
      row.profiling.metrics.completed !== 15 * ticks - 4 ||
      row.profiling.metrics.close.calls !== row.profiling.metrics.create.calls
    )
      throw Error('Profile call counts differ from unchanged benchmark orchestration');
    return {
      scene: row.scene,
      dt: row.dt,
      exactSha256: row.exactSha256,
      profileSha256: row.profileSha256,
      profiling: row.profiling,
      analysis,
    };
  });
  const result = {
    schema: 'collision-profile-analysis-v1',
    status: summary.status,
    profileSummarySha256: sha(summaryPath),
    analysisSourceSha256: sha(fileURLToPath(import.meta.url)),
    acceptance: summary.acceptance,
    baselineSha256: summary.baselineSha256,
    stagesPassed: summary.stages.filter((s) => s.passed).length,
    correction:
      'The first collector uses wrapper-only stack attribution. This analysis also recognizes createRigidStep3D and the rigid.ts run generator when optimized stacks omit a wrapper. Raw profiles and measurements are unchanged.',
    interpretation:
      'Inclusive category counts overlap; percentages describe sampled stacks, not CPU-time or potential speedup. Engine frames outside recognized step roots remain separate.',
    totals: aggregate(rows),
    scenes: [...new Set(rows.map((r) => r.scene))].map((scene) => ({
      scene,
      ...aggregate(rows.filter((r) => r.scene === scene)),
    })),
    rows: rows.map(({ profiling, ...row }) => row),
  };
  json(join(directory, 'profile-analysis.json'), result);
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw Error('Usage: analyze_collision_profile.mjs CPU_PACKET');
  const result = analyzePacket(resolve(process.argv[2]));
  console.log(
    JSON.stringify({
      status: result.status,
      rows: result.rows.length,
      totals: { ...result.totals, functions: result.totals.functions.slice(0, 15) },
      scenes: result.scenes.map(({ functions, ...scene }) => scene),
    }),
  );
}
