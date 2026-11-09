/**
 * IEEE-754 bit-level access to binary64/binary32 values (FND-05a).
 *
 * Every operation here is exact bit manipulation on top of the ECMAScript
 * `DataView` accessors with an explicit byte order, so results are identical
 * on any platform. These helpers exist for three reasons:
 *
 * 1. The deterministic transcendentals (spec 5.1.1) are ports of classic
 *    libm algorithms (fdlibm lineage) that decompose doubles into high/low
 *    32-bit words; they need this module.
 * 2. Determinism tests compare exact bit patterns rather than numbers
 *    (NaN payloads, signed zeros, and rounding boundaries are invisible to
 *    `===`).
 * 3. Behavior models may need to inspect or assemble exact game-precision
 *    values when documenting fround points.
 *
 * Word convention: `hi` is the most significant 32-bit word (sign, exponent,
 * high mantissa bits), `lo` the least significant word.
 */

const buffer = new ArrayBuffer(8);
const view = new DataView(buffer);

/** The two 32-bit words of the binary64 representation of `x`. */
export function f64Words(x: number): { hi: number; lo: number } {
  view.setFloat64(0, x, false);
  return { hi: view.getUint32(0, false), lo: view.getUint32(4, false) };
}

/** The binary64 value whose bit pattern is the given two 32-bit words. */
export function f64FromWords(hi: number, lo: number): number {
  view.setUint32(0, hi >>> 0, false);
  view.setUint32(4, lo >>> 0, false);
  return view.getFloat64(0, false);
}

/** The single 32-bit word of the binary32 (float32) representation of `x`. */
export function f32Word(x: number): number {
  view.setFloat32(0, x, false);
  return view.getUint32(0, false);
}

/** The binary32 value whose bit pattern is the given 32-bit word. */
export function f32FromWord(word: number): number {
  view.setUint32(0, word >>> 0, false);
  return view.getFloat32(0, false);
}

/** `x` with its high 32-bit word replaced (low word kept), like fdlibm `SET_HIGH_WORD`. */
export function withHighWord(x: number, hi: number): number {
  return f64FromWords(hi, f64Words(x).lo);
}

/** `x` with its low 32-bit word replaced (high word kept), like fdlibm `SET_LOW_WORD`. */
export function withLowWord(x: number, lo: number): number {
  return f64FromWords(f64Words(x).hi, lo);
}

/** `|x|` computed by clearing the sign bit — exact, no `Math.*` involved. */
export function f64Abs(x: number): number {
  return f64FromWords(f64Words(x).hi & 0x7fffffff, f64Words(x).lo);
}

/**
 * Distance between two doubles measured in ulps (units in the last place),
 * using the standard monotonic integer ordering of bit patterns.
 *
 * Returns `NaN` if either input is `NaN`. Distances up to 2^53 are returned
 * exactly. Signed zeros are one ulp apart in this ordering although they
 * compare equal — irrelevant for the accuracy comparisons this helper exists
 * for (same-sign, finite pairs).
 */
export function ulpDistance(a: number, b: number): number {
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
  const ordered = (x: number): bigint => {
    const { hi, lo } = f64Words(x);
    const raw = (BigInt(hi >>> 0) << 32n) | BigInt(lo >>> 0);
    // Negative numbers: flip all bits so ordering becomes monotonic.
    return raw >> 63n ? ~raw & 0xffffffffffffffffn : raw ^ 0x8000000000000000n;
  };
  const oa = ordered(a);
  const ob = ordered(b);
  const diff = oa > ob ? oa - ob : ob - oa;
  return Number(diff);
}
