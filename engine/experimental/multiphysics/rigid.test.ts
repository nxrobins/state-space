import { describe, expect, test } from 'vitest';
import {
  type Vec3,
  cuboidMassProperties,
  scaleVec3,
  crossVec3,
  integrateOrientation,
  rotateVector,
  multiplyQuaternions,
  IDENTITY_QUATERNION,
} from './math.js';
import {
  type RigidParcel3D,
  type RigidBond3D,
  type RigidStepOptions3D,
  createRigidStep3D,
  rigidAssemblyMassProperties3D,
  applyMatrix3,
  rigidContactPatchArea3D,
} from './rigid.js';

function parcel(
  id: string,
  center: Vec3 = [0, 0, 0],
  velocity: Vec3 = [0, 0, 0],
  halfExtents: Vec3 = [0.5, 0.5, 0.5],
  mass = 1,
): RigidParcel3D & { tag: string } {
  const volume = 8 * halfExtents[0] * halfExtents[1] * halfExtents[2];
  return {
    id,
    owner: id,
    material: 'solid',
    mass,
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
    principalInertia: cuboidMassProperties(halfExtents, mass / volume).inertia,
    tag: id,
  };
}
function run(
  parcels: readonly RigidParcel3D[],
  options: RigidStepOptions3D,
  bonds: RigidBond3D[] = [],
  anchors: string[] = [],
) {
  const job = createRigidStep3D(parcels, bonds, anchors, options);
  let next = job.next();
  while (!next.done) next = job.next();
  return next.value;
}
function close(a: readonly number[], b: readonly number[], digits = 7): void {
  a.forEach((value, i) => expect(value).toBeCloseTo(b[i], digits));
}
const heat = (result: ReturnType<typeof run>) =>
  result.dissipatedEnergyByParcel.reduce((sum, row) => sum + row.impact + row.friction, 0);
const bond = (a: string, b: string, strength = 1000, restLength = 1): RigidBond3D => ({
  a,
  b,
  strength,
  restLength,
});

describe('bounded rigid candidate foundations', () => {
  test('unequal asymmetric masses produce a full parallel-axis tensor and inverse', () => {
    const a = { ...parcel('a'), principalInertia: [1, 1, 1] as Vec3 };
    const b = {
      ...parcel('b', [2, 2, 0], [0, 0, 0], [0.5, 0.5, 0.5], 3),
      principalInertia: [3, 3, 3] as Vec3,
    };
    const properties = rigidAssemblyMassProperties3D([b, a]);
    expect(properties.mass).toBe(4);
    expect(properties.center).toEqual([1.5, 1.5, 0]);
    expect(properties.inertia).toEqual([7, -3, 0, -3, 7, 0, 0, 0, 10]);
    close(properties.inverseInertia, [7 / 40, 3 / 40, 0, 3 / 40, 7 / 40, 0, 0, 0, 0.1], 12);
    close(
      applyMatrix3(properties.inverseInertia, applyMatrix3(properties.inertia, [3, -2, 7])),
      [3, -2, 7],
      12,
    );
  });

  test('free fall follows the analytical constant-gravity trajectory without heat', () => {
    const source = [parcel('a', [0, 10, 0], [2, 3, 0])],
      original = structuredClone(source);
    const result = run(source, { dt: 0.2, gravity: [0, -10, 0] });
    close(result.parcels[0].center, [0.4, 10.4, 0], 12);
    close(result.parcels[0].velocity, [2, 1, 0], 12);
    expect(heat(result)).toBe(0);
    expect(result.numericalEnergyResidual).toBeCloseTo(0, 11);
    expect(source).toEqual(original);
    expect(result.parcels[0]).toMatchObject({ tag: 'a', thermalQ: 100 });
  });

  test.each([0.01, 0.05, 0.09])(
    'gravity impact at time %s agrees with the ballistic restitution solution',
    (impactTime) => {
      const dt = 0.1,
        g = 10,
        speed = 2;
      for (const restitution of [0.5, 1]) {
        const source = parcel(
          'falling',
          [0, 1 + speed * impactTime + (g * impactTime * impactTime) / 2, 0],
          [0, -speed, 0],
        );
        const floor = parcel('floor', [0, 0, 0], [0, 0, 0], [4, 0.5, 4]);
        const result = run(
          [source, floor],
          { dt, gravity: [0, -g, 0], friction: 0, restitution },
          [],
          ['floor'],
        );
        const incoming = speed + g * impactTime,
          outgoing = restitution * incoming,
          tail = dt - impactTime;
        const body = result.parcels.find((p) => p.id === 'falling')!;
        expect(body.center[1]).toBeCloseTo(1 + outgoing * tail - (g * tail * tail) / 2, 6);
        expect(body.velocity[1]).toBeCloseTo(outgoing - g * tail, 6);
        expect(heat(result)).toBeCloseTo(
          ((1 - restitution * restitution) * incoming * incoming) / 2,
          6,
        );
        expect(Math.abs(result.numericalEnergyResidual)).toBeLessThan(1e-7);
      }
    },
  );

  test('a gravity arc cannot pass through a ceiling and return between clear endpoints', () => {
    const source = parcel('thrown', [0, 0, 0], [0, 4, 0]);
    const ceiling = parcel('ceiling', [0, 1.7, 0], [0, 0, 0], [4, 0.5, 4]);
    const result = run(
      [source, ceiling],
      { dt: 0.8, gravity: [0, -10, 0], friction: 0, restitution: 1 },
      [],
      ['ceiling'],
    );
    const impactTime = (4 - Math.sqrt(2)) / 10,
      tail = 0.8 - impactTime;
    const body = result.parcels.find((p) => p.id === 'thrown')!;
    expect(body.center[1]).toBeCloseTo(0.7 - Math.sqrt(2) * tail - 5 * tail * tail, 6);
    expect(body.velocity[1]).toBeCloseTo(-Math.sqrt(2) - 10 * tail, 6);
    expect(heat(result)).toBeLessThan(1e-7);
    expect(Math.abs(result.numericalEnergyResidual)).toBeLessThan(1e-7);
  });

  test('a separating body can return to the same floor within a gravity step and rebound', () => {
    const source = parcel('thrown', [0, 1, 0], [0, 0.4, 0]);
    const floor = parcel('floor', [0, 0, 0], [0, 0, 0], [4, 0.5, 4]);
    const result = run(
      [source, floor],
      { dt: 0.1, gravity: [0, -10, 0], friction: 0, restitution: 0.5 },
      [],
      ['floor'],
    );
    const body = result.parcels.find((p) => p.id === 'thrown')!;
    expect(body.center[1]).toBeCloseTo(1.002, 6);
    expect(body.velocity[1]).toBeCloseTo(0, 6);
    expect(heat(result)).toBeCloseTo(0.06, 6);
    expect(Math.abs(result.numericalEnergyResidual)).toBeLessThan(1e-7);
  });

  test('co-rotating released fragments advance without false contact impulses or stalling', () => {
    const orientation = integrateOrientation(IDENTITY_QUATERNION, [0, 0, 1], 0.25);
    const source = [-0.5, 0.5].map((x, i) => {
      const p = parcel(String(i), rotateVector(orientation, [x, 0, 0]));
      p.orientation = orientation;
      p.velocity = crossVec3([0, 0, 1.5], p.center);
      p.intrinsicAngularMomentum = [0, 0, 1.5 * p.principalInertia[2]];
      return p;
    });
    const result = run(source, { dt: 1 / 120, gravity: [0, -9.8, 0] });
    expect(heat(result)).toBeLessThan(1e-10);
    expect(result.report.events).toBeLessThan(64);
    expect(Math.abs(result.numericalEnergyResidual)).toBeLessThan(1e-10);
    for (const p of source)
      close(
        result.parcels.find((q) => q.id === p.id)!.velocity,
        [p.velocity[0], p.velocity[1] - 9.8 / 120, p.velocity[2]],
        10,
      );
  });

  test('a free spinning bonded assembly retains its finite parcel spin and world geometry', () => {
    const angular: Vec3 = [0, 0, 1];
    const parcels = [-1, 1].map((x, i) => {
      const p = parcel(String(i), [x, 0, 0], crossVec3(angular, [x, 0, 0]));
      p.intrinsicAngularMomentum = [0, 0, p.principalInertia[2]];
      return p;
    });
    const result = run(parcels, { dt: Math.PI / 2, friction: 0 }, [bond('0', '1', 100, 2)]);
    close(result.parcels[0].center, [0, -1, 0], 11);
    close(result.parcels[1].center, [0, 1, 0], 11);
    close(result.parcels[0].velocity, [1, 0, 0], 11);
    close(result.parcels[1].velocity, [-1, 0, 0], 11);
    close(result.parcels[0].intrinsicAngularMomentum, parcels[0].intrinsicAngularMomentum, 11);
    expect(result.numericalEnergyResidual).toBeCloseTo(0, 11);
    expect(heat(result)).toBe(0);
  });

  test.each([0, 1])(
    'fast swept head-on impacts preserve the analytical restitution %s',
    (restitution) => {
      const a = parcel('a', [-2, 0, 0], [10, 0, 0]),
        b = parcel('b', [2, 0, 0], [-10, 0, 0]);
      const result = run([a, b], { dt: 0.25, restitution, friction: 0 });
      close(result.parcels[0].velocity, [-10 * restitution, 0, 0], 6);
      close(result.parcels[1].velocity, [10 * restitution, 0, 0], 6);
      close(result.parcels[0].center, [-0.5 - restitution, 0, 0], 6);
      close(result.parcels[1].center, [0.5 + restitution, 0, 0], 6);
      expect(heat(result)).toBeCloseTo(100 * (1 - restitution * restitution), 6);
      expect(result.numericalEnergyResidual).toBeCloseTo(0, 6);
      expect(result.report.events).toBe(1);
    },
  );

  test('a fast projectile cannot cross a stationary cuboid between endpoints', () => {
    const result = run(
      [parcel('a', [-4, 0, 0], [100, 0, 0]), parcel('wall')],
      { dt: 0.1, restitution: 0, friction: 0 },
      [],
      ['wall'],
    );
    close(result.parcels[0].center, [-1, 0, 0], 6);
    close(result.parcels[0].velocity, [0, 0, 0], 6);
    close(result.boundaryLinearImpulse, [100, 0, 0], 6);
    expect(heat(result)).toBeCloseTo(5000, 5);
    expect(result.numericalEnergyResidual).toBeCloseTo(0, 5);
  });

  test('gravity support at rest does not manufacture thermal energy', () => {
    const floor = parcel('floor', [0, 0, 0], [0, 0, 0], [4, 0.5, 4]);
    const result = run(
      [floor, parcel('top', [0, 1, 0])],
      { dt: 0.01, gravity: [0, -10, 0], friction: 0 },
      [],
      ['floor'],
    );
    const top = result.parcels.find((p) => p.id === 'top')!;
    close(top.center, [0, 1, 0], 7);
    close(top.velocity, [0, 0, 0], 7);
    expect(heat(result)).toBe(0);
    expect(result.supportConstraintEnergy).toBeLessThan(0);
    expect(result.numericalEnergyResidual).toBeCloseTo(0, 7);
    close(result.boundaryLinearImpulse, [0, -0.2, 0], 7);
  });

  test('contact friction produces identified heat in a sliding face impact', () => {
    const result = run(
      [parcel('floor', [0, 0, 0], [0, 0, 0], [4, 0.5, 4]), parcel('top', [0, 1, 0], [2, -1, 0])],
      { dt: 0.01, restitution: 0, friction: 0.2 },
      [],
      ['floor'],
    );
    close(result.parcels.find((p) => p.id === 'top')!.velocity, [1.8, 0, 0], 6);
    const friction = result.dissipatedEnergyByParcel.reduce((sum, row) => sum + row.friction, 0);
    expect(friction).toBeGreaterThan(0);
    expect(heat(result)).toBeCloseTo(0.88, 6);
    expect(result.numericalEnergyResidual).toBeCloseTo(0, 6);
  });

  test('tree-cut fracture counts cycle support and releases existing parcels without replacement', () => {
    const parcels = [parcel('a'), parcel('b', [1, 0, 0]), parcel('c', [2, 0, 0])];
    const strong = [bond('a', 'b', 1), bond('b', 'c', 1), bond('a', 'c', 1, 2)];
    const held = run(parcels, { dt: 0.1, gravity: [0, -1, 0] }, strong, ['a']);
    expect(held.brokenBonds).toEqual([]);
    expect(held.components).toEqual([['a', 'b', 'c']]);
    const broken = run(
      parcels,
      { dt: 0.1, gravity: [0, -1, 0] },
      strong.map((b) => ({ ...b, strength: 0.01 })),
      ['a'],
    );
    expect(broken.components).toEqual([['a'], ['b'], ['c']]);
    expect(broken.brokenBonds).toHaveLength(3);
    expect(broken.parcels.map((p) => [p.id, p.mass, p.thermalQ, p.center])).toEqual(
      parcels.map((p) => [p.id, p.mass, p.thermalQ, p.center]),
    );
  });

  test('static friction on an inclined support does not turn gravity kicks into heat', () => {
    const orientation = integrateOrientation(IDENTITY_QUATERNION, [0, 0, 1], Math.atan(0.5));
    const floor = { ...parcel('floor', [0, 0, 0], [0, 0, 0], [4, 0.5, 4]), orientation };
    const top = { ...parcel('top', rotateVector(orientation, [0, 1, 0])), orientation };
    const result = run(
      [floor, top],
      { dt: 0.01, gravity: [0, -10, 0], friction: 1 },
      [],
      ['floor'],
    );
    close(result.parcels.find((p) => p.id === 'top')!.center, top.center, 7);
    close(result.parcels.find((p) => p.id === 'top')!.velocity, [0, 0, 0], 7);
    expect(heat(result)).toBe(0);
    expect(result.numericalEnergyResidual).toBeCloseTo(0, 7);
  });

  test('a resting stack preserves height and no-heat support across timestep refinement', () => {
    const initial = [
      parcel('floor', [0, 0, 0], [0, 0, 0], [4, 0.5, 4]),
      parcel('middle', [0, 1, 0]),
      parcel('top', [0, 2, 0]),
    ];
    for (const dt of [0.02, 0.01]) {
      let state: RigidParcel3D[] = initial,
        totalHeat = 0,
        residual = 0;
      for (let i = 0; i < Math.round(0.08 / dt); i++) {
        const result = run(
          state,
          { dt, gravity: [0, -10, 0], friction: 0.5, solverIterations: 256 },
          [],
          ['floor'],
        );
        state = result.parcels;
        totalHeat += heat(result);
        residual += result.numericalEnergyResidual;
      }
      for (const p of state) {
        close(p.center, initial.find((q) => q.id === p.id)!.center, 7);
        close(p.velocity, [0, 0, 0], 7);
      }
      expect(totalHeat).toBe(0);
      expect(residual).toBeCloseTo(0, 7);
    }
  });

  test('asymmetric free spin converges to the independent symmetric-top solution', () => {
    const source = parcel('top', [0, 0, 0], [0, 0, 0], [1, 1, 0.5]);
    const spin: Vec3 = [source.principalInertia[0], 0, 2 * source.principalInertia[2]];
    source.intrinsicAngularMomentum = spin;
    const duration = 0.8,
      transverse = source.principalInertia[0],
      axial = source.principalInertia[2];
    // Exact symmetric-top attitude: rotation about fixed world L, followed by
    // body-axis spin. This expression is independent of the midpoint integrator.
    const expected = multiplyQuaternions(
      integrateOrientation(IDENTITY_QUATERNION, scaleVec3(spin, 1 / transverse), duration),
      integrateOrientation(
        IDENTITY_QUATERNION,
        [0, 0, (1 / axial - 1 / transverse) * spin[2]],
        duration,
      ),
    );
    const errors: number[] = [],
      energyErrors: number[] = [];
    for (const dt of [0.1, 0.05]) {
      let state: RigidParcel3D[] = [source],
        residual = 0;
      for (let i = 0; i < Math.round(duration / dt); i++) {
        const result = run(state, { dt, friction: 0 });
        state = result.parcels;
        residual += result.numericalEnergyResidual;
        expect(heat(result)).toBe(0);
      }
      const orientation = state[0].orientation;
      errors.push(
        2 *
          Math.acos(
            Math.min(1, Math.abs(orientation.reduce((sum, v, i) => sum + v * expected[i], 0))),
          ),
      );
      energyErrors.push(Math.abs(residual));
      close(state[0].intrinsicAngularMomentum, spin, 10);
    }
    expect(errors[0]).toBeGreaterThan(1e-6);
    expect(errors[1]).toBeLessThan(errors[0] * 0.4);
    expect(energyErrors[1]).toBeLessThan(energyErrors[0] * 0.6);
  });

  test('an off-center frictionless impact matches the impulse and torque solution at both timesteps', () => {
    const orientation = integrateOrientation(IDENTITY_QUATERNION, [0, 0, 1], Math.PI / 4);
    const lever = Math.SQRT1_2 / 2,
      reach = 1.5 * Math.SQRT1_2;
    const source = {
      ...parcel('moving', [-0.5 - reach, 0, 0], [2, 0, 0], [1, 0.5, 0.5]),
      orientation,
    };
    const wall = parcel('wall', [0, 0, 0], [0, 0, 0], [0.5, 4, 4]);
    const denominator = 1 / source.mass + (lever * lever) / source.principalInertia[2];
    const impulse = 2 / denominator,
      finalVelocity = 2 - impulse / source.mass,
      spin = impulse * lever;
    for (const dt of [0.02, 0.01]) {
      let state: RigidParcel3D[] = [source, wall],
        totalHeat = 0,
        boundary: Vec3 = [0, 0, 0];
      for (let i = 0; i < Math.round(0.02 / dt); i++) {
        const result = run(state, { dt, friction: 0, restitution: 0 }, [], ['wall']);
        state = result.parcels;
        totalHeat += heat(result);
        boundary = [
          boundary[0] + result.boundaryLinearImpulse[0],
          boundary[1] + result.boundaryLinearImpulse[1],
          boundary[2] + result.boundaryLinearImpulse[2],
        ];
      }
      const body = state.find((p) => p.id === 'moving')!;
      close(body.velocity, [finalVelocity, 0, 0], 6);
      close(body.intrinsicAngularMomentum, [0, 0, spin], 6);
      close(body.center, [source.center[0] + finalVelocity * 0.02, 0, 0], 6);
      close(boundary, [impulse, 0, 0], 6);
      expect(totalHeat).toBeCloseTo(2 / denominator, 6);
    }
  });

  test('conservative rotation advances a moving rod into an actual floor impact', () => {
    const rod = parcel('rod', [0, 1.5, 0], [0, 0, 0], [1.5, 0.1, 0.1]);
    rod.intrinsicAngularMomentum = [0, 0, rod.principalInertia[2]];
    const floor = parcel('floor', [0, 0, 0], [0, 0, 0], [4, 0.5, 4]);
    const result = run(
      [rod, floor],
      { dt: 0.9, friction: 0, restitution: 0, maxEvents: 1024 },
      [],
      ['floor'],
    );
    const after = result.parcels.find((p) => p.id === 'rod')!;
    expect(after.velocity[1]).toBeGreaterThan(0);
    expect(heat(result)).toBeGreaterThan(0);
    expect(result.report.events).toBeGreaterThan(1);
    for (let bits = 0; bits < 8; bits++) {
      const offset = rotateVector(
        after.orientation,
        after.halfExtents.map((v, axis) => (bits & (1 << axis) ? v : -v)) as unknown as Vec3,
      );
      expect(after.center[1] + offset[1]).toBeGreaterThanOrEqual(0.5 - 1e-5);
    }
    expect(Math.abs(result.numericalEnergyResidual)).toBeLessThan(1e-4);
  });

  test('geometric projection exposes its signed angular-momentum error', () => {
    const result = run(
      [parcel('a', [0, 0, 0], [0, 1, 0]), parcel('b', [1 - 1e-6, 0, 0], [0, -1, 0])],
      { dt: 0.01, friction: 0 },
    );
    close(result.numericalLinearMomentumResidual, [0, 0, 0], 12);
    close(result.numericalAngularMomentumResidual, [0, 0, -1e-6], 12);
    expect(result.numericalEnergyResidual).toBeCloseTo(0, 12);
    expect(heat(result)).toBe(0);
  });

  test('each directly anchored parcel supports its own gravity without breaking a weak bond', () => {
    const result = run(
      [parcel('a'), parcel('b', [1, 0, 0])],
      { dt: 0.1, gravity: [0, -1, 0] },
      [bond('a', 'b', 0.5)],
      ['a', 'b'],
    );
    expect(result.brokenBonds).toEqual([]);
    close(result.boundaryLinearImpulse, [0, -0.2, 0], 12);
    close(result.numericalAngularMomentumResidual, [0, 0, 0], 12);
  });

  test('fluid particle pairs can overlap while swept particle-solid contact still transfers momentum', () => {
    const result = run([parcel('a', [0, 0, 0], [1, 0, 0]), parcel('b', [0, 0, 0], [-1, 0, 0])], {
      dt: 0.1,
      nonCollidingParticleIds: ['a', 'b'],
    });
    close(result.parcels[0].center, [0.1, 0, 0], 12);
    close(result.parcels[1].center, [-0.1, 0, 0], 12);
    expect(heat(result)).toBe(0);
    const blocked = run(
      [parcel('a', [-2, 0, 0], [10, 0, 0]), parcel('wall')],
      { dt: 0.2, friction: 0, nonCollidingParticleIds: ['a'] },
      [],
      ['wall'],
    );
    close(blocked.parcels[0].center, [-1, 0, 0], 6);
    close(blocked.boundaryLinearImpulse, [10, 0, 0], 6);
    expect(() =>
      createRigidStep3D([parcel('a'), parcel('b', [1, 0, 0])], [bond('a', 'b')], [], {
        dt: 0.1,
        nonCollidingParticleIds: ['a'],
      }),
    ).toThrow(/unbonded/);
  });

  test('limits and non-rigid welds fail without publishing or mutation', () => {
    const source = [parcel('a'), parcel('b', [1, 0, 0])],
      original = structuredClone(source);
    expect(() => run(source, { dt: 0.1, maxWork: 1 })).toThrow(/work limit/);
    expect(() =>
      run([{ ...source[0], velocity: [1, 0, 0] }, source[1]], { dt: 0.1 }, [bond('a', 'b')]),
    ).toThrow(/not rigid/);
    expect(source).toEqual(original);
    const job = createRigidStep3D([source[0]], [], [], { dt: 0.1 });
    source[0].center = [100, 100, 100];
    let step = job.next();
    while (!step.done) step = job.next();
    expect(step.value.parcels[0].center).toEqual([0, 0, 0]);
    expect(() =>
      createRigidStep3D(original, [bond('a', 'b'), bond('b', 'a')], [], { dt: 0.1 }),
    ).toThrow(/Duplicate/);
    expect(() => createRigidStep3D(original, [], ['missing'], { dt: 0.1 })).toThrow(/anchor/);
    expect(() =>
      run([{ ...parcel('heavy'), mass: 1e20, velocity: [5e-9, 0, 0] }], { dt: 0.1 }, [], ['heavy']),
    ).toThrow(/exactly stationary/);
    let accessed = false;
    const hostile = new Array(1);
    Object.defineProperty(hostile, '0', {
      enumerable: true,
      get() {
        accessed = true;
        return original[0];
      },
    });
    expect(() => createRigidStep3D(hostile, [], [], { dt: 0.1 })).toThrow();
    expect(accessed).toBe(false);
  });
});

test('roundoff-separated corner contacts keep a mechanical manifold without inventing conductive area', () => {
  const a = {
    ...parcel('a', [-9.207582033663906e-15, 1.9999999999996476, 2.2630342363431697e-16]),
    orientation: [
      -4.011274622754066e-14, -1.3600262171324165e-14, 3.1482440768857625e-14, 1,
    ] as const,
  };
  const b = {
    ...parcel('b', [-0.9999999999999999, 1, -1]),
    orientation: [
      1.2502926820487697e-18, -4.679520193403113e-19, -1.8924525620347416e-19, 1,
    ] as const,
  };
  const result = run([a, b], { dt: 0.001, gravity: [0, 0, 0] });
  expect(result.parcels.map((p) => p.velocity)).toEqual([
    [0, 0, 0],
    [0, 0, 0],
  ]);
  expect(heat(result)).toBe(0);
  expect(rigidContactPatchArea3D(a, b)).toBeLessThan(1e-10);
});

test('an almost face-aligned cross-edge contact retains its edge manifold after release', () => {
  const a = {
    ...parcel('a', [-2.601157270634821e-11, 2.0000000000793032, -1.0242782348862707e-10]),
    orientation: [
      -5.174035484196634e-11, 1.106599951105316e-12, 2.6455876670411057e-11, 1,
    ] as const,
  };
  const b = {
    ...parcel('b', [-1.0000019317318045, 0.9999999999958227, -0.000003863465609080113]),
    orientation: [
      -2.378800178129394e-13, 0.000002897598055242565, -1.1144305435369532e-12, 0.999999999995802,
    ] as const,
  };
  const result = run([a, b], { dt: 0.001, gravity: [0, 0, 0] });
  expect(result.parcels.map((p) => p.velocity)).toEqual([
    [0, 0, 0],
    [0, 0, 0],
  ]);
  expect(heat(result)).toBe(0);
  expect(rigidContactPatchArea3D(a, b)).toBe(0);
});
