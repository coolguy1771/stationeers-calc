/**
 * Game-precision arithmetic primitives (FND-05a; spec 5.1.1).
 *
 * # Precision discipline
 *
 * JavaScript numbers are IEEE-754 binary64, but the game frequently stores
 * and computes in binary32 (C# `float`). Where the game uses 32-bit floats,
 * a Verified calculation must round to 32-bit *at the same points the game
 * does*, as confirmed by fixtures (spec 5.1.1). The rules for engine code:
 *
 * - Every behavior model documents the precision of its mechanic and the
 *   exact points where values are stored into a 32-bit game variable or
 *   participate in a 32-bit arithmetic step.
 * - Use the `*F32` helpers for those steps; use plain `+ - * /` (or the
 *   `*F64` helpers, which are documentation of intent) where the game works
 *   in double precision. Never fround "generally" — rounding at extra
 *   points diverges from the game just as much as missing rounding.
 * - Transcendental functions here return binary64. Round the *result* to
 *   the mechanic's precision at the point the behavior model documents
 *   (usually right after the call, i.e. where the game stores the value).
 * - JS `+ - * /` on binary64 inputs and `Math.fround` are exactly specified
 *   (IEEE-754 round-to-nearest), so both are deterministic across engines;
 *   `Math.fround` is explicitly sanctioned by spec 5.1.1.
 *
 * # Why fround-after-f64-op is safe for f32 inputs
 *
 * When both operands are exactly representable as binary32, computing the
 * operation in binary64 and rounding the result to binary32 yields the
 * correctly rounded binary32 result for +, -, * and / (binary64 carries
 * 53 ≥ 2·24 + 2 significand bits, the classical double-rounding safety
 * condition, and it also covers binary32-subnormal results). This is why the
 * helpers below are *exact* emulations of binary32 arithmetic, not
 * approximations. The same argument justifies `sqrtF32`.
 *
 * # Summation order
 *
 * Floating addition is not associative: the game's accumulation order can
 * change results at the ulp level, and spec 5.1.1 requires following it.
 * `sumOrdered` sums strictly left-to-right with rounding after every
 * operation; behavior models pass the values in the game's documented order.
 */

import { sqrt } from './transcendentals';

/** The float precision a mechanic uses; behavior models declare this per point. */
export type GamePrecision = 'f32' | 'f64';

/**
 * Round `x` to the game precision of a mechanic.
 *
 * `'f32'` rounds to the nearest binary32 value (ties to even, preserving
 * signed zeros, overflow to ±Infinity, underflow to binary32 subnormals);
 * `'f64'` is the identity. Call it at the points the behavior model
 * documents — typically where the game stores into a float field or where a
 * 32-bit arithmetic step happens — and nowhere else.
 */
export function roundToGamePrecision(x: number, precision: GamePrecision): number {
  return precision === 'f32' ? Math.fround(x) : x;
}

/** `a + b` rounded to binary32, emulating the game's 32-bit float addition. */
export function addF32(a: number, b: number): number {
  return Math.fround(a + b);
}

/** `a - b` rounded to binary32, emulating the game's 32-bit float subtraction. */
export function subF32(a: number, b: number): number {
  return Math.fround(a - b);
}

/** `a * b` rounded to binary32, emulating the game's 32-bit float multiplication. */
export function mulF32(a: number, b: number): number {
  return Math.fround(a * b);
}

/** `a / b` rounded to binary32, emulating the game's 32-bit float division. */
export function divF32(a: number, b: number): number {
  return Math.fround(a / b);
}

/**
 * `a + b` in binary64. JS `+` is already a correctly rounded IEEE-754 double
 * addition; this wrapper exists so call sites state their precision intent.
 */
export function addF64(a: number, b: number): number {
  return a + b;
}

/** `a - b` in binary64 (JS subtraction is already correctly rounded). */
export function subF64(a: number, b: number): number {
  return a - b;
}

/** `a * b` in binary64 (JS multiplication is already correctly rounded). */
export function mulF64(a: number, b: number): number {
  return a * b;
}

/** `a / b` in binary64 (JS division is already correctly rounded). */
export function divF64(a: number, b: number): number {
  return a / b;
}

/**
 * Square root rounded to binary32.
 *
 * `fround` of the correctly rounded binary64 square root is itself the
 * correctly rounded binary32 square root (the 2p+2 double-rounding condition
 * holds for p = 24 against 53-bit intermediates), so this is an exact
 * emulation of 32-bit hardware square root for binary32 inputs. Whether the
 * game computes a given mechanic's square root in single or double
 * precision is decided per behavior model (spec 5.1.1): use `sqrt(x)` +
 * `roundToGamePrecision` where the model documents double math, this helper
 * where it documents float math.
 */
export function sqrtF32(x: number): number {
  return Math.fround(sqrt(x));
}

/** Options for {@link sumOrdered}. */
export interface SumOptions {
  /**
   * Required: the precision every partial sum is rounded to. Making it
   * explicit forces behavior models to declare the mechanic's precision
   * (spec 5.1.1) instead of silently inheriting a default.
   */
  precision: GamePrecision;
  /** Starting accumulator value, rounded to `precision` first. Defaults to 0. */
  initial?: number;
}

/**
 * Left-to-right summation with rounding after every operation.
 *
 * `sumOrdered([a, b, c], { precision: 'f32' })` computes
 * `fround(fround(fround(0 + a) + b) + c)` — exactly the game's accumulation
 * when it adds float values in array order. Pass the values in the order the
 * behavior model documents for the game (spec 5.1.1: "summation order
 * follows the game's order where it affects results"); reordering inputs
 * changes the result and is a modeling decision, not an optimization.
 *
 * An empty list returns the (rounded) `initial`.
 */
export function sumOrdered(values: readonly number[], options: SumOptions): number {
  const round = (x: number): number =>
    options.precision === 'f32' ? Math.fround(x) : x;
  let acc = round(options.initial ?? 0);
  for (const value of values) acc = round(acc + value);
  return acc;
}

/** Left-to-right binary32 summation (every partial sum rounded to f32). */
export function sumF32(values: readonly number[], initial = 0): number {
  return sumOrdered(values, { precision: 'f32', initial });
}

/** Left-to-right binary64 summation (every partial sum a plain double add). */
export function sumF64(values: readonly number[], initial = 0): number {
  return sumOrdered(values, { precision: 'f64', initial });
}
