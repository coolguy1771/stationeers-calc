/**
 * Deterministic numerics (FND-05a; spec 5.1.1, 5.5).
 *
 * Everything a Verified calculation may use for arithmetic: explicit-precision
 * float ops with fround discipline, ordered summation, deterministic
 * transcendentals (documented algorithms, sub-ulp error bounds), and
 * bit-level helpers for fixture comparison. See `README.md` in this package
 * for the precision discipline and the algorithm/error table.
 */

export {
  f32FromWord,
  f32Word,
  f64Abs,
  f64FromWords,
  f64Words,
  ulpDistance,
  withHighWord,
  withLowWord,
} from './bits';
export {
  addF32,
  addF64,
  divF32,
  divF64,
  mulF32,
  mulF64,
  roundToGamePrecision,
  sqrtF32,
  subF32,
  subF64,
  sumF32,
  sumF64,
  sumOrdered,
} from './floats';
export type { GamePrecision, SumOptions } from './floats';
export { scalbn } from './scalbn';
export { exp, log, log2, pow, sqrt } from './transcendentals';
