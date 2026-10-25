import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  createFluidReferenceJob3D,
  type FluidReferenceInput3D,
  type FluidReferenceTuning3D,
} from './fluids.js';
import {
  createFluidStudyBlock3D as block,
  createFluidStudyWedge3D as wedge,
  createFluidStudyParticle3D as particle,
} from '../../test-support/multiphysics-fluid-fixtures.js';

const reference: FluidReferenceTuning3D = { coordinateProjection: false, zeroViscosity: false };
const variants: FluidReferenceTuning3D[] = [
  { coordinateProjection: true, zeroViscosity: false },
  { coordinateProjection: false, zeroViscosity: true },
  { coordinateProjection: true, zeroViscosity: true },
];
const scenes: [string, () => FluidReferenceInput3D][] = [
  [
    'shared rotating body with off-diagonal inverse inertia',
    () => {
      const scene = block(2);
      scene.bodies[0].inverseInertia = [0.05, 0.01, 0, 0.01, 0.04, 0.005, 0, 0.005, 0.06];
      return scene;
    },
  ],
  [
    'mixed viscosity, unequal masses and finite spin',
    () => {
      const scene = block(2);
      scene.particles.forEach((p, i) => {
        p.viscosity = i % 2 ? 0 : 0.4;
        p.parcel.mass = 1 + 0.01 * i;
        p.parcel.intrinsicAngularMomentum = [0.03, -0.02, 0.01];
      });
      return scene;
    },
  ],
  [
    'zero-viscosity gas pressure and finite parcel rotation',
    () => ({
      particles: [
        [0, 0, 0],
        [1, 0, 0],
      ].map((center, i) => ({
        ...particle(String(i), center as [number, number, number], [0.1 * (1 - i), 0.01, 0]),
        phase: 'gas' as const,
        volume: 1,
        thermalCurve: { enthalpy: 1, lowOffset: 0, highOffset: 0, plateauEnergy: 0 },
      })),
      bodies: [],
      boundaries: [],
      dt: 0.001,
      smoothingRadius: 2,
    }),
  ],
  [
    'duplicated narrow contacts and signed zero',
    () => {
      const scene = wedge();
      scene.particles[0].parcel.intrinsicAngularMomentum = [-0, 0, -0];
      scene.particles[0].parcel.velocity = [-1, -1, -0];
      return scene;
    },
  ],
  [
    'fixed boundary ownership',
    () => {
      const scene = block(2),
        b = scene.bodies[0];
      b.inverseMass = 0;
      b.inverseInertia = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      b.velocity = b.angularVelocity = [0, 0, 0];
      return scene;
    },
  ],
  [
    'gravity predictor and canonical input reversal',
    () => {
      const scene = block(2);
      scene.velocityPrediction = [0.01, -0.02, 0.03];
      scene.particles.reverse();
      scene.boundaries.reverse();
      scene.contacts!.reverse();
      return scene;
    },
  ],
];

test.each(scenes)(
  'coordinate/viscosity optimizations retain exact output and work stages: %s',
  (_name, make) => {
    const input = make(),
      unchanged = structuredClone(input);
    for (const tuning of variants) {
      const old = createFluidReferenceJob3D(input, undefined, reference),
        next = createFluidReferenceJob3D(input, undefined, tuning);
      while (old.progress().status === 'running')
        assert.deepStrictEqual(next.advance(1), old.advance(1));
      assert.deepStrictEqual(next.result(), old.result());
      const batched = createFluidReferenceJob3D(input, undefined, tuning);
      while (batched.progress().status === 'running') batched.advance(256);
      assert.deepStrictEqual(batched.result(), old.result());
    }
    assert.deepStrictEqual(input, unchanged);
  },
);

test('cancellation at each observed stage cannot publish a partial optimized result', () => {
  const input = block(2),
    stages = new Set<string>(),
    scan = createFluidReferenceJob3D(input);
  while (scan.progress().status === 'running') {
    const progress = scan.advance(1);
    if (progress.status === 'running') stages.add(progress.stage);
  }
  for (const stage of stages) {
    const job = createFluidReferenceJob3D(input);
    while (job.progress().stage !== stage) job.advance(1);
    assert.equal(job.cancel(), true);
    assert.throws(() => job.result(), /not complete/);
    assert.throws(() => job.advance(1), /no longer running/);
  }
});

test('invalid viscosity and singular support still reject without publishing', () => {
  for (const tuning of [reference, ...variants]) {
    const invalid = block(2);
    invalid.particles[0].viscosity = -1;
    assert.throws(() => createFluidReferenceJob3D(invalid, undefined, tuning), /viscosity/);
    const singular = {
      particles: [particle('alone', [0, 0, 0], [0, 0, 0])],
      bodies: [],
      boundaries: [],
      dt: 0.001,
      smoothingRadius: 2,
    };
    singular.particles[0].restDensity = 0.01;
    const job = createFluidReferenceJob3D(singular, undefined, tuning);
    assert.throws(() => {
      while (job.progress().status === 'running') job.advance(1);
    }, /movable support/);
    assert.equal(job.progress().status, 'cancelled');
    assert.throws(() => job.result(), /not complete/);
  }
});
