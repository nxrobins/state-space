/** Strict validation shared by browser clients and snapshot transports. */
import { RULES_VERSION, SCHEMA_VERSION } from './generated/materials.js';
import { DEFAULT_REGISTRY, requireRegistry, type MaterialRegistry } from './registry.js';

export { MAX_CELLS, checkedInteger, validateDimensions, validatePackedCells } from './validation.js';
import { checkedInteger, validateDimensions } from './validation.js';
import { rulesForRegistry, validateStructure, type StructuralState } from './structure.js';

export interface PackedSnapshot {
  schemaVersion: number;
  rulesVersion: string;
  materialCatalogHash: string;
  width: number;
  height: number;
  tick: number;
  packedCells: ArrayLike<number>;
  energyQ: ArrayLike<number>;
  structure: ArrayLike<number>;
}

export function validateSnapshot(snapshot: PackedSnapshot, registry: MaterialRegistry = DEFAULT_REGISTRY): StructuralState {
  requireRegistry(registry);
  const keys = ['schemaVersion', 'rulesVersion', 'materialCatalogHash', 'width', 'height', 'tick', 'packedCells', 'energyQ', 'structure'];
  if (!snapshot || Object.keys(snapshot).length !== keys.length || keys.some(key => !Object.hasOwn(snapshot, key))) {
    throw new Error('Snapshot contains missing or unexpected fields.');
  }
  if (snapshot.schemaVersion !== SCHEMA_VERSION || snapshot.rulesVersion !== RULES_VERSION || snapshot.materialCatalogHash !== registry.hash) {
    throw new Error('Incompatible snapshot version or material catalog.');
  }
  checkedInteger(snapshot.tick, 0, Number.MAX_SAFE_INTEGER, 'tick');
  validateDimensions(snapshot.width, snapshot.height);
  return validateStructure({ grid: snapshot.packedCells, energyQ: snapshot.energyQ, structure: snapshot.structure }, snapshot.width, snapshot.height, rulesForRegistry(registry));
}
