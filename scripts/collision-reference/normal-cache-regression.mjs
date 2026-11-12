/** Import-safe differential scenarios. Supplied engines execute only inside an attested Job. */
import assert from 'node:assert/strict';
import { captureExact, decodeExact } from './exact-state.mjs';
import { same, owned } from './replay.mjs';
import { PROTOCOL } from './protocol.mjs';
const qz = (angle) => [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)];
// Lossless diagnostic representation: validated work numbers are consecutive, so
// phase runs preserve every yield without repeatedly embedding a large wire string.
export const newProgressTrace = () => ({ count: 0, runs: [] });
export function appendProgress(trace, value) {
  const keys = Object.keys(value);
  if (
    keys.length !== 2 ||
    keys[0] !== 'phase' ||
    keys[1] !== 'work' ||
    !['assembly', 'sweep', 'contact', 'fracture'].includes(value.phase) ||
    value.work !== trace.count + 1 ||
    trace.count >= PROTOCOL.maxYieldsPerTick
  )
    throw Error('Invalid exact progress trace');
  trace.count++;
  const last = trace.runs.at(-1);
  if (last?.phase === value.phase) last.count++;
  else trace.runs.push({ phase: value.phase, firstWork: value.work, count: 1 });
}
export function progressPrefix(trace, count) {
  assert(Number.isSafeInteger(count) && count >= 0 && count <= trace.count);
  return {
    count,
    runs: trace.runs
      .filter((r) => r.firstWork <= count)
      .map((r) => ({ ...r, count: Math.min(r.count, count - r.firstWork + 1) })),
  };
}
function parcel(api, id, center = [0, 0, 0], velocity = [0, 0, 0], halfExtents = [0.5, 0.5, 0.5]) {
  return {
    id,
    owner: id,
    material: 'solid',
    mass: 1,
    referenceAmount: 1,
    heatCapacity: 1,
    thermalQ: 100,
    latentQ: 0,
    chemicalQ: 0,
    center,
    velocity,
    halfExtents,
    orientation: [0, 0, 0, 1],
    intrinsicAngularMomentum: [0, 0, 0],
    principalInertia: api.cuboidMassProperties(
      halfExtents,
      1 / (8 * halfExtents.reduce((a, v) => a * v, 1)),
    ).inertia,
    extension: { signedZero: -0, kept: ['private-input'] },
  };
}
function scenarios(api) {
  const floor = () => parcel(api, 'floor', [0, 0, 0], [0, 0, 0], [4, 0.5, 4]);
  const orientation = qz(Math.atan(0.5));
  const rod = parcel(api, 'rod', [0, 1.5, 0], [0, 0, 0], [1.5, 0.1, 0.1]);
  rod.intrinsicAngularMomentum = [0, 0, rod.principalInertia[2]];
  return [
    {
      name: 'sliding-friction',
      parcels: [floor(), parcel(api, 'top', [0, 1, 0], [2, -1, 0])],
      options: { dt: 0.01, friction: 0.2, restitution: 0 },
      anchors: ['floor'],
      steps: 2,
    },
    {
      name: 'inclined-friction',
      parcels: [
        { ...floor(), orientation },
        { ...parcel(api, 'top', api.rotateVector(orientation, [0, 1, 0])), orientation },
      ],
      options: { dt: 0.01, gravity: [0, -10, 0], friction: 1 },
      anchors: ['floor'],
      steps: 2,
    },
    {
      name: 'friction-stack',
      parcels: [floor(), parcel(api, 'middle', [0, 1, 0]), parcel(api, 'top', [0, 2, 0])],
      options: { dt: 0.02, gravity: [0, -10, 0], friction: 0.5, solverIterations: 256 },
      anchors: ['floor'],
      steps: 2,
    },
    {
      name: 'off-center-rotated-impact',
      parcels: [
        {
          ...parcel(api, 'moving', [-0.5 - 1.5 * Math.SQRT1_2, 0, 0], [2, 0, 0], [1, 0.5, 0.5]),
          orientation: qz(Math.PI / 4),
        },
        parcel(api, 'wall', [0, 0, 0], [0, 0, 0], [0.5, 4, 4]),
      ],
      options: { dt: 0.01, friction: 0, restitution: 0 },
      anchors: ['wall'],
      steps: 2,
    },
    {
      name: 'rotating-rod-impact',
      parcels: [rod, floor()],
      options: { dt: 0.9, friction: 0, restitution: 0, maxEvents: 1024 },
      anchors: ['floor'],
      steps: 1,
    },
    {
      name: 'geometric-projection',
      parcels: [floor(), parcel(api, 'top', [0, 1 - 1e-7, 0])],
      options: { dt: 0.002, gravity: [0, -10, 0], friction: 0, maxPenetration: 1e-5 },
      anchors: ['floor'],
      steps: 2,
    },
  ];
}
function trajectory(api, s, budget, start = null, limit = s.steps) {
  let state = start ? owned(start) : { parcels: owned(s.parcels), bonds: [], frames: [] };
  try {
    while (state.frames.length < limit) {
      const input = captureExact(state),
        progress = newProgressTrace();
      const job = api.createRigidStep3D(state.parcels, state.bonds, s.anchors, s.options);
      let next;
      try {
        do {
          for (let n = 0; n < budget; n++) {
            next = job.next();
            if (next.done) break;
            appendProgress(progress, next.value);
          }
        } while (!next.done);
      } catch (e) {
        return { status: 'rejected', error: { name: e.name, message: e.message }, state, progress };
      } finally {
        job.return();
      }
      same(captureExact(state), input, 'normal-cache input mutation');
      assert.equal(next.value.report.work, progress.count);
      assert(!JSON.stringify(next.value).includes('normalDenominator'), 'private cache escaped');
      state = {
        parcels: next.value.parcels,
        bonds: next.value.bonds,
        frames: [...state.frames, { result: next.value, progress }],
      };
    }
    return { status: 'completed', state };
  } catch (e) {
    return { status: 'rejected', error: { name: e.name, message: e.message }, state, progress: [] };
  }
}
export function checkNormalCacheRegression(before, after) {
  const oldScenes = scenarios(before),
    newScenes = scenarios(after),
    checks = [];
  const compare = (name, old, current, expected = 'completed') => {
    assert.equal(old.status, expected, name + ' baseline expectation');
    same(current, old, name);
    const exact = captureExact(current);
    checks.push({ name, status: 'passed', outcome: expected, exactSha256: exact.sha256 });
  };
  for (let i = 0; i < oldScenes.length; i++) {
    const a = oldScenes[i],
      b = newScenes[i],
      reference = trajectory(before, a, 256);
    if (reference.status !== 'completed') {
      const current = trajectory(after, b, 256);
      const error = Error(a.name + ' baseline rejected: ' + reference.error.message);
      error.partial = { name: a.name, baseline: reference, current, completedChecks: checks };
      throw error;
    }
    for (const budget of PROTOCOL.budgets) {
      const old = trajectory(before, a, budget),
        current = trajectory(after, b, budget);
      same(old, reference, a.name + ' baseline budgets');
      compare(a.name + '/budget-' + budget, old, current);
    }
    if (a.steps > 1)
      for (const format of ['lossless', 'json']) {
        const restart = (api, s) => {
          const partial = trajectory(api, s, 7, null, 1);
          assert.equal(partial.status, 'completed');
          const captured = captureExact(partial.state);
          const state =
            format === 'lossless'
              ? decodeExact(captured.encoding, captured.sha256)
              : JSON.parse(JSON.stringify(partial.state));
          return trajectory(api, s, 7, state);
        };
        // Exact encoding is required to match the uninterrupted reference. JSON may normalize -0.
        const old = restart(before, a),
          current = restart(after, b);
        if (format === 'lossless') same(old, reference, a.name + ' lossless continuation');
        compare(a.name + '/restart-' + format, old, current);
      }
    const stop = Math.max(1, Math.min(64, reference.state.frames[0].progress.count - 1));
    const cancel = (api, s) => {
      const input = captureExact(s),
        progress = newProgressTrace(),
        job = api.createRigidStep3D(s.parcels, [], s.anchors, s.options);
      try {
        for (let n = 0; n < stop; n++) {
          const next = job.next();
          assert(!next.done);
          appendProgress(progress, next.value);
        }
      } finally {
        job.return();
      }
      assert(job.next().done);
      same(captureExact(s), input, 'cancel caller isolation');
      same(
        progress,
        progressPrefix(reference.state.frames[0].progress, stop),
        'cancel work prefix',
      );
      const retry = trajectory(api, s, 7);
      same(retry, reference, 'cancelled contact cache survived into retry');
      return { status: 'completed', progress, retry };
    };
    compare(a.name + '/cancel-and-retry', cancel(before, a), cancel(after, b));
  }
  for (const [name, patch] of [
    ['work-limit', { maxWork: 10 }],
    ['solver-limit', { solverIterations: 1 }],
    ['invalid-penetration', { maxPenetration: 1e-12 }],
  ]) {
    const index = name === 'invalid-penetration' ? 5 : 2;
    const a = { ...oldScenes[index], options: { ...oldScenes[index].options, ...patch } },
      b = { ...newScenes[index], options: { ...newScenes[index].options, ...patch } };
    compare(name, trajectory(before, a, 7), trajectory(after, b, 7), 'rejected');
  }
  assert.equal(checks.length, 37);
  return { status: 'completed', checks, count: checks.length, acceptance: PROTOCOL.acceptance };
}
