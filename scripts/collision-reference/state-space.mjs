/** Private rigid-kernel measurements plus an independent full-world replay check. */
import { performance } from 'node:perf_hooks';
import { PROTOCOL, ticksFor, evaluate, statistics } from './protocol.mjs';
import { captureExact, decodeExact } from './exact-state.mjs';
import { owned, same, checkWorldReplay } from './replay.mjs';

function initialState(api, scene) {
  return {
    tick: 0,
    bonds: [],
    parcels: scene.bodies.map((b) => {
      const inertia = api.cuboidMassProperties(
        b.halfExtents,
        b.mass / (8 * b.halfExtents.reduce((a, v) => a * v, 1)),
      ).inertia;
      // The fixtures currently start at identity. Keep this check explicit if scenes grow.
      same(b.orientation, [0, 0, 0, 1], 'initial identity orientation');
      return {
        id: b.id,
        owner: b.id,
        material: 'solid',
        mass: b.mass,
        referenceAmount: 1,
        heatCapacity: 1,
        thermalQ: 100,
        latentQ: 0,
        chemicalQ: 0,
        center: b.center,
        velocity: b.velocity,
        halfExtents: b.halfExtents,
        orientation: b.orientation,
        intrinsicAngularMomentum: inertia.map((v, i) => v * b.angularVelocity[i]),
        principalInertia: inertia,
      };
    }),
  };
}

function observation(api, state, scene, dt, report) {
  let mechanicalEnergy = 0;
  const bodies = state.parcels.map((p) => {
    const q = p.orientation;
    const localL = api.rotateVector([-q[0], -q[1], -q[2], q[3]], p.intrinsicAngularMomentum);
    const omega = api.rotateVector(
      q,
      localL.map((v, i) => v / p.principalInertia[i]),
    );
    const kinetic =
      0.5 * p.mass * p.velocity.reduce((s, v) => s + v * v, 0) +
      0.5 * omega.reduce((s, v, i) => s + v * p.intrinsicAngularMomentum[i], 0);
    if (!scene.bodies.find((b) => b.id === p.id).fixed)
      mechanicalEnergy +=
        kinetic - p.mass * scene.gravity.reduce((s, v, i) => s + v * p.center[i], 0);
    return {
      id: p.id,
      center: p.center,
      velocity: p.velocity,
      orientation: q,
      angularVelocity: omega,
    };
  });
  return {
    time: state.tick * dt,
    bodies,
    mechanicalEnergy,
    contacts: report.report.contacts,
    numericalEnergy: report.numericalEnergyResidual,
    physicalDissipation: report.dissipatedEnergyByParcel.reduce(
      (s, r) => s + r.impact + r.friction,
      0,
    ),
  };
}

export function runRigid(api, scene, dt, budget, start = null, end = ticksFor(dt)) {
  let state = start ? owned(start) : initialState(api, scene);
  const original = owned(state),
    frames = [],
    trajectory = [];
  const phaseWork = { assembly: 0, sweep: 0, contact: 0, fracture: 0 };
  let elapsedMs = 0;
  for (; state.tick < end;) {
    const before = owned(state);
    let job,
      result,
      yields = 0;
    const t0 = performance.now();
    try {
      job = api.createRigidStep3D(
        state.parcels,
        state.bonds,
        scene.bodies.filter((b) => b.fixed).map((b) => b.id),
        { dt, gravity: scene.gravity, friction: scene.friction, restitution: scene.restitution },
      );
      let next;
      do {
        for (let i = 0; i < budget; i++) {
          next = job.next();
          if (next.done) break;
          if (
            ++yields > PROTOCOL.maxYieldsPerTick ||
            next.value.work !== yields ||
            !Object.hasOwn(phaseWork, next.value.phase)
          )
            throw Error('Invalid rigid work progress');
          phaseWork[next.value.phase]++;
        }
      } while (!next.done);
      result = next.value;
    } catch (error) {
      error.partial = {
        completed: owned(frames),
        liveInput: owned(state),
        phaseWork: owned(phaseWork),
        failedTick: state.tick,
        yields,
      };
      throw error;
    } finally {
      job?.return();
    }
    elapsedMs += performance.now() - t0;
    same(state, before, 'rigid input changed');
    if (result.report.work !== yields) throw Error('Rigid work receipt mismatch');
    state = { tick: state.tick + 1, bonds: result.bonds, parcels: result.parcels };
    frames.push({ state: owned(state), result: owned(result) });
    trajectory.push(observation(api, state, scene, dt, result));
  }
  return {
    physical: { initial: original, frames, final: owned(state) },
    trajectory,
    phaseWork,
    elapsedMs,
  };
}

export function benchmarkRigid(api, scene, dt) {
  const reference = runRigid(api, scene, dt, 256);
  for (const budget of PROTOCOL.budgets) {
    const repeated = runRigid(api, scene, dt, budget);
    same(reference.physical, repeated.physical, 'rigid work-budget replay');
    same(reference.phaseWork, repeated.phaseWork, 'rigid work counts');
  }
  const checkpoint = captureExact(reference.physical.frames[1].state);
  for (const restored of [
    decodeExact(checkpoint.encoding, checkpoint.sha256),
    JSON.parse(JSON.stringify(checkpoint.value)),
  ]) {
    same(restored, checkpoint.value, 'rigid checkpoint roundtrip');
    const continued = runRigid(api, scene, dt, 7, restored);
    same(
      continued.physical.frames,
      reference.physical.frames.slice(2),
      'rigid restart continuation',
    );
  }
  const source = initialState(api, scene),
    original = owned(source);
  const cancelled = api.createRigidStep3D(
    source.parcels,
    source.bonds,
    scene.bodies.filter((b) => b.fixed).map((b) => b.id),
    { dt, gravity: scene.gravity, friction: scene.friction, restitution: scene.restitution },
  );
  try {
    cancelled.next();
  } finally {
    cancelled.return();
  }
  same(source, original, 'cancelled rigid input');
  const durations = [];
  for (let sample = -PROTOCOL.warmups; sample < PROTOCOL.samples; sample++) {
    try {
      const measured = runRigid(api, scene, dt, 256);
      same(reference.physical, measured.physical, 'measured rigid repeat');
      if (sample >= 0) durations.push(measured.elapsedMs);
    } catch (error) {
      error.partial = {
        reference: captureExact(reference.physical),
        failedSample: sample,
        completedSamplesMs: durations,
        failure: error.partial ?? null,
      };
      throw error;
    }
  }
  return {
    status: 'completed',
    backend: 'state-space-rigid',
    scene: scene.id,
    dt,
    ticks: ticksFor(dt),
    duration: PROTOCOL.duration,
    exact: captureExact(reference.physical),
    trajectory: reference.trajectory,
    phaseWork: reference.phaseWork,
    replay: { budgets: PROTOCOL.budgets, lossless: true, json: true, cancellation: true },
    diagnostic: evaluate(scene, reference.trajectory),
    timing: statistics(durations),
  };
}

export async function benchmarkWorldReplay(api) {
  const profiles = await api.createMultiphysicsProfiles3D();
  const initial = api.createMultiphysicsSnapshot3D(profiles, {
    parcels: [
      api.seedThermalParcel3D(profiles, {
        id: 'a',
        material: 'copper',
        owner: 'start',
        center: [0, 2, 0],
        angularVelocity: [0, 1, 0],
      }),
    ],
  });
  const factory = (save) => api.createMultiphysicsWorld3D(profiles, save);
  let reference;
  for (const budget of [...PROTOCOL.budgets, 256]) {
    const result = checkWorldReplay(factory, initial, budget);
    if (reference) same(reference, result, 'LEG-WORKER complete result');
    else reference = result;
  }
  return {
    status: 'completed',
    fixture: 'LEG-WORKER',
    horizon: 2,
    continuation: 1,
    budgets: PROTOCOL.budgets,
    exact: captureExact(reference),
    acceptance: PROTOCOL.acceptance,
  };
}
