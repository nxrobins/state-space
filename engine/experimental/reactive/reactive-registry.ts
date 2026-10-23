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
// The realm checks and result copies below use the intrinsics this module loaded with, so replacing
// one later cannot hide a change from them or reach into a copy. One replaced before this module
// loaded cannot be told from the realm's own.
const OWN_DESCRIPTOR = Reflect.getOwnPropertyDescriptor,
  GET_PROTOTYPE = Reflect.getPrototypeOf,
  DEFINE = Reflect.defineProperty,
  OBJECT_KEYS = Object.keys,
  HAS_OWN = Object.hasOwn,
  IS_ARRAY = Array.isArray,
  OBJECT_PROTOTYPE = Object.prototype,
  ARRAY = Array,
  ARRAY_PROTOTYPE = Array.prototype,
  ARRAY_SLICE = Array.prototype.slice,
  ARRAY_SPECIES = OWN_DESCRIPTOR(Array, Symbol.species)?.get,
  STRUCTURED_CLONE = structuredClone;
/** A Map whose get and set are the ones this module loaded with, on a frozen prototype of its own. */
class SeenMap extends Map<object, unknown> {}
Object.freeze(
  Object.defineProperties(SeenMap.prototype, {
    get: { value: Map.prototype.get },
    set: { value: Map.prototype.set },
  }),
);
/** A descriptor field, read only when the descriptor has it as its own: a descriptor is an ordinary
 * object, and Object.prototype may add any field. */
function field(d: PropertyDescriptor | undefined, name: keyof PropertyDescriptor) {
  return d && HAS_OWN(d, name) ? d[name] : undefined;
}
function ownField(target: object, key: PropertyKey, name: keyof PropertyDescriptor) {
  return field(OWN_DESCRIPTOR(target, key), name);
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
// The array, map, set and typed-array built-ins the realm check compares, as this module loaded them.
const ITERATOR_PROTOTYPE = GET_PROTOTYPE([][Symbol.iterator]()) as { next: unknown },
  TYPED_PROTOTYPE = GET_PROTOTYPE(Int32Array.prototype) as Record<string, unknown>,
  REALM = {
    isArray: Array.isArray,
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
const species = (constructor: object) =>
  (constructor as { [Symbol.species]?: unknown })[Symbol.species];
/** Internal only: whether the built-ins below still read as the ones this module loaded with, in 49
 * comparisons: the global bindings, Array.isArray, and the listed array, map, set and typed-array
 * methods, constructors, species and iterators, the typed-array methods read through each of the four
 * typed-array prototypes. A tick that finds one replaced fails rather than trust it. The check reads
 * each built-in as the tick does, so it costs a few nanoseconds. It checks no other getter (typed-array
 * length, Set size) and no other built-in (WeakMap, Math), and it does not see an accessor that
 * answers it with the original, a replacement that a caller's hook makes and undoes while a tick call
 * runs, or a built-in replaced before this module loaded.
 */
export function reactiveRealmIntact3D(): boolean {
  return (
    globalThis.Array === ARRAY &&
    ARRAY.isArray === REALM.isArray &&
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
    // The tick calls these on instances, so a method added to one typed-array prototype shadows them.
    REALM.Int32Array.prototype.slice === REALM.typedSlice &&
    REALM.Uint32Array.prototype.slice === REALM.typedSlice &&
    REALM.Uint16Array.prototype.slice === REALM.typedSlice &&
    REALM.Uint8Array.prototype.slice === REALM.typedSlice &&
    REALM.Int32Array.prototype.fill === REALM.typedFill &&
    REALM.Uint32Array.prototype.fill === REALM.typedFill &&
    REALM.Uint16Array.prototype.fill === REALM.typedFill &&
    REALM.Uint8Array.prototype.fill === REALM.typedFill &&
    REALM.Int32Array.prototype.set === REALM.typedSet &&
    REALM.Uint32Array.prototype.set === REALM.typedSet &&
    REALM.Uint16Array.prototype.set === REALM.typedSet &&
    REALM.Uint8Array.prototype.set === REALM.typedSet
  );
}
/** Internal only: fails a world tick whose realm no longer has the built-ins this module loaded with. */
export function assertReactiveRealm3D(): void {
  if (!reactiveRealmIntact3D())
    throw Error('Reactive world ticks need the array built-ins the SDK loaded with.');
}
/** Whether for-in over a plain record sees only its own keys, as it does while Object.prototype has no
 * enumerable key. Enumerating reads no value, so it runs no caller code. */
function forInSeesOwnKeysOnly(): boolean {
  for (const key in {}) if (typeof key === 'string') return false;
  return true;
}
/** A plain record whose own enumerable values are all primitives: in an unmodified realm its spread is
 * the generic walk's copy. Its for-in must see own keys only (forInSeesOwnKeysOnly). An own __proto__
 * key takes the generic walk, whose store treats it as the prototype. Own accessors would be read twice
 * and own symbol keys copied; engine records hold neither.
 */
function flatRecord(x: unknown): x is Record<string, unknown> {
  if (typeof x !== 'object' || x === null || IS_ARRAY(x) || GET_PROTOTYPE(x) !== OBJECT_PROTOTYPE)
    return false;
  for (const key in x) {
    if (key === '__proto__') return false;
    const y = (x as Record<string, unknown>)[key];
    if ((typeof y === 'object' && y !== null) || typeof y === 'function' || typeof y === 'symbol')
      return false;
  }
  return true;
}
/** Internal only: copy of engine-built portable results (plain objects, arrays and primitives).
 * Field order is kept exactly as structuredClone keeps it, without its serializer cost.
 * Shared references are kept for arrays and nested objects; a flat record (primitive values only) inside an array
 * is copied per reference, and engine results never share one.
 * The copy calls only built-ins captured when this module loaded. Each array and record of it starts as
 * a slice() or spread of the original, or as elements defined one by one when slice, its constructor or
 * species was replaced, and nested copies are then stored over those own properties, so no prototype
 * setter sees the copy. A record with an own __proto__ key, which engine results never hold, is the
 * exception: its fields are assigned, as they always were. In an unmodified realm this is the copy
 * that assigning every field makes.
 * Functions and symbols are rejected as structuredClone rejects them; other exotic values fall back to structuredClone.
 * Not for caller-supplied data: that goes through the validating readers.
 */
export function cloneReactiveData3D<T>(value: T): T {
  const seen = new SeenMap();
  // Each realm check runs at most once per copy, and only when a value needs it.
  let records: boolean | undefined, slices: boolean | undefined;
  const copy = (v: unknown): unknown => {
    if (typeof v === 'function' || typeof v === 'symbol')
      throw Error('Reactive results hold portable data only.');
    if (typeof v !== 'object' || v === null) return v;
    const known = seen.get(v);
    if (known !== undefined) return known;
    if (IS_ARRAY(v)) {
      if (GET_PROTOTYPE(v) !== ARRAY_PROTOTYPE) return STRUCTURED_CLONE(v);
      let flat = true;
      for (let i = 0; i < v.length; i++)
        if (typeof v[i] === 'object' && v[i] !== null) {
          flat = false;
          break;
        }
      // A replaced slice could hand back v itself, and the caller would then hold engine state, so
      // the elements are then defined one by one on a fresh array. The check holds for the whole
      // copy, which runs no caller code.
      let out: unknown[];
      if ((slices ??= reactivePlainArraySlice3D())) out = v.slice();
      else {
        out = new ARRAY<unknown>(v.length);
        for (let i = 0; i < v.length; i++)
          // A descriptor without a prototype, so no field planted on Object.prototype joins it.
          DEFINE(out, i, {
            __proto__: null,
            value: v[i],
            writable: true,
            enumerable: true,
            configurable: true,
          } as PropertyDescriptor);
      }
      seen.set(v, out);
      if (flat) return out;
      for (let i = 0; i < v.length; i++) {
        const x = v[i];
        out[i] = (records ??= forInSeesOwnKeysOnly()) && flatRecord(x) ? { ...x } : copy(x);
      }
      return out;
    }
    if (GET_PROTOTYPE(v) !== OBJECT_PROTOTYPE) return STRUCTURED_CLONE(v);
    // The spread holds every primitive field already; an own __proto__ key instead has every field
    // stored, as it always was, so that it sets the copy's prototype.
    const proto = HAS_OWN(v, '__proto__'),
      out: Record<string, unknown> = proto ? {} : { ...v },
      keys = OBJECT_KEYS(v);
    seen.set(v, out);
    for (let k = 0; k < keys.length; k++) {
      const key = keys[k],
        x = (v as Record<string, unknown>)[key];
      if (proto || (typeof x !== 'string' && typeof x !== 'number' && typeof x !== 'boolean'))
        out[key] = copy(x);
    }
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
