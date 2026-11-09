/**
 * Deterministic `scalbn(x, n)` = x · 2^n computed with round-to-nearest.
 *
 * Port of musl libc `src/math/scalbn.c` (Rich Felker et al., MIT license —
 * notice preserved per license terms). Operation order is kept identical to
 * the C original so results are bit-identical across platforms.
 *
 * Scaling by powers of two is exact except at overflow/underflow
 * boundaries; the staged multiplies avoid double-rounding in the subnormal
 * range (see the comment in the C source).
 */

import { f64FromWords } from './bits';

const TWO_POW_1023 = f64FromWords(0x7fe00000, 0); // 0x1p1023
const TWO_POW_M969 = f64FromWords(0x03600000, 0); // 0x1p-1022 * 0x1p53 = 0x1p-969

export function scalbn(x: number, n: number): number {
  let y = x;
  if (n > 1023) {
    y *= TWO_POW_1023;
    n -= 1023;
    if (n > 1023) {
      y *= TWO_POW_1023;
      n -= 1023;
      if (n > 1023) n = 1023;
    }
  } else if (n < -1022) {
    // Make sure final n < -53 to avoid double rounding in the subnormal range.
    y *= TWO_POW_M969;
    n += 1022 - 53;
    if (n < -1022) {
      y *= TWO_POW_M969;
      n += 1022 - 53;
      if (n < -1022) n = -1022;
    }
  }
  const scale = f64FromWords((0x3ff + n) << 20, 0);
  return y * scale;
}
