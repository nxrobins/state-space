/** Authoritative intervention layer; the underlying M5 law is unchanged. */
import { checkedInteger } from '../../validation.js';
import { MAX_ENERGY_Q } from '../../thermal.js';
import { ANCHOR_3D, structuralEligible } from '../structural-mechanics.js';
import {
  applyStructuralEdits3D,
  validateStructuralSnapshot3D,
  type StructuralEdit3D,
  type StructuralSnapshot3D,
} from '../structural-world-core.js';
import type { CellCoordinate3D } from '../interventions.js';

export const TEMPORARY_HOLD_RULES_VERSION_3D = 'temporary-holds-1';
export const THERMAL_INTERVENTION_RULES_VERSION_3D = 'thermal-interventions-1';
export const TACTICAL_ACTION_LIMITS_3D = Object.freeze({
  holds: 64,
  heldCells: 65536,
  lifetimeTicks: 1024,
  thermalCells: 65536,
});
export type TemporaryHold3D = { id: string; expiresAtTick: number; cells: number[] };
export type TemporaryHoldRequest3D = {
  id: string;
  expiresAtTick: number;
  cells: readonly CellCoordinate3D[];
};
export type ThermalDelta3D = { x: number; y: number; z: number; deltaQ: number };
export type ThermalInterventionReceipt3D = {
  rulesVersion: typeof THERMAL_INTERVENTION_RULES_VERSION_3D;
  tick: number;
  suppliedQ: string;
  removedQ: string;
  externalQ: string;
  changes: { index: number; beforeQ: number; afterQ: number; deltaQ: number }[];
};

function record(value: object, names: string[]): void {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Reflect.ownKeys(value).length !== names.length ||
    names.some((key) => !Object.hasOwn(value, key)) ||
    Object.values(Object.getOwnPropertyDescriptors(value)).some(
      (d) => !('value' in d) || !d.enumerable,
    )
  )
    throw Error('Invalid intervention record.');
}
function dense(value: readonly unknown[], max: number): void {
  if (
    !Array.isArray(value) ||
    value.length > max ||
    Reflect.ownKeys(value).length !== value.length + 1
  )
    throw Error('Invalid bounded intervention array.');
  for (let i = 0; i < value.length; i++) {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (!d || !('value' in d) || !d.enumerable)
      throw Error('Intervention arrays must be dense data.');
  }
}
function holdId(id: string): string {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(id))
    throw Error('Invalid hold identity.');
  return id;
}
function index(x: number, y: number, z: number, s: StructuralSnapshot3D): number {
  checkedInteger(x, 0, s.width - 1, 'x');
  checkedInteger(y, 0, s.height - 1, 'y');
  checkedInteger(z, 0, s.depth - 1, 'z');
  return x + s.width * (y + s.height * z);
}
export function copyHolds3D(holds: readonly TemporaryHold3D[]): TemporaryHold3D[] {
  return holds.map((h) => ({ id: h.id, expiresAtTick: h.expiresAtTick, cells: h.cells.slice() }));
}
/** Validate against a completed canonical terrain state; normalize ordering. */
export function validateHolds3D(
  holds: readonly TemporaryHold3D[],
  s: StructuralSnapshot3D,
): TemporaryHold3D[] {
  dense(holds, TACTICAL_ACTION_LIMITS_3D.holds);
  const ids = new Set<string>(),
    cells = new Set<number>(),
    result: TemporaryHold3D[] = [];
  for (const h of holds) {
    record(h, ['id', 'expiresAtTick', 'cells']);
    const id = holdId(h.id);
    if (ids.has(id)) throw Error('Duplicate hold identity.');
    ids.add(id);
    checkedInteger(h.expiresAtTick, 0, Number.MAX_SAFE_INTEGER, 'hold expiry');
    if (
      h.expiresAtTick <= s.tick ||
      h.expiresAtTick - s.tick > TACTICAL_ACTION_LIMITS_3D.lifetimeTicks
    )
      throw Error('Hold expiry exceeds its lifetime window.');
    dense(h.cells, TACTICAL_ACTION_LIMITS_3D.heldCells);
    if (!h.cells.length) throw Error('A hold needs at least one cell.');
    for (const i of h.cells) {
      checkedInteger(i, 0, s.packedCells.length - 1, 'held cell');
      if (cells.has(i)) throw Error('Held cells must not overlap.');
      cells.add(i);
      if (cells.size > TACTICAL_ACTION_LIMITS_3D.heldCells)
        throw Error('Held cell budget exceeded.');
      if (!structuralEligible(s.packedCells[i]))
        throw Error('Holds require cohesive solid/frozen matter.');
    }
    result.push({
      id,
      expiresAtTick: h.expiresAtTick,
      cells: h.cells.slice().sort((a, b) => a - b),
    });
  }
  return result.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
export function addHold3D(
  s: StructuralSnapshot3D,
  holds: readonly TemporaryHold3D[],
  request: TemporaryHoldRequest3D,
): TemporaryHold3D[] {
  record(request, ['id', 'expiresAtTick', 'cells']);
  dense(request.cells, TACTICAL_ACTION_LIMITS_3D.heldCells);
  const cells = request.cells.map((p) => {
    dense(p, 3);
    if (p.length !== 3) throw Error('Expected three coordinates.');
    return index(p[0], p[1], p[2], s);
  });
  return validateHolds3D(
    [...holds, { id: request.id, expiresAtTick: request.expiresAtTick, cells }],
    s,
  );
}
export function removeHold3D(holds: readonly TemporaryHold3D[], id: string): TemporaryHold3D[] {
  holdId(id);
  if (!holds.some((h) => h.id === id)) throw Error('Unknown hold identity.');
  return copyHolds3D(holds.filter((h) => h.id !== id));
}
/** Placement is replacement even if the material ID happens to be unchanged. */
export function holdsAfterEdits3D(
  holds: readonly TemporaryHold3D[],
  edits: readonly StructuralEdit3D[],
  s: StructuralSnapshot3D,
): TemporaryHold3D[] {
  const replaced = new Set(
    edits.filter((e) => e.kind === 'material').map((e) => index(e.x, e.y, e.z, s)),
  );
  return holds
    .map((h) => ({ ...h, cells: h.cells.filter((i) => !replaced.has(i)) }))
    .filter((h) => h.cells.length > 0);
}
/** Owned driver input only. Canonical saves never contain temporary anchor bits. */
export function overlayHolds3D(
  s: StructuralSnapshot3D,
  holds: readonly TemporaryHold3D[],
): StructuralSnapshot3D {
  const out = {
    ...s,
    packedCells: s.packedCells.slice(),
    energyQ: s.energyQ.slice(),
    structure: s.structure.slice(),
  };
  for (const h of holds) for (const i of h.cells) out.structure[i] |= ANCHOR_3D;
  return out;
}
export function stripHoldAnchors3D(
  before: StructuralSnapshot3D,
  after: StructuralSnapshot3D,
  holds: readonly TemporaryHold3D[],
): StructuralSnapshot3D {
  const out = { ...after, structure: after.structure.slice() };
  for (const h of holds)
    for (const i of h.cells) if (!(before.structure[i] & ANCHOR_3D)) out.structure[i] &= ~ANCHOR_3D;
  return out;
}
/** Holds prevent motion, not damage or thermal transformations. */
export function holdsAfterTick3D(
  before: StructuralSnapshot3D,
  after: StructuralSnapshot3D,
  holds: readonly TemporaryHold3D[],
): TemporaryHold3D[] {
  return holds
    .filter((h) => h.expiresAtTick > after.tick)
    .map((h) => ({
      ...h,
      cells: h.cells.filter(
        (i) =>
          (before.packedCells[i] & 255) === (after.packedCells[i] & 255) &&
          structuralEligible(after.packedCells[i]),
      ),
    }))
    .filter((h) => h.cells.length > 0);
}

export function applyThermalDeltas3D(
  s: StructuralSnapshot3D,
  deltas: readonly ThermalDelta3D[],
): { terrain: StructuralSnapshot3D; receipt: ThermalInterventionReceipt3D } {
  dense(deltas, TACTICAL_ACTION_LIMITS_3D.thermalCells);
  const cells = new Set<number>(),
    edits: StructuralEdit3D[] = [],
    changes: ThermalInterventionReceipt3D['changes'] = [];
  let suppliedQ = 0n,
    removedQ = 0n;
  for (const d of deltas) {
    record(d, ['x', 'y', 'z', 'deltaQ']);
    const i = index(d.x, d.y, d.z, s);
    checkedInteger(d.deltaQ, -MAX_ENERGY_Q, MAX_ENERGY_Q, 'energy delta');
    if (cells.has(i)) throw Error('Thermal targets must be unique.');
    cells.add(i);
    const beforeQ = s.energyQ[i],
      afterQ = checkedInteger(beforeQ + d.deltaQ, 0, MAX_ENERGY_Q, 'resulting energy');
    if (d.deltaQ > 0) suppliedQ += BigInt(d.deltaQ);
    else removedQ -= BigInt(d.deltaQ);
    edits.push({ kind: 'energy', x: d.x, y: d.y, z: d.z, energyQ: afterQ });
    changes.push({ index: i, beforeQ, afterQ, deltaQ: d.deltaQ });
  }
  const { state, externalQ } = applyStructuralEdits3D(validateStructuralSnapshot3D(s), edits, s);
  if (externalQ !== suppliedQ - removedQ) throw Error('Thermal intervention accounting mismatch.');
  return {
    terrain: {
      ...s,
      packedCells: Array.from(state.grid),
      energyQ: Array.from(state.energyQ),
      structure: Array.from(state.structure),
    },
    receipt: {
      rulesVersion: THERMAL_INTERVENTION_RULES_VERSION_3D,
      tick: s.tick,
      suppliedQ: suppliedQ.toString(),
      removedQ: removedQ.toString(),
      externalQ: externalQ.toString(),
      changes: changes.sort((a, b) => a.index - b.index),
    },
  };
}
