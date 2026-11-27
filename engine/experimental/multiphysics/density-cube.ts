/*! Density cube adapted from fdlibm / V8's ieee754::pow (Node v22.22.3).
 * Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
 * Developed at SunSoft, a Sun Microsystems, Inc. business.
 * Permission to use, copy, modify, and distribute this software is freely
 * granted, provided that this notice is preserved.
 * Copyright 2016 the V8 project authors. BSD-3-Clause. See docs/THIRD_PARTY.md.
 */

// Keep the original rounding between operations. JS arithmetic on Numbers provides
// binary64 add/multiply/divide without contraction. The scratch word is never exposed.
const word = new DataView(new ArrayBuffer(8));
function high(value: number): number {
  word.setFloat64(0, value);
  return word.getUint32(0);
}
function withHigh(value: number, upper: number): number {
  word.setFloat64(0, value);
  word.setUint32(0, upper);
  return word.getFloat64(0);
}
function chop(value: number): number {
  word.setFloat64(0, value);
  word.setUint32(4, 0);
  return word.getFloat64(0);
}

// Set the exponent field of a positive normal binary64 value with zero fraction.
function normalPowerOfTwo(exponent: number): number {
  return withHigh(0, (exponent + 1023) * 0x100000);
}
const tinyCubeInput = normalPowerOfTwo(-359);
const hugeCubeInput = normalPowerOfTwo(342);
const smallestNormal = normalPowerOfTwo(-1022);
const largestBinaryPower = normalPowerOfTwo(1023);

// fdlibm reduces log2(x) about 1 or 1.5 and carries its low part into exp2.
// The word comparisons, splits and polynomial evaluation order are part of the v1/v2 contract.
export function densityCube(value: number): number {
  const x = Math.abs(value);
  if (value === 0 || x === 1 || !Number.isFinite(x)) return value;
  const sign = value < 0 ? -1 : 1;
  if (x < tinyCubeInput) return sign * 0;
  if (x >= hugeCubeInput) return sign * Infinity;

  const upper = high(x);
  let exponent = (upper >>> 20) - 1023;
  const fraction = upper & 0xfffff;
  let normalizedWord = fraction | 0x3ff00000;
  const middle = fraction > 0x3988e && fraction < 0xbb67a;
  if (fraction >= 0xbb67a) {
    normalizedWord -= 0x100000;
    exponent++;
  }
  const normalized = withHigh(x, normalizedWord);
  const center = middle ? 1.5 : 1;
  const difference = normalized - center;
  const reciprocal = 1 / (normalized + center);
  const ratio = difference * reciprocal;
  const ratioHigh = chop(ratio);
  const denominatorHigh = withHigh(
    0,
    ((normalizedWord >>> 1) | 0x20000000) + 0x80000 + (middle ? 0x40000 : 0),
  );
  const denominatorLow = normalized - (denominatorHigh - center);
  const ratioLow =
    reciprocal * (difference - ratioHigh * denominatorHigh - ratioHigh * denominatorLow);
  const square = ratio * ratio;
  const l1 = 5.99999999999994648725e-1,
    l2 = 4.28571428578550184252e-1,
    l3 = 3.33333329818377432918e-1,
    l4 = 2.72728123808534006489e-1,
    l5 = 2.30660745775561754067e-1,
    l6 = 2.06975017800338417784e-1;
  const remainder =
    square *
      square *
      (l1 + square * (l2 + square * (l3 + square * (l4 + square * (l5 + square * l6))))) +
    ratioLow * (ratioHigh + ratio);
  const highSquare = ratioHigh * ratioHigh;
  const termHigh = chop(3 + highSquare + remainder);
  const termLow = remainder - (termHigh - 3 - highSquare);
  const u = ratioHigh * termHigh;
  const v = ratioLow * termHigh + termLow * ratio;
  const productHigh = chop(u + v);
  const productLow = v - (productHigh - u);
  const offset = middle ? 5.84962487220764160156e-1 : 0;
  const logHigh = 9.61796700954437255859e-1 * productHigh;
  const logLow =
    -7.02846165095275826516e-9 * productHigh +
    productLow * 9.61796693925975554329e-1 +
    (middle ? 1.35003920212974897128e-8 : 0);
  const log = chop(logHigh + logLow + offset + exponent);
  let powerHigh = 3 * log;
  const powerLow = 3 * (logLow - (log - exponent - offset - logHigh));
  const power = powerHigh + powerLow;
  if (power > 1024 || (power === 1024 && powerLow + 8.0085662595372944372e-17 > power - powerHigh))
    return sign * Infinity;
  if (power < -1075 || (power === -1075 && powerLow <= power - powerHigh)) return sign * 0;

  // Reduce to a power of two times an exponential on a small interval.
  const powerWord = high(power);
  const absoluteWord = powerWord & 0x7fffffff;
  let scale = 0;
  if (absoluteWord > 0x3fe00000) {
    const shift = (absoluteWord >>> 20) - 1023;
    const roundedWord = powerWord + (0x100000 >>> (shift + 1));
    const roundedShift = ((roundedWord & 0x7fffffff) >>> 20) - 1023;
    const integer = withHigh(0, roundedWord & ~(0xfffff >>> roundedShift));
    scale = ((roundedWord & 0xfffff) | 0x100000) >>> (20 - roundedShift);
    if (power < 0) scale = -scale;
    powerHigh -= integer;
  }
  const reduced = chop(powerLow + powerHigh);
  const expHigh = reduced * 6.93147182464599609375e-1;
  const expLow =
    (powerLow - (reduced - powerHigh)) * 6.93147180559945286227e-1 +
    reduced * -1.90465429995776804525e-9;
  const z = expHigh + expLow;
  const tail = expLow - (z - expHigh);
  const zz = z * z;
  const p1 = 1.66666666666666019037e-1,
    p2 = -2.77777777770155933842e-3,
    p3 = 6.61375632143793436117e-5,
    p4 = -1.6533902205465251539e-6,
    p5 = 4.13813679705723846039e-8;
  const polynomial = z - zz * (p1 + zz * (p2 + zz * (p3 + zz * (p4 + zz * p5))));
  const correction = (z * polynomial) / (polynomial - 2 - (tail + z * tail));
  const result = 1 - (correction - z);
  // Scale once into subnormal range so the final multiplication rounds only once.
  if (scale < -1022) return sign * (result * normalPowerOfTwo(scale + 1022) * smallestNormal);
  if (scale === 1024) return sign * (result * 2 * largestBinaryPower);
  return sign * (result * normalPowerOfTwo(scale));
}
