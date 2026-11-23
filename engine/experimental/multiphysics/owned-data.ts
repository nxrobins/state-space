/** Copies of data this engine built itself, for the hand-offs inside one world tick. */
import {
  copyPortableValue,
  PORTABLE_VALUE_LIMITS,
  type PortableValue,
} from '../../portable-data.js';

const IRREGULAR = Symbol('irregular');
type Budget = { nodes: number; characters: number };

/** The portable copy of plain data, or IRREGULAR for anything the portable copy would reject
 * or that is not plain data at all. Counts nodes, depth and characters as that copy does. */
function plainCopy(value: unknown, depth: number, budget: Budget): unknown {
  if (++budget.nodes > PORTABLE_VALUE_LIMITS.nodes || depth > PORTABLE_VALUE_LIMITS.depth)
    return IRREGULAR;
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number')
    return Number.isFinite(value) ? (value === 0 ? 0 : value) : IRREGULAR;
  if (typeof value === 'string')
    return (budget.characters += value.length) > PORTABLE_VALUE_LIMITS.characters
      ? IRREGULAR
      : value;
  if (typeof value !== 'object') return IRREGULAR;
  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    for (let i = 0; i < value.length; i++) {
      // A hole reads as undefined, which is irregular.
      const entry = plainCopy(value[i], depth + 1, budget);
      if (entry === IRREGULAR) return IRREGULAR;
      copy.push(entry);
    }
    return copy;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return IRREGULAR;
  const keys = Object.keys(value);
  // The portable copy writes its keys in sorted order. Its own results already are.
  for (let i = 1; i < keys.length; i++)
    if (keys[i - 1] > keys[i]) {
      keys.sort();
      break;
    }
  const copy: Record<string, unknown> = {};
  for (const key of keys) {
    if ((budget.characters += key.length) > PORTABLE_VALUE_LIMITS.characters || key === '__proto__')
      return IRREGULAR;
    const entry = plainCopy((value as Record<string, unknown>)[key], depth + 1, budget);
    if (entry === IRREGULAR) return IRREGULAR;
    copy[key] = entry;
  }
  return copy;
}

/** `copyPortableValue` for a value this engine built itself: the portable copy, this engine's
 * readers and its own arithmetic made every record and array in it. Such data is plain, with
 * no accessors, hidden keys or extra array fields, so the copy's inspection of each property
 * cannot find anything and is not repeated. Everything else the copy does is: the same finite,
 * depth, node and character checks, negative zeros made zero, keys written in sorted order.
 * Whatever those checks would reject, and any value that is not plain data, is handed to
 * `copyPortableValue` itself, so each rejection and its message are the ones it gives.
 *
 * Never for a caller's input: only `copyPortableValue` may admit that. */
export function copyOwnedPortableValue<T extends PortableValue>(value: T): T {
  const copy = plainCopy(value, 0, { nodes: 0, characters: 0 });
  return copy === IRREGULAR ? copyPortableValue(value) : (copy as T);
}
