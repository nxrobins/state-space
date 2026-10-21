/** Explicit conservative transport cycles. Never advances the M5 material clock. */
import { MAT, PHASE, PHASE_SHIFT } from '../generated/materials.js';
import { structuralEligible } from './structural-mechanics.js';
import {
  validateStructuralSnapshot3D,
  type StructuralSnapshot3D,
} from './structural/structural-world-core.js';

import {
  MATERIAL_TRANSPORT_KERNEL_LIMITS_3D,
  transportMaterialKernel3D,
} from './material-transport-kernel.js';

export const MATERIAL_TRANSPORT_RULES_3D = 'material-transport-1';
export const MATERIAL_TRANSPORT_SCHEMA_3D = 1;
export const MATERIAL_TRANSPORT_LIMITS_3D = MATERIAL_TRANSPORT_KERNEL_LIMITS_3D;
type Vector = [number, number, number];
export type MaterialParcelSeed3D = {
  id: string;
  cell: readonly [number, number, number];
  velocityQ?: readonly [number, number, number];
};
export type MaterialParcel3D = { id: string; cell: number; velocityQ: Vector; remainderQ: Vector };
export type MaterialTransportState3D = {
  schemaVersion: typeof MATERIAL_TRANSPORT_SCHEMA_3D;
  rulesVersion: typeof MATERIAL_TRANSPORT_RULES_3D;
  cycle: number;
  terrain: StructuralSnapshot3D;
  parcels: MaterialParcel3D[];
};
export type MaterialImpulse3D = { id: string; impulseQ: readonly [number, number, number] };
export type MaterialTransportReceipt3D = {
  rulesVersion: typeof MATERIAL_TRANSPORT_RULES_3D;
  fromCycle: number;
  toCycle: number;
  materialTick: number;
  /** Control velocity has no kinetic/thermal conversion law. */
  externalEnergyQ: '0';
  /** Ordered unit swaps, including displaced gas and value-identical matter. */
  swaps: [number, number][];
  parcels: { id: string; source: number; destination: number }[];
  contacts: {
    id: string;
    axis: number;
    source: number;
    target: number | null;
    normal: number;
    kind: 'boundary' | 'parcel' | 'material';
    parcelId: string | null;
  }[];
  editedCells: number[];
};

const { parcels: maximum, scale: Q, speedQ } = MATERIAL_TRANSPORT_LIMITS_3D;
function fields(
  raw: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): asserts raw is Record<string, unknown> {
  if (
    !raw ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(raw)) ||
    required.some((k) => !Object.hasOwn(raw, k)) ||
    Reflect.ownKeys(raw).some(
      (k) => typeof k !== 'string' || ![...required, ...optional].includes(k),
    ) ||
    Object.values(Object.getOwnPropertyDescriptors(raw)).some(
      (d) => !('value' in d) || !d.enumerable,
    )
  )
    throw Error('Invalid material transport record.');
}
function dense(raw: unknown, max: number): asserts raw is unknown[] {
  if (!Array.isArray(raw) || raw.length > max || Reflect.ownKeys(raw).length !== raw.length + 1)
    throw Error('Invalid bounded material transport array.');
  for (let i = 0; i < raw.length; i++) {
    const d = Object.getOwnPropertyDescriptor(raw, String(i));
    if (!d || !('value' in d) || !d.enumerable)
      throw Error('Material transport arrays require dense data.');
  }
}
function integer(raw: unknown, min: number, max: number): number {
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < min || raw > max)
    throw Error('Invalid material transport integer.');
  return raw || 0;
}
function vector(raw: unknown, min: number, max: number): Vector {
  dense(raw, 3);
  if (raw.length !== 3) throw Error('Expected a transport vector.');
  return [integer(raw[0], min, max), integer(raw[1], min, max), integer(raw[2], min, max)];
}
function identity(raw: unknown): string {
  if (typeof raw !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(raw))
    throw Error('Invalid parcel identity.');
  return raw;
}
function ownedTerrain(raw: unknown): StructuralSnapshot3D {
  fields(raw, [
    'schemaVersion',
    'rulesVersion',
    'worldVersion',
    'materialCatalogHash',
    'width',
    'height',
    'depth',
    'chunkSize',
    'tick',
    'packedCells',
    'energyQ',
    'structure',
  ]);
  const size =
    integer(raw.width, 1, 128) * integer(raw.height, 1, 128) * integer(raw.depth, 1, 128);
  for (const key of ['packedCells', 'energyQ', 'structure']) {
    dense(raw[key], size);
    if (raw[key].length !== size) throw Error('Transport terrain length differs.');
  }
  const s = raw as unknown as StructuralSnapshot3D,
    state = validateStructuralSnapshot3D(s);
  return {
    ...s,
    packedCells: Array.from(state.grid),
    energyQ: Array.from(state.energyQ),
    structure: Array.from(state.structure),
  };
}
/** Internal shared eligibility law; exported through this source module only. */
export function materialTransportCellMovable3D(s: StructuralSnapshot3D, i: number): boolean {
  if (s.structure[i] !== 0 || (s.packedCells[i] & 255) === MAT.AIR) return false;
  const phase = (s.packedCells[i] >>> PHASE_SHIFT) & 15;
  return (
    phase === PHASE.GAS ||
    phase === PHASE.POWDER ||
    phase === PHASE.LIQUID ||
    phase === PHASE.MOLTEN ||
    phase === PHASE.VISCOUS ||
    structuralEligible(s.packedCells[i])
  );
}
function parcelCell(s: StructuralSnapshot3D, raw: unknown): number {
  const i = integer(raw, 0, s.packedCells.length - 1);
  if (!materialTransportCellMovable3D(s, i))
    throw Error('Parcels require existing unbound mobile matter.');
  return i;
}

/** Validate a complete envelope, with canonical IDs and isolated public storage. */
export function readMaterialTransport3D(raw: unknown): MaterialTransportState3D {
  fields(raw, ['schemaVersion', 'rulesVersion', 'cycle', 'terrain', 'parcels']);
  if (
    raw.schemaVersion !== MATERIAL_TRANSPORT_SCHEMA_3D ||
    raw.rulesVersion !== MATERIAL_TRANSPORT_RULES_3D
  )
    throw Error('Incompatible material transport rules.');
  const cycle = integer(raw.cycle, 0, Number.MAX_SAFE_INTEGER);
  dense(raw.parcels, maximum);
  const terrain = ownedTerrain(raw.terrain),
    parcels: MaterialParcel3D[] = [],
    cells = new Set<number>();
  for (const row of raw.parcels) {
    fields(row, ['id', 'cell', 'velocityQ', 'remainderQ']);
    const id = identity(row.id),
      cell = parcelCell(terrain, row.cell);
    if (cells.has(cell) || (parcels.length && parcels[parcels.length - 1].id >= id))
      throw Error('Parcel cells must be unique and IDs canonical.');
    cells.add(cell);
    parcels.push({
      id,
      cell,
      velocityQ: vector(row.velocityQ, -speedQ, speedQ),
      remainderQ: vector(row.remainderQ, 1 - Q, Q - 1),
    });
  }
  return {
    schemaVersion: MATERIAL_TRANSPORT_SCHEMA_3D,
    rulesVersion: MATERIAL_TRANSPORT_RULES_3D,
    cycle,
    terrain,
    parcels,
  };
}

/** Capture existing matter. Terrain and initial momentum become one saved value. */
export function createMaterialTransport3D(
  terrain: StructuralSnapshot3D,
  seeds: readonly MaterialParcelSeed3D[] = [],
): MaterialTransportState3D {
  dense(seeds, maximum);
  const owned = ownedTerrain(terrain),
    parcels: MaterialParcel3D[] = [],
    ids = new Set<string>(),
    cells = new Set<number>();
  for (const seed of seeds) {
    fields(seed, ['id', 'cell'], ['velocityQ']);
    const id = identity(seed.id),
      p = vector(seed.cell, 0, 127);
    if (p[0] >= owned.width || p[1] >= owned.height || p[2] >= owned.depth)
      throw Error('Parcel coordinate is outside the world.');
    const cell = parcelCell(owned, p[0] + owned.width * (p[1] + owned.height * p[2]));
    if (ids.has(id) || cells.has(cell)) throw Error('Duplicate parcel ID or cell.');
    ids.add(id);
    cells.add(cell);
    parcels.push({
      id,
      cell,
      velocityQ: Object.hasOwn(seed, 'velocityQ')
        ? vector(seed.velocityQ, -speedQ, speedQ)
        : [0, 0, 0],
      remainderQ: [0, 0, 0],
    });
  }
  parcels.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    schemaVersion: MATERIAL_TRANSPORT_SCHEMA_3D,
    rulesVersion: MATERIAL_TRANSPORT_RULES_3D,
    cycle: 0,
    terrain: owned,
    parcels,
  };
}

/**
 * One explicit intervention cycle. ASCII parcel order, then X/Z/Y sweeps.
 * Fractional motion waits for a full lattice-cell crossing. Blocking cancels the
 * normal velocity/remainder without bounce, pushing, drag or thermal conversion.
 * This result must be committed atomically with the application's costs/state.
 */
export function applyMaterialTransport3D(
  raw: MaterialTransportState3D,
  impulses: readonly MaterialImpulse3D[] = [],
): {
  state: MaterialTransportState3D;
  receipt: MaterialTransportReceipt3D;
} {
  dense(impulses, maximum);
  const state = readMaterialTransport3D(raw),
    fromCycle = state.cycle;
  state.cycle = integer(fromCycle + 1, 0, Number.MAX_SAFE_INTEGER);
  const byId = new Map(state.parcels.map((p) => [p.id, p])),
    seen = new Set<string>();
  // Check every command and sum before any material coordinate changes.
  for (const command of impulses) {
    fields(command, ['id', 'impulseQ']);
    const id = identity(command.id),
      parcel = byId.get(id);
    if (!parcel || seen.has(id)) throw Error('Unknown or duplicate impulse target.');
    seen.add(id);
    const impulse = vector(command.impulseQ, -speedQ, speedQ);
    parcel.velocityQ = parcel.velocityQ.map((v, axis) =>
      integer(v + impulse[axis], -speedQ, speedQ),
    ) as Vector;
  }
  const s = state.terrain;
  const motion = transportMaterialKernel3D(
    s,
    state.parcels,
    (i) => s.structure[i] === 0 && ((s.packedCells[i] >>> PHASE_SHIFT) & 15) === PHASE.GAS,
  );
  const receipt: MaterialTransportReceipt3D = {
    rulesVersion: MATERIAL_TRANSPORT_RULES_3D,
    fromCycle,
    toCycle: state.cycle,
    materialTick: s.tick,
    externalEnergyQ: '0',
    ...motion,
    editedCells: [],
  };
  for (let i = 0; i < s.packedCells.length; i++) {
    if (
      s.packedCells[i] !== raw.terrain.packedCells[i] ||
      s.energyQ[i] !== raw.terrain.energyQ[i] ||
      s.structure[i] !== raw.terrain.structure[i]
    )
      receipt.editedCells.push(i);
  }
  return { state, receipt };
}
