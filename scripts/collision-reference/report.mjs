/** Physical diagnostics are separate from within-backend exact replay. */
import { PROTOCOL, ticksFor, evaluate, statistics } from './protocol.mjs';

export function endDifference(a, b) {
  const left = a.trajectory.at(-1),
    right = b.trajectory.at(-1);
  if (!left || !right || Math.abs(left.time - right.time) > 1e-12)
    throw Error('Mismatched physical horizon');
  return left.bodies.map((body) => {
    const other = right.bodies.find((x) => x.id === body.id);
    if (!other) throw Error('Missing paired body');
    const norm = (key) => Math.hypot(...body[key].map((v, i) => v - other[key][i]));
    const qa = body.orientation,
      qb = other.orientation;
    const cosine = Math.abs(
      qa.reduce((s, v, i) => s + v * qb[i], 0) / (Math.hypot(...qa) * Math.hypot(...qb)),
    );
    const values = {
      id: body.id,
      positionL2: norm('center'),
      velocityL2: norm('velocity'),
      angularVelocityL2: norm('angularVelocity'),
      orientationRadians: 2 * Math.acos(Math.min(1, cosine)),
    };
    if (Object.values(values).some((v) => typeof v === 'number' && !Number.isFinite(v)))
      throw Error('Nonfinite comparison');
    return values;
  });
}

export function assembleReport(packet, stateRows, mujocoRows, worldReplay) {
  const backends = ['state-space-rigid', 'mujoco-discrete', 'mujoco-speculative'];
  const rows = [...stateRows, ...mujocoRows].map((row) => {
    const scene = packet.fixtures.find((f) => f.id === row.scene);
    if (!scene || !PROTOCOL.timesteps.includes(row.dt) || !backends.includes(row.backend))
      throw Error('Unregistered comparison row');
    if (row.status !== 'completed') return row;
    if (
      row.duration !== PROTOCOL.duration ||
      row.ticks !== ticksFor(row.dt) ||
      row.trajectory?.length !== row.ticks
    )
      throw Error('Incomplete trajectory');
    const ids = scene.bodies.map((b) => b.id).sort();
    for (const [i, frame] of row.trajectory.entries()) {
      if (
        !Number.isFinite(frame.time) ||
        Math.abs(frame.time - (i + 1) * row.dt) > 1e-12 ||
        !Number.isFinite(frame.mechanicalEnergy) ||
        !Number.isSafeInteger(frame.contacts) ||
        frame.contacts < 0 ||
        JSON.stringify(frame.bodies.map((b) => b.id).sort()) !== JSON.stringify(ids)
      )
        throw Error('Invalid trajectory frame');
      for (const body of frame.bodies)
        for (const [key, size] of [
          ['center', 3],
          ['velocity', 3],
          ['orientation', 4],
          ['angularVelocity', 3],
        ])
          if (
            !Array.isArray(body[key]) ||
            body[key].length !== size ||
            body[key].some((x) => !Number.isFinite(x))
          )
            throw Error('Invalid observation vector');
    }
    return {
      ...row,
      diagnostic: evaluate(scene, row.trajectory),
      timing: statistics(row.samplesMs ?? row.timing?.samplesMs ?? []),
    };
  });
  const indexed = new Map();
  for (const row of rows) {
    const key = `${row.scene}/${row.dt}/${row.backend}`;
    if (indexed.has(key)) throw Error('Duplicate comparison row');
    indexed.set(key, row);
  }
  const comparisons = [],
    refinement = [],
    missing = [];
  for (const scene of packet.fixtures) {
    for (const dt of PROTOCOL.timesteps) {
      const cohort = backends.map((b) => indexed.get(`${scene.id}/${dt}/${b}`));
      for (let i = 0; i < cohort.length; i++)
        if (!cohort[i]) missing.push(`${scene.id}/${dt}/${backends[i]}`);
      if (cohort.every((r) => r?.status === 'completed')) {
        comparisons.push({
          scene: scene.id,
          dt,
          discreteVsStateSpace: endDifference(cohort[0], cohort[1]),
          speculativeVsStateSpace: endDifference(cohort[0], cohort[2]),
          speculativeVsDiscrete: endDifference(cohort[1], cohort[2]),
        });
      }
    }
    for (const backend of backends)
      for (let i = 0; i + 1 < PROTOCOL.timesteps.length; i++) {
        const coarse = indexed.get(`${scene.id}/${PROTOCOL.timesteps[i]}/${backend}`);
        const fine = indexed.get(`${scene.id}/${PROTOCOL.timesteps[i + 1]}/${backend}`);
        if (coarse?.status === 'completed' && fine?.status === 'completed')
          refinement.push({
            scene: scene.id,
            backend,
            coarseDt: coarse.dt,
            fineDt: fine.dt,
            difference: endDifference(coarse, fine),
          });
      }
  }
  const failed = rows.filter((r) => r.status !== 'completed').length;
  return {
    schema: 'collision-comparison-report-v1',
    status:
      missing.length || failed || worldReplay.status !== 'completed'
        ? 'incomplete'
        : 'diagnostic-complete',
    acceptance: PROTOCOL.acceptance,
    missing,
    failed,
    worldReplay,
    interpretation: [
      'No cross-engine bitwise equivalence or solver-only speedup is inferred.',
      'State Space measures private rigid stepping including owned input/output and generator overhead; MuJoCo measures mj_step through Python.',
      'Compilation, setup, state capture, observation extraction and replay checks are outside timing.',
      'Warmups and measured trajectories must reproduce complete within-backend state; failed samples are never replaced.',
      'MuJoCo soft-contact dissipation and numerical error are not identified as physical heat.',
      'Contact counts have different sampling semantics: State Space counts during the tick; MuJoCo reports the pre-integration contact set.',
      'Two warmups/seven samples are diagnostics, not the R1 five-session performance protocol.',
      'Runtime/Worker/GPU acceptance, coupled-world qualification and R0/R1 gates remain open.',
    ],
    rows,
    comparisons,
    refinement,
  };
}

export function markdownReport(report) {
  const lines = [
    '# CPU collision comparison',
    '',
    `Status: **${report.status}**. All qualification acceptance flags remain false.`,
    '',
    '| Scene | dt | Backend | Outcome | Median ms / simulated second |',
    '| --- | ---: | --- | --- | ---: |',
  ];
  for (const row of report.rows)
    lines.push(
      `| ${row.scene} | ${row.dt} | ${row.backend} | ${row.status === 'completed' ? row.diagnostic.status : 'failed'} | ${row.timing?.medianMsPerSimulatedSecond?.toFixed(3) ?? '—'} |`,
    );
  lines.push(
    '',
    ...report.interpretation.map((s) => '- ' + s),
    '',
    'Full states, physical differences, refinement diagnostics, failures and provenance are retained in the JSON report.',
  );
  return lines.join('\n') + '\n';
}
