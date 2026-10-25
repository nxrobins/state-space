import { describe, expect, it } from 'vitest';
import { validatePackedCells } from './validation.js';

describe('packed-state validation', () => {
  it('copies typed unsigned storage, including maximum values, without invoking its iterator', () => {
    const values = Uint32Array.of(0, 0xffffffff);
    values[Symbol.iterator] = () => {
      throw new Error('Caller iterator must not run.');
    };
    const output = validatePackedCells(values, 2);
    expect([...output]).toEqual([0, 0xffffffff]);
    values.fill(7);
    expect([...output]).toEqual([0, 0xffffffff]);
  });

  it('rejects coercion, holes and malformed lengths in ordinary inputs', () => {
    for (const values of [
      [-1],
      [0x100000000],
      [0.5],
      [NaN],
      [Infinity],
      ['1'],
      [undefined],
      new Array(1),
    ]) {
      expect(() => validatePackedCells(values as number[], 1)).toThrow();
    }
    expect(() => validatePackedCells(Uint32Array.of(1), 2)).toThrow();
    expect([...validatePackedCells([0, 0xffffffff], 2)]).toEqual([0, 0xffffffff]);
  });

  it('checks actual typed storage length when a subclass shadows its length', () => {
    class MisreportedArray extends Uint32Array {
      get length() {
        return 2;
      }
    }
    expect(() => validatePackedCells(new MisreportedArray(1), 2)).toThrow();
  });

  it('does not trust a forged unsigned-array prototype', () => {
    const signed = Int32Array.of(-1);
    Object.setPrototypeOf(signed, Uint32Array.prototype);
    expect(() => validatePackedCells(signed, 1)).toThrow();
    const forged = Object.create(Uint32Array.prototype, { length: { value: 1 }, 0: { value: -1 } });
    expect(() => validatePackedCells(forged, 1)).toThrow();
  });
});
