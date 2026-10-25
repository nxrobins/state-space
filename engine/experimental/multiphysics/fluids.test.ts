import { expect, test } from 'vitest';
import { parcelConservation3D, type MaterialParcel3D } from './conservation.js';
import { type Vec3, crossVec3, addVec3, scaleVec3, subtractVec3, dotVec3 } from './math.js';
import {
  type FluidParticle3D,
  type FluidReferenceInput3D,
  type FluidBoundaryBody3D,
  fluidDensityKernel3D,
  solveFluidReference3D,
  createFluidReferenceJob3D,
  FLUID_REFERENCE_LIMITS_3D,
} from './fluids.js';

const parcel = (
  id: string,
  center: Vec3,
  patch: Partial<MaterialParcel3D> = {},
): MaterialParcel3D => ({
  id,
  owner: 'fluid',
  material: 'water',
  mass: 1,
  referenceAmount: 1,
  heatCapacity: 1,
  thermalQ: 256,
  latentQ: 0,
  chemicalQ: 0,
  center,
  velocity: [0, 0, 0],
  orientation: [0, 0, 0, 1],
  principalInertia: [1 / 6, 1 / 6, 1 / 6],
  intrinsicAngularMomentum: [0, 0, 0],
  ...patch,
});
const particle = (
  id: string,
  center: Vec3,
  patch: Partial<FluidParticle3D> = {},
): FluidParticle3D => {
  const value = {
    parcel: parcel(id, center),
    thermalEnergy: 1,
    phase: 'gas' as const,
    restDensity: 1,
    viscosity: 0,
    volume: 1,
    ...patch,
  };
  return {
    ...value,
    thermalCurve:
      patch.thermalCurve === undefined
        ? value.phase === 'gas'
          ? { enthalpy: value.thermalEnergy, lowOffset: 0, highOffset: 0, plateauEnergy: 0 }
          : null
        : patch.thermalCurve,
  };
};
const input = (
  particles: FluidParticle3D[],
  patch: Partial<FluidReferenceInput3D> = {},
): FluidReferenceInput3D => ({
  particles,
  bodies: [],
  boundaries: [],
  dt: 0.01,
  smoothingRadius: 2,
  ...patch,
});
const body = (patch: Partial<FluidBoundaryBody3D> = {}): FluidBoundaryBody3D => ({
  id: 'body',
  center: [1, 1, 0],
  velocity: [0, 0, 0],
  angularVelocity: [0, 0, 0],
  inverseMass: 0.5,
  inverseInertia: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  ...patch,
});
function closeVector(actual: Vec3, expected: Vec3, digits = 11): void {
  for (let i = 0; i < 3; i++) expect(actual[i]).toBeCloseTo(expected[i], digits);
}

// These prove bounded local references, not DFSPH/world/runtime qualification.
test('poly6 value and derivative match the radial polynomial and compact support', () => {
  const c = 315 / (64 * Math.PI);
  expect(fluidDensityKernel3D([0, 0, 0], 1).value).toBe(c);
  const at = fluidDensityKernel3D([0.5, 0, 0], 1);
  expect(at.value).toBeCloseTo((c * 27) / 64, 13);
  closeVector(at.gradient, [(-27 * c) / 16, 0, 0]);
  expect(fluidDensityKernel3D([1, 0, 0], 1)).toEqual({ value: 0, gradient: [0, 0, 0] });
  expect(fluidDensityKernel3D([2, 0, 0], 1).value).toBe(0);
  expect(() => fluidDensityKernel3D([0, 0, 0], 0)).toThrow();
});

test('gas pressure pays exactly for pair mechanical work from sensible energy only', () => {
  const scene = input([particle('a', [0, 0, 0]), particle('b', [1, 0, 0])]);
  const before = structuredClone(scene),
    result = solveFluidReference3D(scene);
  expect(result.particles[0].parcel.velocity[0]).toBeLessThan(0);
  expect(result.particles[1].parcel.velocity[0]).toBeGreaterThan(0);
  const mechanical = parcelConservation3D(result.particles.map((p) => p.parcel));
  closeVector(mechanical.linearMomentum, [0, 0, 0]);
  closeVector(mechanical.angularMomentum, [0, 0, 0]);
  expect(mechanical.kineticEnergy).toBeCloseTo(result.energy.gasMechanicalWork, 13);
  expect(result.thermalWork.reduce((s, p) => s + p.pressure, 0)).toBeCloseTo(
    -mechanical.kineticEnergy,
    13,
  );
  expect(result.energy.impulseWorkResidual).toBeCloseTo(0, 13);
  expect(result.energy.projectionKineticChange).toBe(0);
  expect(result.energy.viscousHeat).toBe(0);
  for (let i = 0; i < result.densities.length; i++) {
    const d = result.densities[i],
      energy = 1 + result.thermalWork[i].pressure;
    expect(d.pressure).toBeCloseTo(0.4 * energy * d.density, 13); // gamma=1.4, m=1.
  }
  const chemicallyRich = solveFluidReference3D(
    input(
      scene.particles.map((p) => ({
        ...p,
        parcel: { ...p.parcel, chemicalQ: 1000000, latentQ: 1000000 },
      })),
    ),
  );
  expect(chemicallyRich.densities).toEqual(result.densities);
  expect(chemicallyRich.particles.map((p) => p.parcel.velocity)).toEqual(
    result.particles.map((p) => p.parcel.velocity),
  );
  // Applying heat is the root thermal adapter's responsibility; no hidden Q mutation.
  expect(result.particles.map((p) => p.parcel.thermalQ)).toEqual([256, 256]);
  expect(scene).toEqual(before);
});

test('compression increases gas internal energy and excessive volume changes reject atomically', () => {
  const a = particle('a', [0, 0, 0], { parcel: parcel('a', [0, 0, 0], { velocity: [1, 0, 0] }) });
  const b = particle('b', [1, 0, 0], { parcel: parcel('b', [1, 0, 0], { velocity: [-1, 0, 0] }) });
  const result = solveFluidReference3D(input([a, b]));
  expect(result.energy.gasMechanicalWork).toBeLessThan(0);
  expect(result.thermalWork.every((v) => v.pressure > 0)).toBe(true);
  const energetic = input(
    [
      particle('a', [0, 0, 0], { thermalEnergy: 1000 }),
      particle('b', [1, 0, 0], { thermalEnergy: 1000 }),
    ],
    { dt: 1 },
  );
  const snapshot = structuredClone(energetic),
    job = createFluidReferenceJob3D(energetic);
  expect(() => {
    while (job.progress().status === 'running') job.advance();
  }).toThrow(/volume step/);
  expect(job.progress().status).toBe('cancelled');
  expect(() => job.result()).toThrow();
  expect(energetic).toEqual(snapshot);
});

test('compatible gas pressure matches an independent midpoint solution and the adiabatic volume law', () => {
  // Choose the exact midpoint relative speed, then derive the initial speed and
  // impulse from U_new V_new^0.4 = U_old V_old^0.4. No numerical root in this oracle.
  for (const midpointSpeed of [2, -2]) {
    const dt = 0.01,
      coefficient = (dt * 54 * 315) / (64 * Math.PI * 2 ** 9);
    const deltaVolume = coefficient * midpointSpeed;
    const expectedVolume = 1 + deltaVolume,
      expectedEnergy = expectedVolume ** -0.4;
    const meanPressure = (1 - expectedEnergy) / deltaVolume,
      expectedImpulse = 2 * coefficient * meanPressure;
    const initialSpeed = midpointSpeed - expectedImpulse; // 0.5 * effective inverse mass = 1.
    const a = particle('a', [0, 0, 0], {
      parcel: parcel('a', [0, 0, 0], { velocity: [-initialSpeed / 2, 0, 0] }),
    });
    const b = particle('b', [1, 0, 0], {
      parcel: parcel('b', [1, 0, 0], { velocity: [initialSpeed / 2, 0, 0] }),
    });
    const result = solveFluidReference3D(input([a, b], { dt }));
    expect(result.particles[0].parcel.velocity[0]).toBeCloseTo(
      -initialSpeed / 2 - expectedImpulse,
      12,
    );
    for (let i = 0; i < 2; i++) {
      const row = result.gasVolumes[i];
      expect(row.volume).toBeCloseTo(expectedVolume, 13);
      expect(1 + result.thermalWork[i].pressure).toBeCloseTo(expectedEnergy, 13);
      expect(row.supportRadius).toBeCloseTo(2 * Math.cbrt(expectedVolume), 13);
      expect((1 + result.thermalWork[i].pressure) * row.volume ** 0.4).toBeCloseTo(1, 13);
      expect(row.entropyResidual).toBeLessThan(1e-13);
      expect(row.pressureWorkResidual).toBeLessThan(1e-13);
    }
    expect(result.convergence.gasVolumeResidual).toBeLessThan(1e-13);
    expect(result.energy.gasMechanicalWork).toBeCloseTo(2 * (1 - expectedEnergy), 12);
  }
});

test('a latent plateau releases enthalpy at constant sensible pressure without treating latent energy as pressure', () => {
  const curve = { enthalpy: 4, lowOffset: 1, highOffset: 5, plateauEnergy: 2 };
  const midpointSpeed = 2,
    coefficient = (0.01 * 54 * 315) / (64 * Math.PI * 2 ** 9);
  const expectedVolume = 1 + coefficient * midpointSpeed;
  const expectedChange = -0.4 * curve.plateauEnergy * Math.log(expectedVolume);
  const meanPressure = -expectedChange / (expectedVolume - 1),
    expectedImpulse = 2 * coefficient * meanPressure;
  const initialSpeed = midpointSpeed - expectedImpulse;
  const a = particle('a', [0, 0, 0], {
    thermalEnergy: 2,
    thermalCurve: curve,
    parcel: parcel('a', [0, 0, 0], { velocity: [-initialSpeed / 2, 0, 0] }),
  });
  const b = particle('b', [1, 0, 0], {
    thermalEnergy: 2,
    thermalCurve: curve,
    parcel: parcel('b', [1, 0, 0], { velocity: [initialSpeed / 2, 0, 0] }),
  });
  const result = solveFluidReference3D(input([a, b]));
  for (let i = 0; i < 2; i++) {
    expect(result.gasVolumes[i].volume).toBeCloseTo(expectedVolume, 13);
    expect(result.thermalWork[i].pressure).toBeCloseTo(expectedChange, 13);
    expect(result.particles[i].thermalCurve!.enthalpy).toBeCloseTo(4 + expectedChange, 13);
    expect(result.particles[i].thermalEnergy).toBe(2);
    expect(result.densities[i].pressure).toBeCloseTo(0.8 / expectedVolume, 13);
    expect(result.gasVolumes[i].entropyResidual).toBeLessThan(1e-12);
  }
  expect(result.energy.gasMechanicalWork).toBeCloseTo(-2 * expectedChange, 12);
  // Changing the latent reservoir while staying on the same plateau changes no force.
  const richer = solveFluidReference3D(
    input([a, b].map((p) => ({ ...p, thermalCurve: { ...curve, enthalpy: 6 } }))),
  );
  expect(richer.particles.map((p) => p.parcel.velocity)).toEqual(
    result.particles.map((p) => p.parcel.velocity),
  );
  expect(richer.gasVolumes.map((v) => v.volume)).toEqual(result.gasVolumes.map((v) => v.volume));
});

test('pressure work crosses caloric plateau endpoints continuously in either direction', () => {
  const coefficient = (0.01 * 54 * 315) / (64 * Math.PI * 2 ** 9),
    exponent = 0.4;
  // Each case traverses one plateau boundary; the oracle integrates each segment.
  for (const [enthalpy, midpointSpeed, expectedEnthalpy] of [
    [3.001, 4, 1 + 2 * Math.exp(-(exponent * Math.log(1 + 4 * coefficient) - 0.001 / 2))],
    [6.999, -4, 5 + 2 * Math.exp(-exponent * Math.log(1 - 4 * coefficient) - 0.001 / 2)],
  ]) {
    const expectedVolume = 1 + coefficient * midpointSpeed,
      change = expectedEnthalpy - enthalpy;
    const pressure = -change / (expectedVolume - 1),
      impulse = 2 * coefficient * pressure;
    const speed = midpointSpeed - impulse,
      curve = { enthalpy, lowOffset: 1, highOffset: 5, plateauEnergy: 2 };
    const result = solveFluidReference3D(
      input([
        particle('a', [0, 0, 0], {
          thermalEnergy: 2,
          thermalCurve: curve,
          parcel: parcel('a', [0, 0, 0], { velocity: [-speed / 2, 0, 0] }),
        }),
        particle('b', [1, 0, 0], {
          thermalEnergy: 2,
          thermalCurve: curve,
          parcel: parcel('b', [1, 0, 0], { velocity: [speed / 2, 0, 0] }),
        }),
      ]),
    );
    expect(result.gasVolumes[0].volume).toBeCloseTo(expectedVolume, 12);
    expect(result.particles[0].thermalCurve!.enthalpy).toBeCloseTo(expectedEnthalpy, 12);
    expect(result.energy.gasMechanicalWork).toBeCloseTo(-2 * change, 12);
    expect(result.gasVolumes[0].entropyResidual).toBeLessThan(1e-12);
  }
});

test('saved gas volume controls EOS and support, survives JSON continuation, and needs resolved neighbors to expand', () => {
  const isolated = solveFluidReference3D(input([particle('alone', [0, 0, 0], { volume: 8 })]));
  expect(isolated.gasVolumes[0].volume).toBe(8);
  expect(isolated.gasVolumes[0].supportRadius).toBe(4);
  expect(isolated.densities[0]).toEqual({ id: 'alone', density: 1 / 8, pressure: (1.4 - 1) / 8 });
  expect(isolated.thermalWork[0].pressure).toBe(0);
  // Distance 3 is outside liquid h=2, but inside the volume-derived gas h=4.
  const scene = input([
    particle('a', [0, 0, 0], { volume: 8 }),
    particle('b', [3, 0, 0], { volume: 8 }),
  ]);
  const first = solveFluidReference3D(scene);
  expect(first.particles[0].parcel.velocity[0]).toBeLessThan(0);
  expect(first.gasVolumes.every((v) => v.volume > 8)).toBe(true);
  const next = input(first.particles);
  expect(solveFluidReference3D(JSON.parse(JSON.stringify(next)))).toEqual(
    solveFluidReference3D(next),
  );
  const alteredMass = solveFluidReference3D(
    input([particle('a', [0, 0, 0], { volume: 8, parcel: parcel('a', [0, 0, 0], { mass: 2 }) })]),
  );
  expect(alteredMass.densities[0].density).toBe(1 / 4);
  expect(alteredMass.densities[0].pressure).toBe(isolated.densities[0].pressure);
});

test('gas boundary pressure funds translation and off-center rotation and conserves total angular momentum', () => {
  const fluid = particle('a', [0, 0, 0]),
    solid = body();
  const result = solveFluidReference3D(
    input([fluid], {
      bodies: [solid],
      boundaries: [{ id: 'surface', bodyId: 'body', position: [1, 0, 0], volume: 1 }],
    }),
  );
  const output = result.bodies[0],
    transfer = result.boundaryTransfers[0];
  const after = parcelConservation3D(result.particles.map((p) => p.parcel));
  closeVector(addVec3(after.linearMomentum, scaleVec3(output.velocity, 2)), [0, 0, 0]);
  closeVector(
    addVec3(
      after.angularMomentum,
      addVec3(crossVec3(output.center, scaleVec3(output.velocity, 2)), output.angularVelocity),
    ),
    [0, 0, 0],
  );
  closeVector(scaleVec3(output.velocity, 2), transfer.impulse);
  const bodyEnergy =
    dotVec3(output.velocity, output.velocity) +
    0.5 * dotVec3(output.angularVelocity, output.angularVelocity);
  expect(after.kineticEnergy + bodyEnergy).toBeCloseTo(-result.thermalWork[0].pressure, 13);
  expect(result.gasVolumes[0].volume).toBeGreaterThan(1);
});

test('liquid density and divergence constraints converge and report correction energy separately from heat', () => {
  const rho = fluidDensityKernel3D([0, 0, 0], 2).value + fluidDensityKernel3D([1, 0, 0], 2).value;
  const a = particle('a', [0, 0, 0], {
    phase: 'liquid',
    volume: null,
    restDensity: rho,
    parcel: parcel('a', [0, 0, 0], { velocity: [1, 0, 0] }),
  });
  const b = particle('b', [1, 0, 0], {
    phase: 'liquid',
    volume: null,
    restDensity: rho,
    parcel: parcel('b', [1, 0, 0], { velocity: [-1, 0, 0] }),
  });
  const result = solveFluidReference3D(input([a, b]));
  closeVector(result.particles[0].parcel.velocity, [0, 0, 0]);
  closeVector(result.particles[1].parcel.velocity, [0, 0, 0]);
  expect(result.energy.projectionKineticChange).toBeCloseTo(-1, 12);
  expect(result.thermalWork.every((v) => v.pressure === 0 && v.viscous === 0)).toBe(true);
  expect(result.convergence.densityError).toBeLessThanOrEqual(
    FLUID_REFERENCE_LIMITS_3D.densityTolerance,
  );
  expect(result.convergence.divergenceError).toBeLessThanOrEqual(
    FLUID_REFERENCE_LIMITS_3D.divergenceTolerance,
  );

  const compressed = solveFluidReference3D(
    input(
      [a, b].map((p) => ({
        ...p,
        restDensity: 0.95 * rho,
        parcel: { ...p.parcel, velocity: [0, 0, 0] as Vec3 },
      })),
    ),
  );
  expect(compressed.particles[0].parcel.velocity[0]).toBeLessThan(0);
  expect(compressed.energy.projectionKineticChange).toBeGreaterThan(0);
  expect(compressed.convergence.densityError).toBeLessThanOrEqual(
    FLUID_REFERENCE_LIMITS_3D.densityTolerance,
  );
});

test('a moving rigid boundary receives the density reaction and off-center torque using its effective inertia', () => {
  const rest =
    fluidDensityKernel3D([0, 0, 0], 2).value / (1 - fluidDensityKernel3D([1, 0, 0], 2).value);
  const fluid = particle('a', [0, 0, 0], {
    phase: 'liquid',
    volume: null,
    restDensity: rest,
    parcel: parcel('a', [0, 0, 0], { velocity: [1, 0, 0] }),
  });
  const scene = input([fluid], {
    bodies: [body()],
    boundaries: [{ id: 'surface', bodyId: 'body', position: [1, 0, 0], volume: 1 }],
  });
  const result = solveFluidReference3D(scene),
    solid = result.bodies[0],
    transfer = result.boundaryTransfers[0];
  // Relative effective inverse mass: 1 + 1/2 + (lever arm)^2/I = 2.5.
  closeVector(result.particles[0].parcel.velocity, [0.6, 0, 0]);
  closeVector(solid.velocity, [0.2, 0, 0]);
  closeVector(solid.angularVelocity, [0, 0, 0.4]);
  closeVector(transfer.impulse, [0.4, 0, 0]);
  closeVector(transfer.angularImpulse, [0, 0, 0]);
  const linear = addVec3(result.particles[0].parcel.velocity, scaleVec3(solid.velocity, 2));
  const angular = addVec3(
    crossVec3(solid.center, scaleVec3(solid.velocity, 2)),
    solid.angularVelocity,
  );
  closeVector(linear, [1, 0, 0]);
  closeVector(angular, [0, 0, 0]);
  const fixed = solveFluidReference3D({
    ...scene,
    bodies: [body({ inverseMass: 0, inverseInertia: [0, 0, 0, 0, 0, 0, 0, 0, 0] })],
  });
  closeVector(fixed.particles[0].parcel.velocity, [0, 0, 0]);
  closeVector(fixed.bodies[0].velocity, [0, 0, 0]);
  expect(fixed.boundaryTransfers[0].impulse[0]).toBeCloseTo(1, 12);
});

test('viscous pair relaxation preserves orbital plus intrinsic angular momentum and turns measured loss into heat', () => {
  const a = particle('a', [-0.5, 0, 0], {
    thermalEnergy: 0,
    viscosity: 8,
    parcel: parcel('a', [-0.5, 0, 0], {
      velocity: [0, 1, 0],
      intrinsicAngularMomentum: [0.2, 0, 0.3],
    }),
  });
  const b = particle('b', [0.5, 0, 0], {
    thermalEnergy: 0,
    viscosity: 8,
    parcel: parcel('b', [0.5, 0, 0], {
      velocity: [0, -1, 0],
      intrinsicAngularMomentum: [-0.1, 0, -0.1],
    }),
  });
  const before = parcelConservation3D([a.parcel, b.parcel]),
    result = solveFluidReference3D(input([a, b]));
  const after = parcelConservation3D(result.particles.map((p) => p.parcel));
  closeVector(after.linearMomentum, before.linearMomentum);
  closeVector(after.angularMomentum, before.angularMomentum);
  expect(after.kineticEnergy).toBeLessThan(before.kineticEnergy);
  expect(result.energy.viscousHeat).toBeCloseTo(before.kineticEnergy - after.kineticEnergy, 12);
  expect(result.thermalWork.reduce((s, p) => s + p.viscous, 0)).toBeCloseTo(
    result.energy.viscousHeat,
    13,
  );
  expect(result.energy.impulseWorkResidual).toBeCloseTo(0, 12);
});

test('boundary viscosity reports its intrinsic-spin reaction couple and deposits heat once', () => {
  const fluid = particle('a', [0, 0, 0], {
    thermalEnergy: 0,
    viscosity: 8,
    parcel: parcel('a', [0, 0, 0], {
      velocity: [0, 1, 0],
      intrinsicAngularMomentum: [0.2, 0, 0.3],
    }),
  });
  const solid = body(),
    result = solveFluidReference3D(
      input([fluid], {
        bodies: [solid],
        boundaries: [{ id: 'surface', bodyId: 'body', position: [1, 0, 0], volume: 1 }],
      }),
    );
  const output = result.bodies[0],
    transfer = result.boundaryTransfers[0];
  closeVector(scaleVec3(output.velocity, 2), transfer.impulse);
  closeVector(
    output.angularVelocity,
    addVec3(
      crossVec3(subtractVec3(transfer.position, solid.center), transfer.impulse),
      transfer.angularImpulse,
    ),
  );
  const before = parcelConservation3D([fluid.parcel]),
    after = parcelConservation3D(result.particles.map((p) => p.parcel));
  closeVector(addVec3(after.linearMomentum, scaleVec3(output.velocity, 2)), before.linearMomentum);
  closeVector(
    addVec3(
      after.angularMomentum,
      addVec3(crossVec3(output.center, scaleVec3(output.velocity, 2)), output.angularVelocity),
    ),
    before.angularMomentum,
  );
  const bodyEnergy =
    dotVec3(output.velocity, output.velocity) +
    0.5 * dotVec3(output.angularVelocity, output.angularVelocity);
  expect(before.kineticEnergy - after.kineticEnergy - bodyEnergy).toBeCloseTo(
    result.energy.viscousHeat,
    12,
  );
  expect(result.thermalWork[0].viscous + transfer.viscousHeat).toBeCloseTo(
    result.energy.viscousHeat,
    12,
  );
});

test('work budgets, cancellation and canonical ordering preserve the same completed reference result', () => {
  const scene = input([particle('b', [1, 0, 0]), particle('a', [0, 0, 0])]);
  const small = createFluidReferenceJob3D(scene),
    large = createFluidReferenceJob3D({ ...scene, particles: [...scene.particles].reverse() });
  while (small.progress().status === 'running') small.advance(1);
  while (large.progress().status === 'running') large.advance(256);
  expect(small.result()).toEqual(large.result());
  expect(small.progress().completedWork).toBeLessThanOrEqual(small.progress().maxTotalWork);
  const copy = small.result();
  copy.particles[0].parcel.mass = 9;
  expect(small.result().particles[0].parcel.mass).toBe(1);
  const cancelled = createFluidReferenceJob3D(scene);
  cancelled.advance(1);
  expect(cancelled.cancel()).toBe(true);
  expect(cancelled.cancel()).toBe(false);
  expect(() => cancelled.result()).toThrow();
  expect(() => cancelled.advance()).toThrow();
});

test('singular density rows, inadmissible inputs and duplicate ownership fail without publication', () => {
  const dense = input([
    particle('alone', [0, 0, 0], { phase: 'liquid', volume: null, restDensity: 1e-6 }),
  ]);
  expect(() => solveFluidReference3D(dense)).toThrow(/no movable support/);
  const scene = input([particle('a', [0, 0, 0])]);
  expect(() =>
    createFluidReferenceJob3D({ ...scene, particles: [...scene.particles, ...scene.particles] }),
  ).toThrow(/Duplicate/);
  expect(() => createFluidReferenceJob3D({ ...scene, dt: 0 })).toThrow();
  expect(() =>
    createFluidReferenceJob3D(input([particle('bad', [0, 0, 0], { thermalCurve: null })])),
  ).toThrow();
  expect(() =>
    createFluidReferenceJob3D(
      input([
        particle('bad', [0, 0, 0], {
          thermalCurve: { enthalpy: 2, lowOffset: 0, highOffset: 0, plateauEnergy: 0 },
        }),
      ]),
    ),
  ).toThrow(/sensible energy/);
  expect(() =>
    createFluidReferenceJob3D(
      input([
        particle('bad', [0, 0, 0], {
          thermalCurve: { enthalpy: 1, lowOffset: 0, highOffset: 2, plateauEnergy: 0 },
        }),
      ]),
    ),
  ).toThrow(/caloric plateau/);
  for (const volume of [null, 0, -1, Infinity, 4097])
    expect(() =>
      createFluidReferenceJob3D(input([particle('bad', [0, 0, 0], { volume })])),
    ).toThrow();
  expect(() =>
    createFluidReferenceJob3D(input([particle('bad', [0, 0, 0], { phase: 'liquid' })])),
  ).toThrow(/volume must be null/);
  expect(() =>
    createFluidReferenceJob3D(
      input([particle('bad', [0, 0, 0], { volume: 4096 })], { smoothingRadius: 16 }),
    ),
  ).toThrow(/support radius/);
  expect(() => createFluidReferenceJob3D({ ...scene, bodies: [body({ inverseMass: 0 })] })).toThrow(
    /Static/,
  );
  expect(() =>
    createFluidReferenceJob3D({
      ...scene,
      bodies: [body({ inverseInertia: [-1, 0, 0, 0, 1, 0, 0, 0, 1] })],
    }),
  ).toThrow(/positive definite/);
  expect(() =>
    createFluidReferenceJob3D({
      ...scene,
      boundaries: [{ id: 'orphan', bodyId: 'missing', position: [1, 0, 0], volume: 1 }],
    }),
  ).toThrow(/no body/);
  expect(() =>
    createFluidReferenceJob3D({
      ...scene,
      particles: Array.from({ length: 129 }, (_, i) => particle(`p${i}`, [i, 0, 0])),
    }),
  ).toThrow(/size/);
  let accessed = false;
  const invalid = {
    ...scene,
    get dt() {
      accessed = true;
      return 0.01;
    },
  };
  expect(() => createFluidReferenceJob3D(invalid)).toThrow(/accessors/);
  expect(accessed).toBe(false);
});

test('wall contact and pressure converge together; physical impact heat is paid once at the actual lever arm', () => {
  const fluid = particle('a', [0, 0, 0], {
    phase: 'liquid',
    volume: null,
    parcel: parcel('a', [0, 0, 0], { velocity: [1, 0, 0] }),
  });
  const solid = body();
  // The volume sample and mechanical contact point intentionally differ.
  const scene = input([fluid], {
    bodies: [solid],
    boundaries: [{ id: 'sample', bodyId: 'body', position: [1, 1, 0], volume: 1 }],
    contacts: [
      {
        id: 'contact',
        particleId: 'a',
        boundaryId: 'sample',
        point: [1, 0, 0],
        normal: [-1, 0, 0],
        impact: true,
      },
    ],
  });
  const result = solveFluidReference3D(scene);
  expect(result.convergence.contactError).toBeLessThanOrEqual(1e-8);
  expect(result.energy.contactHeat).toBeGreaterThan(0);
  const mechanical = parcelConservation3D(result.particles.map((p) => p.parcel));
  const moved = result.bodies[0],
    transfer = result.boundaryTransfers[0];
  const finalKinetic =
    mechanical.kineticEnergy +
    0.5 * 2 * dotVec3(moved.velocity, moved.velocity) +
    0.5 * dotVec3(moved.angularVelocity, moved.angularVelocity);
  expect(
    finalKinetic + result.energy.contactHeat - result.energy.projectionKineticChange,
  ).toBeCloseTo(0.5, 12);
  expect(result.thermalWork[0].contact + transfer.contactHeat).toBeCloseTo(
    result.energy.contactHeat,
    12,
  );
  closeVector(
    addVec3(crossVec3(transfer.position, transfer.impulse), transfer.angularImpulse),
    addVec3(crossVec3(solid.center, scaleVec3(moved.velocity, 2)), moved.angularVelocity),
  );
  expect(result.energy.impulseWorkResidual).toBeCloseTo(0, 12);
  const support = solveFluidReference3D({
    ...scene,
    contacts: scene.contacts!.map((c) => ({ ...c, impact: false })),
  });
  expect(support.energy.contactHeat).toBe(0);
  expect(support.energy.projectionKineticChange).toBeLessThan(0);
});

test('gravity prediction and repeated pressure corrections do not increase physical contact heat', () => {
  const scene = input(
    [
      particle('a', [0, 0, 0], {
        phase: 'liquid',
        volume: null,
        parcel: parcel('a', [0, 0, 0], { velocity: [1, 0, 0] }),
      }),
    ],
    {
      bodies: [{ ...body(), inverseMass: 0, inverseInertia: [0, 0, 0, 0, 0, 0, 0, 0, 0] }],
      boundaries: [{ id: 'sample', bodyId: 'body', position: [1, 0, 0], volume: 2 }],
      contacts: [
        {
          id: 'contact',
          particleId: 'a',
          boundaryId: 'sample',
          point: [0.5, 0, 0],
          normal: [-1, 0, 0],
          impact: true,
        },
      ],
    },
  );
  const base = solveFluidReference3D(scene),
    predicted = solveFluidReference3D({ ...scene, velocityPrediction: [0.2, 0, 0] });
  expect(base.energy.contactHeat).toBeCloseTo(0.5, 12);
  expect(predicted.energy.contactHeat).toBeCloseTo(base.energy.contactHeat, 12);
  expect(predicted.energy.predictionKineticChange).toBeCloseTo(0.02, 12);
  expect(predicted.energy.impulseWorkResidual).toBeCloseTo(0, 12);
});

test('under-filled free surface retains approach motion until its predicted density reaches the limit', () => {
  const pair = [
    particle('a', [0, 0, 0], {
      phase: 'liquid',
      volume: null,
      parcel: parcel('a', [0, 0, 0], { velocity: [4, 0, 0] }),
    }),
    particle('b', [1, 0, 0], {
      phase: 'liquid',
      volume: null,
      parcel: parcel('b', [1, 0, 0], { velocity: [-4, 0, 0] }),
    }),
  ];
  for (const projectionOnly of [false, true]) {
    const free = solveFluidReference3D(input(pair, { projectionOnly }));
    expect(free.particles.map((p) => p.parcel.velocity)).toEqual(
      pair.map((p) => p.parcel.velocity),
    );
    expect(free.energy.projectionKineticChange).toBe(0);
    expect(free.convergence.freeSurfaceRows).toBe(2);
    expect(free.convergence.divergenceRows).toBe(0);
    expect(free.convergence.freeSurfaceCompressionRate).toBeGreaterThan(0);
    const constrained = solveFluidReference3D(input(pair, { projectionOnly, dt: 1 }));
    expect(constrained.particles[0].parcel.velocity[0]).toBeLessThan(4);
    expect(constrained.convergence.densityError).toBeLessThanOrEqual(1e-4);
    expect(constrained.energy.projectionKineticChange).toBeLessThan(0);
    expect(constrained.energy.contactHeat).toBe(0);
  }
});
