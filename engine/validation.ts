/** Numeric validation shared by portable backends. */
export const MAX_CELLS = 0x3fffffff;
const typedArrayName = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint32Array.prototype), Symbol.toStringTag)!.get!;
const typedArrayPrototype = Object.getPrototypeOf(Uint32Array.prototype);
const arrayLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'length')!.get!;
const arrayBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer')!.get!;
const arrayOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteOffset')!.get!;

/** Validate caller-owned output storage before writing any coordinate. */
export function stateCopyTargets(target: object, count: number): Uint32Array[] {
  if (!target || typeof target !== 'object') throw new Error('State copy requires output storage.');
  const values = ['grid', 'energyQ', 'structure'].map(key => Object.getOwnPropertyDescriptor(target, key)?.value);
  for (const value of values) {
    if (!(value instanceof Uint32Array) || typedArrayName.call(value) !== 'Uint32Array' || arrayLength.call(value) !== count) {
      throw new Error('State copy requires three Uint32Arrays of the field cell count.');
    }
  }
  for (let i = 0; i < values.length; i++) for (let j = 0; j < i; j++) {
    if (arrayBuffer.call(values[i]) === arrayBuffer.call(values[j]) &&
        Math.abs(arrayOffset.call(values[i]) - arrayOffset.call(values[j])) < count * 4) {
      throw new Error('State copy coordinates must not overlap.');
    }
  }
  return values;
}

export function checkedInteger(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer in [${minimum}, ${maximum}].`);
  }
  return value;
}

export function validateDimensions(width: number, height: number): number {
  checkedInteger(width, 1, MAX_CELLS, 'dimensions.width');
  checkedInteger(height, 1, MAX_CELLS, 'dimensions.height');
  return checkedInteger(width * height, 1, MAX_CELLS, 'cell count');
}

export function validatePackedCells(values: ArrayLike<number>, length: number): Uint32Array {
  if (!values || values.length !== length) {
    throw new Error(`Engine snapshot cell length mismatch: expected ${length}, received ${values?.length}.`);
  }
  // Uint32Array storage already guarantees the numeric range. The intrinsic
  // typed-array constructor copies its storage without coercion or caller-owned
  // iterators; keep a copy so validated state never aliases the caller.
  if (values instanceof Uint32Array && typedArrayName.call(values) === 'Uint32Array') {
    const copy = new Uint32Array(values);
    if (copy.length !== length) throw new Error('Engine snapshot cell length mismatch.');
    return copy;
  }
  // Validate before constructing a typed array; construction silently wraps or truncates.
  for (let index = 0; index < length; index += 1) {
    const value = values[index];
    if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
      checkedInteger(value, 0, 0xffffffff, `packedCells[${index}]`);
    }
  }
  return Uint32Array.from(values);
}

