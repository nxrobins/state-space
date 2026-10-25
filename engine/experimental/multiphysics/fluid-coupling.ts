/** Two-way adapter between owned world parcels and the bounded fluid operator. */
import {
  createFluidReferenceJob3D,
  type FluidBoundaryBody3D,
  type FluidBoundaryContact3D,
  type FluidMatrix3D,
  type FluidReferenceResult3D,
} from './fluids.js';
import { validateRigidAssemblyMotion3D, particleBoxGeometry } from './rigid.js';
import {
  baseParcel3D,
  bondedComponents3D,
  isRigidMaterial3D,
  multiphysicsInventory3D,
  inventoryEnergyDelta3D,
  type MultiphysicsSnapshot3D,
} from './model.js';
import { parcelTemperature3D } from './thermal.js';
import { readMultiphysicsProfile3D, type MultiphysicsProfiles3D } from './profiles.js';
import { depositMechanicalHeat3D } from './coupling-energy.js';
import {
  addVec3,
  subtractVec3,
  scaleVec3,
  dotVec3,
  crossVec3,
  lengthVec3,
  rotateVector,
  type Vec3,
} from './math.js';
const ZERO: Vec3 = [0, 0, 0];
const ZERO_MATRIX: FluidMatrix3D = [0, 0, 0, 0, 0, 0, 0, 0, 0];
export type FluidCouplingResult3D = {
  numericalEnergy: number;
  boundaryLinearImpulse: Vec3;
  boundaryAngularImpulse: Vec3;
  report:
    | (Pick<FluidReferenceResult3D, 'energy' | 'convergence' | 'densities' | 'gasVolumes'> & {
        gravityPredictionWork: number;
      })
    | null;
};
/** Candidate state is private to the encompassing world job; no live publication occurs here. */
export function* createFluidCoupling3D(
  profiles: MultiphysicsProfiles3D,
  state: MultiphysicsSnapshot3D,
  projectionOnly = false,
): Generator<string, FluidCouplingResult3D, void> {
  const liquidGas = state.parcels.filter((p) => !isRigidMaterial3D(profiles, p));
  if (!liquidGas.length)
    return {
      numericalEnergy: 0,
      boundaryLinearImpulse: ZERO,
      boundaryAngularImpulse: ZERO,
      report: null,
    };
  const before = multiphysicsInventory3D(state),
    solids = state.parcels.filter((p) => isRigidMaterial3D(profiles, p));
  const byId = new Map(state.parcels.map((p) => [p.id, p])),
    volumes = new Map(state.gasVolumes.map((g) => [g.id, g.volume]));
  const bodies: FluidBoundaryBody3D[] = [],
    bodyMembers = new Map<string, string[]>();
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
    for (let x = 0; x < counts[0]; x++)
      for (let y = 0; y < counts[1]; y++)
        for (let z = 0; z < counts[2]; z++) {
          const position = addVec3(
            p.center,
            rotateVector(
              p.orientation,
              [x, y, z].map(
                (c, axis) => ((2 * (c + 0.5)) / counts[axis] - 1) * p.halfExtents[axis],
              ) as unknown as Vec3,
            ),
          );
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
      thermalEnergy: parcelTemperature3D(profiles, p) * p.heatCapacity,
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
  const job = createFluidReferenceJob3D({
    particles,
    bodies: nearbyBodies,
    boundaries,
    contacts,
    projectionOnly,
    velocityPrediction: gravityPrediction,
    dt,
    smoothingRadius: h,
  });
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
          parcelTemperature3D(profiles, updated) * updated.heatCapacity - expected.thermalEnergy,
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
  return {
    numericalEnergy,
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
