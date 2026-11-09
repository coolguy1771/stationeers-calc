import { describe, expect, it } from 'vitest';
import {
  f32FromWord,
  f64FromWords,
  f64Words,
  ulpDistance,
  withHighWord,
  withLowWord,
} from './bits';
import {
  addF32,
  addF64,
  divF32,
  mulF32,
  mulF64,
  roundToGamePrecision,
  sqrtF32,
  subF32,
  sumF32,
  sumF64,
  sumOrdered,
} from './floats';

describe('f32 arithmetic helpers round at every operation', () => {
  it('rounds each result to binary32 (unlike plain double math)', () => {
    expect(addF32(1, 2 ** -30)).toBe(1); // 1 + tiny rounds away in f32
    expect(1 + 2 ** -30).not.toBe(1); // ...but survives in f64
    // 1 + 3·2^-24 is an exact tie between 1+2^-23 (odd) and 1+2^-22 (even)
    expect(addF32(1, 3 * 2 ** -24)).toBe(1 + 2 ** -22); // ties to even
    expect(mulF32(3, 4)).toBe(12); // exact when representable
    expect(divF32(1, 3)).toBe(Math.fround(1 / 3));
    expect(divF32(1, 3)).not.toBe(1 / 3);
  });

  it('matches Math.fround semantics (ties to even)', () => {
    // 1 + 2^-24 lands exactly halfway between two f32 values -> ties to even
    expect(addF32(1, 2 ** -24)).toBe(1);
    // odd-integer significand: 16777216 + 1 -> 16777216 (even); +3 -> 16777220
    expect(addF32(16777216, 1)).toBe(16777216);
    expect(addF32(16777216, 3)).toBe(16777220);
  });

  it('overflows to Infinity in f32 range', () => {
    expect(mulF32(3e38, 2)).toBe(Infinity);
    expect(mulF32(-3e38, 2)).toBe(-Infinity);
    // f64-finite operands whose f32 sum overflows
    expect(addF32(3e38, 3e38)).toBe(Infinity);
  });

  it('rounds through the f32 subnormal range', () => {
    const subnormal = mulF32(1e-20, 1e-20); // 1e-40 is subnormal in f32
    expect(subnormal).toBe(Math.fround(1e-40));
    expect(subnormal).not.toBe(1e-40);
    expect(Math.abs(subnormal)).toBeGreaterThan(0);
    expect(subnormal).toBeLessThan(2 ** -126); // below the f32 minimum normal
    // underflow all the way to zero
    expect(mulF32(1e-30, 1e-30)).toBe(Math.fround(1e-60));
    expect(Math.fround(7e-46)).toBe(0); // below half the smallest subnormal
  });

  it('propagates signed zeros and NaN like IEEE-754', () => {
    expect(Object.is(subF32(-0, 0), -0));
    expect(Object.is(addF32(-0, 0), 0));
    expect(Number.isNaN(addF32(NaN, 1))).toBe(true);
    expect(Number.isNaN(addF32(Infinity, -Infinity))).toBe(true);
    expect(Number.isNaN(divF32(0, 0))).toBe(true);
  });

  it('f64 counterparts are the plain IEEE-754 double operations', () => {
    expect(addF64(1, 2 ** -30)).toBe(1 + 2 ** -30);
    expect(mulF64(0.1, 3)).toBe(0.1 * 3);
    expect(mulF64(1e300, 1e300)).toBe(Infinity);
  });

  it('sqrtF32 is the correctly rounded binary32 square root', () => {
    expect(sqrtF32(2)).toBe(Math.fround(Math.SQRT2));
    expect(sqrtF32(4)).toBe(2);
    expect(sqrtF32(1e-10)).toBe(Math.fround(Math.sqrt(1e-10)));
  });

  it('roundToGamePrecision routes f32 through fround and leaves f64 alone', () => {
    expect(roundToGamePrecision(0.1, 'f32')).toBe(Math.fround(0.1));
    expect(roundToGamePrecision(0.1, 'f64')).toBe(0.1);
    expect(roundToGamePrecision(3e38 * 2, 'f32')).toBe(Infinity);
  });
});

describe('ordered summation (spec 5.1.1: game order matters)', () => {
  it('f32 left-to-right sum differs from a naive f64 reduce', () => {
    const values = [1e8, 1, 1, -1e8];
    expect(sumF32(values)).toBe(0); // 1e8+1 rounds back to 1e8 in f32
    expect(values.reduce((a, b) => a + b, 0)).toBe(2); // f64 keeps the ones
  });

  it('input order changes the f32 result', () => {
    expect(sumF32([1, 1e8, -1e8])).toBe(0);
    expect(sumF32([1e8, -1e8, 1])).toBe(1);
  });

  it('equals a sequential addF32 fold over the same order', () => {
    const values = [0.1, 0.2, 0.3, 1e8, -1e8, 7, 1e-8];
    let acc = 0;
    for (const v of values) acc = addF32(acc, v);
    expect(sumF32(values)).toBe(acc);
  });

  it('f64 summation accumulates exactly like plain addition', () => {
    const values = [1e8, 1, 1, -1e8];
    expect(sumF64(values)).toBe(2);
    expect(sumOrdered(values, { precision: 'f64' })).toBe(2);
  });

  it('honors the initial value and empty input', () => {
    expect(sumOrdered([], { precision: 'f32' })).toBe(0);
    expect(sumOrdered([], { precision: 'f32', initial: 0.5 })).toBe(0.5);
    expect(sumF32([1, 2, 3], 100)).toBe(106);
    // non-finite values propagate
    expect(sumF32([1, Infinity, 2])).toBe(Infinity);
    expect(sumF32([1, -Infinity, 2])).toBe(-Infinity);
  });
});

describe('bit-level helpers', () => {
  it('f64 word round-trips are exact', () => {
    for (const x of [0, -0, 1, -1, 0.5, 1.5, 1e-320, 1e308, Infinity, -Infinity, NaN]) {
      const { hi, lo } = f64Words(x);
      expect(Object.is(f64FromWords(hi, lo), x)).toBe(true);
    }
  });

  it('f32 word round-trips are exact', () => {
    expect(f32FromWord(0x3fc00000)).toBe(1.5);
    expect(f64Words(1.5)).toEqual({ hi: 0x3ff80000, lo: 0 });
  });

  it('withHighWord/withLowWord replace exactly one word', () => {
    expect(withHighWord(1.5, 0x40000000)).toBe(2);
    expect(withLowWord(1.5, 0x80000000)).toBe(f64FromWords(0x3ff80000, 0x80000000));
  });

  it('ulpDistance measures in last places', () => {
    const nextAfter1 = f64FromWords(0x3ff00000, 1);
    expect(ulpDistance(1, nextAfter1)).toBe(1);
    expect(ulpDistance(1, 1.5)).toBe(2 ** 51);
    expect(ulpDistance(1.5, 1)).toBe(2 ** 51);
    expect(ulpDistance(3.25, 3.25)).toBe(0);
    expect(Number.isNaN(ulpDistance(NaN, 1))).toBe(true);
  });
});
