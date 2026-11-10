/**
 * Sanitization of user display strings (spec 9.4).
 *
 * Imported projects and packs are untrusted; control characters are not
 * meaningful display text and must never reach the UI.
 */
import { z } from './zod';
import type { Z } from './zod';

/** C0 (U+0000–U+001F) and C1 (U+007F–U+009F) control characters. */
// oxlint-disable-next-line eslint/no-control-regex -- matching control chars is this helper's purpose (9.4 sanitization)
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;

/** Strip control characters from a user-facing display string. */
export function sanitizeDisplayString(value: string): string {
  return value.replace(CONTROL_CHARS, '');
}

/** A display string schema that strips control characters at every boundary. */
export function displayString(maxLength: number): Z.ZodType<string> {
  return z.string().max(maxLength).transform(sanitizeDisplayString);
}
