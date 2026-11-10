/**
 * Deterministic transcendental functions (FND-05a; spec 5.1.1: bundled
 * deterministic implementation, not the browser's `Math` object).
 *
 * Backing engine: `decimal.js`, running in an isolated constructor cloned
 * with `precision: 50` significant digits. decimal.js performs its own
 * base-10^7 limb arithmetic with fixed rounding — it never calls libm — so
 * the same inputs and configuration produce bit-identical results on every
 * platform, satisfying spec 5.5.
 *
 * Pipeline per call:
 * 1. IEEE edge cases (NaN/±Inf/±0/negative-domain) resolved in plain JS
 *    against the C99/IEEE tables.
 * 2. The double input is converted to the *exact* decimal value of its bits
 *    (BigInt mantissa × power-of-two scaling — see `doubleToExactDecimal`),
 *    not its shortest round-trip string. This removes the ~0.25 ulp
 *    perturbation a string round-trip would inject and makes the pipeline
 *    mathematically exact end to end.
 * 3. The function is evaluated at 50 significant digits.
 * 4. `toNumber()` converts back to binary64 through the ECMAScript
 *    string→Number conversion, which the language specification requires to
 *    be correctly rounded. With 50 correct digits feeding a 16-digit target,
 *    results are correctly rounded doubles in practice (worst case ≤ 1 ulp,
 *    asserted against 60-digit references in the test suite).
 * 5. Behavior models apply `roundToGamePrecision(x, 'f32')` at the points
 *    they document (spec 5.1.1); nothing here frounds on its own.
 *
 * Precision configuration lives here on purpose: every function below must
 * agree on one working precision, and `Decimal.clone` keeps this engine's
 * configuration isolated from any other decimal.js use in the host
 * application. Cost note: digit-limb arithmetic is orders of magnitude
 * slower than libm — suited to Verified offline/static calculations, not
 * per-tick loops.
 */

import Decimal from 'decimal.js';
import { f64Words } from './bits';

/**
 * The engine's private decimal.js constructor: 50 significant digits,
 * half-up internal rounding (the final binary64 rounding in step 4 is
 * round-to-nearest-even, handled by `toNumber`).
 */
const Dec = Decimal.clone({ precision: 50, rounding: Decimal.ROUND_HALF_UP });

/** ln 2 at working precision; fixed point of the deterministic configuration. */
const LN2 = Dec(2).ln();

/**
 * ln of the round-to-+Infinity overflow threshold of binary64:
 * values ≥ (2 − 2⁻⁵³)·2¹⁰²³ round to +Inf, so `exp(p)` overflows exactly
 * when p ≥ this constant. Computed in decimal at full precision so the
 * boundary decision for `pow` is exact.
 */
const OVERFLOW_LN = Dec(1023)
  .mul(LN2)
  .plus(Dec(decimalPowerOfTwoExponentString(-53, 2n * 10n ** 53n - 5n ** 53n)).ln());

/**
 * ln of the round-to-zero underflow threshold: values ≤ 2⁻¹⁰⁷⁶ (half the
 * minimum subnormal) round to +0 under round-to-nearest-even.
 */
const UNDERFLOW_LN = Dec(-1076).mul(LN2);

/** Exponent (decimal scientific notation) string for value `digits × 10^e`. */
function decimalPowerOfTwoExponentString(e: number, digits: bigint): string {
  return `${digits.toString()}e${e}`;
}

/**
 * The exact decimal value of a finite, nonzero double.
 *
 * Decomposes the bit pattern into mantissa × 2^e and evaluates that product
 * exactly with BigInt (the product of an integer and a power of two is a
 * terminating decimal), then hands the full-precision literal to the
 * decimal constructor, which stores every digit it is given.
 */
function doubleToExactDecimal(x: number): Decimal {
  const { hi, lo } = f64Words(x);
  const biased = (hi >>> 20) & 0x7ff;
  // 52-bit fraction field across both words
  const fraction = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo >>> 0);
  let mantissa: bigint;
  let e: number;
  if (biased === 0) {
    // subnormal: value = fraction·2^-1074
    mantissa = fraction;
    e = -1074;
  } else {
    // value = (2^52 + fraction)·2^(biased − 1075)
    mantissa = (1n << 52n) + fraction;
    e = biased - 1075;
  }
  const negative = (hi >>> 31) === 1;
  let literal: string;
  if (e >= 0) {
    literal = (mantissa << BigInt(e)).toString();
  } else {
    literal = `${(mantissa * 5n ** BigInt(-e)).toString()}e${e}`;
  }
  return Dec(negative ? `-${literal}` : literal);
}

/** True when `y` is an odd integer value (all |y| ≥ 2^53 doubles are even). */
function isOddInteger(y: number): boolean {
  return Number.isInteger(y) && Math.abs(y) % 2 === 1;
}

/** e^x, deterministic. IEEE/C99 edges: exp(±0) = 1, exp(-Inf) = +0,
 * exp(+Inf) = +Inf, exp(NaN) = NaN; overflow → +Inf, underflow → +0 with
 * the exact binary64 rounding boundaries handled by the decimal pipeline. */
export function exp(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x === Infinity) return Infinity;
  if (x === -Infinity) return 0;
  if (x === 0) return 1;
  // Beyond ±1e15 the result is far outside binary64 range in either
  // direction; intercepting keeps decimal.js arguments small.
  if (x >= 1e15) return Infinity;
  if (x <= -1e15) return 0;
  return doubleToExactDecimal(x).exp().toNumber();
}

/** Natural log, deterministic. IEEE/C99 edges: log(±0) = −Infinity,
 * log(< 0) = NaN, log(+Inf) = +Inf, log(1) = +0, log(NaN) = NaN. */
export function log(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x === Infinity) return Infinity;
  if (x < 0) return NaN; // includes -Infinity
  if (x === 0) return -Infinity; // both ±0
  if (x === 1) return 0;
  return doubleToExactDecimal(x).ln().toNumber();
}

/**
 * Base-2 log, deterministic. Same edge table as `log`, plus log2 of powers
 * of two is exact (ln(2^k)/ln2 differs from k by ~1e-47, far below half an
 * ulp, so `toNumber` lands exactly on the integer).
 */
export function log2(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x === Infinity) return Infinity;
  if (x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === 1) return 0;
  return doubleToExactDecimal(x).ln().div(LN2).toNumber();
}

/**
 * x^y, deterministic, with the full C99/IEEE special-case table:
 * pow(x, ±0) = 1 (even for NaN x); pow(+1, y) = 1 (even for NaN y);
 * pow(±0, y) → ±0/±Inf by parity and sign of y; pow(±Inf, y) → 0/±Inf;
 * pow(±1, ±Inf) = 1; pow(x < 0, non-integer y) = NaN; negative results only
 * for negative x raised to an odd integer. Overflow/underflow decisions are
 * made against exact decimal boundaries (`OVERFLOW_LN`, `UNDERFLOW_LN`), so
 * the cliffs sit exactly where binary64 rounding puts them.
 */
export function pow(x: number, y: number): number {
  // pow(x, ±0) = 1 for any x, even NaN
  if (y === 0) return 1;
  // pow(+1, y) = 1 for any y, even NaN
  if (x === 1) return 1;
  if (Number.isNaN(x) || Number.isNaN(y)) return NaN;

  const xIsNegativeZero = x === 0 && 1 / x === -Infinity;
  const xIsNegative = x < 0 || xIsNegativeZero;

  // ±0 base
  if (x === 0) {
    if (y === Infinity) return 0;
    if (y === -Infinity) return Infinity;
    if (y > 0) return isOddInteger(y) ? x : 0;
    return isOddInteger(y) ? (xIsNegativeZero ? -Infinity : Infinity) : Infinity;
  }

  // Infinite base
  if (x === Infinity) return y < 0 ? 0 : Infinity;
  if (x === -Infinity) {
    if (y < 0) return isOddInteger(y) ? -0 : 0;
    return isOddInteger(y) ? -Infinity : Infinity;
  }

  // Infinite exponent
  if (y === Infinity) {
    if (x === -1) return 1;
    return Math.abs(x) > 1 ? Infinity : 0;
  }
  if (y === -Infinity) {
    if (x === -1) return 1;
    return Math.abs(x) > 1 ? 0 : Infinity;
  }

  // Negative base with non-integer exponent is NaN; negative results only
  // for negative bases raised to an odd integer.
  const yIsInteger = Number.isInteger(y);
  if (xIsNegative && !yIsInteger) return NaN;
  const negativeResult = xIsNegative && isOddInteger(y);

  // Magnitude via y·ln|x| in exact-input decimal; the boundary comparisons
  // decide overflow/underflow exactly instead of trusting a rounded p.
  const p = doubleToExactDecimal(Math.abs(x)).ln().mul(doubleToExactDecimal(y));
  if (p.comparedTo(OVERFLOW_LN) >= 0) return negativeResult ? -Infinity : Infinity;
  if (p.comparedTo(UNDERFLOW_LN) <= 0) return negativeResult ? -0 : 0;
  const magnitude = p.exp().toNumber();
  return negativeResult ? -magnitude : magnitude;
}

/** Square root, deterministic. IEEE/C99 edges: sqrt(±0) = ±0 (sign kept),
 * sqrt(< 0) = NaN, sqrt(+Inf) = +Inf, sqrt(NaN) = NaN. */
export function sqrt(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x === Infinity) return Infinity;
  if (x < 0) return NaN;
  if (x === 0) return x; // preserves the sign of zero
  return doubleToExactDecimal(x).sqrt().toNumber();
}
