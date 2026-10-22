import { assertRecordFields } from '../../portable-data.js';
/** Versioned reactive 3D material definitions; never starts a simulation. */
import {
  DEFAULT_REGISTRY,
  createMaterialRegistry,
  type MaterialRegistry,
  type MaterialCatalog,
  type MaterialDefinition,
} from '../../registry.js';
import { MAT, PHASE, COLD_STRIDE } from '../../generated/materials.js';

export const REACTIVE_MATERIAL_RULES_3D = 'reactive-materials-1';
export const REACTIVE_MATERIAL_SCHEMA_3D = 1;
export const REACTIVE_MATERIAL_LIMITS_3D = Object.freeze({
  materials: 256,
  catalogNodes: 65536,
  depth: 12,
});
export type ReactiveMaterialCatalog3D = {
  schemaVersion: 1;
  rulesVersion: typeof REACTIVE_MATERIAL_RULES_3D;
  propertiesCatalog: MaterialCatalog;
  materialIds: number[];
};
export interface ReactiveMaterialRegistry3D {
  readonly hash: string;
  readonly sourceCatalogHash: string;
  readonly materialIds: readonly number[];
  readonly rulesVersion: typeof REACTIVE_MATERIAL_RULES_3D;
  has(id: number): boolean;
  material(id: number): ReturnType<MaterialRegistry['material']>;
  toCatalog(): ReactiveMaterialCatalog3D;
  coldTable(): Uint32Array;
  extend(materials: MaterialDefinition[]): Promise<ReactiveMaterialRegistry3D>;
}
type Source = { registry: MaterialRegistry; cold: Uint32Array; ids: ReadonlySet<number> };
const sources = new WeakMap<object, Source>();
export function reactiveRegistrySource3D(registry: ReactiveMaterialRegistry3D): Source {
  const source = sources.get(registry);
  if (!source) throw Error('A validated reactive 3D registry is required.');
  return source;
}
export function reactiveFields3D(
  raw: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): asserts raw is Record<string, unknown> {
  assertRecordFields(raw, required, optional, 'Invalid reactive data fields.');
}
export function reactiveArray3D(raw: unknown, maximum: number): unknown[] {
  if (
    !Array.isArray(raw) ||
    Object.getPrototypeOf(raw) !== Array.prototype ||
    raw.length > maximum ||
    Reflect.ownKeys(raw).length !== raw.length + 1
  )
    throw Error('Invalid reactive array.');
  // The canonical string key names the same property as i; a number key would be converted
  // again inside every lookup. Primitive concatenation runs no caller code and keeps no state.
  for (let i = 0; i < raw.length; i++) {
    const d = Object.getOwnPropertyDescriptor(raw, '' + i);
    if (!d || !('value' in d) || !d.enumerable) throw Error('Reactive arrays require dense data.');
  }
  return raw;
}
/** Internal only: copy of engine-built portable results (plain objects, arrays and primitives).
 * Field order and shared references are kept exactly as structuredClone keeps them, without its serializer cost.
 * Functions and symbols are rejected as structuredClone rejects them; other exotic values fall back to structuredClone.
 * Not for caller-supplied data: that goes through the validating readers.
 */
export function cloneReactiveData3D<T>(value: T): T {
  const seen = new Map<object, unknown>();
  const copy = (v: unknown): unknown => {
    if (typeof v === 'function' || typeof v === 'symbol')
      throw Error('Reactive results hold portable data only.');
    if (typeof v !== 'object' || v === null) return v;
    const known = seen.get(v);
    if (known !== undefined) return known;
    if (Array.isArray(v)) {
      if (Object.getPrototypeOf(v) !== Array.prototype) return structuredClone(v);
      let flat = true;
      for (let i = 0; i < v.length; i++)
        if (typeof v[i] === 'object' && v[i] !== null) {
          flat = false;
          break;
        }
      if (flat) {
        const out = v.slice();
        seen.set(v, out);
        return out;
      }
      const out = new Array<unknown>(v.length);
      seen.set(v, out);
      for (let i = 0; i < v.length; i++) out[i] = copy(v[i]);
      return out;
    }
    if (Object.getPrototypeOf(v) !== Object.prototype) return structuredClone(v);
    const out: Record<string, unknown> = {};
    seen.set(v, out);
    for (const key of Object.keys(v)) out[key] = copy((v as Record<string, unknown>)[key]);
    return out;
  };
  return copy(value) as T;
}
export function reactiveInteger3D(raw: unknown, min: number, max: number): number {
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < min || raw > max)
    throw Error('Invalid reactive integer.');
  return raw === 0 ? 0 : raw;
}
/** Owned portable data before asynchronous hashing; never invokes accessors. */
function copyCatalogData(raw: unknown): unknown {
  let nodes = 0;
  const copy = (value: unknown, depth: number): unknown => {
    if (
      ++nodes > REACTIVE_MATERIAL_LIMITS_3D.catalogNodes ||
      depth > REACTIVE_MATERIAL_LIMITS_3D.depth
    )
      throw Error('Reactive catalog exceeds its data budget.');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') {
      if (!Number.isSafeInteger(value)) throw Error('Catalog numbers must be exact integers.');
      return value === 0 ? 0 : value;
    }
    if (typeof value === 'string') {
      if (value.length > 256) throw Error('Catalog string exceeds its limit.');
      return value;
    }
    if (Array.isArray(value))
      return reactiveArray3D(value, REACTIVE_MATERIAL_LIMITS_3D.catalogNodes).map((v) =>
        copy(v, depth + 1),
      );
    if (
      !value ||
      typeof value !== 'object' ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    )
      throw Error('Catalog requires plain portable data.');
    const out: Record<string, unknown> = Object.create(null);
    for (const key of Reflect.ownKeys(value)) {
      const d = Object.getOwnPropertyDescriptor(value, key)!;
      if (typeof key !== 'string' || key.length > 64 || !('value' in d) || !d.enumerable)
        throw Error('Catalog requires enumerable data fields.');
      out[key] = copy(d.value, depth + 1);
    }
    return out;
  };
  return copy(raw, 0);
}
export function defaultReactiveMaterialCatalog3D(): ReactiveMaterialCatalog3D {
  return {
    schemaVersion: 1,
    rulesVersion: REACTIVE_MATERIAL_RULES_3D,
    propertiesCatalog: DEFAULT_REGISTRY.toCatalog(),
    materialIds: DEFAULT_REGISTRY.materialIds.filter((id) => id !== MAT.PLAYER),
  };
}
export async function createReactiveMaterialRegistry3D(
  raw: unknown = defaultReactiveMaterialCatalog3D(),
): Promise<ReactiveMaterialRegistry3D> {
  const data = copyCatalogData(raw);
  reactiveFields3D(data, ['schemaVersion', 'rulesVersion', 'propertiesCatalog', 'materialIds']);
  if (
    data.schemaVersion !== REACTIVE_MATERIAL_SCHEMA_3D ||
    data.rulesVersion !== REACTIVE_MATERIAL_RULES_3D
  )
    throw Error('Incompatible reactive material catalog.');
  const ids = reactiveArray3D(data.materialIds, 256)
      .map((v) => reactiveInteger3D(v, 0, 255))
      .sort((a, b) => a - b),
    active = new Set(ids);
  if (!ids.length || ids.length !== active.size || !active.has(MAT.AIR))
    throw Error('Reactive catalog requires unique IDs and air.');
  const registry = await createMaterialRegistry(data.propertiesCatalog),
    catalog = registry.toCatalog();
  catalog.materials.sort((a, b) => a.id - b.id);
  const phases: readonly number[] = [
    PHASE.SOLID,
    PHASE.POWDER,
    PHASE.LIQUID,
    PHASE.VISCOUS,
    PHASE.GAS,
    PHASE.FROZEN,
    PHASE.MOLTEN,
  ];
  for (const id of ids) {
    const material = registry.material(id),
      p = material.properties;
    if (material.name.length > 64 || !phases.includes(p.default_phase))
      throw Error('Unsupported reactive material name or phase.');
    for (const key of [
      'melts_into',
      'boils_into',
      'freezes_into',
      'condenses_into',
      'burns_into',
      'smoke_product',
    ]) {
      if (p[key] && !active.has(p[key]))
        throw Error('Reactive material targets must belong to the active catalog.');
    }
    if (id === MAT.AIR && (p.default_phase !== PHASE.GAS || p.oxidizer !== 1 || p.density === 0))
      throw Error('Reactive air must be a gaseous oxidizer with positive density.');
    if (
      (id === MAT.FIRE || id === MAT.SMOKE) &&
      (p.default_phase !== PHASE.GAS || p.fuel_energy || p.phase_energy || p.oxidizer)
    )
      throw Error('Fire and smoke require inert gas identities.');
    if (id === MAT.FIRE && !active.has(MAT.SMOKE))
      throw Error('Fire requires its smoke destination.');
    if (id === MAT.WATER && p.default_phase !== PHASE.LIQUID)
      throw Error('Reactive water requires the liquid phase.');
  }
  const preimage = JSON.stringify([
    REACTIVE_MATERIAL_RULES_3D,
    REACTIVE_MATERIAL_SCHEMA_3D,
    registry.hash,
    ids,
  ]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(preimage));
  const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  const cold = registry.coldTable();
  for (let id = 0; id < 256; id++)
    if (!active.has(id)) cold.fill(0, id * COLD_STRIDE, (id + 1) * COLD_STRIDE);
  const result: ReactiveMaterialRegistry3D = {
    hash,
    sourceCatalogHash: registry.hash,
    rulesVersion: REACTIVE_MATERIAL_RULES_3D,
    materialIds: Object.freeze(ids),
    has: (id) => active.has(id),
    material(id) {
      reactiveInteger3D(id, 0, 255);
      if (!active.has(id)) throw Error('Inactive reactive material.');
      return registry.material(id);
    },
    toCatalog: () => ({
      schemaVersion: 1,
      rulesVersion: REACTIVE_MATERIAL_RULES_3D,
      propertiesCatalog: structuredClone(catalog),
      materialIds: [...ids],
    }),
    coldTable: () => cold.slice(),
    async extend(materials) {
      const rows = copyCatalogData(materials);
      reactiveArray3D(rows, 256);
      const next = result.toCatalog();
      for (const row of rows as MaterialDefinition[]) {
        reactiveFields3D(row, ['id', 'name', 'default_thermal', 'color', 'properties']);
        next.materialIds.push(reactiveInteger3D(row.id, 0, 255));
        next.propertiesCatalog.materials.push(row);
      }
      return createReactiveMaterialRegistry3D(next);
    },
  };
  sources.set(result, { registry, cold, ids: active });
  return Object.freeze(result);
}
