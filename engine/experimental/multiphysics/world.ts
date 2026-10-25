/** Revision-bound edits and previews over private, portable multiphysics worlds. */
import { assertRecordFields, copyPortableValue, type PortableValue } from '../../portable-data.js';
import { readPhysicalBattery3D, type PhysicalBattery3D } from './battery.js';
import {
  seedThermalParcel3D,
  depositParcelHeat3D,
  THERMAL_FRACTION_SCALE_3D,
  type ThermalSeed3D,
} from './thermal.js';
import { type MultiphysicsProfiles3D, readMultiphysicsProfile3D } from './profiles.js';
import { createMultiphysicsTickJob3D, type MultiphysicsTickReport3D } from './world-tick.js';
import {
  readMultiphysicsSnapshot3D,
  multiphysicsInventory3D,
  rebuildOwners3D,
  bondedComponents3D,
  isRigidMaterial3D,
  compareIdentity3D,
  MULTIPHYSICS_LIMITS_3D,
  type MultiphysicsSnapshot3D,
  type MultiphysicsInventory3D,
} from './model.js';
import {
  addVec3,
  subtractVec3,
  lengthVec3,
  rotateVector,
  normalizeQuaternion,
  multiplyQuaternions,
  type Vec3,
  type Quat,
} from './math.js';

export type MultiphysicsEdit3D =
  | { kind: 'place'; parcel: ThermalSeed3D }
  | { kind: 'remove'; ids: string[] }
  | { kind: 'bond'; a: string; b: string; strength: number }
  | { kind: 'cut'; a: string; b: string }
  | { kind: 'anchor'; id: string; anchored: boolean }
  | { kind: 'heat'; id: string; energyQ: number }
  | { kind: 'battery'; battery: PhysicalBattery3D | null }
  | { kind: 'transform'; ids: string[]; translation: Vec3; rotation: Quat; pivot: Vec3 };
export type MultiphysicsEditReceipt3D = {
  storedSubQ: string;
  mechanicalEnergy: number;
  conversionRemainderSubQ: number;
  mass: number;
  linearMomentum: Vec3;
  angularMomentum: Vec3;
};
export type MultiphysicsPreviewResult3D = {
  snapshot: MultiphysicsSnapshot3D;
  edits: MultiphysicsEditReceipt3D;
  ticks: MultiphysicsTickReport3D[];
};
export type MultiphysicsPreviewProgress3D = {
  status: 'running' | 'ready' | 'cancelled' | 'failed';
  completedTicks: number;
  work: number;
  lastAdvanceWork: number;
};
export type MultiphysicsPreview3D = {
  progress(): MultiphysicsPreviewProgress3D;
  advance(budget?: number): MultiphysicsPreviewProgress3D;
  cancel(): boolean;
  result(): MultiphysicsPreviewResult3D;
};
export type MultiphysicsWorld3D = {
  snapshot(): MultiphysicsSnapshot3D;
  revision(): number;
  prepare(edits?: readonly MultiphysicsEdit3D[], ticks?: number): MultiphysicsPreview3D;
  commit(preview: MultiphysicsPreview3D): { revision: number; result: MultiphysicsPreviewResult3D };
  edit(edits: readonly MultiphysicsEdit3D[]): {
    revision: number;
    result: MultiphysicsPreviewResult3D;
  };
  restore(snapshot: unknown): void;
};
const zero: Vec3 = [0, 0, 0];
const edgeKey = (a: string, b: string) => JSON.stringify([a, b].sort(compareIdentity3D));
function receipt(
  before: MultiphysicsInventory3D,
  after: MultiphysicsInventory3D,
): MultiphysicsEditReceipt3D {
  return {
    storedSubQ: String(BigInt(after.storedSubQ) - BigInt(before.storedSubQ)),
    mechanicalEnergy: after.mechanicalEnergy - before.mechanicalEnergy,
    conversionRemainderSubQ: after.conversionRemainderSubQ - before.conversionRemainderSubQ,
    mass: after.mass - before.mass,
    linearMomentum: subtractVec3(after.linearMomentum, before.linearMomentum),
    angularMomentum: subtractVec3(after.angularMomentum, before.angularMomentum),
  };
}
function applyEdits(
  profiles: MultiphysicsProfiles3D,
  state: MultiphysicsSnapshot3D,
  raw: readonly MultiphysicsEdit3D[],
): MultiphysicsEditReceipt3D {
  if (!Array.isArray(raw) || raw.length > 256) throw Error('Edit batch exceeds its bound.');
  const edits = copyPortableValue(
    raw as unknown as PortableValue,
  ) as unknown as MultiphysicsEdit3D[];
  const before = multiphysicsInventory3D(state),
    previous = structuredClone(state.parcels);
  const find = (id: string) => {
    const p = state.parcels.find((p) => p.id === id);
    if (!p) throw Error('Edit refers to absent matter.');
    return p;
  };
  const identities = (ids: string[]) => {
    if (!Array.isArray(ids) || !ids.length || ids.length > 256 || new Set(ids).size !== ids.length)
      throw Error('Invalid edit identities.');
    ids.forEach(find);
    return new Set(ids);
  };
  for (const edit of edits) {
    if (!edit || typeof edit !== 'object') throw Error('Invalid edit.');
    switch (edit.kind) {
      case 'place': {
        assertRecordFields(edit, ['kind', 'parcel'], [], 'Invalid placement.');
        if (state.parcels.length >= MULTIPHYSICS_LIMITS_3D.parcels)
          throw Error('World parcel limit exceeded.');
        const p = seedThermalParcel3D(profiles, edit.parcel);
        if (state.parcels.some((old) => old.id === p.id))
          throw Error('Parcel identity already exists.');
        state.parcels.push(p);
        state.conversionRemainders.push({ id: p.id, subQ: 0 });
        const profile = readMultiphysicsProfile3D(profiles, p.material);
        if (profile.phase === 'gas')
          state.gasVolumes.push({ id: p.id, volume: p.mass / profile.restDensity });
        break;
      }
      case 'remove': {
        assertRecordFields(edit, ['kind', 'ids'], [], 'Invalid removal.');
        const ids = identities(edit.ids);
        state.parcels = state.parcels.filter((p) => !ids.has(p.id));
        state.bonds = state.bonds.filter((b) => !ids.has(b.a) && !ids.has(b.b));
        state.anchors = state.anchors.filter((id) => !ids.has(id));
        state.gasVolumes = state.gasVolumes.filter((v) => !ids.has(v.id));
        state.conversionRemainders = state.conversionRemainders.filter((v) => !ids.has(v.id));
        if (state.battery) {
          state.battery.failed ||= [
            state.battery.positive,
            state.battery.negative,
            ...state.battery.cores.map((c) => c.id),
          ].some((id) => ids.has(id));
          state.battery.cores = state.battery.cores.filter((c) => !ids.has(c.id));
          if (!state.battery.cores.length) state.battery = null;
        }
        break;
      }
      case 'bond': {
        assertRecordFields(edit, ['kind', 'a', 'b', 'strength'], [], 'Invalid bond edit.');
        const a = find(edit.a),
          b = find(edit.b);
        if (
          a === b ||
          !Number.isFinite(edit.strength) ||
          edit.strength <= 0 ||
          edit.strength > 1e12
        )
          throw Error('Invalid positive bond strength.');
        if ([a, b].some((p) => readMultiphysicsProfile3D(profiles, p.material).phase !== 'solid'))
          throw Error('Only solids can be bonded.');
        if (state.bonds.some((b) => edgeKey(b.a, b.b) === edgeKey(edit.a, edit.b)))
          throw Error('Bond already exists.');
        state.bonds.push({
          a: edit.a,
          b: edit.b,
          strength: edit.strength,
          restLength: lengthVec3(subtractVec3(a.center, b.center)),
        });
        break;
      }
      case 'cut': {
        assertRecordFields(edit, ['kind', 'a', 'b'], [], 'Invalid cut edit.');
        find(edit.a);
        find(edit.b);
        const at = state.bonds.findIndex((b) => edgeKey(b.a, b.b) === edgeKey(edit.a, edit.b));
        if (at < 0) throw Error('Cut refers to absent bond.');
        state.bonds.splice(at, 1);
        break;
      }
      case 'anchor': {
        assertRecordFields(edit, ['kind', 'id', 'anchored'], [], 'Invalid anchor edit.');
        const p = find(edit.id);
        if (
          typeof edit.anchored !== 'boolean' ||
          readMultiphysicsProfile3D(profiles, p.material).phase !== 'solid'
        )
          throw Error('Invalid solid anchor.');
        state.anchors = state.anchors.filter((id) => id !== edit.id);
        if (edit.anchored) {
          state.anchors.push(edit.id);
          const group = bondedComponents3D(
            state.parcels.filter((p) => isRigidMaterial3D(profiles, p)),
            state.bonds,
          ).find((ids) => ids.includes(edit.id))!;
          for (const id of group) {
            find(id).velocity = zero;
            find(id).intrinsicAngularMomentum = zero;
          }
        }
        break;
      }
      case 'heat': {
        assertRecordFields(edit, ['kind', 'id', 'energyQ'], [], 'Invalid heat edit.');
        find(edit.id);
        if (!Number.isSafeInteger(edit.energyQ)) throw Error('Heat edits require integer Q.');
        const at = state.parcels.findIndex((p) => p.id === edit.id);
        state.parcels[at] = depositParcelHeat3D(
          profiles,
          state.parcels[at],
          BigInt(edit.energyQ) * BigInt(THERMAL_FRACTION_SCALE_3D),
        );
        break;
      }
      case 'battery': {
        assertRecordFields(edit, ['kind', 'battery'], [], 'Invalid battery edit.');
        state.battery = edit.battery === null ? null : readPhysicalBattery3D(edit.battery);
        break;
      }
      case 'transform': {
        assertRecordFields(
          edit,
          ['kind', 'ids', 'translation', 'rotation', 'pivot'],
          [],
          'Invalid transform edit.',
        );
        const ids = identities(edit.ids),
          rotation = normalizeQuaternion(edit.rotation);
        if (state.bonds.some((b) => ids.has(b.a) !== ids.has(b.b)))
          throw Error('Transform requires complete bonded assemblies.');
        for (const id of ids) {
          const p = find(id);
          p.center = addVec3(
            addVec3(edit.pivot, edit.translation),
            rotateVector(rotation, subtractVec3(p.center, edit.pivot)),
          );
          p.orientation = normalizeQuaternion(multiplyQuaternions(rotation, p.orientation));
          p.velocity = rotateVector(rotation, p.velocity);
          p.intrinsicAngularMomentum = rotateVector(rotation, p.intrinsicAngularMomentum);
        }
        break;
      }
      default:
        throw Error('Unknown multiphysics edit.');
    }
  }
  rebuildOwners3D(profiles, state, previous);
  const delta = receipt(before, multiphysicsInventory3D(state)),
    ledger = state.accounting;
  ledger.externalStoredSubQ = String(BigInt(ledger.externalStoredSubQ) + BigInt(delta.storedSubQ));
  ledger.externalMechanicalEnergy += delta.mechanicalEnergy;
  ledger.externalConversionRemainderSubQ += delta.conversionRemainderSubQ;
  ledger.externalMass += delta.mass;
  ledger.externalLinearMomentum = addVec3(ledger.externalLinearMomentum, delta.linearMomentum);
  ledger.externalAngularMomentum = addVec3(ledger.externalAngularMomentum, delta.angularMomentum);
  return delta;
}
export function createMultiphysicsWorld3D(
  profiles: MultiphysicsProfiles3D,
  initial: MultiphysicsSnapshot3D,
): MultiphysicsWorld3D {
  let state = readMultiphysicsSnapshot3D(profiles, initial),
    revision = 0;
  const previews = new WeakMap<MultiphysicsPreview3D, number>();
  const snapshot = () => readMultiphysicsSnapshot3D(profiles, state);
  const prepare = (
    commands: readonly MultiphysicsEdit3D[] = [],
    count = 1,
  ): MultiphysicsPreview3D => {
    if (!Number.isInteger(count) || count < 0 || count > 2)
      throw Error('Previews require zero, one or two ticks.');
    const candidate = snapshot(),
      edits = applyEdits(profiles, candidate, commands);
    let current = readMultiphysicsSnapshot3D(profiles, candidate),
      status: MultiphysicsPreviewProgress3D['status'] = 'running';
    let work = 0,
      lastAdvanceWork = 0,
      active: ReturnType<typeof createMultiphysicsTickJob3D> | undefined;
    const ticks: MultiphysicsTickReport3D[] = [];
    const progress = (): MultiphysicsPreviewProgress3D => ({
      status,
      completedTicks: ticks.length,
      work,
      lastAdvanceWork,
    });
    const preview: MultiphysicsPreview3D = Object.freeze({
      progress,
      advance(budget = 128) {
        if (!Number.isSafeInteger(budget) || budget < 1 || budget > 256)
          throw Error('Invalid preview budget.');
        lastAdvanceWork = 0;
        if (status !== 'running') return progress();
        try {
          while (lastAdvanceWork < budget) {
            if (ticks.length === count) {
              status = 'ready';
              break;
            }
            active ??= createMultiphysicsTickJob3D(profiles, current);
            const p = active.advance(1);
            work += p.lastAdvanceWork;
            lastAdvanceWork += p.lastAdvanceWork;
            if (p.status === 'ready') {
              const result = active.result();
              current = result.snapshot;
              ticks.push(result.report);
              active = undefined;
            }
          }
        } catch (error) {
          status = 'failed';
          active?.cancel();
          active = undefined;
          throw error;
        }
        return progress();
      },
      cancel() {
        if (status !== 'running' && status !== 'ready') return false;
        status = 'cancelled';
        active?.cancel();
        active = undefined;
        return true;
      },
      result() {
        if (status !== 'ready') throw Error('Preview is not ready.');
        return {
          snapshot: readMultiphysicsSnapshot3D(profiles, current),
          edits: structuredClone(edits),
          ticks: structuredClone(ticks),
        };
      },
    });
    previews.set(preview, revision);
    return preview;
  };
  const commit = (preview: MultiphysicsPreview3D) => {
    if (previews.get(preview) !== revision)
      throw Error('Preview is stale or belongs to another world.');
    if (revision >= Number.MAX_SAFE_INTEGER) throw Error('World revision exhausted.');
    const result = preview.result();
    state = readMultiphysicsSnapshot3D(profiles, result.snapshot);
    previews.delete(preview);
    preview.cancel();
    revision++;
    return { revision, result };
  };
  return Object.freeze({
    snapshot,
    revision: () => revision,
    prepare,
    commit,
    edit(commands: readonly MultiphysicsEdit3D[]) {
      const preview = prepare(commands, 0);
      preview.advance(1);
      return commit(preview);
    },
    restore(raw: unknown) {
      const candidate = readMultiphysicsSnapshot3D(profiles, raw);
      if (revision >= Number.MAX_SAFE_INTEGER) throw Error('World revision exhausted.');
      state = candidate;
      revision++;
    },
  });
}
