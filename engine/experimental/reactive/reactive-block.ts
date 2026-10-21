/** Portable reactive material blocks and atomic edits; no time evolution. */
import { MAT, PHASE, PHASE_SHIFT, COLD_STRIDE, COLD_COHESION } from '../../generated/materials.js';
import { seedState, validateEnergyState, thermalView, energyLedger, MAX_ENERGY_Q } from '../../thermal.js';
import { INTEGRITY_3D, ANCHOR_3D, BONDS_3D, COMPLETE_STRUCTURE_3D, structuralNeighbor } from '../structural-mechanics.js';
import { reactiveRegistrySource3D, reactiveFields3D, reactiveArray3D, reactiveInteger3D, type ReactiveMaterialRegistry3D } from './reactive-registry.js';
const BOND_MASK_3D = BONDS_3D.reduce((mask, bit) => mask | bit, 0);
/** Per-registry material facts the block check needs for every cell; registries are frozen, so these never change. */
const materialTables = new WeakMap<ReactiveMaterialRegistry3D, {known: Uint8Array; phase: Uint8Array}>();
function reactiveMaterialTables3D(registry: ReactiveMaterialRegistry3D) {
  let tables = materialTables.get(registry);
  if (!tables) {
    const known = new Uint8Array(256), phase = new Uint8Array(256);
    for (const id of registry.materialIds) {known[id] = 1; phase[id] = registry.material(id).properties.default_phase;}
    tables = {known, phase}; materialTables.set(registry, tables);
  }
  return tables;
}
export const REACTIVE_BLOCK_RULES_3D = 'reactive-material-block-1';
export const REACTIVE_BLOCK_SCHEMA_3D = 1;
export const REACTIVE_BLOCK_LIMITS_3D = Object.freeze({cells: 32768, dimension: 128, edits: 4096});
type Shape = {width: number; height: number; depth: number};
export type ReactiveMaterialBlock3D = Shape & {schemaVersion: 1; rulesVersion: typeof REACTIVE_BLOCK_RULES_3D;
  materialCatalogHash: string; packedCells: number[]; energyQ: number[]; structure: number[]};
type Position = {x: number; y: number; z: number};
export type ReactiveMaterialEdit3D = Position & ({kind: 'place'; material: number; thermal?: number} |
  {kind: 'energy'; energyQ: number} | {kind: 'integrity'; integrity: number} | {kind: 'anchor'; anchored: boolean} |
  {kind: 'bond'; direction: number; bonded: boolean});
function shape(raw: Shape): number {
  for (const v of [raw.width, raw.height, raw.depth]) reactiveInteger3D(v, 1, REACTIVE_BLOCK_LIMITS_3D.dimension);
  return reactiveInteger3D(raw.width * raw.height * raw.depth, 1, REACTIVE_BLOCK_LIMITS_3D.cells);
}
function eligible(packed: number, cold: Uint32Array): boolean {
  const phase = (packed >>> PHASE_SHIFT) & 15;
  return (phase === PHASE.SOLID || phase === PHASE.FROZEN) && cold[(packed & 255) * COLD_STRIDE + COLD_COHESION] > 0;
}
function placement(registry: ReactiveMaterialRegistry3D, id: number, thermal?: number) {
  const source = reactiveRegistrySource3D(registry), material = registry.material(id), t = thermal ?? material.default_thermal;
  reactiveInteger3D(t, 0, 255);
  return seedState([id | (t << 8) | (material.properties.default_phase << PHASE_SHIFT)], source.cold, source.registry);
}
/** Fresh cells have fresh integrity, no anchors and no implicit joins. */
export function createReactiveMaterialBlock3D(registry: ReactiveMaterialRegistry3D, dimensions: Shape, fillMaterial: number = MAT.AIR): ReactiveMaterialBlock3D {
  reactiveFields3D(dimensions, ['width', 'height', 'depth']); const count = shape(dimensions), source = reactiveRegistrySource3D(registry), seed = placement(registry, fillMaterial);
  return {schemaVersion: 1, rulesVersion: REACTIVE_BLOCK_RULES_3D, materialCatalogHash: registry.hash, ...dimensions,
    packedCells: new Array(count).fill(seed.grid[0]), energyQ: new Array(count).fill(seed.energyQ[0]), structure: new Array(count).fill(eligible(seed.grid[0], source.cold) ? INTEGRITY_3D : 0)};
}
/** Owned complete coordinates. No normalization or repair on malformed input. */
export function readReactiveMaterialBlock3D(registry: ReactiveMaterialRegistry3D, raw: unknown): ReactiveMaterialBlock3D {
  reactiveRegistrySource3D(registry);
  reactiveFields3D(raw, ['schemaVersion', 'rulesVersion', 'materialCatalogHash', 'width', 'height', 'depth', 'packedCells', 'energyQ', 'structure']);
  if (raw.schemaVersion !== REACTIVE_BLOCK_SCHEMA_3D || raw.rulesVersion !== REACTIVE_BLOCK_RULES_3D || raw.materialCatalogHash !== registry.hash) throw Error('Incompatible reactive material block.');
  const dimensions = {width: raw.width, height: raw.height, depth: raw.depth} as Shape, count = shape(dimensions);
  const [packedCells, energyQ, structure] = [raw.packedCells, raw.energyQ, raw.structure].map(value => {
    const rows = reactiveArray3D(value, count); if (rows.length !== count) throw Error('Reactive coordinate length mismatch.');
    return rows.map(v => reactiveInteger3D(v, 0, 0xffffffff));
  });
  return checkReactiveMaterialBlock3D(registry, {schemaVersion: 1, rulesVersion: REACTIVE_BLOCK_RULES_3D, materialCatalogHash: registry.hash, ...dimensions, packedCells, energyQ, structure});
}
/** Internal only: physical invariants of an engine-owned block whose data shape is already trusted.
 * The public reader copies and checks shape first; this never copies, and returns canonical field order.
 */
export function checkReactiveMaterialBlock3D(registry: ReactiveMaterialRegistry3D, block: ReactiveMaterialBlock3D): ReactiveMaterialBlock3D {
  const source = reactiveRegistrySource3D(registry), {packedCells, energyQ, structure} = block;
  const dimensions = {width: block.width, height: block.height, depth: block.depth}, count = shape(dimensions);
  if (packedCells.length !== count || energyQ.length !== count || structure.length !== count) throw Error('Reactive coordinate length mismatch.');
  validateEnergyState(packedCells, energyQ, count, source.cold, source.registry);
  const {known, phase} = reactiveMaterialTables3D(registry);
  for (let i = 0; i < count; i++) {
    const v = packedCells[i], word = structure[i];
    if (!known[v & 255] || (v & 0xf0ff0000) !== 0 || (v >>> PHASE_SHIFT & 15) !== phase[v & 255]) throw Error('Invalid reactive packed material.');
    if ((word & ~COMPLETE_STRUCTURE_3D) !== 0 || !eligible(v, source.cold) && word !== 0) throw Error('Invalid reactive structural state.');
    if ((word & BOND_MASK_3D) === 0) continue;
    for (let dir = 0; dir < 6; dir++) if (word & BONDS_3D[dir]) {
      const j = structuralNeighbor(i, dir, dimensions);
      if (j < 0 || !(word & INTEGRITY_3D) || !(structure[j] & INTEGRITY_3D) || !(structure[j] & BONDS_3D[dir ^ 1]) || !eligible(packedCells[j], source.cold)) throw Error('Invalid reactive reciprocal bond or boundary.');
    }
  }
  return {schemaVersion: 1, rulesVersion: REACTIVE_BLOCK_RULES_3D, materialCatalogHash: registry.hash, ...dimensions, packedCells, energyQ, structure};
}
/** Exact under REACTIVE_BLOCK_LIMITS_3D: 32768 cells at MAX_ENERGY_Q stay far below 2^53. */
export function reactiveEnergyTotalQ3D(energyQ: readonly number[]): bigint {
  let sum = 0; for (let i = 0; i < energyQ.length; i++) sum += energyQ[i];
  if (!Number.isSafeInteger(sum)) throw Error('Reactive energy total exceeds exact integer range.');
  return BigInt(sum);
}
export function reactiveMaterialEnergyLedger3D(registry: ReactiveMaterialRegistry3D, raw: ReactiveMaterialBlock3D) {
  const block = readReactiveMaterialBlock3D(registry, raw), source = reactiveRegistrySource3D(registry);
  return energyLedger({grid: Uint32Array.from(block.packedCells), energyQ: Uint32Array.from(block.energyQ)}, source.cold);
}
/** Internal staging also reports replacement intent, including identical placement. */
export function stageReactiveMaterialEdits3D(registry: ReactiveMaterialRegistry3D, raw: ReactiveMaterialBlock3D, edits: readonly ReactiveMaterialEdit3D[]) {
  const block = readReactiveMaterialBlock3D(registry, raw), before = block.energyQ.slice(), oldCells = block.packedCells.slice(), oldStructure = block.structure.slice();
  const source = reactiveRegistrySource3D(registry), commands = reactiveArray3D(edits, REACTIVE_BLOCK_LIMITS_3D.edits).map(row => {
    if (!row || typeof row !== 'object') throw Error('Invalid reactive edit.'); const tag = Object.getOwnPropertyDescriptor(row, 'kind');
    if (!tag || !('value' in tag) || !['place', 'energy', 'integrity', 'anchor', 'bond'].includes(tag.value)) throw Error('Invalid reactive edit kind.');
    const base = ['kind', 'x', 'y', 'z'], keys = {place: ['material'], energy: ['energyQ'], integrity: ['integrity'], anchor: ['anchored'], bond: ['direction', 'bonded']};
    reactiveFields3D(row, [...base, ...keys[tag.value as keyof typeof keys]], tag.value === 'place' ? ['thermal'] : []);
    const x = reactiveInteger3D(row.x, 0, block.width - 1), y = reactiveInteger3D(row.y, 0, block.height - 1), z = reactiveInteger3D(row.z, 0, block.depth - 1);
    const edit = {...row} as ReactiveMaterialEdit3D;
    if (edit.kind === 'place') {
      if (Object.hasOwn(row, 'thermal')) reactiveInteger3D(row.thermal, 0, 255);
      placement(registry, edit.material, edit.thermal);
    }
    if (edit.kind === 'energy') reactiveInteger3D(edit.energyQ, 0, MAX_ENERGY_Q);
    if (edit.kind === 'integrity') reactiveInteger3D(edit.integrity, 0, 255);
    if (edit.kind === 'anchor' && typeof edit.anchored !== 'boolean' || edit.kind === 'bond' && typeof edit.bonded !== 'boolean') throw Error('Reactive edit requires a boolean.');
    if (edit.kind === 'bond') reactiveInteger3D(edit.direction, 0, 5);
    return {edit, i: x + block.width * (y + block.height * z)};
  });
  const clearBonds = (i: number) => {
    for (let dir = 0; dir < 6; dir++) {const j = structuralNeighbor(i, dir, block); if (j >= 0) block.structure[j] &= ~BONDS_3D[dir ^ 1];}
    block.structure[i] &= INTEGRITY_3D | ANCHOR_3D;
  };
  for (const {edit, i} of commands) {
    if (edit.kind === 'place') {
      const seed = placement(registry, edit.material, edit.thermal); clearBonds(i);
      block.packedCells[i] = seed.grid[0]; block.energyQ[i] = seed.energyQ[0]; block.structure[i] = eligible(seed.grid[0], source.cold) ? INTEGRITY_3D : 0;
    } else if (edit.kind === 'energy') {
      const floor = registry.material(block.packedCells[i] & 255).properties.fuel_energy * 256;
      if (edit.energyQ < floor) throw Error('Thermal edits cannot consume chemical fuel.');
      block.energyQ[i] = edit.energyQ; block.packedCells[i] = thermalView(block.packedCells[i], edit.energyQ, source.cold);
    } else {
      if (!eligible(block.packedCells[i], source.cold)) throw Error('Reactive structural edits require an eligible material.');
      if (edit.kind === 'integrity') {block.structure[i] = (block.structure[i] & ~INTEGRITY_3D) | edit.integrity; if (!edit.integrity) clearBonds(i);}
      else if (edit.kind === 'anchor') block.structure[i] = edit.anchored ? block.structure[i] | ANCHOR_3D : block.structure[i] & ~ANCHOR_3D;
      else {
        const j = structuralNeighbor(i, edit.direction, block); if (j < 0) throw Error('Reactive bond crosses the boundary.');
        if (edit.bonded && (!eligible(block.packedCells[j], source.cold) || !(block.structure[i] & INTEGRITY_3D) || !(block.structure[j] & INTEGRITY_3D))) throw Error('Reactive join requires two intact eligible cells.');
        if (edit.bonded) {block.structure[i] |= BONDS_3D[edit.direction]; block.structure[j] |= BONDS_3D[edit.direction ^ 1];}
        else {block.structure[i] &= ~BONDS_3D[edit.direction]; block.structure[j] &= ~BONDS_3D[edit.direction ^ 1];}
      }
    }
  }
  const changedCells: number[] = []; let externalQ = 0n;
  for (let i = 0; i < before.length; i++) {
    externalQ += BigInt(block.energyQ[i]) - BigInt(before[i]);
    if (block.packedCells[i] !== oldCells[i] || block.energyQ[i] !== before[i] || block.structure[i] !== oldStructure[i]) changedCells.push(i);
  }
  const replacedCells = [...new Set(commands.filter(c => c.edit.kind === 'place').map(c => c.i))].sort((a, b) => a - b);
  return {block, replacedCells, receipt: {rulesVersion: REACTIVE_BLOCK_RULES_3D, materialCatalogHash: registry.hash, externalEnergyQ: externalQ.toString(), changedCells}};
}
export function editReactiveMaterialBlock3D(registry: ReactiveMaterialRegistry3D, raw: ReactiveMaterialBlock3D, edits: readonly ReactiveMaterialEdit3D[]) {
  const {block, receipt} = stageReactiveMaterialEdits3D(registry, raw, edits); return {block, receipt};
}
