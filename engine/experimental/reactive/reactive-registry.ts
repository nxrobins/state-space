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
/** A plain record whose own enumerable values are all primitives: under a plain Object.prototype its
 * spread is the generic walk's copy. An own __proto__ key takes the generic walk, whose store treats it
 * as the prototype. Own accessors would be read twice and own symbol keys copied; engine records hold
 * neither.
 */
function flatRecord(x: unknown): x is Record<string, unknown> {
  if (
    typeof x !== 'object' ||
    x === null ||
    Array.isArray(x) ||
    Object.getPrototypeOf(x) !== Object.prototype
  )
    return false;
  for (const key in x) {
    if (key === '__proto__') return false;
    const y = (x as Record<string, unknown>)[key];
    if ((typeof y === 'object' && y !== null) || typeof y === 'function' || typeof y === 'symbol')
      return false;
  }
  return true;
}
// The realm checks below use the intrinsics this module loaded with, so replacing one later cannot
// hide a change from them. One replaced before this module loaded cannot be told from the realm's own.
const OWN_KEYS = Reflect.ownKeys,
  OWN_DESCRIPTOR = Reflect.getOwnPropertyDescriptor,
  GET_PROTOTYPE = Reflect.getPrototypeOf,
  OBJECT_KEYS = Object.keys,
  HAS_OWN = Object.hasOwn,
  OBJECT_PROTOTYPE = Object.prototype,
  PROTO = OWN_DESCRIPTOR(OBJECT_PROTOTYPE, '__proto__'),
  ARRAY = Array,
  ARRAY_PROTOTYPE = Array.prototype,
  ARRAY_SLICE = Array.prototype.slice,
  ARRAY_SPECIES = OWN_DESCRIPTOR(Array, Symbol.species)?.get;
/** A descriptor field, read only when the descriptor has it as its own: a descriptor is an ordinary
 * object, and Object.prototype may add any field. */
function field(d: PropertyDescriptor | undefined, name: keyof PropertyDescriptor) {
  return d && HAS_OWN(d, name) ? d[name] : undefined;
}
function ownField(target: object, key: PropertyKey, name: keyof PropertyDescriptor) {
  return field(OWN_DESCRIPTOR(target, key), name);
}
/** Object.prototype as the realm starts it: every own property is a non-enumerable writable data
 * property, apart from the non-enumerable __proto__ accessor this module loaded with. Then for-in sees
 * own keys only, and each [[Set]] of the generic walk defines an own data property exactly as spread
 * does. Anything else (an enumerable, accessor or read-only key) sends every record through the generic
 * walk.
 */
export function reactivePlainObjectPrototype3D(): boolean {
  const keys = OWN_KEYS(OBJECT_PROTOTYPE);
  for (let k = 0; k < keys.length; k++) {
    // One descriptor read per key: Object.prototype is an ordinary object, so it runs no caller code.
    const key = keys[k],
      d = OWN_DESCRIPTOR(OBJECT_PROTOTYPE, key);
    if (field(d, 'enumerable') !== false) return false;
    if (key === '__proto__') {
      if (field(d, 'get') !== PROTO?.get || field(d, 'set') !== PROTO?.set) return false;
    } else if (
      field(d, 'writable') !== true ||
      field(d, 'get') !== undefined ||
      field(d, 'set') !== undefined
    )
      return false;
  }
  return true;
}
/** Array.prototype.slice, Array.prototype.constructor and Array[Symbol.species] as this module loaded
 * them: slice() of a plain array then makes a fresh plain array of its own elements. A replaced one may
 * return any object, even its input.
 */
export function reactivePlainArraySlice3D(): boolean {
  return (
    ownField(ARRAY_PROTOTYPE, 'slice', 'value') === ARRAY_SLICE &&
    ownField(ARRAY_PROTOTYPE, 'constructor', 'value') === ARRAY &&
    ownField(ARRAY, Symbol.species, 'get') === ARRAY_SPECIES
  );
}
// The array, map, set and typed-array built-ins a world tick calls, as this module loaded them.
const ITERATOR_PROTOTYPE = GET_PROTOTYPE([][Symbol.iterator]()) as { next: unknown },
  TYPED_PROTOTYPE = GET_PROTOTYPE(Int32Array.prototype) as Record<string, unknown>,
  REALM = {
    iterator: ARRAY_PROTOTYPE[Symbol.iterator],
    next: ITERATOR_PROTOTYPE.next,
    slice: ARRAY_PROTOTYPE.slice,
    map: ARRAY_PROTOTYPE.map,
    filter: ARRAY_PROTOTYPE.filter,
    flatMap: ARRAY_PROTOTYPE.flatMap,
    concat: ARRAY_PROTOTYPE.concat,
    push: ARRAY_PROTOTYPE.push,
    sort: ARRAY_PROTOTYPE.sort,
    some: ARRAY_PROTOTYPE.some,
    every: ARRAY_PROTOTYPE.every,
    includes: ARRAY_PROTOTYPE.includes,
    fill: ARRAY_PROTOTYPE.fill,
    Map,
    Set,
    mapGet: Map.prototype.get,
    mapSet: Map.prototype.set,
    mapHas: Map.prototype.has,
    setAdd: Set.prototype.add,
    setHas: Set.prototype.has,
    setIterator: Set.prototype[Symbol.iterator],
    Int32Array,
    Uint32Array,
    Uint16Array,
    Uint8Array,
    typedSlice: TYPED_PROTOTYPE.slice,
    typedFill: TYPED_PROTOTYPE.fill,
    typedSet: TYPED_PROTOTYPE.set,
  };
/** Internal only: whether the array, map, set and typed-array built-ins a world tick calls are still
 * the ones this module loaded with, including the global bindings, constructors and species. A tick
 * that finds one replaced fails rather than trust it. Direct reads only: a replaced accessor answers
 * with what the tick would call. Built-ins replaced before this module loaded cannot be told apart.
 */
const species = (constructor: object) =>
  (constructor as { [Symbol.species]?: unknown })[Symbol.species];
export function reactiveRealmIntact3D(): boolean {
  return (
    globalThis.Array === ARRAY &&
    ARRAY_PROTOTYPE.constructor === ARRAY &&
    ARRAY[Symbol.species] === ARRAY &&
    ARRAY_PROTOTYPE[Symbol.iterator] === REALM.iterator &&
    ITERATOR_PROTOTYPE.next === REALM.next &&
    ARRAY_PROTOTYPE.slice === REALM.slice &&
    ARRAY_PROTOTYPE.map === REALM.map &&
    ARRAY_PROTOTYPE.filter === REALM.filter &&
    ARRAY_PROTOTYPE.flatMap === REALM.flatMap &&
    ARRAY_PROTOTYPE.concat === REALM.concat &&
    ARRAY_PROTOTYPE.push === REALM.push &&
    ARRAY_PROTOTYPE.sort === REALM.sort &&
    ARRAY_PROTOTYPE.some === REALM.some &&
    ARRAY_PROTOTYPE.every === REALM.every &&
    ARRAY_PROTOTYPE.includes === REALM.includes &&
    ARRAY_PROTOTYPE.fill === REALM.fill &&
    globalThis.Map === REALM.Map &&
    globalThis.Set === REALM.Set &&
    REALM.Map.prototype.get === REALM.mapGet &&
    REALM.Map.prototype.set === REALM.mapSet &&
    REALM.Map.prototype.has === REALM.mapHas &&
    REALM.Set.prototype.add === REALM.setAdd &&
    REALM.Set.prototype.has === REALM.setHas &&
    REALM.Set.prototype[Symbol.iterator] === REALM.setIterator &&
    globalThis.Int32Array === REALM.Int32Array &&
    globalThis.Uint32Array === REALM.Uint32Array &&
    globalThis.Uint16Array === REALM.Uint16Array &&
    globalThis.Uint8Array === REALM.Uint8Array &&
    REALM.Int32Array.prototype.constructor === REALM.Int32Array &&
    REALM.Uint32Array.prototype.constructor === REALM.Uint32Array &&
    REALM.Uint16Array.prototype.constructor === REALM.Uint16Array &&
    REALM.Uint8Array.prototype.constructor === REALM.Uint8Array &&
    species(REALM.Int32Array) === REALM.Int32Array &&
    species(REALM.Uint32Array) === REALM.Uint32Array &&
    species(REALM.Uint16Array) === REALM.Uint16Array &&
    species(REALM.Uint8Array) === REALM.Uint8Array &&
    TYPED_PROTOTYPE.slice === REALM.typedSlice &&
    TYPED_PROTOTYPE.fill === REALM.typedFill &&
    TYPED_PROTOTYPE.set === REALM.typedSet
  );
}
/** Internal only: fails a world tick whose realm no longer has the built-ins this module loaded with. */
export function assertReactiveRealm3D(): void {
  if (!reactiveRealmIntact3D())
    throw Error('Reactive world ticks need the array built-ins the SDK loaded with.');
}
/** Internal only: whether a copy holds exactly the data of an engine-built original. The copy is read
 * through its own data descriptors only, with the intrinsics this module loaded with, so no prototype
 * hook or own accessor can answer for it: every array element and record key must be an own data
 * property, prototypes must be the plain ones, and keys, lengths and Object.is-equal primitives must
 * match the original's. */
export function reactiveSameData3D(copy: unknown, original: unknown): boolean {
  if (
    typeof copy !== 'object' ||
    copy === null ||
    typeof original !== 'object' ||
    original === null
  )
    return Object.is(copy, original);
  const list = ARRAY.isArray(original);
  if (GET_PROTOTYPE(copy) !== (list ? ARRAY_PROTOTYPE : OBJECT_PROTOTYPE)) return false;
  const keys = list ? null : OBJECT_KEYS(original),
    count = list ? (original as unknown[]).length : keys!.length,
    own = OWN_KEYS(copy);
  // An array's own keys are its indices and 'length'; a record's are exactly the original's keys.
  if (own.length !== count + (list ? 1 : 0)) return false;
  for (let i = 0; i < count; i++) {
    const key = list ? '' + i : keys![i],
      d = OWN_DESCRIPTOR(copy, key);
    if (!d || !HAS_OWN(d, 'value') || HAS_OWN(d, 'get') || HAS_OWN(d, 'set')) return false;
    if (!reactiveSameData3D(d.value, (original as Record<string, unknown>)[key])) return false;
  }
  return true;
}
/** Internal only: copy of engine-built portable results (plain objects, arrays and primitives).
 * Field order is kept exactly as structuredClone keeps it, without its serializer cost.
 * Shared references are kept for arrays and nested objects; a flat record (primitive values only) inside an array
 * is copied per reference, and engine results never share one.
 * Functions and symbols are rejected as structuredClone rejects them; other exotic values fall back to structuredClone.
 * Not for caller-supplied data: that goes through the validating readers.
 */
export function cloneReactiveData3D<T>(value: T, plainObjectPrototype?: boolean): T {
  const seen = new Map<object, unknown>();
  // Each realm check runs at most once per copy, and only when a value needs it; a caller that has
  // just checked Object.prototype passes the answer.
  let records = plainObjectPrototype,
    slices: boolean | undefined;
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
        // A replaced slice could hand back v itself, and the caller would then hold engine state.
        let out = v;
        if ((slices ??= reactivePlainArraySlice3D())) out = v.slice();
        else {
          out = new Array<unknown>(v.length);
          for (let i = 0; i < v.length; i++) out[i] = v[i];
        }
        seen.set(v, out);
        return out;
      }
      const out = new Array<unknown>(v.length);
      seen.set(v, out);
      for (let i = 0; i < v.length; i++) {
        const x = v[i];
        out[i] =
          (records ??= reactivePlainObjectPrototype3D()) && flatRecord(x) ? { ...x } : copy(x);
      }
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
