/** Owned exact data and a lossless Float64 wire format. No engine imports. */
import { createHash } from 'node:crypto';
import { types } from 'node:util';

export const EXACT_STATE_LIMITS = Object.freeze({
  nodes: 131072,
  depth: 64,
  characters: 2097152,
  encodedBytes: 16777216,
  differences: 64,
  pathCharacters: 512,
});
const digest = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const fail = (message) => {
  throw Error('Exact state: ' + message);
};
const bitsOf = (number) => {
  const bytes = Buffer.allocUnsafe(8);
  bytes.writeDoubleBE(number);
  return bytes.toString('hex');
};

/** Preserve record key order and array order. Do not canonicalize physical values. */
export function captureExact(input) {
  let nodes = 0,
    characters = 0;
  const ancestors = new Set();
  function visit(value, depth) {
    if (++nodes > EXACT_STATE_LIMITS.nodes || depth > EXACT_STATE_LIMITS.depth)
      fail('data exceeds the node/depth bound');
    if (value === null) return { value: null, wire: ['null'] };
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) fail('numbers must be finite');
      return { value, wire: ['number', bitsOf(value)] };
    }
    if (typeof value === 'boolean') return { value, wire: ['boolean', value] };
    if (typeof value === 'string') {
      characters += value.length;
      if (characters > EXACT_STATE_LIMITS.characters) fail('character bound exceeded');
      return { value, wire: ['string', value] };
    }
    if (typeof value !== 'object' || types.isProxy(value)) fail('plain data required');
    if (ancestors.has(value)) fail('cycles are not portable');
    const array = Array.isArray(value);
    if (array && Object.getPrototypeOf(value) !== Array.prototype) fail('plain arrays required');
    if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
      fail('plain records required');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== 'string')) fail('symbol fields are not portable');
    for (const key of keys) {
      if (array && key === 'length') continue;
      if (!Object.hasOwn(descriptors[key], 'value') || !descriptors[key].enumerable)
        fail('accessors and hidden fields are not portable');
    }
    ancestors.add(value);
    let out, wire;
    if (array) {
      const length = descriptors.length.value;
      if (length > EXACT_STATE_LIMITS.nodes || keys.length !== length + 1)
        fail('arrays must be dense without extra fields');
      out = [];
      const children = [];
      for (let i = 0; i < length; i++) {
        if (!Object.hasOwn(descriptors, String(i))) fail('array hole');
        const child = visit(descriptors[String(i)].value, depth + 1);
        out.push(child.value);
        children.push(child.wire);
      }
      wire = ['array', children];
    } else {
      out = {};
      const entries = [];
      for (const key of keys) {
        characters += key.length;
        if (characters > EXACT_STATE_LIMITS.characters) fail('character bound exceeded');
        const child = visit(descriptors[key].value, depth + 1);
        Object.defineProperty(out, key, {
          value: child.value,
          enumerable: true,
          writable: false,
          configurable: false,
        });
        entries.push([key, child.wire]);
      }
      wire = ['object', entries];
    }
    ancestors.delete(value);
    return { value: Object.freeze(out), wire };
  }
  const result = visit(input, 0),
    encoding = JSON.stringify(result.wire);
  const bytes = Buffer.byteLength(encoding, 'utf8');
  if (bytes > EXACT_STATE_LIMITS.encodedBytes) fail('encoded byte bound exceeded');
  return Object.freeze({
    schema: 'exact-state-1',
    value: result.value,
    encoding,
    sha256: digest(encoding),
    bytes,
    nodes,
  });
}

/** Decode only the canonical tagged encoding; JSON round trips otherwise erase -0. */
export function decodeExact(encoding, expectedHash) {
  if (
    typeof encoding !== 'string' ||
    Buffer.byteLength(encoding, 'utf8') > EXACT_STATE_LIMITS.encodedBytes
  )
    fail('invalid encoded data');
  if (
    expectedHash !== undefined &&
    (typeof expectedHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(expectedHash) ||
      digest(encoding) !== expectedHash)
  )
    fail('encoded hash mismatch');
  let nodes = 0;
  function read(wire, depth) {
    if (
      ++nodes > EXACT_STATE_LIMITS.nodes ||
      depth > EXACT_STATE_LIMITS.depth ||
      !Array.isArray(wire)
    )
      fail('invalid encoded tree');
    const [tag, payload] = wire;
    if (tag === 'null' && wire.length === 1) return null;
    if (wire.length !== 2) fail('invalid tag arity');
    if (tag === 'boolean' && typeof payload === 'boolean') return payload;
    if (tag === 'string' && typeof payload === 'string') return payload;
    if (tag === 'number' && typeof payload === 'string' && /^[a-f0-9]{16}$/.test(payload)) {
      const n = Buffer.from(payload, 'hex').readDoubleBE();
      if (!Number.isFinite(n)) fail('nonfinite encoded number');
      return n;
    }
    if (tag === 'array' && Array.isArray(payload)) return payload.map((v) => read(v, depth + 1));
    if (tag === 'object' && Array.isArray(payload)) {
      const out = {},
        seen = new Set();
      for (const entry of payload) {
        if (
          !Array.isArray(entry) ||
          entry.length !== 2 ||
          typeof entry[0] !== 'string' ||
          seen.has(entry[0])
        )
          fail('invalid/duplicate encoded key');
        seen.add(entry[0]);
        Object.defineProperty(out, entry[0], {
          value: read(entry[1], depth + 1),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return out;
    }
    fail('unknown or malformed tag');
  }
  const value = read(JSON.parse(encoding), 0),
    captured = captureExact(value);
  if (captured.encoding !== encoding) fail('noncanonical encoding');
  return captured.value;
}

const kind = (value) => (value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value);
const short = (value) => {
  if (typeof value === 'number')
    return {
      type: 'number',
      bits: bitsOf(value),
      display: Object.is(value, -0) ? '-0' : String(value),
    };
  if (typeof value === 'string')
    return { type: 'string', length: value.length, display: value.slice(0, 120) };
  if (value === null || typeof value === 'boolean')
    return { type: kind(value), display: String(value) };
  return {
    type: kind(value),
    length: Array.isArray(value) ? value.length : Object.keys(value).length,
  };
};
const pointer = (key) => String(key).replaceAll('~', '~0').replaceAll('/', '~1');

/** Always compare the owned values in full; hashes are evidence, not the equality test. */
export function compareExact(left, right, options = {}) {
  if (
    !options ||
    typeof options !== 'object' ||
    types.isProxy(options) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(options))
  )
    fail('plain comparison options required');
  if (
    Object.values(Object.getOwnPropertyDescriptors(options)).some(
      (d) => !Object.hasOwn(d, 'value') || !d.enumerable,
    )
  )
    fail('plain comparison options required');
  if (Reflect.ownKeys(options).some((key) => key !== 'maxDifferences'))
    fail('unknown comparison option');
  const max = options.maxDifferences ?? 20;
  if (!Number.isSafeInteger(max) || max < 1 || max > EXACT_STATE_LIMITS.differences)
    fail('invalid difference bound');
  const a = captureExact(left),
    b = captureExact(right),
    differences = [];
  let mismatchCount = 0;
  const add = (path, reason, x, y, pathTruncated) => {
    mismatchCount++;
    if (differences.length < max)
      differences.push(
        Object.freeze({
          path,
          pathTruncated,
          reason,
          left: Object.freeze(short(x)),
          right: Object.freeze(short(y)),
        }),
      );
  };
  const childPath = (path, key, truncated) => {
    const full = path + '/' + pointer(key);
    return [
      full.slice(0, EXACT_STATE_LIMITS.pathCharacters),
      truncated || full.length > EXACT_STATE_LIMITS.pathCharacters,
    ];
  };
  function visit(x, y, path, pathTruncated = false) {
    if (kind(x) !== kind(y)) {
      add(path, 'type', x, y, pathTruncated);
      return;
    }
    if (x === null || typeof x !== 'object') {
      if (!Object.is(x, y)) add(path, 'value', x, y, pathTruncated);
      return;
    }
    if (Array.isArray(x)) {
      if (x.length !== y.length) add(path, 'array-length', x, y, pathTruncated);
      for (let i = 0; i < Math.min(x.length, y.length); i++)
        visit(x[i], y[i], ...childPath(path, i, pathTruncated));
      return;
    }
    const xk = Object.keys(x),
      yk = Object.keys(y);
    if (xk.length !== yk.length || xk.some((k, i) => k !== yk[i]))
      add(path, 'record-keys-or-order', x, y, pathTruncated);
    for (const key of xk)
      if (Object.hasOwn(y, key)) visit(x[key], y[key], ...childPath(path, key, pathTruncated));
  }
  visit(a.value, b.value, '');
  return Object.freeze({
    equal: mismatchCount === 0,
    leftSha256: a.sha256,
    rightSha256: b.sha256,
    mismatchCount,
    differences: Object.freeze(differences),
    diagnosticsTruncated: mismatchCount > differences.length,
  });
}
