import { describe, expect, it } from 'vitest';
import { f64FromWords, f64Words, ulpDistance } from './bits';
import { exp, log, log2, pow, sqrt } from './transcendentals';

/**
 * Accuracy fixtures: `hi`/`lo` are the bit pattern of the TRUE mathematical
 * result correctly rounded to binary64, generated with Python `decimal` at
 * 60 significant digits (proced documented in the package README). The
 * decimal-backed implementation is asserted to reproduce them exactly:
 * precision 50 feeding a 16-digit target gives correctly rounded doubles in
 * practice, and every fixture below must stay exact. If a future change
 * makes one inexact, the test failure will show the ulp distance.
 *
 * Determinism (same inputs → same bits on any engine) follows from
 * decimal.js's own limb arithmetic + the spec-mandated correctly-rounded
 * string→Number conversion in `toNumber()`; the repeat-call assertions below
 * anchor it, and CI (QA-01) runs the suite in every supported engine.
 */

/** [input, trueHi, trueLo] for exp — reference values from 60-digit decimal. */
const expRefs: ReadonlyArray<[number, number, number]> = [
  [0.5, 0x3ffa6129, 0x8e1e069c],
  [1, 0x4005bf0a, 0x8b145769],
  [1.5, 0x4011ed3f, 0xe64fc541],
  [2, 0x401d8e64, 0xb8d4ddae],
  [3, 0x403415e5, 0xbf6fb106],
  [7, 0x40912288, 0x5aaeddaa],
  [10, 0x40d5829d, 0xcf950560],
  [20, 0x41bceb08, 0x8b68e804],
  [123.456, 0x4b11428e, 0x1cbc0143],
  [709.7, 0x7fed75ae, 0x7a50ee14],
  [709.75, 0x7feef85a, 0x11e73f2d],
  [709.78, 0x7fefe9ce, 0x5c4c52b4],
  [-0.5, 0x3fe368b2, 0xfc6f960a],
  [-1, 0x3fd78b56, 0x362cef38],
  [-2, 0x3fc152aa, 0xa3bf81cc],
  [-10, 0x3f07cd79, 0xb5647c9b],
  [-20, 0x3e21b486, 0x55f37267],
  [-0.1, 0x3fecf46d, 0x99d52b3a],
  [0.1, 0x3ff1aec7, 0xb35a00d4],
  [1e-10, 0x3ff00000, 0x0006df38],
  [1e-300, 0x3ff00000, 0x00000000],
  [-745, 0x00000000, 0x00000001],
  [-745.1, 0x00000000, 0x00000001],
];

const logRefs: ReadonlyArray<[number, number, number]> = [
  [2, 0x3fe62e42, 0xfefa39ef],
  [10, 0x40026bb1, 0xbbb55516],
  [0.5, 0xbfe62e42, 0xfefa39ef],
  [0.1, 0xc0026bb1, 0xbbb55515],
  [1.0000000001, 0x3ddb7cdf, 0xfffa18d8],
  [0.9999999999, 0xbddb7ce0, 0x0005e728],
  [2.718281828459045, 0x3ff00000, 0x00000000],
  [123.456, 0x40134377, 0x4f3e2362],
  [1e-10, 0xc037069e, 0x2aa2aa5b],
  [1e10, 0x4037069e, 0x2aa2aa5b],
  [5e-324, 0xc0874385, 0x446d71c3],
  [1e-300, 0xc0859634, 0x47f87fb5],
  [1.5, 0x3fd9f323, 0xecbf984c],
  [0.9, 0xbfbaf8e8, 0x210a415c],
  [1.1, 0x3fb8663f, 0x793c46cc],
  [0.7, 0xbfd6d3c3, 0x24e13f50],
  [1.9999999999999998, 0x3fe62e42, 0xfefa39ee],
];

const log2Refs: ReadonlyArray<[number, number, number]> = [
  [2, 0x3ff00000, 0x00000000],
  [4, 0x40000000, 0x00000000],
  [8, 0x40080000, 0x00000000],
  [16, 0x40100000, 0x00000000],
  [0.5, 0xbff00000, 0x00000000],
  [0.25, 0xc0000000, 0x00000000],
  [10, 0x400a934f, 0x0979a371],
  [3, 0x3ff95c01, 0xa39fbd68],
  [1.4142135623730951, 0x3fe00000, 0x00000001],
  [0.7071067811865476, 0xbfdfffff, 0xfffffffe],
  [1.0000000001, 0x3de3d408, 0x46f44141],
  [0.9999999999, 0xbde3d408, 0x46fcc564],
  [1e-10, 0xc0409c11, 0x65ec0627],
  [1e10, 0x40409c11, 0x65ec0627],
  [5e-324, 0xc090c800, 0x00000000],
  [1024, 0x40240000, 0x00000000],
  [9.332636185032189e-302, 0xc08f4000, 0x00000000],
];

/** [x, y, trueHi, trueLo] for pow. */
const powRefs: ReadonlyArray<[number, number, number, number]> = [
  [2, 10, 0x40900000, 0x00000000],
  [2, 0.5, 0x3ff6a09e, 0x667f3bcd],
  [2, -3, 0x3fc00000, 0x00000000],
  [10, 20, 0x4415af1d, 0x78b58c40],
  [10, -20, 0x3bc79ca1, 0x0c924223],
  [0.5, 0.3, 0x3fe9fdf8, 0xbcce533e],
  [7, 11, 0x41dd76e7, 0x25c00000],
  [0.9, 100, 0x3efbda05, 0x6ed49410],
  [123.456, 7.89, 0x435c37e5, 0x3d5e93d2],
  [1.5, 2.718281828459045, 0x400815e3, 0x4adaf5a0],
  [0.001, 0.5, 0x3fa030dc, 0x4ea03a72],
  [2, 1023, 0x7fe00000, 0x00000000],
  [0.25, 0.5, 0x3fe00000, 0x00000000],
  [9, 0.5, 0x40080000, 0x00000000],
  [1e-10, 0.25, 0x3f69e7c6, 0xe43390b7],
  [2.5, 1e-8, 0x3ff00000, 0x0275ab92],
  [0.7, -0.3, 0x3ff1ce97, 0x0bf40010],
  [1e-300, 2, 0x00000000, 0x00000000],
];

const sqrtRefs: ReadonlyArray<[number, number, number]> = [
  [2, 0x3ff6a09e, 0x667f3bcd],
  [10, 0x40094c58, 0x3ada5b53],
  [0.25, 0x3fe00000, 0x00000000],
  [4, 0x40000000, 0x00000000],
  [3, 0x3ffbb67a, 0xe8584caa],
  [1e10, 0x40f86a00, 0x00000000],
  [1e-10, 0x3ee4f8b5, 0x88e368f1],
  [5e-324, 0x1e600000, 0x00000000],
  [1e-300, 0x20ca2fe7, 0x6a3f9475],
  [123.456, 0x402638de, 0xe52c80ed],
  [0.7, 0x3feac5eb, 0x3f7ab2f8],
  [1.5e300, 0x5f17f21a, 0x3deb5607],
  [9.87654321e-11, 0x3ee4d777, 0x4d0d6332],
];

describe('transcendentals — accuracy vs 60-digit decimal references (exact bits)', () => {
  it('exp reproduces the correctly-rounded true value bit for bit', () => {
    for (const [x, hi, lo] of expRefs) {
      const got = f64Words(exp(x));
      expect([x, got.hi, got.lo]).toEqual([x, hi, lo]);
    }
  });

  it('log reproduces the correctly-rounded true value bit for bit', () => {
    for (const [x, hi, lo] of logRefs) {
      const got = f64Words(log(x));
      expect([x, got.hi, got.lo]).toEqual([x, hi, lo]);
    }
  });

  it('log2 reproduces the correctly-rounded true value bit for bit', () => {
    for (const [x, hi, lo] of log2Refs) {
      const got = f64Words(log2(x));
      expect([x, got.hi, got.lo]).toEqual([x, hi, lo]);
    }
  });

  it('pow reproduces the correctly-rounded true value bit for bit', () => {
    for (const [x, y, hi, lo] of powRefs) {
      const got = f64Words(pow(x, y));
      expect([x, y, got.hi, got.lo]).toEqual([x, y, hi, lo]);
    }
  });

  it('sqrt reproduces the correctly-rounded true value bit for bit', () => {
    for (const [x, hi, lo] of sqrtRefs) {
      const got = f64Words(sqrt(x));
      expect([x, got.hi, got.lo]).toEqual([x, hi, lo]);
    }
  });

  it('sanity: results stay within 2 ulp of the engine Math.* oracle across a grid', () => {
    // The correctness basis is the decimal reference table above; this is a
    // broad-domain tripwire against gross regressions only (Math.* is itself
    // up to 1 ulp from exact, hence the 2 ulp bound).
    let seed = 0x2f6e2b1;
    const next = () => {
      // xorshift-style LCG — deterministic, no dependencies
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let k = 0; k < 200; k++) {
      const x = (next() - 0.5) * 2 ** Math.round((next() - 0.5) * 40);
      if (x !== 0 && Number.isFinite(x)) {
        expect(ulpDistance(exp(x), Math.exp(x))).toBeLessThanOrEqual(2);
        expect(ulpDistance(log(Math.abs(x)), Math.log(Math.abs(x)))).toBeLessThanOrEqual(2);
        expect(ulpDistance(log2(Math.abs(x)), Math.log2(Math.abs(x)))).toBeLessThanOrEqual(2);
        expect(ulpDistance(sqrt(Math.abs(x)), Math.sqrt(Math.abs(x)))).toBeLessThanOrEqual(2);
        expect(ulpDistance(pow(Math.abs(x), 1.7), Math.pow(Math.abs(x), 1.7))).toBeLessThanOrEqual(2);
      }
    }
  });
});

describe('transcendentals — determinism', () => {
  it('repeated calls return bit-identical results', () => {
    for (const x of [0.5, 1, 123.456, 709.7, -745.1, 1e-10, 5e-324]) {
      for (const fn of [exp, log, log2, sqrt]) {
        const a = f64Words(fn(x));
        const b = f64Words(fn(x));
        expect([a.hi, a.lo]).toEqual([b.hi, b.lo]);
      }
      const pa = f64Words(pow(x, 1.618));
      const pb = f64Words(pow(x, 1.618));
      expect([pa.hi, pa.lo]).toEqual([pb.hi, pb.lo]);
    }
  });

  it('edge inputs are bit-identical across calls too', () => {
    for (const x of [0, -0, Infinity, -Infinity, NaN, -2]) {
      for (const fn of [exp, log, log2, sqrt]) {
        const a = f64Words(fn(x));
        const b = f64Words(fn(x));
        expect([a.hi, a.lo]).toEqual([b.hi, b.lo]);
      }
    }
  });
});

describe('transcendentals — IEEE edge cases', () => {
  it('exp edge table', () => {
    expect(exp(0)).toBe(1);
    expect(exp(-0)).toBe(1);
    expect(exp(Infinity)).toBe(Infinity);
    expect(exp(-Infinity)).toBe(0);
    expect(Number.isNaN(exp(NaN))).toBe(true);
    expect(exp(710)).toBe(Infinity); // beyond the overflow threshold
    expect(exp(-746)).toBe(0); // below half the minimum subnormal
  });

  it('log edge table', () => {
    expect(log(0)).toBe(-Infinity);
    expect(log(-0)).toBe(-Infinity);
    expect(log(Infinity)).toBe(Infinity);
    expect(log(-Infinity)).toBeNaN();
    expect(log(-1)).toBeNaN();
    expect(Number.isNaN(log(NaN))).toBe(true);
    expect(Object.is(log(1), 0)).toBe(true); // +0 exactly
  });

  it('log2 edge table', () => {
    expect(log2(0)).toBe(-Infinity);
    expect(log2(-0)).toBe(-Infinity);
    expect(log2(Infinity)).toBe(Infinity);
    expect(log2(-Infinity)).toBeNaN();
    expect(log2(0.25)).toBe(-2); // powers of two are exact
    expect(log2(1024)).toBe(10);
    expect(Object.is(log2(1), 0)).toBe(true);
  });

  it('sqrt edge table', () => {
    expect(sqrt(Infinity)).toBe(Infinity);
    expect(sqrt(-Infinity)).toBeNaN();
    expect(sqrt(-1)).toBeNaN();
    expect(Number.isNaN(sqrt(NaN))).toBe(true);
    expect(Object.is(sqrt(0), 0)).toBe(true);
    expect(Object.is(sqrt(-0), -0)).toBe(true); // sign of zero preserved
    expect(sqrt(4)).toBe(2);
    expect(sqrt(0.25)).toBe(0.5);
  });

  it('pow edge table (C99/IEEE special cases)', () => {
    // exponents of ±0
    expect(pow(NaN, 0)).toBe(1);
    expect(pow(-Infinity, 0)).toBe(1);
    // base 1 (even NaN exponent)
    expect(pow(1, NaN)).toBe(1);
    expect(pow(1, Infinity)).toBe(1);
    expect(pow(-1, Infinity)).toBe(1);
    expect(pow(-1, -Infinity)).toBe(1);
    // NaN propagation
    expect(Number.isNaN(pow(NaN, 2))).toBe(true);
    expect(Number.isNaN(pow(2, NaN))).toBe(true);
    // ±0 bases
    expect(pow(-0, 3)).toBe(-0);
    expect(pow(-0, 2)).toBe(0);
    expect(pow(-0, -3)).toBe(-Infinity);
    expect(pow(-0, -2)).toBe(Infinity);
    expect(pow(0, -3)).toBe(Infinity);
    expect(pow(0, Infinity)).toBe(0);
    expect(pow(0, -Infinity)).toBe(Infinity);
    // infinite bases
    expect(pow(Infinity, -2)).toBe(0);
    expect(pow(Infinity, 2)).toBe(Infinity);
    expect(pow(-Infinity, 3)).toBe(-Infinity);
    expect(pow(-Infinity, 4)).toBe(Infinity);
    expect(Object.is(pow(-Infinity, -3), -0)).toBe(true);
    expect(pow(-Infinity, -4)).toBe(0);
    // infinite exponents on finite bases
    expect(pow(2, Infinity)).toBe(Infinity);
    expect(pow(2, -Infinity)).toBe(0);
    expect(pow(0.5, Infinity)).toBe(0);
    expect(pow(0.5, -Infinity)).toBe(Infinity);
    // negative base
    expect(pow(-2, 3)).toBe(-8); // odd integer exponent
    expect(pow(-2, 4)).toBe(16); // even integer exponent
    expect(Number.isNaN(pow(-2, 0.5))).toBe(true); // non-integer exponent
    expect(pow(-0.5, 3)).toBe(-0.125);
    // overflow / underflow at exact binary64 boundaries
    expect(pow(2, 1024)).toBe(Infinity);
    expect(pow(2, -1075)).toBe(0);
    expect(pow(2, -1074)).toBe(5e-324); // minimum subnormal, exact
  });
});
