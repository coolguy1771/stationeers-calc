/**
 * Record with a bounded key count (spec 9.4: bound graph sizes, entity counts, and nesting).
 */
import { z } from './zod';
import type { Z } from './zod';

export function boundedRecord<K extends Z.ZodType<string>, V extends Z.ZodType<unknown>>(
  key: K,
  value: V,
  max: number,
) {
  return z.record(key, value).superRefine((obj, ctx) => {
    if (Object.keys(obj).length > max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Record exceeds ${max} keys`,
        path: [],
      });
    }
  });
}
