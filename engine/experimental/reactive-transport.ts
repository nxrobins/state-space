/** Conservative control planning. Results are candidates, never world commits. */
import { MAT, PHASE, PHASE_SHIFT, COLD_STRIDE, COLD_COHESION } from '../generated/materials.js';
import { reactiveArray3D, reactiveFields3D, reactiveInteger3D, reactiveRegistrySource3D, type ReactiveMaterialRegistry3D } from './reactive-registry.js';
import { reactiveDomainId3D, type ReactiveDomainId3D } from './reactive-domain-state.js';
import { reactiveHeldCells3D } from './reactive-holds.js';
import { REACTIVE_WORLD_COMPONENTS_3D, readReactiveWorldSnapshot3D, reactiveSnapshotHolds3D, type ReactiveWorldSnapshot3D } from './reactive-world-tick.js';
import { reactiveGeometrySource3D, type ReactiveGameplayGeometry3D } from './reactive-geometry.js';
import { MATERIAL_TRANSPORT_KERNEL_LIMITS_3D, createMaterialTransportKernel3D } from './material-transport-kernel.js';
import type { MaterialParcel3D, MaterialParcelSeed3D, MaterialImpulse3D, MaterialTransportReceipt3D } from './material-transport.js';

export const REACTIVE_TRANSPORT_RULES_3D = 'reactive-transport-1';
export const REACTIVE_TRANSPORT_SCHEMA_3D = 1;
export const REACTIVE_TRANSPORT_MEMORY_RULES_3D = 'reactive-transport-memory-1';
export const REACTIVE_TRANSPORT_LIMITS_3D = MATERIAL_TRANSPORT_KERNEL_LIMITS_3D;
export type ReactiveMaterialParcel3D = MaterialParcel3D;
export type ReactiveMaterialParcelSeed3D = MaterialParcelSeed3D;
export type ReactiveMaterialImpulse3D = MaterialImpulse3D;
export type ReactiveTransportIdentity3D = {worldId: string; gameRulesVersion: string; domain: ReactiveDomainId3D;
  materialCatalogHash: string; width: number; height: number; depth: number; tick: number;
  worldRulesVersion: ReactiveWorldSnapshot3D['rulesVersion']; evolutionRulesVersion: string; structureRulesVersion: string};
export type ReactiveMaterialTransport3D = {schemaVersion: 1; rulesVersion: typeof REACTIVE_TRANSPORT_RULES_3D;
  cycle: number; identity: ReactiveTransportIdentity3D; world: ReactiveWorldSnapshot3D; parcels: ReactiveMaterialParcel3D[]};
export type ReactiveMaterialTransportReceipt3D = Omit<MaterialTransportReceipt3D, 'rulesVersion'> & {rulesVersion: typeof REACTIVE_TRANSPORT_RULES_3D};
export type ReactiveMaterialTransportMemory3D = Omit<ReactiveMaterialTransport3D, 'world' | 'parcels'> & {
  memoryRulesVersion: typeof REACTIVE_TRANSPORT_MEMORY_RULES_3D;
  parcels: (ReactiveMaterialParcel3D & {packed: number; energyQ: number; structure: number})[]};
const {parcels: maximum, scale: Q, speedQ} = REACTIVE_TRANSPORT_LIMITS_3D;
const identityKeys = ['worldId', 'gameRulesVersion', 'domain', 'materialCatalogHash', 'width', 'height', 'depth', 'tick',
  'worldRulesVersion', 'evolutionRulesVersion', 'structureRulesVersion'] as const;
function id(raw: unknown): string {
  if (typeof raw !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(raw)) throw Error('Invalid reactive parcel identity.'); return raw;
}
function vector(raw: unknown, min: number, max: number): [number, number, number] {
  const a = reactiveArray3D(raw, 3); if (a.length !== 3) throw Error('Reactive transport needs three coordinates.');
  return a.map(v => reactiveInteger3D(v, min, max)) as [number, number, number];
}
function binding(world: ReactiveWorldSnapshot3D, worldId: string, gameRulesVersion: string, domain: ReactiveDomainId3D): ReactiveTransportIdentity3D {
  const b = world.block;
  return {worldId, gameRulesVersion, domain, materialCatalogHash: b.materialCatalogHash, width: b.width, height: b.height, depth: b.depth,
    tick: world.tick, worldRulesVersion: world.rulesVersion, evolutionRulesVersion: REACTIVE_WORLD_COMPONENTS_3D.evolution, structureRulesVersion: REACTIVE_WORLD_COMPONENTS_3D.structure};
}
function readIdentity(world: ReactiveWorldSnapshot3D, raw: unknown) {
  reactiveFields3D(raw, identityKeys);
  const expected = binding(world, id(raw.worldId), id(raw.gameRulesVersion), reactiveDomainId3D(raw.domain));
  if (identityKeys.some(k => raw[k] !== expected[k])) throw Error('Reactive transport world identity differs.'); return expected;
}
/** Internal owned boundary. Views provide identity; public stamps cannot forge one. */
export function reactiveTransportBoundary3D(registry: ReactiveMaterialRegistry3D, view: ReactiveGameplayGeometry3D) {
  const source = reactiveGeometrySource3D(view), world = readReactiveWorldSnapshot3D(registry, source.token);
  const revision = view.stamp.kind === 'committed' ? view.stamp.revision : view.stamp.base;
  return {world, identity: binding(world, revision.worldId, revision.gameRulesVersion, view.stamp.domain)};
}
/** Internal eligibility: temporary constraints and custom cohesion are authoritative. */
export function reactiveTransportEligibility3D(registry: ReactiveMaterialRegistry3D, world: ReactiveWorldSnapshot3D) {
  const cold = reactiveRegistrySource3D(registry).cold, held = new Set(reactiveHeldCells3D(reactiveSnapshotHolds3D(world))), b = world.block;
  return (i: number) => {
    const word = b.packedCells[i], phase = word >>> PHASE_SHIFT & 15;
    if (held.has(i) || b.structure[i] !== 0 || (word & 255) === MAT.AIR) return false;
    return [PHASE.GAS, PHASE.POWDER, PHASE.LIQUID, PHASE.MOLTEN, PHASE.VISCOUS].some(p => p === phase) ||
      [PHASE.SOLID, PHASE.FROZEN].some(p => p === phase) && cold[(word & 255) * COLD_STRIDE + COLD_COHESION] > 0;
  };
}
export function readReactiveMaterialTransport3D(registry: ReactiveMaterialRegistry3D, raw: unknown): ReactiveMaterialTransport3D {
  reactiveFields3D(raw, ['schemaVersion', 'rulesVersion', 'cycle', 'identity', 'world', 'parcels']);
  if (raw.schemaVersion !== 1 || raw.rulesVersion !== REACTIVE_TRANSPORT_RULES_3D) throw Error('Incompatible reactive transport state.');
  const cycle = reactiveInteger3D(raw.cycle, 0, Number.MAX_SAFE_INTEGER), rows = reactiveArray3D(raw.parcels, maximum);
  const world = readReactiveWorldSnapshot3D(registry, raw.world), identity = readIdentity(world, raw.identity), eligible = reactiveTransportEligibility3D(registry, world);
  const parcels: ReactiveMaterialParcel3D[] = [], cells = new Set<number>();
  for (const row of rows) {
    reactiveFields3D(row, ['id', 'cell', 'velocityQ', 'remainderQ']);
    const name = id(row.id), cell = reactiveInteger3D(row.cell, 0, world.block.packedCells.length - 1);
    if (!eligible(cell)) throw Error('Reactive parcels require existing unbound mobile matter without holds.');
    if (cells.has(cell) || parcels.length && parcels[parcels.length - 1].id >= name) throw Error('Reactive parcels require unique cells and canonical IDs.');
    cells.add(cell); parcels.push({id: name, cell, velocityQ: vector(row.velocityQ, -speedQ, speedQ), remainderQ: vector(row.remainderQ, 1 - Q, Q - 1)});
  }
  return {schemaVersion: 1, rulesVersion: REACTIVE_TRANSPORT_RULES_3D, cycle, identity, world, parcels};
}
export function createReactiveMaterialTransport3D(registry: ReactiveMaterialRegistry3D, view: ReactiveGameplayGeometry3D,
  seeds: readonly ReactiveMaterialParcelSeed3D[] = []): ReactiveMaterialTransport3D {
  const rows = reactiveArray3D(seeds, maximum), boundary = reactiveTransportBoundary3D(registry, view), b = boundary.world.block;
  const parcels = rows.map(row => {
    reactiveFields3D(row, ['id', 'cell'], ['velocityQ']); const c = vector(row.cell, 0, 127);
    if (c[0] >= b.width || c[1] >= b.height || c[2] >= b.depth) throw Error('Reactive parcel coordinate outside the world.');
    return {id: id(row.id), cell: c[0] + b.width * (c[1] + b.height * c[2]), remainderQ: [0, 0, 0],
      velocityQ: Object.hasOwn(row, 'velocityQ') ? vector(row.velocityQ, -speedQ, speedQ) : [0, 0, 0]};
  }).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return readReactiveMaterialTransport3D(registry, {schemaVersion: 1, rulesVersion: REACTIVE_TRANSPORT_RULES_3D, cycle: 0, ...boundary, parcels});
}
export type ReactiveTransportProgress3D = {status: 'running' | 'complete' | 'cancelled'; phase: 'parcels' | 'publish' | 'complete'; completedParcels: number; totalParcels: number};
export type ReactiveTransportResult3D = {state: ReactiveMaterialTransport3D; receipt: ReactiveMaterialTransportReceipt3D};
export interface ReactiveMaterialTransportJob3D {
  progress(): ReactiveTransportProgress3D;
  advance(): ReactiveTransportProgress3D;
  cancel(): boolean;
  result(): ReactiveTransportResult3D;
}
/** One parcel (at most six swaps) per advance, then full-block validation/publication.
 * Preparation and publication are bounded volume work, not a latency guarantee. */
export function createReactiveMaterialTransportJob3D(registry: ReactiveMaterialRegistry3D, raw: ReactiveMaterialTransport3D,
  impulses: readonly ReactiveMaterialImpulse3D[] = []): ReactiveMaterialTransportJob3D {
  const commands = reactiveArray3D(impulses, maximum);
  let state: ReactiveMaterialTransport3D | null = readReactiveMaterialTransport3D(registry, raw);
  const fromCycle = state.cycle;
  state.cycle = reactiveInteger3D(fromCycle + 1, 0, Number.MAX_SAFE_INTEGER);
  const byId = new Map(state.parcels.map(p => [p.id, p])), seen = new Set<string>();
  for (const c of commands) {
    reactiveFields3D(c, ['id', 'impulseQ']); const name = id(c.id), p = byId.get(name);
    if (!p || seen.has(name)) throw Error('Unknown or duplicate reactive impulse target.'); seen.add(name);
    const impulse = vector(c.impulseQ, -speedQ, speedQ);
    p.velocityQ = p.velocityQ.map((v, a) => reactiveInteger3D(v + impulse[a], -speedQ, speedQ)) as [number, number, number];
  }
  const b = state.world.block, held = new Set(reactiveHeldCells3D(reactiveSnapshotHolds3D(state.world)));
  let before: typeof b | null = structuredClone(b);
  let kernel: ReturnType<typeof createMaterialTransportKernel3D> | null = createMaterialTransportKernel3D(b, state.parcels,
    i => !held.has(i) && b.structure[i] === 0 && (b.packedCells[i] >>> PHASE_SHIFT & 15) === PHASE.GAS);
  const totalParcels = state.parcels.length; let completedParcels = 0;
  let status: ReactiveTransportProgress3D['status'] = 'running', phase: ReactiveTransportProgress3D['phase'] = totalParcels ? 'parcels' : 'publish';
  let result: ReactiveTransportResult3D | null = null;
  const progress = (): ReactiveTransportProgress3D => ({status, phase, completedParcels, totalParcels});
  const release = () => {state = null; before = null; kernel = null; held.clear(); byId.clear();};
  const cancel = () => {if (status !== 'running') return false; release(); status = 'cancelled'; return true;};
  return Object.freeze({progress, cancel,
    advance() {
      if (status !== 'running' || !state || !before || !kernel) throw Error('Reactive transport job is not running.');
      try {
        if (phase === 'parcels') {kernel.advance(); completedParcels++; if (kernel.complete()) phase = 'publish';}
        else {
          const valid = readReactiveMaterialTransport3D(registry, state), out = valid.world.block;
          const editedCells = out.packedCells.flatMap((v, i) => v !== before!.packedCells[i] || out.energyQ[i] !== before!.energyQ[i] || out.structure[i] !== before!.structure[i] ? [i] : []);
          const total = (values: number[]) => values.reduce((sum, q) => sum + BigInt(q), 0n);
          if (total(out.energyQ) !== total(before.energyQ)) throw Error('Reactive transport lost conserved energy.');
          result = {state: valid, receipt: {rulesVersion: REACTIVE_TRANSPORT_RULES_3D, fromCycle, toCycle: valid.cycle,
            materialTick: valid.world.tick, externalEnergyQ: '0', ...structuredClone(kernel.receipt), editedCells}};
          release(); status = 'complete'; phase = 'complete';
        }
      } catch (error) {cancel(); throw error;} return progress();
    },
    result() {if (!result || status !== 'complete') throw Error('Reactive transport result is not complete.'); return structuredClone(result);},
  });
}
/** Pure candidate, with control motion separate from the physical clock and energy. */
export function applyReactiveMaterialTransport3D(registry: ReactiveMaterialRegistry3D, raw: ReactiveMaterialTransport3D,
  impulses: readonly ReactiveMaterialImpulse3D[] = []): ReactiveTransportResult3D {
  const job = createReactiveMaterialTransportJob3D(registry, raw, impulses);
  while (job.progress().status === 'running') job.advance(); return job.result();
}
/** Compact application-owned saved control, not an executed-movement capability. */
export function captureReactiveMaterialTransportMemory3D(registry: ReactiveMaterialRegistry3D, raw: ReactiveMaterialTransport3D): ReactiveMaterialTransportMemory3D {
  const {world, parcels, ...state} = readReactiveMaterialTransport3D(registry, raw), b = world.block;
  return {...state, memoryRulesVersion: REACTIVE_TRANSPORT_MEMORY_RULES_3D,
    parcels: parcels.map(p => ({...p, packed: b.packedCells[p.cell], energyQ: b.energyQ[p.cell], structure: b.structure[p.cell]}))};
}
export function restoreReactiveMaterialTransportMemory3D(registry: ReactiveMaterialRegistry3D, view: ReactiveGameplayGeometry3D, raw: unknown): ReactiveMaterialTransport3D {
  reactiveFields3D(raw, ['schemaVersion', 'rulesVersion', 'memoryRulesVersion', 'cycle', 'identity', 'parcels']);
  if (raw.memoryRulesVersion !== REACTIVE_TRANSPORT_MEMORY_RULES_3D) throw Error('Incompatible reactive transport memory.');
  const rows = reactiveArray3D(raw.parcels, maximum), boundary = reactiveTransportBoundary3D(registry, view);
  const parcels = rows.map(row => {reactiveFields3D(row, ['id', 'cell', 'velocityQ', 'remainderQ', 'packed', 'energyQ', 'structure']);
    return {id: row.id, cell: row.cell, velocityQ: row.velocityQ, remainderQ: row.remainderQ};});
  const state = readReactiveMaterialTransport3D(registry, {schemaVersion: raw.schemaVersion, rulesVersion: raw.rulesVersion,
    cycle: raw.cycle, identity: raw.identity, world: boundary.world, parcels});
  if (identityKeys.some(k => state.identity[k] !== boundary.identity[k])) throw Error('Reactive transport memory belongs to another world or domain.');
  for (let k = 0; k < parcels.length; k++) {
    const p = state.parcels[k], row = rows[k] as ReactiveMaterialTransportMemory3D['parcels'][number], b = state.world.block;
    if (row.packed !== b.packedCells[p.cell] || row.energyQ !== b.energyQ[p.cell] || row.structure !== b.structure[p.cell]) throw Error('Reactive transport material witness differs.');
  }
  return state;
}
