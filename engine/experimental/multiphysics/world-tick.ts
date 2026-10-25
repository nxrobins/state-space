/** Private, bounded operator-split candidate tick. This is not release qualification. */
import { copyPortableValue, type PortableValue } from '../../portable-data.js';
import { createCircuitSolveJob3D } from './circuit.js';
import type { ResistiveConnection3D } from './circuit-reference.js';
import { batteryStoredUnits3D, stepBatteryEnergy3D } from './battery.js';
import { orientedCuboidContact, cuboidBounds, type AxisAlignedBounds } from './collision.js';
import {
  createRigidStep3D,
  rigidContactPatchArea3D,
  fractureRigidBonds3D,
  type RigidBond3D,
} from './rigid.js';
import { createFluidCoupling3D, type FluidCouplingResult3D } from './fluid-coupling.js';
import { depositMechanicalHeat3D } from './coupling-energy.js';
import {
  advanceParcelThermal3D,
  settleThermalPhases3D,
  depositParcelHeat3D,
  parcelTemperature3D,
  type ThermalParcel3D,
  type ThermalContact3D,
  type ThermalTransition3D,
  type ThermalBurn3D,
} from './thermal.js';
import { readMultiphysicsProfile3D, type MultiphysicsProfiles3D } from './profiles.js';
import {
  readMultiphysicsSnapshot3D,
  multiphysicsInventory3D,
  inventoryEnergyDelta3D,
  rebuildOwners3D,
  isRigidMaterial3D,
  compareIdentity3D,
  MULTIPHYSICS_LIMITS_3D,
  type MultiphysicsSnapshot3D,
} from './model.js';
import { addVec3, subtractVec3, assertFiniteVec3, type Vec3 } from './math.js';

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
  burns: ThermalBurn3D[];
  brokenBonds: RigidBond3D[];
  battery: null | {
    drawnUnits: string;
    activeSeconds: number;
    failed: boolean;
    depleted: boolean;
    /** Instantaneous current during the paid activeSeconds interval. */
    sourceCurrent: number;
  };
  fluid: FluidCouplingResult3D['report'];
  fluidPostProjection: FluidCouplingResult3D['report'];
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
      parcelTemperature3D(profiles, p) < battery.failureTemperature,
  );
}
function soften(profiles: MultiphysicsProfiles3D, parcel: ThermalParcel3D): number {
  const onset = readMultiphysicsProfile3D(profiles, parcel.material).softening;
  return onset === 0
    ? 1
    : Math.max(0, Math.min(1, (onset + 64 - parcelTemperature3D(profiles, parcel)) / 64));
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
  return Object.freeze({
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
      return {
        snapshot: readMultiphysicsSnapshot3D(profiles, completed.snapshot),
        report: copyPortableValue(
          completed.report as unknown as PortableValue,
        ) as unknown as MultiphysicsTickReport3D,
      };
    },
  });

  function* run(): Generator<string, MultiphysicsTickResult3D, void> {
    const before = multiphysicsInventory3D(state),
      dt = state.settings.dt;
    const bounds: AxisAlignedBounds[] = [];
    for (const parcel of state.parcels) {
      bounds.push(cuboidBounds(parcel));
      yield 'contacts';
    }
    const contacts: ThermalContact3D[] = [],
      contactAreas = new Map<string, number>();
    for (let i = 0; i < state.parcels.length; i++)
      for (let j = i + 1; j < state.parcels.length; j++) {
        if (
          nearBounds(bounds[i], bounds[j]) &&
          orientedCuboidContact(state.parcels[i], state.parcels[j])
        ) {
          if (contacts.length >= MULTIPHYSICS_TICK_LIMITS_3D.contacts)
            throw Error('World contact limit exceeded.');
          const area = rigidContactPatchArea3D(state.parcels[i], state.parcels[j]);
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
        state.parcels[at] = depositParcelHeat3D(profiles, state.parcels[at], BigInt(heat.units));
        yield 'electrical-heat';
      }
      batteryReport = {
        drawnUnits: paid.drawnUnits,
        activeSeconds: paid.activeSeconds,
        failed: paid.battery.failed,
        depleted: paid.depleted,
        sourceCurrent: paid.activeSeconds > 0 && !paid.battery.failed ? sourceCurrent : 0,
      };
    }
    const previous = state.parcels;
    yield 'thermal';
    const thermal = advanceParcelThermal3D(profiles, state.parcels, contacts, dt);
    state.parcels = thermal.parcels;
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
    const mechanical = createRigidStep3D(state.parcels, softened, state.anchors, {
      dt,
      gravity: state.settings.gravity,
      restitution: state.settings.restitution,
      friction: state.settings.friction,
      resolvedParticleContacts: true,
      deferFracture: true,
      nonCollidingParticleIds: state.parcels
        .filter((p) => !isRigidMaterial3D(profiles, p))
        .map((p) => p.id),
    });
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
    // Finish at a full-step velocity boundary. Otherwise the last gravity half
    // kick survives in resting liquid and appears as artificial kinetic energy.
    const postFluid = yield* createFluidCoupling3D(profiles, state, true);
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
      rigid.numericalEnergyResidual + fluidReceipt.numericalEnergy + postFluid.numericalEnergy,
    );
    // Conversion is explicit; neither projection error nor integration drift becomes heat.
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
    const snapshot = readMultiphysicsSnapshot3D(profiles, state);
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
        burns: thermal.burns,
        brokenBonds,
        battery: batteryReport,
        fluid: fluidReceipt.report,
        fluidPostProjection: postFluid.report,
        mechanicalHeat,
        numericalEnergy,
        numericalLinearMomentum: numericalP,
        numericalAngularMomentum: numericalL,
        boundaryLinearImpulse: vector(addVec3(rigid.boundaryLinearImpulse, fluidBoundaryP)),
        boundaryAngularImpulse: vector(addVec3(rigid.boundaryAngularImpulse, fluidBoundaryL)),
      },
    };
  }
}
