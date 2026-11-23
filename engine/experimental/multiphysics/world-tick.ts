/** Private, bounded operator-split candidate tick. This is not release qualification. */
import type { PortableValue } from '../../portable-data.js';
import { copyOwnedPortableValue } from './owned-data.js';
import { createCircuitSolveJob3D } from './circuit.js';
import type { ResistiveConnection3D } from './circuit-reference.js';
import { batteryStoredUnits3D, stepBatteryEnergy3D } from './battery.js';
import {
  orientedCuboidContact,
  prepareCuboid,
  preparedCuboidBounds,
  preparedCuboidContact,
  type AxisAlignedBounds,
  type PreparedCuboid,
} from './collision.js';
import {
  createRigidStep3D,
  rigidContactPatchAreaAlong3D,
  particleBoxGeometry,
  fractureRigidBonds3D,
  type RigidBond3D,
} from './rigid.js';
import { createFluidCoupling3D, type FluidCouplingResult3D } from './fluid-coupling.js';
import { depositMechanicalHeat3D } from './coupling-energy.js';
import { retainJobFunctions } from './retained-functions.js';
import {
  advanceOwnedParcelThermal3D,
  settleThermalPhases3D,
  deferParcelPhase3D,
  depositOwnedParcelHeat3D,
  ownedParcelTemperature3D,
  type ThermalParcel3D,
  type ThermalContact3D,
  type ThermalTransition3D,
  type ThermalBurn3D,
} from './thermal.js';
import { readMultiphysicsProfile3D, type MultiphysicsProfiles3D } from './profiles.js';
import {
  readMultiphysicsSnapshot3D,
  readOwnedMultiphysicsSnapshot3D,
  multiphysicsInventory3D,
  inventoryEnergyDelta3D,
  rebuildOwners3D,
  bondedComponents3D,
  isRigidMaterial3D,
  compareIdentity3D,
  MULTIPHYSICS_LIMITS_3D,
  type MultiphysicsSnapshot3D,
} from './model.js';
import {
  addVec3,
  subtractVec3,
  scaleVec3,
  applyWorldInverseInertia,
  assertFiniteVec3,
  type Vec3,
} from './math.js';

export const MULTIPHYSICS_TICK_LIMITS_3D = Object.freeze({
  advanceWork: 256,
  totalWork: 3000000,
  contacts: 16384,
});
export type MultiphysicsTickProgress3D = {
  status: 'running' | 'ready' | 'cancelled' | 'failed';
  stage: string;
  work: number;
  lastAdvanceWork: number;
};
export type MultiphysicsTickReport3D = {
  tick: number;
  work: number;
  contacts: number;
  transitions: ThermalTransition3D[];
  /** Requested solidification held at its current enthalpy until geometry fits. */
  deferredTransitions: (ThermalTransition3D & { blockedBy: string[] })[];
  burns: ThermalBurn3D[];
  brokenBonds: RigidBond3D[];
  battery: null | {
    drawnUnits: string;
    activeSeconds: number;
    failed: boolean;
    depleted: boolean;
    /** Instantaneous current during the paid activeSeconds interval. */
    sourceCurrent: number;
    /** Network sampled at the start of this tick, before thermal/mechanical motion.
     * Values describe the paid active interval, not the final snapshot geometry. */
    network: null | {
      sampledTick: number;
      nodes: { id: string; potential: number | null }[];
      edges: { a: string; b: string; resistance: number; current: number; power: number }[];
      terminalVoltage: number;
      residual: { maxJunctionCurrent: number; power: number };
    };
  };
  fluid: FluidCouplingResult3D['report'];
  fluidPostProjection: FluidCouplingResult3D['report'];
  /** Identified mechanical dissipation paid as heat this tick: rigid impacts and friction,
   * and the net kinetic energy that liquid constraints and the solid support of liquid
   * samples removed from closing motion. */
  mechanicalHeat: number;
  numericalEnergy: number;
  numericalLinearMomentum: Vec3;
  numericalAngularMomentum: Vec3;
  /** Momentum received by stationary anchors, opposite to their impulse on matter. */
  boundaryLinearImpulse: Vec3;
  boundaryAngularImpulse: Vec3;
};
export type MultiphysicsTickResult3D = {
  snapshot: MultiphysicsSnapshot3D;
  report: MultiphysicsTickReport3D;
};
export type MultiphysicsTickJob3D = {
  advance(budget?: number): MultiphysicsTickProgress3D;
  progress(): MultiphysicsTickProgress3D;
  cancel(): boolean;
  result(): MultiphysicsTickResult3D;
};
const key = (bond: { a: string; b: string }) => JSON.stringify([bond.a, bond.b]);
const finite = (value: number) => {
  if (!Number.isFinite(value)) throw Error('World tick arithmetic overflow.');
  return value;
};
const vector = (value: Vec3): Vec3 => {
  assertFiniteVec3(value);
  return value;
};
function nearBounds(a: AxisAlignedBounds, b: AxisAlignedBounds): boolean {
  return a.min.every((min, i) => {
    const tolerance =
      128 *
      Number.EPSILON *
      Math.max(1, Math.abs(min), Math.abs(a.max[i]), Math.abs(b.min[i]), Math.abs(b.max[i]));
    return min <= b.max[i] + tolerance && a.max[i] >= b.min[i] - tolerance;
  });
}
function batteryIntact(profiles: MultiphysicsProfiles3D, state: MultiphysicsSnapshot3D): boolean {
  const battery = state.battery;
  if (!battery) return false;
  const byId = new Map(state.parcels.map((p) => [p.id, p]));
  const ports = [battery.positive, battery.negative, ...battery.cores.map((c) => c.id)].map((id) =>
    byId.get(id),
  );
  if (ports.some((p) => !p)) return false;
  const owner = ports[0]!.owner;
  return ports.every(
    (p) =>
      p !== undefined &&
      readMultiphysicsProfile3D(profiles, p.material).phase === 'solid' &&
      p.owner === owner &&
      ownedParcelTemperature3D(profiles, p) < battery.failureTemperature,
  );
}
function soften(profiles: MultiphysicsProfiles3D, parcel: ThermalParcel3D): number {
  const onset = readMultiphysicsProfile3D(profiles, parcel.material).softening;
  return onset === 0
    ? 1
    : Math.max(0, Math.min(1, (onset + 64 - ownedParcelTemperature3D(profiles, parcel)) / 64));
}

/**
 * Owns input before returning. Work counts bounded scheduler steps, including
 * one capped thermal batch; it is not a wall-clock or scalar-operation promise.
 * Cancellation/failure never publishes the private candidate or a partial report.
 */
export function createMultiphysicsTickJob3D(
  profiles: MultiphysicsProfiles3D,
  raw: MultiphysicsSnapshot3D,
): MultiphysicsTickJob3D {
  const state = readMultiphysicsSnapshot3D(profiles, raw);
  if (state.tick >= MULTIPHYSICS_LIMITS_3D.ticks) throw Error('World tick counter exhausted.');
  const iterator = run();
  let status: MultiphysicsTickProgress3D['status'] = 'running',
    stage = 'contacts',
    work = 0,
    lastAdvanceWork = 0;
  let completed: MultiphysicsTickResult3D | undefined;
  const progress = (): MultiphysicsTickProgress3D => ({ status, stage, work, lastAdvanceWork });
  const job: MultiphysicsTickJob3D = Object.freeze({
    progress,
    advance(budget = MULTIPHYSICS_TICK_LIMITS_3D.advanceWork) {
      if (
        !Number.isSafeInteger(budget) ||
        budget < 1 ||
        budget > MULTIPHYSICS_TICK_LIMITS_3D.advanceWork
      )
        throw Error('Invalid world tick work budget.');
      lastAdvanceWork = 0;
      if (status !== 'running') return progress();
      try {
        while (lastAdvanceWork < budget) {
          if (work >= MULTIPHYSICS_TICK_LIMITS_3D.totalWork)
            throw Error('World tick work limit exceeded.');
          const next = iterator.next();
          work++;
          lastAdvanceWork++;
          if (next.done) {
            completed = next.value;
            completed.report.work = work;
            status = 'ready';
            stage = 'complete';
            break;
          }
          stage = next.value;
        }
      } catch (error) {
        status = 'failed';
        completed = undefined;
        iterator.return(undefined as never);
        throw error;
      }
      return progress();
    },
    cancel() {
      if (status !== 'running' && status !== 'ready') return false;
      status = 'cancelled';
      completed = undefined;
      iterator.return(undefined as never);
      return true;
    },
    result() {
      if (status !== 'ready' || !completed) throw Error('World tick result is not ready.');
      // The completed snapshot was validated at the end of the tick; callers receive an owned
      // copy. This tick built both values, so the copy does not re-inspect them.
      return {
        snapshot: copyOwnedPortableValue(
          completed.snapshot as unknown as PortableValue,
        ) as unknown as MultiphysicsSnapshot3D,
        report: copyOwnedPortableValue(
          completed.report as unknown as PortableValue,
        ) as unknown as MultiphysicsTickReport3D,
      };
    },
  });
  // The job's methods, its progress reader and its pipeline. See retained-functions.ts.
  retainJobFunctions('world-tick', [job, progress, run]);
  return job;

  function* run(): Generator<string, MultiphysicsTickResult3D, void> {
    retainJobFunctions('world-tick-stages', [admitSolidification, refreshPhaseOwnership]);
    const before = multiphysicsInventory3D(state),
      dt = state.settings.dt;
    // Each parcel's cuboid is checked and given its axes once here, as its bounds need, and
    // reused for every pair below: nothing moves a parcel during this stage.
    const cuboids: PreparedCuboid[] = [],
      bounds: AxisAlignedBounds[] = [];
    for (const parcel of state.parcels) {
      const cuboid = prepareCuboid(parcel);
      cuboids.push(cuboid);
      bounds.push(preparedCuboidBounds(cuboid));
      yield 'contacts';
    }
    const contacts: ThermalContact3D[] = [],
      contactAreas = new Map<string, number>();
    for (let i = 0; i < state.parcels.length; i++)
      for (let j = i + 1; j < state.parcels.length; j++) {
        const contact = nearBounds(bounds[i], bounds[j])
          ? preparedCuboidContact(cuboids[i], cuboids[j])
          : null;
        if (contact) {
          if (contacts.length >= MULTIPHYSICS_TICK_LIMITS_3D.contacts)
            throw Error('World contact limit exceeded.');
          // The patch area starts from this same contact; it is not found a second time.
          const area = rigidContactPatchAreaAlong3D(state.parcels[i], state.parcels[j], contact);
          if (area > 1e-10) {
            const pair = { a: state.parcels[i].id, b: state.parcels[j].id };
            contacts.push(pair);
            contactAreas.set(key(pair), area);
          }
        }
        yield 'contacts';
      }
    let batteryReport: MultiphysicsTickReport3D['battery'] = null;
    if (state.battery) {
      const damaged = !batteryIntact(profiles, state),
        losses: { id: string; power: number }[] = [];
      let sourceCurrent = 0;
      let network: NonNullable<MultiphysicsTickReport3D['battery']>['network'] = null;
      if (!state.battery.failed && !damaged && BigInt(batteryStoredUnits3D(state.battery)) > 0n) {
        const indices = new Map(state.parcels.map((p, i) => [p.id, i]));
        const connections: ResistiveConnection3D[] = [],
          endpoints: ThermalContact3D[] = [];
        for (const pair of contacts) {
          const a = indices.get(pair.a)!,
            b = indices.get(pair.b)!;
          const sa = readMultiphysicsProfile3D(
            profiles,
            state.parcels[a].material,
          ).electricalConductivity;
          const sb = readMultiphysicsProfile3D(
            profiles,
            state.parcels[b].material,
          ).electricalConductivity;
          if (sa > 0 && sb > 0) {
            const resistance = (1 / sa + 1 / sb) / (2 * contactAreas.get(key(pair))!);
            // Sub-resolution transport contacts are open at this model's resistance bound.
            if (resistance <= 1e6) {
              connections.push({ a, b, resistance });
              endpoints.push(pair);
            }
          }
          yield 'electrical-network';
        }
        const job = createCircuitSolveJob3D({
          nodeCount: state.parcels.length,
          connections,
          source: {
            positive: indices.get(state.battery.positive)!,
            negative: indices.get(state.battery.negative)!,
            emf: state.battery.emf,
            internalResistance: state.battery.internalResistance,
          },
        });
        try {
          while (job.progress().status === 'running') {
            job.advance(1);
            yield 'electrical-solve';
          }
          const result = job.result();
          sourceCurrent = result.sourceCurrent;
          network = {
            sampledTick: state.tick,
            nodes: state.parcels.map((p, i) => ({ id: p.id, potential: result.potentials[i] })),
            edges: endpoints.map((pair, i) => ({
              ...pair,
              resistance: connections[i].resistance,
              current: result.currents[i],
              power: result.dissipations[i],
            })),
            terminalVoltage: result.terminalVoltage,
            residual: result.residual,
          };
          for (const [i, power] of result.dissipations.entries()) {
            losses.push(
              { id: endpoints[i].a, power: power / 2 },
              { id: endpoints[i].b, power: power / 2 },
            );
            yield 'electrical-heat';
          }
          for (const core of state.battery.cores) {
            losses.push({
              id: core.id,
              power: result.internalDissipation / state.battery.cores.length,
            });
            yield 'electrical-heat';
          }
        } finally {
          job.cancel();
        }
      }
      const paid = stepBatteryEnergy3D(state.battery, losses, dt, damaged);
      state.battery = paid.battery;
      const indices = new Map(state.parcels.map((p, i) => [p.id, i]));
      for (const heat of paid.heat) {
        const at = indices.get(heat.id);
        if (at === undefined) throw Error('Electrical heat has no material destination.');
        state.parcels[at] = depositOwnedParcelHeat3D(
          profiles,
          state.parcels[at],
          BigInt(heat.units),
        );
        yield 'electrical-heat';
      }
      batteryReport = {
        drawnUnits: paid.drawnUnits,
        activeSeconds: paid.activeSeconds,
        failed: paid.battery.failed,
        depleted: paid.depleted,
        sourceCurrent: paid.activeSeconds > 0 && !paid.battery.failed ? sourceCurrent : 0,
        network,
      };
    }
    const deferredTransitions = new Map<string, ThermalTransition3D & { blockedBy: string[] }>();
    function* admitSolidification(
      oldParcels: readonly ThermalParcel3D[],
      transitions: ThermalTransition3D[],
    ): Generator<string, void> {
      const old = new Map(oldParcels.map((p) => [p.id, p]));
      const rigid = state.parcels.map((p) => isRigidMaterial3D(profiles, p));
      const proposed = new Map(
        transitions
          .filter(
            (t) =>
              t.kind === 'phase' &&
              readMultiphysicsProfile3D(profiles, t.to).phase === 'solid' &&
              !isRigidMaterial3D(profiles, old.get(t.id)!),
          )
          .map((t) => [t.id, t]),
      );
      if (!proposed.size) return;
      const blocked = new Map<string, string[]>();
      // Inspect all proposed shapes together, before rolling any phase back.
      // This prevents parcel iteration order from choosing which one freezes.
      for (let i = 0; i < state.parcels.length; i++)
        for (let j = i + 1; j < state.parcels.length; j++) {
          const a = state.parcels[i],
            b = state.parcels[j];
          if ((proposed.has(a.id) || proposed.has(b.id)) && nearBounds(bounds[i], bounds[j])) {
            const depth =
              rigid[i] && rigid[j]
                ? (orientedCuboidContact(a, b)?.depth ?? 0)
                : -particleBoxGeometry(a, b, !rigid[i]).gap;
            // Admit only touching shapes within the existing contact skin.
            // Large phase-generated overlap is not a geometric correction.
            if (depth > 1e-8)
              for (const [parcel, other] of [
                [a, b],
                [b, a],
              ])
                if (proposed.has(parcel.id))
                  blocked.set(parcel.id, [...(blocked.get(parcel.id) ?? []), other.id]);
          }
          yield 'phase-admission';
        }
      state.parcels = state.parcels.map((p) => {
        const blockedBy = blocked.get(p.id);
        if (!blockedBy) return p;
        deferredTransitions.set(p.id, { ...proposed.get(p.id)!, blockedBy });
        return deferParcelPhase3D(profiles, p, old.get(p.id)!.material);
      });
      const admitted = transitions.filter((t) => !blocked.has(t.id));
      transitions.splice(0, transitions.length, ...admitted);
    }
    const previous = state.parcels;
    yield 'thermal';
    const thermal = advanceOwnedParcelThermal3D(profiles, state.parcels, contacts, dt);
    state.parcels = thermal.parcels;
    yield* admitSolidification(previous, thermal.transitions);
    const phaseBroken: RigidBond3D[] = [];
    function refreshPhaseOwnership(oldParcels: readonly ThermalParcel3D[]): void {
      const byId = new Map(state.parcels.map((p) => [p.id, p]));
      const solid = (id: string) =>
        readMultiphysicsProfile3D(profiles, byId.get(id)!.material).phase === 'solid';
      phaseBroken.push(...state.bonds.filter((b) => !solid(b.a) || !solid(b.b)));
      state.bonds = state.bonds.filter((b) => solid(b.a) && solid(b.b));
      state.anchors = state.anchors.filter(solid);
      rebuildOwners3D(profiles, state, oldParcels);
      const oldVolume = new Map(state.gasVolumes.map((row) => [row.id, row.volume])),
        oldParcel = new Map(oldParcels.map((p) => [p.id, p]));
      state.gasVolumes = state.parcels
        .filter((p) => readMultiphysicsProfile3D(profiles, p.material).phase === 'gas')
        .map((p) => {
          const old = oldParcel.get(p.id)!;
          return {
            id: p.id,
            volume:
              oldVolume.get(p.id) ??
              old.mass / readMultiphysicsProfile3D(profiles, old.material).restDensity,
          };
        });
    }
    refreshPhaseOwnership(previous);
    yield 'phase-ownership';
    const fluid = createFluidCoupling3D(profiles, state);
    let fluidResult: ReturnType<typeof fluid.next>;
    try {
      fluidResult = fluid.next();
      while (!fluidResult.done) {
        yield 'fluid-coupling';
        fluidResult = fluid.next();
      }
    } finally {
      fluid.return(undefined as never);
    }
    const fluidReceipt = fluidResult.value;
    const beforeSettlement = state.parcels;
    const settled = settleThermalPhases3D(profiles, state.parcels);
    state.parcels = settled.parcels;
    yield* admitSolidification(beforeSettlement, settled.transitions);
    thermal.transitions.push(...settled.transitions);
    refreshPhaseOwnership(beforeSettlement);
    yield 'pressure-phase-ownership';
    const byId = new Map(state.parcels.map((p) => [p.id, p]));
    const beforeRigid = multiphysicsInventory3D(state),
      beforeFracture = state.parcels;
    const originals = new Map(state.bonds.map((b) => [key(b), b]));
    const softened = state.bonds.map((b) => ({
      ...b,
      strength:
        b.strength * Math.min(soften(profiles, byId.get(b.a)!), soften(profiles, byId.get(b.b)!)),
    }));
    const mechanical = createRigidStep3D(
      state.parcels,
      softened,
      state.anchors,
      {
        dt,
        gravity: state.settings.gravity,
        restitution: state.settings.restitution,
        friction: state.settings.friction,
        resolvedParticleContacts: true,
        deferFracture: true,
        nonCollidingParticleIds: state.parcels
          .filter((p) => !isRigidMaterial3D(profiles, p))
          .map((p) => p.id),
      },
      // All four inputs are this tick's own data.
      copyOwnedPortableValue,
    );
    let mechanicalResult: ReturnType<typeof mechanical.next>;
    try {
      mechanicalResult = mechanical.next();
      while (!mechanicalResult.done) {
        yield `rigid-${mechanicalResult.value.phase}`;
        mechanicalResult = mechanical.next();
      }
    } finally {
      mechanical.return(undefined as never);
    }
    const rigid = mechanicalResult.value;
    state.parcels = rigid.parcels;
    state.bonds = rigid.bonds.map((b) => ({ ...originals.get(key(b))! }));
    const afterRigid = multiphysicsInventory3D(state);
    const physicalLinear = subtractVec3(
      subtractVec3(afterRigid.linearMomentum, beforeRigid.linearMomentum),
      rigid.numericalLinearMomentumResidual,
    );
    const physicalAngular = subtractVec3(
      subtractVec3(afterRigid.angularMomentum, beforeRigid.angularMomentum),
      rigid.numericalAngularMomentumResidual,
    );
    let mechanicalHeat = 0;
    for (const row of rigid.dissipatedEnergyByParcel) {
      const heat = finite(row.impact + row.friction);
      if (heat < 0) throw Error('Negative identified mechanical dissipation.');
      depositMechanicalHeat3D(profiles, state, row.id, heat);
      mechanicalHeat = finite(mechanicalHeat + heat);
      yield 'mechanical-heat';
    }
    rebuildOwners3D(profiles, state, beforeFracture);
    // Each parcel's motion with only the gravity that resting support did not cancel: what
    // entered the rigid stage, less the predicted gravity the first fluid pass absorbed, plus
    // the whole step of gravity and the rigid stage's physical impacts. Closing present in
    // it is an impact; the rest of what the post-drift projection removes is support.
    const absorbed = new Map(fluidReceipt.supportVelocityChange.map((row) => [row.id, row])),
      impacts = new Map(rigid.physicalVelocityChange.map((row) => [row.id, row])),
      fixed = new Set(
        bondedComponents3D(
          beforeFracture.filter((p) => isRigidMaterial3D(profiles, p)),
          state.bonds,
        )
          .filter((ids) => ids.some((id) => state.anchors.includes(id)))
          .flat(),
      ),
      fall = scaleVec3(state.settings.gravity, dt);
    const impactReference = beforeFracture.map((p) => {
      const impact = impacts.get(p.id)!;
      return {
        id: p.id,
        velocity: vector(
          addVec3(
            addVec3(p.velocity, absorbed.get(p.id)?.velocity ?? [0, 0, 0]),
            addVec3(impact.velocity, fixed.has(p.id) ? [0, 0, 0] : fall),
          ),
        ),
        angularVelocity: vector(
          addVec3(
            applyWorldInverseInertia(
              p.orientation,
              p.principalInertia.map((v) => 1 / v) as unknown as Vec3,
              p.intrinsicAngularMomentum,
            ),
            impact.angularVelocity,
          ),
        ),
      };
    });
    // Finish at a full-step velocity boundary. Otherwise the last gravity half
    // kick survives in resting liquid and appears as artificial kinetic energy.
    const postFluid = yield* createFluidCoupling3D(profiles, state, true, impactReference);
    // Liquid constraints and the solid support of liquid samples are inelastic. Their work on
    // resting liquid cancels within the tick: the first pass absorbs the predicted gravity,
    // and the solid contacts and this projection give the same amount back. What remains is
    // kinetic energy they removed from motion that was closing. It is paid as heat when it is
    // a loss beyond a dead band of 1e-4 of the numerical limit and the closing motion is
    // identified: a liquid row found it, or a body that a physical impact struck was carrying
    // liquid samples, so their support passed the blow on. The amount is the tick's own net,
    // so heat can never exceed the energy lost, and it goes where those rows and contacts
    // acted. A net gain is never paid and stays a numerical residual.
    const constraintEnergy = finite(
      fluidReceipt.numericalEnergy + rigid.particleSupportEnergy + postFluid.numericalEnergy,
    );
    let constraintHeat = 0;
    if (-constraintEnergy > 1e-4 * state.settings.numericalEnergyLimit) {
      const weights = new Map<string, number>();
      for (const rows of [fluidReceipt.impactLoss, rigid.particleSupportLoss, postFluid.impactLoss])
        for (const row of rows) weights.set(row.id, (weights.get(row.id) ?? 0) + row.loss);
      const struck = new Set(
        rigid.physicalVelocityChange
          .filter((row) => [...row.velocity, ...row.angularVelocity].some((value) => value !== 0))
          .map((row) => row.id),
      );
      const identified =
          fluidReceipt.impactLoss.length > 0 ||
          postFluid.impactLoss.length > 0 ||
          rigid.particleSupportLoss.some((row) => struck.has(row.id)),
        total = [...weights.values()].reduce((sum, value) => sum + value, 0);
      if (identified && total > 0) {
        constraintHeat = -constraintEnergy;
        for (const id of [...weights.keys()].sort(compareIdentity3D)) {
          depositMechanicalHeat3D(profiles, state, id, (constraintHeat * weights.get(id)!) / total);
          yield 'constraint-heat';
        }
      }
    }
    const demands = new Map(
      state.parcels.map((p) => [
        p.id,
        { id: p.id, linear: [0, 0, 0] as Vec3, angular: [0, 0, 0] as Vec3 },
      ]),
    );
    for (const loads of [fluidReceipt.loadDemands, rigid.loadDemands, postFluid.loadDemands])
      for (const row of loads) {
        const total = demands.get(row.id)!;
        total.linear = addVec3(total.linear, row.linear);
        total.angular = addVec3(total.angular, row.angular);
      }
    const fracture = fractureRigidBonds3D(state.parcels, rigid.bonds, [...demands.values()], dt);
    let fractureResult = fracture.next();
    while (!fractureResult.done) {
      yield 'coupled-fracture';
      fractureResult = fracture.next();
    }
    const coupledBroken = fractureResult.value;
    const brokenKeys = new Set(coupledBroken.map(key));
    const beforeCoupledFracture = state.parcels;
    state.bonds = state.bonds.filter((b) => !brokenKeys.has(key(b)));
    rebuildOwners3D(profiles, state, beforeCoupledFracture);

    const fluidBoundaryP = addVec3(
      fluidReceipt.boundaryLinearImpulse,
      postFluid.boundaryLinearImpulse,
    );
    const fluidBoundaryL = addVec3(
      fluidReceipt.boundaryAngularImpulse,
      postFluid.boundaryAngularImpulse,
    );

    if (state.battery) {
      state.battery.failed ||= !batteryIntact(profiles, state);
      if (batteryReport) batteryReport.failed = state.battery.failed;
    }
    const after = multiphysicsInventory3D(state),
      numericalEnergy = finite(inventoryEnergyDelta3D(before, after));
    const expectedNumerical = finite(
      rigid.numericalEnergyResidual +
        fluidReceipt.numericalEnergy +
        postFluid.numericalEnergy +
        constraintHeat,
    );
    // Conversion is explicit: only the identified losses above became heat. Whatever is left
    // is unexplained, whether projection error or integration drift, and is bounded here.
    if (Math.abs(numericalEnergy) > state.settings.numericalEnergyLimit)
      throw Error(
        `World numerical energy limit exceeded (${numericalEnergy}; limit ${state.settings.numericalEnergyLimit}).`,
      );
    if (
      Math.abs(numericalEnergy - expectedNumerical) >
      1e-7 * Math.max(1, Math.abs(expectedNumerical), Math.abs(numericalEnergy))
    )
      throw Error('World numerical energy receipts disagree.');
    const physicalP = vector(subtractVec3(physicalLinear, fluidBoundaryP));
    const physicalL = vector(subtractVec3(physicalAngular, fluidBoundaryL));
    const numericalP = vector(
      subtractVec3(subtractVec3(after.linearMomentum, before.linearMomentum), physicalP),
    );
    const numericalL = vector(
      subtractVec3(subtractVec3(after.angularMomentum, before.angularMomentum), physicalL),
    );
    const ledger = state.accounting;
    ledger.numericalEnergy = finite(ledger.numericalEnergy + numericalEnergy);
    ledger.physicalLinearImpulse = vector(addVec3(ledger.physicalLinearImpulse, physicalP));
    ledger.physicalAngularImpulse = vector(addVec3(ledger.physicalAngularImpulse, physicalL));
    ledger.numericalLinearMomentum = vector(addVec3(ledger.numericalLinearMomentum, numericalP));
    ledger.numericalAngularMomentum = vector(addVec3(ledger.numericalAngularMomentum, numericalL));
    state.tick++;
    yield 'validation';
    const snapshot = readOwnedMultiphysicsSnapshot3D(profiles, state);
    const brokenBonds = [
      ...phaseBroken,
      ...[...rigid.brokenBonds, ...coupledBroken].map((b) => ({ ...originals.get(key(b))! })),
    ].sort((a, b) => compareIdentity3D(a.a, b.a) || compareIdentity3D(a.b, b.b));
    return {
      snapshot,
      report: {
        tick: snapshot.tick,
        work: 0,
        contacts: contacts.length,
        transitions: thermal.transitions,
        deferredTransitions: [...deferredTransitions.values()].sort((a, b) =>
          compareIdentity3D(a.id, b.id),
        ),
        burns: thermal.burns,
        brokenBonds,
        battery: batteryReport,
        fluid: fluidReceipt.report,
        fluidPostProjection: postFluid.report,
        mechanicalHeat:
          constraintHeat > 0 ? finite(mechanicalHeat + constraintHeat) : mechanicalHeat,
        numericalEnergy,
        numericalLinearMomentum: numericalP,
        numericalAngularMomentum: numericalL,
        boundaryLinearImpulse: vector(addVec3(rigid.boundaryLinearImpulse, fluidBoundaryP)),
        boundaryAngularImpulse: vector(addVec3(rigid.boundaryAngularImpulse, fluidBoundaryL)),
      },
    };
  }
}
