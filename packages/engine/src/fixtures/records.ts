/**
 * Bounded record for fixture documents (spec 9.4: bound collection sizes).
 *
 * Mirrors the domain's internal `boundedRecord` helper, which is deliberately
 * not exported from `@stationeers/domain`: fixture documents have their own
 * bounds (`limits.ts`) and must not borrow the project model's.
 */
import * as z from 'zod';

export function boundedRecord<K extends z.ZodType<string>, V extends z.ZodType<unknown>>(
  key: K,
  value: V,
  max: number,
) {
  return z.record(key, value).superRefine((obj, ctx) => {
    if (Object.keys(obj).length > max) {
      ctx.addIssue({
        code: 'custom',
        message: `Record exceeds ${max} keys`,
        path: [],
      });
    }
  });
}
