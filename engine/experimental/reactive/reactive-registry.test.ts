/** Portable data validation only; no engine step or browser execution. */
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { DEFAULT_REGISTRY } from '../../registry.js';
import { COLD_STRIDE, PHASE, MAT } from '../../generated/materials.js';
import {
  cloneReactiveData3D,
  createReactiveMaterialRegistry3D as create,
  defaultReactiveMaterialCatalog3D as catalog,
  REACTIVE_MATERIAL_RULES_3D,
  reactiveArray3D,
  type ReactiveMaterialRegistry3D,
} from './reactive-registry.js';
import { createReactiveMaterialBlock3D } from '../reactive-materials.js';
let registry: ReactiveMaterialRegistry3D;
beforeAll(async () => {
  registry = await create();
});
function custom(id = 200) {
  const source = DEFAULT_REGISTRY.material(MAT.WOOD);
  return { ...source, properties: { ...source.properties }, id, name: 'resin' };
}
const material = (c: ReturnType<typeof catalog>, id: number) =>
  c.propertiesCatalog.materials.find((m) => m.id === id)!;

describe('versioned reactive material catalog', () => {
  test('default profile contains every physical builtin and excludes the player marker', () => {
    expect(registry.materialIds).toHaveLength(17);
    expect(registry.has(MAT.PLAYER)).toBe(false);
    for (const id of [
      MAT.WOOD,
      MAT.FIRE,
      MAT.SMOKE,
      MAT.ASH,
      MAT.OIL,
      MAT.OIL_VAPOR,
      MAT.MOLTEN_METAL,
    ])
      expect(registry.has(id)).toBe(true);
    expect(() => registry.material(MAT.PLAYER)).toThrow();
    expect(registry.rulesVersion).toBe(REACTIVE_MATERIAL_RULES_3D);
  });
  test('domain hash is separate while builtin property identity stays unchanged', () => {
    expect(registry.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(registry.sourceCatalogHash).toBe(DEFAULT_REGISTRY.hash);
    expect(registry.hash).not.toBe(DEFAULT_REGISTRY.hash);
  });
  test('reordered material records and active IDs have canonical identity', async () => {
    const c = catalog();
    c.materialIds.reverse();
    c.propertiesCatalog.materials.reverse();
    const r = await create(c);
    expect(r.hash).toBe(registry.hash);
    expect(r.toCatalog()).toEqual(registry.toCatalog());
  });
  test('property changes change both property and profile identity', async () => {
    const c = catalog();
    material(c, MAT.WOOD).properties.conductivity++;
    const r = await create(c);
    expect(r.hash).not.toBe(registry.hash);
    expect(r.sourceCatalogHash).not.toBe(registry.sourceCatalogHash);
  });
  test('active material selection changes only profile identity', async () => {
    const c = catalog();
    c.materialIds = [MAT.AIR];
    const r = await create(c);
    expect(r.hash).not.toBe(registry.hash);
    expect(r.sourceCatalogHash).toBe(registry.sourceCatalogHash);
  });
  test('public records and ID lists are immutable; catalog and table reads are isolated', () => {
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.materialIds)).toBe(true);
    expect(Object.isFrozen(registry.material(MAT.WOOD).properties)).toBe(true);
    const c = registry.toCatalog(),
      cold = registry.coldTable();
    c.materialIds.length = 0;
    material(c, MAT.WOOD).properties.density = 0;
    cold.fill(0);
    expect(registry.materialIds).toHaveLength(17);
    expect(registry.material(MAT.WOOD).properties.density).toBeGreaterThan(0);
    expect(registry.coldTable().some((v) => v > 0)).toBe(true);
    expect([
      ...registry.coldTable().slice(MAT.PLAYER * COLD_STRIDE, (MAT.PLAYER + 1) * COLD_STRIDE),
    ]).toEqual(new Array(COLD_STRIDE).fill(0));
  });
  test('custom fuel can be added at the highest ID without mutating the original', async () => {
    const r = await registry.extend([custom(255)]);
    expect(r.has(255)).toBe(true);
    expect(registry.has(255)).toBe(false);
    expect(r.material(255).properties.fuel_energy).toBe(80);
    expect((await create(JSON.parse(JSON.stringify(r.toCatalog())))).hash).toBe(r.hash);
  });
  test('constructor owns all data before asynchronous hashing begins', async () => {
    const c = catalog(),
      pending = create(c);
    c.materialIds.length = 0;
    material(c, MAT.WOOD).properties.fuel_energy = 0;
    expect((await pending).hash).toBe(registry.hash);
  });
  test('extension owns definitions before asynchronous hashing begins', async () => {
    const row = custom(),
      rows = [row],
      pending = registry.extend(rows);
    row.name = 'mutated';
    row.properties.fuel_energy = 0;
    rows.length = 0;
    const r = await pending;
    expect(r.material(200).name).toBe('resin');
    expect(r.material(200).properties.fuel_energy).toBe(80);
  });
  test('forged registry objects cannot create material blocks', () => {
    expect(() =>
      createReactiveMaterialBlock3D({ ...registry }, { width: 1, height: 1, depth: 1 }),
    ).toThrow(/validated/);
  });
  test('wrong wrapper rules, schema and unexpected fields are rejected', async () => {
    for (const patch of [
      { rulesVersion: '3d-m5' },
      { schemaVersion: 2 },
      { extra: 1 },
      { materialIds: null },
    ])
      await expect(create({ ...catalog(), ...patch })).rejects.toThrow();
  });
  test('duplicate or absent active IDs and missing air are rejected', async () => {
    for (const ids of [[0, 0], [], [MAT.STONE], [0, 256], [0, 1.5], [0, 200]])
      await expect(create({ ...catalog(), materialIds: ids })).rejects.toThrow();
  });
  test('phase and combustion destinations must all be active', async () => {
    for (const absent of [MAT.ICE, MAT.STEAM, MAT.LAVA, MAT.ASH, MAT.FIRE, MAT.SMOKE]) {
      const c = catalog();
      c.materialIds = c.materialIds.filter((id) => id !== absent);
      await expect(create(c)).rejects.toThrow();
    }
  });
  test('fire also needs smoke when no fuel is active', async () => {
    const c = catalog();
    c.materialIds = [MAT.AIR, MAT.FIRE];
    await expect(create(c)).rejects.toThrow(/smoke/);
  });
  test('unsupported transitional phase cannot enter the profile', async () => {
    const c = catalog();
    material(c, MAT.ASH).properties.default_phase = 5;
    await expect(create(c)).rejects.toThrow(/phase/);
  });
  test('air, fire, smoke and water retain required role identities', async () => {
    for (const [id, key, value] of [
      [MAT.AIR, 'oxidizer', 0],
      [MAT.AIR, 'density', 0],
      [MAT.AIR, 'default_phase', PHASE.SOLID],
      [MAT.FIRE, 'default_phase', PHASE.POWDER],
      [MAT.SMOKE, 'default_phase', PHASE.LIQUID],
      [MAT.WATER, 'default_phase', PHASE.GAS],
    ] as const) {
      const c = catalog();
      material(c, id).properties[key] = value;
      await expect(create(c)).rejects.toThrow();
    }
  });
  test('incomplete fuel and nonconservative phase definitions are rejected', async () => {
    for (const [id, key, value] of [
      [MAT.WOOD, 'flash_point', 0],
      [MAT.WOOD, 'burns_into', 0],
      [MAT.WOOD, 'smoke_product', 0],
      [MAT.STEAM, 'fuel_energy', 1],
      [MAT.WATER, 'latent_heat_boil', 0],
    ] as const) {
      const c = catalog();
      material(c, id).properties[key] = value;
      await expect(create(c)).rejects.toThrow();
    }
  });
  test('duplicate custom names and IDs are rejected', async () => {
    await expect(registry.extend([custom(), custom()])).rejects.toThrow();
    await expect(registry.extend([{ ...custom(), name: 'wood' }])).rejects.toThrow();
    await expect(registry.extend([custom(MAT.WOOD)])).rejects.toThrow();
  });
  test('undefined and extra material properties are rejected', async () => {
    const row = custom();
    row.properties.extra = 0;
    await expect(registry.extend([row])).rejects.toThrow();
    const c = catalog();
    (c as unknown as Record<string, unknown>).extra = undefined;
    await expect(create(c)).rejects.toThrow();
  });
  test('accessors are rejected without invocation at every data level', async () => {
    let calls = 0;
    for (const target of ['root', 'record', 'property', 'array']) {
      const c = catalog();
      const object =
        target === 'root'
          ? c
          : target === 'record'
            ? material(c, MAT.WOOD)
            : target === 'property'
              ? material(c, MAT.WOOD).properties
              : c.materialIds;
      const key =
        target === 'root'
          ? 'rulesVersion'
          : target === 'record'
            ? 'name'
            : target === 'property'
              ? 'density'
              : '0';
      Object.defineProperty(object, key, {
        get() {
          calls++;
          throw Error('invoked');
        },
        enumerable: true,
      });
      await expect(create(c)).rejects.toThrow();
    }
    expect(calls).toBe(0);
  });
  test('sparse, decorated and nonstandard arrays are rejected', async () => {
    const sparse = new Array(1),
      decorated = [0],
      nonstandard = [0];
    Object.assign(decorated, { extra: 1 });
    Object.setPrototypeOf(nonstandard, null);
    for (const ids of [sparse, decorated, nonstandard])
      await expect(create({ ...catalog(), materialIds: ids })).rejects.toThrow();
  });
  test('symbols, hidden fields and nonplain objects are rejected', async () => {
    const symbol = catalog(),
      hidden = catalog();
    Object.assign(symbol, { [Symbol('x')]: 1 });
    Object.defineProperty(hidden, 'x', { value: 1 });
    for (const c of [symbol, hidden, new Date(), Object.create(catalog())])
      await expect(create(c)).rejects.toThrow();
  });
  test('cyclic, excessively deep, oversized and fractional data are rejected', async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    let deep: unknown = 0;
    for (let i = 0; i < 14; i++) deep = { child: deep };
    for (const raw of [
      cyclic,
      deep,
      new Array(65537),
      { name: 'x'.repeat(257) },
      { x: NaN },
      { x: 0.5 },
    ])
      await expect(create(raw)).rejects.toThrow();
  });
  test('null-prototype portable records produce the same identity', async () => {
    expect((await create(Object.assign(Object.create(null), catalog()))).hash).toBe(registry.hash);
  });
});

/** The per-index descriptor reader that reactiveArray3D replaced, kept as the oracle. */
function oracleArray(raw: unknown, maximum: number): unknown[] {
  if (
    !Array.isArray(raw) ||
    Object.getPrototypeOf(raw) !== Array.prototype ||
    raw.length > maximum ||
    Reflect.ownKeys(raw).length !== raw.length + 1
  )
    throw Error('Invalid reactive array.');
  for (let i = 0; i < raw.length; i++) {
    const d = Object.getOwnPropertyDescriptor(raw, i);
    if (!d || !('value' in d) || !d.enumerable) throw Error('Reactive arrays require dense data.');
  }
  return raw;
}
describe('reactive array reads', () => {
  let calls = 0;
  const trace: unknown[] = [];
  const counted = (enumerable = true) => ({
    get() {
      calls++;
      return 0;
    },
    enumerable,
    configurable: true,
  });
  const define = (a: unknown[], key: PropertyKey, d: PropertyDescriptor) => (
    Object.defineProperty(a, key, d),
    a
  );
  const range = (n: number) => Array.from({ length: n }, (_, i) => i);
  const holed = (n: number, i: number) => {
    const a: unknown[] = range(n);
    delete a[i];
    return a;
  };
  const traced = (target: unknown[], handler: ProxyHandler<unknown[]> = {}) =>
    new Proxy(target, {
      getPrototypeOf: (t) => (trace.push('proto'), Reflect.getPrototypeOf(t)),
      get: (t, k, r) => (trace.push(['get', k]), Reflect.get(t, k, r)),
      ownKeys: (t) => (trace.push('keys'), Reflect.ownKeys(t)),
      getOwnPropertyDescriptor: (t, k) => (
        trace.push(['own', k]),
        Reflect.getOwnPropertyDescriptor(t, k)
      ),
      ...handler,
    });
  const run = (read: typeof oracleArray, [raw, maximum]: [unknown, number]) => {
    calls = 0;
    trace.length = 0;
    let result: string;
    try {
      result = read(raw, maximum) === raw ? 'same' : 'other';
    } catch (e) {
      result = (e as Error).message;
    }
    return { result, calls, trace: [...trace] };
  };
  class Sub extends Array<number> {}
  const cases: Record<string, () => [unknown, number]> = {
    dense: () => [[1, 2, 3], 3],
    empty: () => [[], 0],
    tooLong: () => [[1, 2, 3], 2],
    holeStart: () => [[, 1, 2], 3],
    holeMiddle: () => [[0, , 2], 3],
    holeEnd: () => [[0, 1, ,], 3],
    getter: () => [define([0, 1, 2], 1, counted()), 3],
    hiddenGetter: () => [define([0, 1, 2], 1, counted(false)), 3],
    setterOnly: () => [define([0, 1, 2], 1, { set() {}, enumerable: true }), 3],
    emptyAccessor: () => [define([0, 1, 2], 1, { get: undefined, enumerable: true }), 3],
    hiddenData: () => [define([0, 1, 2], 1, { value: 1, enumerable: false }), 3],
    oddValues: () => [[undefined, null, -0, NaN], 4],
    extra: () => [Object.assign([0], { extra: 1 }), 1],
    hiddenExtra: () => [define([0], 'extra', { value: 1 }), 1],
    hiddenExtraWithHole: () => [define([0, , 2], 'extra', { value: 1 }), 3],
    symbol: () => [Object.assign([0], { [Symbol('x')]: 1 }), 1],
    maxIndexKey: () => [Object.assign([0, 1], { 4294967295: 1 }), 2],
    maxIndexKeyWithHole: () => [Object.assign([0, , 2], { 4294967295: 1 }), 3],
    nullPrototype: () => [Object.setPrototypeOf([0], null), 1],
    objectPrototype: () => [Object.setPrototypeOf([0], Object.prototype), 1],
    subclass: () => [Sub.from([0, 1]), 2],
    typed: () => [new Uint32Array(2), 2],
    arrayLike: () => [{ 0: 1, length: 1 }, 1],
    frozen: () => [Object.freeze([0, 1]), 2],
    sealed: () => [Object.seal([0, 1]), 2],
    nonExtensible: () => [Object.preventExtensions([0, 1]), 2],
    nonArray: () => [{}, 1],
    nullValue: () => [null, 1],
    long: () => [range(40000), 65536],
    longHole: () => [holed(40000, 100), 65536],
    longHoleWithExtraKey: () => [define(holed(40000, 100), 'extra', { value: 1 }), 65536],
    longLastHoleWithExtraKey: () => [define(holed(40000, 39999), 'extra', { value: 1 }), 65536],
    longLateGetter: () => [define(range(40000), 35000, counted()), 65536],
    proxy: () => [new Proxy([0, 1, 2], {}), 3],
    tracedProxy: () => [traced([0, 1, 2]), 3],
    tracedProxyHole: () => [traced([0, , 2]), 3],
    tracedLongProxy: () => [traced(range(33000)), 65536],
    lyingKeys: () => [
      traced([0, 1], { ownKeys: () => (trace.push('keys'), ['b', 'a', 'length']) }),
      2,
    ],
    lyingDescriptor: () => [
      traced([0, , 2], {
        ownKeys: () => ['0', '1', '2', 'length'],
        getOwnPropertyDescriptor: (t, k) =>
          k === '1'
            ? { value: 1, writable: true, enumerable: true, configurable: true }
            : Reflect.getOwnPropertyDescriptor(t, k),
      }),
      3,
    ],
    growingLength: () => {
      let reads = 0;
      return [
        traced([0, 1], {
          get: (t, k, r) => (k === 'length' ? (++reads > 2 ? 4 : 2) : Reflect.get(t, k, r)),
        }),
        4,
      ];
    },
    throwingPrototype: () => [
      traced([0], {
        getPrototypeOf: () => {
          throw Error('trap');
        },
      }),
      1,
    ],
    revoked: () => {
      const { proxy, revoke } = Proxy.revocable([0], {});
      revoke();
      return [proxy, 1];
    },
  };
  test('match the per-index descriptor reader on adversarial arrays', () => {
    // Traces are compared as one text, a trap and its key per line: toEqual would walk each of the
    // long proxy's 33000 entries.
    const text = ({ trace, ...rest }: ReturnType<typeof run>) => ({
      ...rest,
      trace: trace
        .map((entry) => (Array.isArray(entry) ? entry.map(String).join(' ') : String(entry)))
        .join('\n'),
    });
    for (const [name, make] of Object.entries(cases)) {
      const expected = run(oracleArray, make());
      expect({ name, ...text(run(reactiveArray3D, make())) }).toEqual({ name, ...text(expected) });
      expect(expected.calls).toBe(0);
    }
  });
  test('match it under an Array.prototype index accessor', () => {
    const holey = [0, , 2],
      balanced = define([0, , 2], 'extra', { value: 1 }),
      dense = [0, 1, 2];
    Object.defineProperty(Array.prototype, '1', counted());
    let results;
    try {
      results = {
        holey: [run(oracleArray, [holey, 3]), run(reactiveArray3D, [holey, 3])],
        balanced: [run(oracleArray, [balanced, 3]), run(reactiveArray3D, [balanced, 3])],
        dense: [run(oracleArray, [dense, 3]), run(reactiveArray3D, [dense, 3])],
      };
    } finally {
      delete (Array.prototype as unknown as Record<string, unknown>)['1'];
    }
    const outcome = (result: string) => Array(2).fill({ result, calls: 0, trace: [] });
    expect(results).toEqual({
      holey: outcome('Invalid reactive array.'),
      balanced: outcome('Reactive arrays require dense data.'),
      dense: outcome('same'),
    });
  });
  test('keep no state that a transient realm wrapper could leave behind', async () => {
    // A guard against caching keys between calls. A fresh module instance, so its first block-sized
    // read happens while the wrapper is in place.
    vi.resetModules();
    const fresh = (await import('./reactive-registry.js')).reactiveArray3D;
    const ownKeys = Reflect.ownKeys,
      n = 32768;
    // While wrapped, every key listing of a typed array reads as index 0.
    Reflect.ownKeys = ((target: object) =>
      ArrayBuffer.isView(target)
        ? ownKeys(target).map(() => '0')
        : ownKeys(target)) as typeof Reflect.ownKeys;
    try {
      fresh(range(n), n);
    } finally {
      Reflect.ownKeys = ownKeys;
    }
    const balanced = define(holed(n, 7), 'extra', { value: 1 }),
      accessor = define(range(n), 9, counted());
    expect([balanced, accessor].map((a) => run(fresh, [a, n]))).toEqual(
      [balanced, accessor].map((a) => run(oracleArray, [a, n])),
    );
  });
});

/** The generic walk every record took before flat records were spread; kept as the copy oracle. */
function oracleClone<T>(value: T): T {
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
/** Key order and the values JSON would lose (-0, NaN, undefined, bigint) in one comparable text. */
const portableText = (value: unknown) =>
  JSON.stringify(value, (_key, v: unknown) =>
    Object.is(v, -0)
      ? '<-0>'
      : typeof v === 'number' && Number.isNaN(v)
        ? '<NaN>'
        : v === undefined
          ? '<undefined>'
          : typeof v === 'bigint'
            ? `<${v}n>`
            : v,
  );
const motionLike = () => ({
  status: 'complete',
  overflowAtPass: null,
  passes: Array.from({ length: 3 }, (_, index) => ({
    index,
    kind: 'movement',
    segments: Array.from({ length: 40 }, (_, i) => ({
      origin: i,
      from: i,
      to: i + 1,
      mode: i % 2 ? 'linear' : 'relocation',
      component: i % 3 ? null : i,
    })),
    changes: Array.from({ length: 40 }, (_, i) => ({
      index: i,
      packed: i * 257,
      energyQ: i % 5 ? -i : -0,
      structure: 0,
    })),
  })),
  holds: [{ id: 'h', expiresAtTick: 3, cells: [1, 2] }],
  retired: [{ id: 'h', cells: [3] }],
});

describe('reactive result copies', () => {
  test('flat records keep the generic walk field order and exact values', () => {
    const records = [
      { 2: 'two', b: -0, a: NaN, c: undefined, 1: null, big: BigInt(5), t: true, s: 'x' },
      { z: 1, y: Infinity, x: -Infinity },
      {},
    ];
    const data = { records, nested: [[{ b: 1, a: 2 }]], motion: motionLike() };
    const out = cloneReactiveData3D(data);
    expect(portableText(out)).toBe(portableText(oracleClone(data)));
    expect(Object.keys(out.records[0])).toEqual(['1', '2', 'b', 'a', 'c', 'big', 't', 's']);
    expect(Object.is(out.records[0].b, -0)).toBe(true);
    expect('c' in out.records[0]).toBe(true);
    expect(out).toStrictEqual(oracleClone(data));
  });
  test('function and symbol values are rejected as before', () => {
    for (const bad of [[{ a: 1, f: () => 0 }], [{ s: Symbol('s') }], [{ a: 1 }, () => 0]]) {
      expect(() => oracleClone(bad)).toThrow('Reactive results hold portable data only.');
      expect(() => cloneReactiveData3D(bad)).toThrow('Reactive results hold portable data only.');
    }
    // A primitive-only array is sliced without inspection, before and after.
    const sliced = [{ a: [Symbol.for('s')] }];
    expect(cloneReactiveData3D(sliced)[0].a[0]).toBe(oracleClone(sliced)[0].a[0]);
  });
  test('arrays and nested objects stay shared; flat records in arrays are copied per reference', () => {
    const list = [1, 2],
      hold = { id: 'h', cells: [4] },
      point = { x: 1 },
      record = { from: 1, to: 2 };
    const out = cloneReactiveData3D({
      a: list,
      b: list,
      holds: [hold, hold],
      u: point,
      v: point,
      moves: [record, record],
    });
    expect(out.a).toBe(out.b);
    expect(out.a).not.toBe(list);
    expect(out.holds[0]).toBe(out.holds[1]);
    expect(out.holds[0].cells).not.toBe(hold.cells);
    expect(out.u).toBe(out.v);
    expect(out.u).not.toBe(point);
    expect(out.moves[0]).not.toBe(out.moves[1]);
    expect(out.moves[0]).toEqual(record);
  });
  test('record copies and the source are independent', () => {
    const source = motionLike(),
      text = portableText(source),
      out = cloneReactiveData3D(source);
    out.passes[0].segments[0].origin = 99;
    out.passes[1].changes[2].packed = -1;
    out.holds[0].cells.push(9);
    expect(portableText(source)).toBe(text);
    source.passes[2].segments[3].to = 77;
    source.retired[0].id = 'changed';
    expect(out.passes[2].segments[3].to).toBe(4);
    expect(out.retired[0].id).toBe('h');
    expect(out.passes[0].segments[0]).not.toBe(source.passes[0].segments[0]);
  });
  test('typed arrays, maps and nonplain records still fall back to structuredClone', () => {
    class Point {
      x = 1;
    }
    const typed = new Int32Array([1, -2]),
      map = new Map([[1, { a: 1 }]]),
      data = [typed, map, Object.assign(Object.create(null), { a: 1 }), new Point(), { t: typed }];
    const out = cloneReactiveData3D(data);
    expect(out).toStrictEqual(oracleClone(data));
    expect(out[0]).toBeInstanceOf(Int32Array);
    expect(out[0]).not.toBe(typed);
    expect(out[1]).toBeInstanceOf(Map);
    expect(Object.getPrototypeOf(out[2])).toBe(Object.prototype);
    expect(out[3]).not.toBeInstanceOf(Point);
    expect((out[4] as { t: Int32Array }).t).not.toBe(typed);
  });
  test('a copy calls no built-in replaced after load and no prototype setter, on either path', () => {
    const data = () => ({
      moves: [{ from: 1, to: 2 }],
      nested: { list: [{ a: 1, b: [2, 3] }], typed: new Uint8Array([4, 5]) },
      flat: [6, 7],
      // An array on another prototype takes the structured clone.
      odd: Object.setPrototypeOf([8, 9], Object.create(Array.prototype)) as number[],
      // A hole where a hook swallowed a store, and a record with an own __proto__ key.
      holey: [{ c: 1 }, , { d: 2 }],
      own: JSON.parse('{"e":1,"__proto__":{"f":2},"g":[3]}') as Record<string, unknown>,
    });
    const clean = cloneReactiveData3D(data());
    expect(Object.hasOwn(clean.holey, 1)).toBe(true);
    let calls = 0;
    const g = globalThis as unknown as Record<string, unknown>;
    /** Wraps target[key] with a function that counts its calls; returns the undo. */
    const wrap = (target: object, key: PropertyKey) => {
      const bag = target as Record<PropertyKey, unknown>,
        original = bag[key] as (...rest: unknown[]) => unknown;
      bag[key] = function (this: unknown, ...rest: unknown[]) {
        calls++;
        return original.apply(this, rest);
      };
      return () => void (bag[key] = original);
    };
    const getOwn = Reflect.getOwnPropertyDescriptor;
    /** A setter that counts what reaches it, on target[key]; returns the undo. */
    const setter = (target: object, key: string) => {
      const before = getOwn(target, key);
      Object.defineProperty(target, key, {
        configurable: true,
        get: before?.get,
        set(this: object, value: unknown) {
          calls++;
          return before?.set?.call(this, value);
        },
      });
      return () =>
        void (before
          ? Object.defineProperty(target, key, before)
          : delete (target as Record<string, unknown>)[key]);
    };
    // Captured, since the global Array is replaced below; the handlers have no prototype, so the 'get'
    // planted on Object.prototype does not become their trap.
    const iterator = Object.getPrototypeOf([][Symbol.iterator]()) as object,
      RealSymbol = Symbol,
      RealArray = Array,
      ArrayPrototype = Array.prototype,
      slice = Array.prototype.slice;
    const replaceAll = (alsoSlice: boolean) => {
      const undo = [
        wrap(Array, 'isArray'),
        wrap(Object, 'getPrototypeOf'),
        wrap(Reflect, 'getPrototypeOf'),
        wrap(Reflect, 'getOwnPropertyDescriptor'),
        wrap(Reflect, 'defineProperty'),
        wrap(Reflect, 'apply'),
        wrap(Object, 'keys'),
        wrap(Object, 'hasOwn'),
        wrap(Map.prototype, 'get'),
        wrap(Map.prototype, 'set'),
        wrap(iterator, 'next'),
        wrap(g, 'structuredClone'),
        setter(Object.prototype, '__proto__'),
        setter(Object.prototype, 'e'),
        setter(Object.prototype, 'g'),
      ];
      g.Symbol = new Proxy(RealSymbol, {
        __proto__: null,
        get(target, key, receiver) {
          calls++;
          return Reflect.get(target, key, receiver);
        },
      } as ProxyHandler<SymbolConstructor>);
      g.Array = new Proxy(RealArray, {
        __proto__: null,
        construct(target, rest, newTarget) {
          calls++;
          return Reflect.construct(target, rest, newTarget);
        },
      } as ProxyHandler<ArrayConstructor>);
      undo.push(() => {
        g.Array = RealArray;
        g.Symbol = RealSymbol;
      });
      if (alsoSlice) {
        // An accessor sends the copy down the element-by-element path. It answers with the original
        // only once, so a copy that read it and then called it would call a counted stand-in; a planted
        // 'get' would break a descriptor that inherits from Object.prototype.
        let reads = 0;
        Object.defineProperty(ArrayPrototype, 'slice', {
          configurable: true,
          get() {
            calls++;
            return ++reads === 1
              ? slice
              : function (this: unknown) {
                  calls++;
                  return this;
                };
          },
        });
        Object.defineProperty(Object.prototype, 'get', {
          value: () => undefined,
          writable: true,
          configurable: true,
        });
        undo.push(() => {
          delete (Object.prototype as Record<string, unknown>).get;
          Object.defineProperty(ArrayPrototype, 'slice', {
            value: slice,
            writable: true,
            enumerable: false,
            configurable: true,
          });
        });
      }
      // Last, since storing into a new array index from here on reaches the trap: assigning to the
      // hole would reach it, and slice() leaves the hole as a hole.
      undo.push(() => void Object.setPrototypeOf(ArrayPrototype, Object.prototype));
      Object.setPrototypeOf(
        ArrayPrototype,
        new Proxy(Object.prototype, {
          __proto__: null,
          has: (target, key) => key !== '1' && Reflect.has(target, key),
          set(target, key, value, receiver) {
            calls++;
            return Reflect.set(target, key, value, receiver);
          },
        } as ProxyHandler<object>),
      );
      return () => {
        for (let k = undo.length - 1; k >= 0; k--) undo[k]();
      };
    };
    for (const alsoSlice of [false, true]) {
      const value = data();
      calls = 0;
      const restore = replaceAll(alsoSlice);
      let copy: ReturnType<typeof data> | undefined;
      try {
        copy = cloneReactiveData3D(value);
      } finally {
        restore();
      }
      expect({ alsoSlice, calls, copy }).toEqual({ alsoSlice, calls: 0, copy: clean });
      expect({ alsoSlice, hole: Object.hasOwn(copy!.holey, 1) }).toEqual({ alsoSlice, hole: true });
      expect(Object.getPrototypeOf(copy!.own)).toEqual({ f: 2 });
    }
  });
  test('an enumerable Object.prototype accessor is never read', () => {
    const read = vi.fn(() => ({}));
    const data = { moves: [{ from: 1, to: 2 }], motion: motionLike() };
    let out: typeof data, oracle: typeof data;
    Object.defineProperty(Object.prototype, 'polluted', {
      get: read,
      enumerable: true,
      configurable: true,
    });
    try {
      out = cloneReactiveData3D(data);
      oracle = oracleClone(data);
    } finally {
      delete (Object.prototype as Record<string, unknown>).polluted;
    }
    expect(read).not.toHaveBeenCalled();
    expect(portableText(out)).toBe(portableText(oracle));
  });
  test('hidden accessor and read-only Object.prototype keys neither see nor change a copy', () => {
    const variants: Record<string, (calls: { n: number }) => PropertyDescriptor> = {
      setter: (calls) => ({ set: () => void calls.n++, configurable: true }),
      getterOnly: () => ({ get: () => 7, configurable: true }),
      readOnly: () => ({ value: 7, writable: false, configurable: true }),
      throwingSetter: () => ({
        set: () => {
          throw Error('caller setter');
        },
        configurable: true,
      }),
      writableData: () => ({ value: 7, writable: true, configurable: true }),
    };
    const data = () => ({ moves: [{ from: 1, to: 2 }], motion: motionLike() }),
      clean = portableText(oracleClone(data()));
    for (const [name, make] of Object.entries(variants)) {
      const calls = { n: 0 };
      Object.defineProperty(Object.prototype, 'from', make(calls));
      let result: string;
      try {
        result = portableText(cloneReactiveData3D(data()));
      } catch (error) {
        result = (error as Error).message;
      } finally {
        delete (Object.prototype as Record<string, unknown>).from;
      }
      expect({ name, result, calls: calls.n }).toEqual({ name, result: clean, calls: 0 });
    }
  });
  test('an own __proto__ key takes the generic walk', () => {
    for (const text of ['[{"a":1,"__proto__":null},[0]]', '[{"a":1,"__proto__":5},[0]]']) {
      const out = cloneReactiveData3D({ a: JSON.parse(text) }),
        oracle = oracleClone({ a: JSON.parse(text) });
      expect(Object.keys(out.a[0])).toEqual(Object.keys(oracle.a[0]));
      expect(Object.getPrototypeOf(out.a[0])).toBe(Object.getPrototypeOf(oracle.a[0]));
    }
  });
});
