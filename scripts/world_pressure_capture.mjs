/** Observe the existing frozen world fixtures. All captures belong to the study process. */
import assert from 'node:assert/strict';
import { serialize } from 'node:v8';
import { gzipSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hash } from './liquid_contact_engine.mjs';

export const scenes = [
  { id: 'control-timed-cup-4', water: 63, ticks: 2 },
  { id: 'control-resolved-tank', water: 99, ticks: 2 },
  { id: 'control-resting-cup', water: 27, ticks: 6 },
];

export function captureScene(api, profiles, golden, scene, output) {
  const fixture = api.FROZEN_CASES_3D.find((item) => item.id === scene.id);
  const { heavy, why, ...expected } = golden.cases[scene.id];
  const referenceTicks = [];
  let initial;
  const plainEngine = {
    ...api,
    createMultiphysicsTickJob3D(p, state) {
      initial ??= structuredClone(state);
      const job = api.createMultiphysicsTickJob3D(p, state);
      return {
        ...job,
        result() {
          const result = job.result();
          referenceTicks.push(structuredClone(result));
          return result;
        },
      };
    },
  };
  const plain = api.recordFrozenCase3D(plainEngine, profiles, fixture);
  assert.deepEqual(plain, expected);
  const operators = new Map(),
    faces = [],
    ticks = [];
  const rest = { maxSpeed: 0, maxDisplacement: 0, heat: 0, maxAbsLedger: 0 };
  let initialWater;
  const engine = {
    ...api,
    createMultiphysicsTickJob3D(p, state) {
      const inputDigest = api.digestFrozen3D(state);
      assert.equal(state.rules, 'multiphysics-world-2');
      const water = state.parcels.filter((row) => row.material === 'water');
      assert.equal(water.length, scene.water);
      initialWater ??= new Map(water.map((row) => [row.id, row.center]));
      const capturePass = (pass) => (face, columns) => {
        assert(faces.length < 512, 'per-scene face bound');
        assert.equal(columns.particles.length, scene.water);
        const { gradients, responses, ...active } = face;
        assert.equal(gradients[0].length, scene.water * 3 + 6 * columns.bodies.length);
        const op = { columns, gradients, responses };
        const key = hash(serialize(op));
        if (!operators.has(key)) operators.set(key, op);
        faces.push({ tick: state.tick + 1, pass, operator: key, dt: state.settings.dt, ...active });
      };
      const job = api.createWorldTickJob(p, state, {
        first: capturePass('first'),
        postDrift: capturePass('postDrift'),
      });
      return {
        ...job,
        advance: () => job.advance(1),
        result() {
          const result = job.result();
          assert.equal(api.digestFrozen3D(state), inputDigest, 'tick mutated its input');
          assert.deepEqual(result, referenceTicks[ticks.length], 'capture changed a full tick');
          const { report, snapshot } = result;
          ticks.push({
            tick: snapshot.tick,
            work: report.work,
            stateAndReport: api.digestFrozen3D(result),
            first: report.fluid?.convergence,
            postDrift: report.fluidPostProjection?.convergence,
          });
          if (scene.id === 'control-resting-cup') {
            rest.heat += report.mechanicalHeat;
            for (const fluid of [report.fluid, report.fluidPostProjection])
              rest.heat += fluid.energy.viscousHeat + fluid.energy.contactHeat;
            rest.maxAbsLedger = Math.max(
              rest.maxAbsLedger,
              Math.abs(snapshot.accounting.numericalEnergy),
            );
            for (const row of snapshot.parcels.filter((p) => initialWater.has(p.id))) {
              rest.maxSpeed = Math.max(rest.maxSpeed, Math.hypot(...row.velocity));
              rest.maxDisplacement = Math.max(
                rest.maxDisplacement,
                Math.hypot(...row.center.map((v, i) => v - initialWater.get(row.id)[i])),
              );
            }
          }
          return result;
        },
      };
    },
  };
  const observed = api.recordFrozenCase3D(engine, profiles, fixture);
  assert.deepEqual(observed, plain, 'capture changed the frozen trajectory');
  assert.equal(observed.outcome, 'completed');
  assert.equal(ticks.length, scene.ticks);
  if (scene.id === 'control-resting-cup')
    assert(
      rest.maxSpeed < 1e-6 &&
        rest.maxDisplacement < 1e-6 &&
        Math.abs(rest.heat) < 1e-9 &&
        rest.maxAbsLedger < 1e-6,
      'resting-water gate',
    );
  // Each frozen tick reaches the dense fallback in both pressure passes.
  for (const { tick } of ticks)
    for (const pass of ['first', 'postDrift'])
      assert(
        faces.some((f) => f.tick === tick && f.pass === pass),
        'missing ' + pass + ' capture on tick ' + tick,
      );
  // V8 serialization preserves Float64 bits including signed zero. Decode this exact packet
  // in both timed children; each distinct ordered operator is stored only once.
  const packet = gzipSync(serialize({ operators, faces }));
  const file = scene.id + '.v8.gz';
  writeFileSync(join(output, file), packet);
  const worldFile = scene.id + '.ticks.v8.gz';
  const world = gzipSync(serialize({ initial, results: referenceTicks }));
  writeFileSync(join(output, worldFile), world);
  return {
    ...scene,
    file,
    sha256: hash(packet),
    bytes: packet.length,
    world: { file: worldFile, sha256: hash(world), bytes: world.length },
    capturedFaces: faces.length,
    uniqueOperators: operators.size,
    trajectory: ticks,
    resting: scene.id === 'control-resting-cup' ? rest : null,
  };
}
