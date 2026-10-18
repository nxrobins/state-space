/** Finite physical storage domains and conservative cross-domain handoffs. */
import { MAT, PHASE, PHASE_SHIFT } from '../generated/materials.js';
import { checkedInteger } from '../validation.js';
import { ANCHOR_3D, BONDS_3D, structuralEligible, structuralNeighbor } from './structural-mechanics.js';
import { validateStructuralSnapshot3D, validateStructuralState3D, type StructuralSnapshot3D } from './structural-world-core.js';
import type { CellCoordinate3D } from './interventions.js';

export const MATERIAL_RESERVOIR_RULES_VERSION_3D = 'material-reservoirs-1';
export const MATERIAL_RESERVOIR_LIMITS_3D = Object.freeze({domains: 8, cells: 65536, transferCells: 65536});
export type MaterialReservoir3D = {id: string; terrain: StructuralSnapshot3D};
export type MaterialTransferRequest3D = {
  /** null is the primary world; strings identify saved companion volumes. */
  from: string | null; to: string | null; cells: readonly CellCoordinate3D[];
  /** Destination coordinates equal source coordinates plus this offset. */
  offset: CellCoordinate3D;
  externalBonds?: 'reject' | 'cut'; anchors?: 'reject' | 'release'; displacement?: 'air' | 'mobile';
};
export type MaterialTransferReceipt3D = {
  rulesVersion: typeof MATERIAL_RESERVOIR_RULES_VERSION_3D; tick: number;
  from: string | null; to: string | null; sources: number[]; destinations: number[];
  sourceEnergyDeltaQ: string; destinationEnergyDeltaQ: string; externalEnergyQ: '0';
  cutBonds: [number, number][]; releasedAnchors: number[];
  sourceEditedCells: number[]; destinationEditedCells: number[];
};
function fields(value: object, required: readonly string[], optional: readonly string[] = []): void {
  if (!value || typeof value !== 'object' || Array.isArray(value) || required.some(k => !Object.hasOwn(value, k)) ||
      Reflect.ownKeys(value).some(k => typeof k !== 'string' || ![...required, ...optional].includes(k)) ||
      Object.values(Object.getOwnPropertyDescriptors(value)).some(d => !('value' in d) || !d.enumerable)) throw Error('Invalid reservoir record.');
}
function dense(value: readonly unknown[], max: number): void {
  if (!Array.isArray(value) || value.length > max || Reflect.ownKeys(value).length !== value.length + 1) throw Error('Invalid bounded reservoir array.');
  for (let i = 0; i < value.length; i++) {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (!d || !('value' in d) || !d.enumerable) throw Error('Reservoir arrays must contain dense data.');
  }
}
function domainId(id: string): void {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(id)) throw Error('Invalid reservoir identity.');
}
function coordinate(p: CellCoordinate3D): CellCoordinate3D {
  dense(p, 3); if (p.length !== 3 || p.some(v => !Number.isSafeInteger(v))) throw Error('Expected three integer coordinates.');
  return [p[0], p[1], p[2]];
}
function index(p: CellCoordinate3D, s: StructuralSnapshot3D): number {
  checkedInteger(p[0], 0, s.width - 1, 'x'); checkedInteger(p[1], 0, s.height - 1, 'y'); checkedInteger(p[2], 0, s.depth - 1, 'z');
  return p[0] + s.width * (p[1] + s.height * p[2]);
}
function copy(s: StructuralSnapshot3D): StructuralSnapshot3D {
  return {...s, packedCells: s.packedCells.slice(), energyQ: s.energyQ.slice(), structure: s.structure.slice()};
}
export function copyReservoirs3D(reservoirs: readonly MaterialReservoir3D[]): MaterialReservoir3D[] {
  return reservoirs.map(r => ({id: r.id, terrain: copy(r.terrain)}));
}
export function reservoirEnergyQ3D(reservoirs: readonly MaterialReservoir3D[]): bigint {
  let sum = 0; for (const r of reservoirs) for (const q of r.terrain.energyQ) sum += q; return BigInt(sum);
}
export function validateReservoirs3D(reservoirs: readonly MaterialReservoir3D[], world: StructuralSnapshot3D): MaterialReservoir3D[] {
  dense(reservoirs, MATERIAL_RESERVOIR_LIMITS_3D.domains);
  const ids = new Set<string>(), result: MaterialReservoir3D[] = []; let count = 0;
  for (const r of reservoirs) {
    fields(r, ['id', 'terrain']); domainId(r.id);
    if (ids.has(r.id)) throw Error('Duplicate reservoir identity.'); ids.add(r.id);
    // Bound allocation before asking the M5 validator to copy the domain.
    const s = r.terrain;
    fields(s, ['schemaVersion', 'rulesVersion', 'worldVersion', 'materialCatalogHash', 'width', 'height', 'depth', 'chunkSize', 'tick', 'packedCells', 'energyQ', 'structure']);
    for (const n of [s.width, s.height, s.depth]) checkedInteger(n, 1, 128, 'reservoir dimension');
    const size = s.width * s.height * s.depth; count += size;
    if (count > MATERIAL_RESERVOIR_LIMITS_3D.cells) throw Error('Reservoir cell budget exceeded.');
    for (const key of ['schemaVersion', 'rulesVersion', 'worldVersion', 'materialCatalogHash', 'tick'] as const) {
      if (s[key] !== world[key]) throw Error('Reservoir rules or absolute tick differ from the world.');
    }
    for (const cells of [s.packedCells, s.energyQ, s.structure]) {
      dense(cells, size); if (cells.length !== size) throw Error('Reservoir coordinate length differs from its geometry.');
    }
    const state = validateStructuralSnapshot3D(s);
    result.push({id: r.id, terrain: {...s, packedCells: Array.from(state.grid), energyQ: Array.from(state.energyQ), structure: Array.from(state.structure)}});
  }
  return result.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
export function compatibleReservoirs3D(a: readonly MaterialReservoir3D[], b: readonly MaterialReservoir3D[]): void {
  if (a.length !== b.length) throw Error('Reservoir topology cannot change during a session.');
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || (['width', 'height', 'depth', 'chunkSize'] as const).some(k => a[i].terrain[k] !== b[i].terrain[k])) throw Error('Reservoir identity or geometry changed.');
  }
}

/** Same displacement law as material-interventions-1. No destination is erased. */
function displaceable(v: number, structure: number, policy: 'air' | 'mobile'): boolean {
  if (structure !== 0) return false;
  if ((v & 255) === MAT.AIR) return true;
  if (policy === 'air') return false;
  const phase = (v >>> PHASE_SHIFT) & 15;
  return phase === PHASE.GAS || phase === PHASE.POWDER || phase === PHASE.LIQUID ||
    phase === PHASE.VISCOUS || phase === PHASE.MOLTEN || structuralEligible(v);
}
/** Pure cross-domain swap. Caller owns the result and commits it with game state. */
export function transferMaterial3D(world: StructuralSnapshot3D, reservoirs: readonly MaterialReservoir3D[], request: MaterialTransferRequest3D): {
  terrain: StructuralSnapshot3D; reservoirs: MaterialReservoir3D[]; receipt: MaterialTransferReceipt3D;
} {
  fields(request, ['from', 'to', 'cells', 'offset'], ['externalBonds', 'anchors', 'displacement']);
  for (const id of [request.from, request.to]) if (id !== null) domainId(id);
  if (request.from === request.to) throw Error('Use checked-path translation inside one domain.');
  const externalBonds = request.externalBonds === undefined ? 'reject' : request.externalBonds, anchors = request.anchors === undefined ? 'reject' : request.anchors, displacement = request.displacement === undefined ? 'air' : request.displacement;
  if (!['reject', 'cut'].includes(externalBonds) || !['reject', 'release'].includes(anchors) || !['air', 'mobile'].includes(displacement)) throw Error('Invalid material transfer policy.');
  dense(request.cells, MATERIAL_RESERVOIR_LIMITS_3D.transferCells);
  if (!request.cells.length) throw Error('Select existing matter for transfer.');
  const offset = coordinate(request.offset);
  validateStructuralSnapshot3D(world);
  const owned = validateReservoirs3D(reservoirs, world);
  const domain = (id: string | null) => {
    if (id === null) return world;
    const r = owned.find(r => r.id === id); if (!r) throw Error('Unknown reservoir.'); return r.terrain;
  };
  const source = domain(request.from), target = domain(request.to);
  const pairs = request.cells.map(c => {
    const p = coordinate(c), from = index(p, source), to = index([p[0] + offset[0], p[1] + offset[1], p[2] + offset[2]], target);
    if ((source.packedCells[from] & 255) === MAT.AIR) throw Error('Select existing matter, not air.');
    if (!displaceable(target.packedCells[to], target.structure[to], displacement)) throw Error('Transfer destination is obstructed.');
    return {from, to};
  }).sort((a, b) => a.from - b.from);
  const members = new Set(pairs.map(p => p.from));
  if (members.size !== pairs.length) throw Error('Duplicate transfer source.');
  const a = copy(source), b = copy(target), cutBonds: [number, number][] = [], releasedAnchors: number[] = [];
  for (const {from: i} of pairs) {
    if (a.structure[i] & ANCHOR_3D) {
      if (anchors === 'reject') throw Error('Explicitly release selected anchors before transfer.');
      a.structure[i] &= ~ANCHOR_3D; releasedAnchors.push(i);
    }
    for (let dir = 0; dir < 6; dir++) {
      if (!(a.structure[i] & BONDS_3D[dir])) continue;
      const j = structuralNeighbor(i, dir, source); if (members.has(j)) continue;
      if (externalBonds === 'reject') throw Error('Explicitly cut external bonds before transfer.');
      a.structure[i] &= ~BONDS_3D[dir]; a.structure[j] &= ~BONDS_3D[dir ^ 1]; cutBonds.push([Math.min(i, j), Math.max(i, j)]);
    }
  }
  let sourceDelta = 0n;
  for (const {from, to} of pairs) {
    sourceDelta += BigInt(b.energyQ[to]) - BigInt(a.energyQ[from]);
    for (const key of ['packedCells', 'energyQ', 'structure'] as const) [a[key][from], b[key][to]] = [b[key][to], a[key][from]];
  }
  validateStructuralState3D(a.packedCells, a.energyQ, a.structure, a);
  validateStructuralState3D(b.packedCells, b.energyQ, b.structure, b);
  let terrain = world;
  for (const [id, value] of [[request.from, a], [request.to, b]] as const) {
    if (id === null) terrain = value; else owned.find(r => r.id === id)!.terrain = value;
  }
  const changed = (before: StructuralSnapshot3D, after: StructuralSnapshot3D) => {
    const cells: number[] = [];
    for (let i = 0; i < before.packedCells.length; i++) if (before.packedCells[i] !== after.packedCells[i] || before.energyQ[i] !== after.energyQ[i] || before.structure[i] !== after.structure[i]) cells.push(i);
    return cells;
  };
  return {terrain: terrain === world ? copy(world) : terrain, reservoirs: owned, receipt: {
    rulesVersion: MATERIAL_RESERVOIR_RULES_VERSION_3D, tick: world.tick, from: request.from, to: request.to,
    sources: pairs.map(p => p.from), destinations: pairs.map(p => p.to), sourceEnergyDeltaQ: sourceDelta.toString(), destinationEnergyDeltaQ: (-sourceDelta).toString(), externalEnergyQ: '0',
    cutBonds: cutBonds.sort((a, b) => a[0] - b[0] || a[1] - b[1]), releasedAnchors,
    sourceEditedCells: changed(source, a), destinationEditedCells: changed(target, b),
  }};
}
