/** Two-way adapter between owned world parcels and the bounded fluid operator. */
import {
  createFluidReferenceJob3D,
  type FluidBoundaryBody3D,
  type FluidBoundaryContact3D,
  type FluidMatrix3D,
  type FluidReferenceResult3D,
} from './fluids.js';
import {
  validateRigidAssemblyMotion3D,
  particleBoxGeometry,
  rigidLoadDemands3D,
  type RigidImpulse3D,
} from './rigid.js';
import {
  LEGACY_MULTIPHYSICS_RULES_3D,
  baseParcel3D,
  bondedComponents3D,
  isRigidMaterial3D,
  multiphysicsInventory3D,
  inventoryEnergyDelta3D,
  type MultiphysicsSnapshot3D,
} from './model.js';
import { ownedParcelTemperature3D } from './thermal.js';
import { readMultiphysicsProfile3D, type MultiphysicsProfiles3D } from './profiles.js';
import { depositMechanicalHeat3D } from './coupling-energy.js';
import { copyOwnedPortableValue } from './owned-data.js';
import {
  addVec3,
  subtractVec3,
  scaleVec3,
  dotVec3,
  crossVec3,
  lengthVec3,
  rotateVector,
  rotateByUnitQuaternion,
  normalizeQuaternion,
  assertFiniteVec3,
  type Vec3,
  type Quat,
} from './math.js';
const ZERO: Vec3 = [0, 0, 0];
const ZERO_MATRIX: FluidMatrix3D = [0, 0, 0, 0, 0, 0, 0, 0, 0];
export type FluidCouplingResult3D = {
  /** Per parcel, the part of this pass's gravity prediction that resting support absorbed:
   * the projection's velocity change along gravity, no larger than the prediction. Empty
   * when the pass applied no prediction. */
  supportVelocityChange: { id: string; velocity: Vec3 }[];
  /** Per parcel, where this pass's projection removed motion that was already closing: a
   * weight for depositing the tick's inelastic constraint loss. Zero for resting support. */
  impactLoss: { id: string; loss: number }[];
  numericalEnergy: number;
  loadDemands: RigidImpulse3D[];
  boundaryLinearImpulse: Vec3;
  boundaryAngularImpulse: Vec3;
  report:
    | (Pick<FluidReferenceResult3D, 'energy' | 'convergence' | 'densities' | 'gasVolumes'> & {
        gravityPredictionWork: number;
      })
    | null;
};
/** Candidate state is private to the encompassing world job; no live publication occurs here.
 * `impactReference` is each parcel's motion with only the gravity that resting support did
 * not cancel. The post-drift projection classifies closing against it; the first pass of a
 * tick has none and classifies against its own motion before the predictor. */
export function* createFluidCoupling3D(
  profiles: MultiphysicsProfiles3D,
  state: MultiphysicsSnapshot3D,
  projectionOnly = false,
  impactReference?: readonly { id: string; velocity: Vec3; angularVelocity: Vec3 }[],
): Generator<string, FluidCouplingResult3D, void> {
  const liquidGas = state.parcels.filter((p) => !isRigidMaterial3D(profiles, p));
  if (!liquidGas.length)
    return {
      supportVelocityChange: [],
      impactLoss: [],
      numericalEnergy: 0,
      loadDemands: [],
      boundaryLinearImpulse: ZERO,
      boundaryAngularImpulse: ZERO,
      report: null,
    };
  const before = multiphysicsInventory3D(state),
    solids = state.parcels.filter((p) => isRigidMaterial3D(profiles, p));
  const beforeSolid = new Map(
    solids.map((p) => [
      p.id,
      {
        linear: scaleVec3(p.velocity, p.mass),
        angular: addVec3(
          p.intrinsicAngularMomentum,
          crossVec3(p.center, scaleVec3(p.velocity, p.mass)),
        ),
      },
    ]),
  );
  const applied = new Map(solids.map((p) => [p.id, { id: p.id, linear: ZERO, angular: ZERO }]));
  const byId = new Map(state.parcels.map((p) => [p.id, p])),
    volumes = new Map(state.gasVolumes.map((g) => [g.id, g.volume]));
  const bodies: FluidBoundaryBody3D[] = [],
    bodyMembers = new Map<string, string[]>();
  const referenceOf = impactReference && new Map(impactReference.map((row) => [row.id, row]));
  const referenceMotion = (id: string) => {
    const row = referenceOf!.get(id);
    if (!row) throw Error('Fluid impact reference does not cover the world.');
    return row;
  };
  const bodyReference = new Map<string, { velocity: Vec3; angularVelocity: Vec3 }>();
  for (const ids of bondedComponents3D(solids, state.bonds)) {
    const anchored = ids.some((id) => state.anchors.includes(id)),
      members = ids.map((id) => byId.get(id)!);
    const assembly = validateRigidAssemblyMotion3D(members, anchored);
    // Cholesky inversion is symmetric analytically; remove arithmetic-order skew.
    const m = assembly.inverseInertia;
    const inverseInertia: FluidMatrix3D = [
      m[0],
      (m[1] + m[3]) / 2,
      (m[2] + m[6]) / 2,
      (m[1] + m[3]) / 2,
      m[4],
      (m[5] + m[7]) / 2,
      (m[2] + m[6]) / 2,
      (m[5] + m[7]) / 2,
      m[8],
    ];
    bodies.push({
      id: members[0].owner,
      center: assembly.center,
      velocity: assembly.velocity,
      angularVelocity: assembly.angularVelocity,
      inverseMass: anchored ? 0 : 1 / assembly.mass,
      inverseInertia: anchored ? ZERO_MATRIX : inverseInertia,
    });
    bodyMembers.set(members[0].owner, ids);
    // A rigid assembly's reference motion at its centre of mass: the mass-weighted mean of
    // its members' reference velocities, and the angular velocity they all share.
    if (referenceOf)
      bodyReference.set(members[0].owner, {
        velocity: members.reduce<Vec3>(
          (sum, p) =>
            addVec3(sum, scaleVec3(referenceMotion(p.id).velocity, p.mass / assembly.mass)),
          ZERO,
        ),
        angularVelocity: referenceMotion(members[0].id).angularVelocity,
      });
    yield 'fluid-assemblies';
  }
  // Sample solid volume at at-most-unit spacing; collapsing a wide floor into
  // one huge SPH point falsely multiplies local density and pressure.
  const h = 1.5,
    dt = state.settings.dt,
    gravityPrediction = projectionOnly ? ZERO : scaleVec3(state.settings.gravity, dt / 2);
  const boundaries: { id: string; bodyId: string; position: Vec3; volume: number }[] = [];
  const sampleOwners = new Map<string, string>();
  for (const [index, p] of solids.entries()) {
    const counts = p.halfExtents.map((r) => Math.max(1, Math.ceil(2 * r)));
    const volume =
      (8 * p.halfExtents[0] * p.halfExtents[1] * p.halfExtents[2]) /
      (counts[0] * counts[1] * counts[2]);
    // One normalization per solid for all of its samples, made where the first sample's
    // rotation would make it: after that sample's own offset has been checked.
    let unit: Quat | undefined;
    for (let x = 0; x < counts[0]; x++)
      for (let y = 0; y < counts[1]; y++)
        for (let z = 0; z < counts[2]; z++) {
          const offset = [x, y, z].map(
            (c, axis) => ((2 * (c + 0.5)) / counts[axis] - 1) * p.halfExtents[axis],
          ) as unknown as Vec3;
          if (unit === undefined) {
            assertFiniteVec3(offset);
            unit = normalizeQuaternion(p.orientation);
          }
          const position = addVec3(p.center, rotateByUnitQuaternion(unit, offset));
          if (
            liquidGas.some(
              (f) =>
                lengthVec3(subtractVec3(f.center, position)) <
                1.1 * h * Math.cbrt(volumes.get(f.id) ?? 1),
            )
          ) {
            if (boundaries.length >= 128)
              throw Error('Fluid boundary sampling exceeds the qualified candidate limit.');
            const id = `boundary:${index}:${x}:${y}:${z}`;
            boundaries.push({ id, bodyId: p.owner, position, volume });
            sampleOwners.set(id, p.id);
          }
          yield 'fluid-boundary-samples';
        }
  }
  // Resolve solid exclusion in the same iterative system as liquid density.
  // A later independent contact projection otherwise undoes incompressibility.
  const contacts: FluidBoundaryContact3D[] = [];
  for (const fluid of liquidGas)
    for (const solid of solids) {
      const contact = particleBoxGeometry(fluid, solid, true);
      if (contact.gap <= 1e-8) {
        if (contact.gap < -1e-5) throw Error('Fluid boundary starts with excessive penetration.');
        const samples = boundaries.filter((s) => sampleOwners.get(s.id) === solid.id);
        samples.sort(
          (a, b) =>
            lengthVec3(subtractVec3(a.position, contact.point)) -
            lengthVec3(subtractVec3(b.position, contact.point)),
        );
        if (!samples.length) throw Error('Fluid contact has no boundary sample.');
        const body = bodies.find((b) => b.id === solid.owner)!;
        const normal = scaleVec3(contact.normal, -1);
        const bodyVelocity = addVec3(
          body.velocity,
          crossVec3(body.angularVelocity, subtractVec3(contact.point, body.center)),
        );
        contacts.push({
          id: JSON.stringify([fluid.id, solid.id]),
          particleId: fluid.id,
          boundaryId: samples[0].id,
          point: contact.point,
          normal,
          impact:
            !projectionOnly && dotVec3(subtractVec3(fluid.velocity, bodyVelocity), normal) < -1e-8,
        });
      }
      yield 'fluid-contact-constraints';
    }
  const sampledBodies = new Set(boundaries.map((s) => s.bodyId));
  const nearbyBodies = bodies.filter((b) => sampledBodies.has(b.id));
  const particles = liquidGas.map((p) => {
    const profile = readMultiphysicsProfile3D(profiles, p.material);
    const destination = profile.condensesInto
      ? readMultiphysicsProfile3D(profiles, profile.condensesInto)
      : profile;
    const thermalCurve =
      profile.phase === 'gas'
        ? {
            enthalpy: (p.thermalQ + p.latentQ + p.thermalRemainder) / 256,
            lowOffset: destination.phaseEnergyQ / 256,
            highOffset: profile.phaseEnergyQ / 256,
            plateauEnergy: profile.condensesInto ? profile.condensePoint : 0,
          }
        : null;
    return {
      thermalCurve,
      parcel: baseParcel3D(p),
      phase: profile.phase as 'liquid' | 'gas',
      restDensity: profile.restDensity,
      viscosity: profile.viscosity,
      volume: profile.phase === 'gas' ? volumes.get(p.id)! : null,
      thermalEnergy: ownedParcelTemperature3D(profiles, p) * p.heatCapacity,
    };
  });
  const checkTravel = (fluid: typeof particles, movingBodies: FluidBoundaryBody3D[]) => {
    for (const p of fluid) {
      const radius = p.phase === 'gas' ? h * Math.cbrt(p.volume!) : h;
      if (lengthVec3(p.parcel.velocity) * dt > 0.2 * radius)
        throw Error('Fluid point travel exceeds the fixed-step accuracy bound.');
    }
    for (const body of movingBodies)
      for (const id of bodyMembers.get(body.id)!) {
        const p = byId.get(id)!,
          speed =
            lengthVec3(body.velocity) +
            lengthVec3(body.angularVelocity) * lengthVec3(subtractVec3(p.center, body.center));
        if (speed * dt > 0.2 * h)
          throw Error('Fluid boundary travel exceeds the fixed-step accuracy bound.');
      }
  };
  checkTravel(particles, nearbyBodies);
  const job = createFluidReferenceJob3D(
    {
      particles,
      bodies: nearbyBodies,
      boundaries,
      contacts,
      projectionOnly,
      velocityPrediction: gravityPrediction,
      ...(referenceOf
        ? {
            reference: {
              particles: liquidGas.map((p) => ({
                id: p.id,
                velocity: referenceMotion(p.id).velocity,
              })),
              bodies: nearbyBodies.map((b) => ({ id: b.id, ...bodyReference.get(b.id)! })),
            },
          }
        : {}),
      dt,
      smoothingRadius: h,
    },
    undefined,
    { recordImpactLoss: state.rules !== LEGACY_MULTIPHYSICS_RULES_3D },
    // This input is built above from this tick's own data.
    copyOwnedPortableValue,
  );
  while (job.progress().status === 'running') {
    job.advance(1);
    yield 'fluid-solve';
  }
  const result = job.result();
  checkTravel(result.particles, result.bodies);
  for (const particle of result.particles) {
    const p = byId.get(particle.parcel.id)!;
    p.velocity = subtractVec3(particle.parcel.velocity, gravityPrediction);
    p.intrinsicAngularMomentum = particle.parcel.intrinsicAngularMomentum;
    yield 'fluid-particles';
  }
  for (const body of result.bodies) {
    for (const id of bodyMembers.get(body.id)!) {
      const p = byId.get(id)!,
        q = p.orientation,
        w = body.angularVelocity;
      p.velocity = addVec3(
        body.inverseMass ? subtractVec3(body.velocity, gravityPrediction) : body.velocity,
        crossVec3(w, subtractVec3(p.center, body.center)),
      );
      const local = rotateVector([-q[0], -q[1], -q[2], q[3]], w);
      p.intrinsicAngularMomentum = rotateVector(q, [
        local[0] * p.principalInertia[0],
        local[1] * p.principalInertia[1],
        local[2] * p.principalInertia[2],
      ]);
    }
    yield 'fluid-body-reactions';
  }
  let boundaryLinearImpulse: Vec3 = ZERO,
    boundaryAngularImpulse: Vec3 = ZERO;
  const fixedBodies = new Set(bodies.filter((b) => b.inverseMass === 0).map((b) => b.id));
  for (const transfer of result.boundaryTransfers) {
    const load = applied.get(sampleOwners.get(transfer.id)!)!;
    load.linear = addVec3(load.linear, transfer.impulse);
    load.angular = addVec3(
      load.angular,
      addVec3(crossVec3(transfer.position, transfer.impulse), transfer.angularImpulse),
    );
    depositMechanicalHeat3D(
      profiles,
      state,
      sampleOwners.get(transfer.id)!,
      transfer.viscousHeat + transfer.contactHeat,
    );
    if (fixedBodies.has(transfer.bodyId)) {
      boundaryLinearImpulse = addVec3(boundaryLinearImpulse, transfer.impulse);
      boundaryAngularImpulse = addVec3(
        boundaryAngularImpulse,
        addVec3(crossVec3(transfer.position, transfer.impulse), transfer.angularImpulse),
      );
    }
    yield 'fluid-boundary-heat';
  }
  for (const heat of result.thermalWork) {
    depositMechanicalHeat3D(profiles, state, heat.id, heat.pressure + heat.viscous + heat.contact);
    const expected = result.particles.find((p) => p.parcel.id === heat.id)!;
    if (expected.phase === 'gas') {
      const updated = state.parcels.find((p) => p.id === heat.id)!;
      if (
        Math.abs(
          ownedParcelTemperature3D(profiles, updated) * updated.heatCapacity -
            expected.thermalEnergy,
        ) >
        1e-8 * Math.max(1, expected.thermalEnergy)
      )
        throw Error('Gas caloric curve and parcel heat transfer disagree.');
    }
    yield 'fluid-internal-work';
  }
  state.gasVolumes = result.gasVolumes.map((g) => ({ id: g.id, volume: g.volume }));
  const numericalEnergy = inventoryEnergyDelta3D(before, multiphysicsInventory3D(state));
  // Remove exactly the predictor's kinetic work. Physical impacts occur before
  // prediction, so their boundary impulses must not receive a gravity cross term.
  const undoPrediction = (mass: number, velocity: Vec3) =>
    mass *
    (dotVec3(gravityPrediction, velocity) - 0.5 * dotVec3(gravityPrediction, gravityPrediction));
  const predictedWork =
    result.particles.reduce((sum, p) => sum + undoPrediction(p.parcel.mass, p.parcel.velocity), 0) +
    result.bodies.reduce(
      (sum, b) => sum + (b.inverseMass ? undoPrediction(1 / b.inverseMass, b.velocity) : 0),
      0,
    );
  const gravityPredictionWork = result.energy.predictionKineticChange - predictedWork;
  if (
    Math.abs(numericalEnergy - result.energy.projectionKineticChange - gravityPredictionWork) >
    1e-7 * Math.max(1, Math.abs(numericalEnergy))
  )
    throw Error('Fluid/world energy transfer mismatch.');
  // How much of the predicted gravity each parcel's support absorbed, as a velocity.
  const predictionSpeed = lengthVec3(gravityPrediction);
  const absorbed = (change: Vec3): Vec3 =>
    scaleVec3(
      gravityPrediction,
      -Math.min(
        1,
        Math.max(0, -dotVec3(change, gravityPrediction) / (predictionSpeed * predictionSpeed)),
      ),
    );
  const supportVelocityChange: { id: string; velocity: Vec3 }[] = [];
  if (predictionSpeed > 0) {
    for (const row of result.projectionVelocityChange.particles)
      supportVelocityChange.push({ id: row.id, velocity: absorbed(row.velocity) });
    for (const row of result.projectionVelocityChange.bodies) {
      const velocity = absorbed(row.velocity);
      for (const id of bodyMembers.get(row.id)!) supportVelocityChange.push({ id, velocity });
    }
  }
  const changes = solids.map((p) => {
    const start = beforeSolid.get(p.id)!,
      momentum = scaleVec3(p.velocity, p.mass);
    return {
      id: p.id,
      linear: subtractVec3(momentum, start.linear),
      angular: subtractVec3(
        addVec3(p.intrinsicAngularMomentum, crossVec3(p.center, momentum)),
        start.angular,
      ),
    };
  });
  const impactLoss = new Map<string, number>();
  for (const row of result.impactLoss.particles)
    impactLoss.set(row.id, (impactLoss.get(row.id) ?? 0) + row.loss);
  for (const row of result.impactLoss.boundaries) {
    const id = sampleOwners.get(row.id)!;
    impactLoss.set(id, (impactLoss.get(id) ?? 0) + row.loss);
  }
  return {
    supportVelocityChange,
    impactLoss: [...impactLoss].map(([id, loss]) => ({ id, loss })),
    numericalEnergy,
    loadDemands: rigidLoadDemands3D(solids, state.bonds, state.anchors, changes, [
      ...applied.values(),
    ]),
    boundaryLinearImpulse,
    boundaryAngularImpulse,
    report: {
      gravityPredictionWork,
      energy: result.energy,
      convergence: result.convergence,
      densities: result.densities,
      gasVolumes: result.gasVolumes,
    },
  };
}
