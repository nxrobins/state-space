import { describe, expect, it, vi } from 'vitest';
import {
  assertRecordFields,
  copyPortableValue as copy,
  PORTABLE_VALUE_LIMITS as limits,
  type PortableValue,
} from './portable-data.js';
import { copyTacticalValue } from './experimental/tactical-session-core.js';

describe('bounded portable data', () => {
  it('copies aliases independently, sorts keys and keeps prototype-looking keys inert', () => {
    const shared = { n: -0 };
    const input = Object.assign(Object.create(null), { z: shared, a: shared });
    Object.defineProperty(input, '__proto__', { value: { polluted: true }, enumerable: true });
    const result = copy(input);
    expect(Object.keys(result)).toEqual(['__proto__', 'a', 'z']);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(result.a).not.toBe(result.z);
    expect(Object.is(result.a.n, -0)).toBe(false);
    result.a.n = 5;
    expect(shared.n).toBe(-0);
    expect(result.z.n).toBe(0);
    expect(copyTacticalValue(input)).toEqual(copy(input));
  });
  it('rejects malformed values without invoking accessors', () => {
    const getter = vi.fn(() => 1),
      cycle: PortableValue[] = [];
    cycle.push(cycle);
    const accessor = Object.defineProperty({}, 'x', { get: getter, enumerable: true });
    const hidden = Object.defineProperty({}, 'x', { value: 1 });
    const arrayAccessor = Object.defineProperty([0], '0', { get: getter });
    for (const bad of [
      cycle,
      accessor,
      hidden,
      arrayAccessor,
      [, ,],
      Object.assign([0], { extra: 1 }),
      { [Symbol()]: 0 },
      new Date(),
      new Uint8Array(1),
      undefined,
      NaN,
      Infinity,
      1n,
      () => {},
    ]) {
      expect(() => copy(bad as PortableValue)).toThrow();
    }
    expect(getter).not.toHaveBeenCalled();
  });
  it('preserves the historical acceptance of array subclasses', () => {
    class Values extends Array<number> {}
    expect(copy(new Values(1, 2))).toEqual([1, 2]);
  });
  it('enforces exact character, depth and total-node boundaries', () => {
    expect(copy('x'.repeat(limits.characters))).toHaveLength(limits.characters);
    expect(() => copy({ x: 'y'.repeat(limits.characters) })).toThrow('character budget');
    let nested: PortableValue = 1;
    for (let i = 0; i < limits.depth; i++) nested = [nested];
    expect(() => copy(nested)).not.toThrow();
    expect(() => copy([nested])).toThrow('bounded value budget');
    expect(copy(Array(limits.nodes - 1).fill(null))).toHaveLength(limits.nodes - 1);
    expect(() => copy(Array(limits.nodes).fill(null))).toThrow('bounded value budget');
  });
});

describe('record field validation', () => {
  const check = (v: unknown) => assertRecordFields(v, ['x'], ['y'], 'domain diagnostic');
  it('accepts only owned enumerable data fields and preserves domain diagnostics', () => {
    const getter = vi.fn(() => 1);
    for (const good of [
      { x: 1 },
      { x: 1, y: undefined },
      Object.assign(Object.create(null), { x: 1 }),
    ])
      expect(() => check(good)).not.toThrow();
    for (const bad of [
      null,
      [],
      {},
      { x: 1, z: 2 },
      Object.create({ x: 1 }),
      Object.assign(new Date(), { x: 1 }),
      { x: 1, [Symbol()]: 2 },
      Object.defineProperty({}, 'x', { value: 1 }),
      Object.defineProperty({}, 'x', { get: getter, enumerable: true }),
    ]) {
      expect(() => check(bad)).toThrow('domain diagnostic');
    }
    expect(getter).not.toHaveBeenCalled();
  });
});
