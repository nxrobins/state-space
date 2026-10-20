/** Bounded portable data shared by session families. Legacy diagnostics are stable. */
export type PortableValue =
  | null
  | boolean
  | number
  | string
  | PortableValue[]
  | { [key: string]: PortableValue };
export const PORTABLE_VALUE_LIMITS = Object.freeze({
  nodes: 65536,
  depth: 32,
  characters: 1048576,
});

/** Validate record shape without evaluating getters. Domain wrappers own diagnostics. */
export function assertRecordFields(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  message: string,
): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    required.some((key) => !Object.hasOwn(value, key)) ||
    Reflect.ownKeys(value).some(
      (key) => typeof key !== 'string' || ![...required, ...optional].includes(key),
    ) ||
    Object.values(Object.getOwnPropertyDescriptors(value)).some(
      (d) => !('value' in d) || !d.enumerable,
    )
  ) {
    throw Error(message);
  }
}

/** Portable JSON values only: reject accessors, hidden fields, cycles and holes. */
export function copyPortableValue<T extends PortableValue>(value: T): T {
  let nodes = 0,
    characters = 0;
  const ancestors = new Set<object>();
  function copy(v: PortableValue, depth: number): PortableValue {
    if (++nodes > PORTABLE_VALUE_LIMITS.nodes || depth > PORTABLE_VALUE_LIMITS.depth)
      throw Error('Game state exceeds the bounded value budget.');
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) throw Error('Game state numbers must be finite.');
      return Object.is(v, -0) ? 0 : v;
    }
    if (typeof v === 'string') {
      characters += v.length;
      if (characters > PORTABLE_VALUE_LIMITS.characters)
        throw Error('Game state exceeds the character budget.');
      return v;
    }
    if (!v || typeof v !== 'object' || ancestors.has(v))
      throw Error('Game state must be acyclic portable data.');
    const array = Array.isArray(v);
    if (
      !array &&
      Object.getPrototypeOf(v) !== Object.prototype &&
      Object.getPrototypeOf(v) !== null
    )
      throw Error('Game state must contain plain objects.');
    ancestors.add(v);
    const descriptors = Object.getOwnPropertyDescriptors(v),
      keys = Reflect.ownKeys(v);
    if (
      keys.some((k) => typeof k !== 'string') ||
      Object.entries(descriptors).some(
        ([key, d]) => !(array && key === 'length') && (!('value' in d) || !d.enumerable),
      )
    )
      throw Error('Game state contains hidden fields or accessors.');
    let out: PortableValue;
    if (array) {
      if (v.length > PORTABLE_VALUE_LIMITS.nodes || keys.length !== v.length + 1)
        throw Error('Game arrays must be dense with no extra fields.');
      const values: PortableValue[] = [];
      for (let i = 0; i < v.length; i++) {
        if (!Object.hasOwn(descriptors, String(i))) throw Error('Sparse game array.');
        values.push(copy(descriptors[String(i)].value, depth + 1));
      }
      out = values;
    } else {
      const values: { [key: string]: PortableValue } = {};
      for (const key of (keys as string[]).sort()) {
        characters += key.length;
        if (characters > PORTABLE_VALUE_LIMITS.characters)
          throw Error('Game state exceeds the character budget.');
        Object.defineProperty(values, key, {
          value: copy(descriptors[key].value, depth + 1),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      out = values;
    }
    ancestors.delete(v);
    return out;
  }
  return copy(value, 0) as T;
}
