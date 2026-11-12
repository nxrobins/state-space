/** Data-only stack attribution and precise-coverage decoding. No engine/inspector import. */
import { summarizeCpuProfile } from './profile-data.mjs';

export function bundleLocations(text) {
  const lines = text.split('\n'),
    sections = [];
  let offset = 0;
  const offsets = lines.map((line, index) => {
    const start = offset;
    offset += line.length + 1;
    const section = /^\/\/ (engine\/.*\.ts)$/.exec(line);
    if (section) sections.push({ line: index, source: section[1] });
    return start;
  });
  return {
    source: (line) => sections.findLast((s) => s.line <= line)?.source ?? '(unmapped)',
    at: (offset) => {
      let lo = 0,
        hi = offsets.length;
      while (lo + 1 < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (offsets[mid] <= offset) lo = mid;
        else hi = mid;
      }
      return {
        source: sections.findLast((s) => s.line <= lo)?.source ?? '(unmapped)',
        generatedLine: lo + 1,
        column: offset - offsets[lo] + 1,
      };
    },
  };
}

const rigidPath = 'engine/experimental/multiphysics/rigid.ts';
const categories = {
  geometry:
    /^(contactGeometry|contactWithinTolerance|pairAxes|axes|projectionRadius|manifold|clipPolygon|closestEdgePoint|particleBoxGeometry)$/,
  effectiveResponse: /^effective$/,
  relativeMotion: /^(relative|pointVelocity|omega|beforeKickVelocity)$/,
  impulseUpdates: /^(impulse|apply|record)$/,
  frictionDisk: /^diskSolution$/,
};
function emptyCounts() {
  return {
    samples: 0,
    kernelSamples: 0,
    solverSamples: 0,
    buckets: {},
    inclusive: {},
    solverBreakdown: {},
  };
}
const increment = (map, key) => {
  map[key] = (map[key] ?? 0) + 1;
};

export function analyzeSolverProfile(profile, text) {
  const checked = summarizeCpuProfile(profile, text),
    locations = bundleLocations(text);
  const nodes = new Map(profile.nodes.map((n) => [n.id, n])),
    parent = new Map();
  for (const n of profile.nodes) for (const child of n.children ?? []) parent.set(child, n.id);
  const describe = (n) => ({
    function: n.callFrame.functionName || '(anonymous)',
    source: n.callFrame.url.replaceAll('\\', '/').endsWith('/engine.mjs')
      ? locations.source(n.callFrame.lineNumber)
      : n.callFrame.url,
    generatedLine: n.callFrame.lineNumber + 1,
    column: n.callFrame.columnNumber + 1,
  });
  const all = emptyCounts(),
    shortIntervals = emptyCounts(),
    functions = new Map(),
    positions = [];
  let wrapperOmittedKernelSamples = 0;
  for (const [index, id] of profile.samples.entries()) {
    const stack = [];
    for (let current = id; current !== undefined; current = parent.get(current))
      stack.push(describe(nodes.get(current)));
    const leaf = stack[0],
      rigid = (regex) => stack.some((f) => f.source === rigidPath && regex.test(f.function));
    const wrapped = stack.some(
      (f) =>
        f.source.replaceAll('\\', '/').endsWith('/profile-data.mjs') &&
        /^profileKernel(Create|Next|Return)$/.test(f.function),
    );
    const kernel = wrapped || rigid(/^(run|createRigidStep3D)$/),
      solver = kernel && rigid(/^solve\d*$/);
    const bucket =
      leaf.function === '(garbage collector)'
        ? 'gc'
        : leaf.function === '(idle)'
          ? 'idle'
          : kernel
            ? 'kernel'
            : stack.some((f) => f.source.replaceAll('\\', '/').endsWith('/exact-state.mjs'))
              ? 'harness-exact-state'
              : stack.some((f) => f.source.startsWith('engine/'))
                ? 'engine-outside-recognized-step'
                : 'harness-other-or-profiler';
    const active = kernel && bucket === 'kernel';
    const inclusion = [];
    if (active) {
      if (solver) inclusion.push('solver');
      if (rigid(/^project$/)) inclusion.push('projection');
      if (rigid(/^(nextImpact|translationImpact|boundedContactAdvance)$/))
        inclusion.push('timeOfImpact');
      for (const [name, regex] of Object.entries(categories))
        if (rigid(regex)) inclusion.push(name);
      if (
        stack.some(
          (f) =>
            f.source === 'engine/portable-data.ts' && /^(copy|copyPortableValue)$/.test(f.function),
        )
      )
        inclusion.push('portableCopy');
      if (
        stack.some(
          (f) =>
            /\/(rigid|conservation)\.ts$/.test(f.source) &&
            /^(validateOwnedParcel|readMaterialParcel3D|admitAssembly|assemblyMotionOfAdmitted|assemblyMassPropertiesOfAdmitted)$/.test(
              f.function,
            ),
        )
      )
        inclusion.push('ownedAdmission');
    }
    let branch = 'solver-other-or-inlined';
    if (active && solver) {
      outer: for (const frame of stack)
        if (frame.source === rigidPath)
          for (const [name, regex] of Object.entries(categories))
            if (regex.test(frame.function)) {
              branch = name;
              break outer;
            }
    }
    for (const counts of [all, ...(profile.timeDeltas[index] <= 10000 ? [shortIntervals] : [])]) {
      counts.samples++;
      increment(counts.buckets, bucket);
      if (active) {
        counts.kernelSamples++;
        for (const name of inclusion) increment(counts.inclusive, name);
        if (solver) {
          counts.solverSamples++;
          increment(counts.solverBreakdown, branch);
        }
      }
    }
    if (!active) continue;
    if (!wrapped) wrapperOmittedKernelSamples++;
    const unique = new Map(
      stack.filter((f) => f.source.startsWith('engine/')).map((f) => [JSON.stringify(f), f]),
    );
    for (const [key, frame] of unique) {
      if (!functions.has(key))
        functions.set(key, { ...frame, selfSamples: 0, inclusiveSamples: 0 });
      functions.get(key).inclusiveSamples++;
    }
    if (leaf.source.startsWith('engine/')) functions.get(JSON.stringify(leaf)).selfSamples++;
  }
  for (const node of profile.nodes) {
    const frame = describe(node);
    if (!frame.source.startsWith('engine/')) continue;
    for (const position of node.positionTicks ?? []) {
      if (
        !Number.isSafeInteger(position.line) ||
        position.line < 1 ||
        !Number.isSafeInteger(position.ticks) ||
        position.ticks < 0
      )
        throw Error('Invalid sampled source-position ticks');
      positions.push({
        function: frame.function,
        declaredSource: frame.source,
        source: locations.source(position.line - 1),
        generatedLine: position.line,
        ticks: position.ticks,
      });
    }
  }
  return {
    all,
    shortIntervals,
    wrapperOmittedKernelSamples,
    intervals: checked.intervals,
    functions: [...functions.values()].sort((a, b) => b.inclusiveSamples - a.inclusiveSamples),
    positions,
    interpretation:
      'Sample counts only, never elapsed-gap-weighted CPU percentages. Inclusive categories overlap. Solver breakdown uses the nearest recognized helper; inlined/unresolved work remains explicit. Short-interval counts are a sensitivity view; all raw samples remain retained.',
  };
}

export function decodeSolverCoverage(coverage, text, bundleUrl) {
  if (!coverage || !Array.isArray(coverage.result) || !Number.isFinite(coverage.timestamp))
    throw Error('Malformed precise coverage');
  const scripts = coverage.result.filter((s) => s.url === bundleUrl);
  if (scripts.length !== 1) throw Error('Expected one exact engine coverage script');
  const locations = bundleLocations(text);
  return scripts[0].functions
    .map((f) => {
      if (!Array.isArray(f.ranges) || !f.ranges.length)
        throw Error('Missing function coverage range');
      for (const r of f.ranges)
        if (
          ![r.startOffset, r.endOffset, r.count].every(Number.isSafeInteger) ||
          r.startOffset < 0 ||
          r.endOffset <= r.startOffset ||
          r.endOffset > text.length ||
          r.count < 0
        )
          throw Error('Invalid coverage range');
      const outer = f.ranges[0];
      for (const r of f.ranges)
        if (r.startOffset < outer.startOffset || r.endOffset > outer.endOffset)
          throw Error('Coverage escapes function');
      return {
        function: f.functionName || '(anonymous)',
        ...locations.at(outer.startOffset),
        callCount: outer.count,
        blockCoverage: f.isBlockCoverage,
        ranges: f.ranges.map((r) => ({
          ...r,
          ...locations.at(r.startOffset),
          excerpt: text.slice(r.startOffset, Math.min(r.endOffset, r.startOffset + 150)),
        })),
      };
    })
    .filter((f) => f.source.startsWith('engine/'));
}
