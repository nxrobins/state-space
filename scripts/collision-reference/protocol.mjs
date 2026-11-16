/** Fixed diagnostic workload. No engine imports or physics execution. */
export const PROTOCOL = Object.freeze({
  schema: 'collision-reference-v1',
  duration: 0.048,
  timesteps: [0.016, 0.008, 0.002],
  budgets: [1, 7, 256],
  warmups: 2,
  samples: 7,
  maxTicks: 24,
  maxYieldsPerTick: 200000,
  supervisorSeconds: 600,
  mujocoVersion: '4.0.0',
  numpyVersion: '2.3.4',
  mujoco: {
    integrator: 'Euler',
    solver: 'Newton',
    iterations: 100,
    tolerance: 1e-10,
    solref: [0.002, 1],
    solimp: [0.99, 0.99, 0.001],
    sleeping: false,
    warmstart: true,
    threads: 1,
  },
  acceptance: {
    runtime: false,
    performance: false,
    gpu: false,
    worker: false,
    r1: false,
    purpose: 'Bounded diagnostic comparison; no existing qualification gate is closed.',
  },
});

const body = (
  id,
  center,
  halfExtents,
  velocity = [0, 0, 0],
  angularVelocity = [0, 0, 0],
  fixed = false,
) => ({
  id,
  center,
  halfExtents,
  velocity,
  angularVelocity,
  orientation: [0, 0, 0, 1],
  mass: 1,
  fixed,
});
const wall = (id = 'wall', x = 0) => body(id, [x, 0, 0], [0.005, 2, 2], undefined, undefined, true);
const floor = () => body('floor', [0, -0.01, 0], [3, 0.01, 3], undefined, undefined, true);
const moving = () => body('moving', [-0.1, 0, 0], [0.01, 0.01, 0.01], [20, 0, 0]);
const scene = (id, bodies, extra = {}) => ({
  id,
  bodies,
  gravity: [0, 0, 0],
  restitution: 0,
  friction: 0,
  check: { kind: 'diagnostic' },
  ...extra,
});

export function fixtures() {
  return [
    scene('free-drift', [body('moving', [-1, 1, 0], [0.1, 0.1, 0.1], [2, -1, 0])], {
      check: { kind: 'ballistic', tolerance: 1e-10, contactForbidden: true },
    }),
    scene('thin-wall', [moving(), wall()], {
      check: {
        kind: 'barrier',
        body: 'moving',
        maxX: -0.015,
        tolerance: 1e-5,
        contactRequired: true,
      },
    }),
    scene('occluded-wall', [moving(), wall(), wall('behind', 0.05)], {
      check: {
        kind: 'barrier',
        body: 'moving',
        maxX: -0.015,
        tolerance: 1e-5,
        contactRequired: true,
      },
    }),
    scene(
      'grazing-clearance',
      [body('moving', [-0.1, 2.02, 0], [0.01, 0.01, 0.01], [20, 0, 0]), wall()],
      { check: { kind: 'ballistic', tolerance: 1e-10, contactForbidden: true } },
    ),
    scene('rotating-plate', [
      body('moving', [0, 0.15, 0], [0.4, 0.01, 0.1], undefined, [0, 0, 50]),
      floor(),
    ]),
    scene('impact-chain', [
      moving(),
      body('middle', [0, 0, 0], [0.01, 0.01, 0.01]),
      body('last', [0.05, 0, 0], [0.01, 0.01, 0.01]),
    ]),
    scene(
      'resting-stack',
      [
        floor(),
        body('lower', [0, 0.1, 0], [0.1, 0.1, 0.1]),
        body('upper', [0, 0.3, 0], [0.1, 0.1, 0.1]),
      ],
      { gravity: [0, -9.8, 0] },
    ),
  ];
}

export function ticksFor(dt) {
  if (!PROTOCOL.timesteps.includes(dt)) throw Error('Unregistered timestep');
  const ticks = Math.round(PROTOCOL.duration / dt);
  if (ticks < 3 || ticks > PROTOCOL.maxTicks || Math.abs(ticks * dt - PROTOCOL.duration) > 1e-14)
    throw Error('Invalid equal-duration horizon');
  return ticks;
}

export function statistics(samples) {
  if (samples.length !== PROTOCOL.samples || samples.some((x) => !Number.isFinite(x) || x <= 0))
    throw Error('Incomplete or invalid timing cohort');
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    samplesMs: samples,
    medianMs: sorted[Math.floor(sorted.length / 2)],
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    medianMsPerSimulatedSecond: sorted[Math.floor(sorted.length / 2)] / PROTOCOL.duration,
    diagnosticOnly: true,
  };
}

// These are benchmark diagnostics, not weakened replacements for engine tolerances.
export function evaluate(scene, trajectory) {
  if (!trajectory.length) throw Error('Missing trajectory');
  const check = scene.check;
  if (check.kind === 'diagnostic') return { status: 'observed', passed: null };
  let maximumError = 0;
  for (const frame of trajectory) {
    if (!Number.isFinite(frame.time)) throw Error('Invalid observation time');
    for (const initial of scene.bodies.filter((b) => !b.fixed)) {
      const current = frame.bodies.find((b) => b.id === initial.id);
      if (!current || [...current.center, ...current.velocity].some((x) => !Number.isFinite(x)))
        throw Error('Missing or invalid body observation');
      if (check.kind === 'ballistic') {
        for (let i = 0; i < 3; i++) {
          maximumError = Math.max(
            maximumError,
            Math.abs(
              current.center[i] -
                initial.center[i] -
                initial.velocity[i] * frame.time -
                (scene.gravity[i] * frame.time ** 2) / 2,
            ),
            Math.abs(current.velocity[i] - initial.velocity[i] - scene.gravity[i] * frame.time),
          );
        }
      } else if (initial.id === check.body)
        maximumError = Math.max(maximumError, current.center[0] - check.maxX);
    }
  }
  const contactObserved = trajectory.some((f) => f.contacts > 0);
  const passed =
    maximumError <= check.tolerance &&
    (!check.contactRequired || contactObserved) &&
    (!check.contactForbidden || !contactObserved);
  return {
    status: passed ? 'passed' : 'failed',
    passed,
    maximumError,
    contactObserved,
    tolerance: check.tolerance,
  };
}
