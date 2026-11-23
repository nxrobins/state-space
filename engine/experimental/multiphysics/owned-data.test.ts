import { beforeAll, expect, test } from 'vitest';
import {
  copyPortableValue,
  PORTABLE_VALUE_LIMITS,
  type PortableValue,
} from '../../portable-data.js';
import { copyOwnedPortableValue } from './owned-data.js';
import { createMultiphysicsProfiles3D, type MultiphysicsProfiles3D } from './profiles.js';
import { createMultiphysicsDemonstration3D } from './demonstrations.js';

let profiles: MultiphysicsProfiles3D;
beforeAll(async () => {
  profiles = await createMultiphysicsProfiles3D();
});
// Key order, every value and the sign of each zero; or the rejection.
const outcome = (copy: (value: PortableValue) => unknown, value: unknown) => {
  try {
    return `value ${JSON.stringify(copy(value as PortableValue), (_key, entry: unknown) =>
      Object.is(entry, -0) ? 'negative zero' : entry,
    )}`;
  } catch (error) {
    return `error ${(error as Error).message}`;
  }
};
const nested = (depth: number): unknown => (depth ? [nested(depth - 1)] : 0);

test('the owned copy is the portable copy of plain data, key order and zeros included', () => {
  const world = createMultiphysicsDemonstration3D(profiles, 'combined-failure');
  const values: unknown[] = [
    world,
    { z: 1, a: [-0, 0, { y: -0, b: 'text', a: null }], m: true, '10': 'ten', '9': 'nine' },
    {
      tick: 3,
      parcels: [
        { id: 'b', center: [0, -0, 1] },
        { center: [1, 2, 3], id: 'a' },
      ],
    },
    Object.assign(Object.create(null), { b: 1, a: -0 }),
    [],
    {},
    [[], {}, [[-0]]],
    'text',
    '',
    -0,
    0,
    1.5,
    true,
    false,
    null,
    nested(PORTABLE_VALUE_LIMITS.depth),
    Array<number>(PORTABLE_VALUE_LIMITS.nodes - 1).fill(-0),
    ['x'.repeat(PORTABLE_VALUE_LIMITS.characters)],
    { ['k'.repeat(1000)]: 'x'.repeat(PORTABLE_VALUE_LIMITS.characters - 1000) },
  ];
  for (const value of values) {
    const copied = outcome(copyPortableValue, value);
    expect(copied.startsWith('value')).toBe(true);
    expect(outcome(copyOwnedPortableValue, value)).toBe(copied);
  }
  // A copy, never the value itself or a part of it.
  const record = { list: [1, 2, 3], inner: { a: 1 } },
    copy = copyOwnedPortableValue(record);
  expect(copy).not.toBe(record);
  expect(copy.list).not.toBe(record.list);
  expect(copy.inner).not.toBe(record.inner);
  expect(Object.getPrototypeOf(copyOwnedPortableValue(Object.create(null) as PortableValue))).toBe(
    Object.prototype,
  );
});

test('whatever the portable copy rejects, the owned copy rejects with its message', () => {
  const cycle: Record<string, unknown> = { a: 1 };
  cycle.self = { back: cycle };
  const sparse = [0, 0, 0];
  delete sparse[1];
  class Instance {
    a = 1;
  }
  const prototypeKey = JSON.parse('{"a": 1, "__proto__": {"b": 2}}') as unknown;
  const values: unknown[] = [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    { a: [1, Number.NEGATIVE_INFINITY] },
    undefined,
    { a: undefined },
    [undefined],
    1n,
    { a: 1n },
    Symbol('s'),
    () => 0,
    { a: () => 0 },
    cycle,
    [cycle],
    sparse,
    { a: sparse },
    new Instance(),
    [new Instance()],
    new Float64Array(3),
    { a: new Float64Array(3) },
    new Map(),
    new Date(0),
    Object.assign(Object.create({ inherited: 1 }), { own: 1 }),
    nested(PORTABLE_VALUE_LIMITS.depth + 1),
    Array<number>(PORTABLE_VALUE_LIMITS.nodes).fill(0),
    ['x'.repeat(PORTABLE_VALUE_LIMITS.characters + 1)],
    { ['k'.repeat(1000)]: 'x'.repeat(PORTABLE_VALUE_LIMITS.characters - 999) },
  ];
  for (const value of values) {
    const copied = outcome(copyPortableValue, value);
    expect(copied.startsWith('error')).toBe(true);
    expect(outcome(copyOwnedPortableValue, value)).toBe(copied);
  }
  // An own key named __proto__ is data to the portable copy, and stays an own key here.
  const copied = copyOwnedPortableValue(prototypeKey as PortableValue) as object;
  expect(Object.hasOwn(copied, '__proto__')).toBe(true);
  expect(Object.getPrototypeOf(copied)).toBe(Object.prototype);
  expect(outcome(copyOwnedPortableValue, prototypeKey)).toBe(
    outcome(copyPortableValue, prototypeKey),
  );
});
