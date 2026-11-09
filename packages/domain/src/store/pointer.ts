/**
 * RFC 6901 JSON Pointer encoding and decoding for the patch engine.
 *
 * Internal to the store; patches in the log are pointer strings so they stay
 * plain RFC 6902 on disk.
 */
import { StoreError, StoreErrorCode } from './errors';

/** Escapes one reference token: `~` → `~0`, `/` → `~1` (encode ~ first). */
export function escapeToken(token: string): string {
  return token.replaceAll('~', '~0').replaceAll('/', '~1');
}

/** Decodes one reference token: `~1` → `/`, `~0` → `~` (decode / first). */
function unescapeToken(token: string): string {
  return token.replaceAll('~1', '/').replaceAll('~0', '~');
}

/**
 * Builds a pointer from reference tokens. Requires at least one token: the
 * store never emits root-level operations (a project document cannot be
 * replaced or removed wholesale through a patch).
 */
export function buildPointer(tokens: readonly string[]): string {
  if (tokens.length === 0) {
    throw new Error('buildPointer requires at least one token; root pointers are invalid here.');
  }
  return `/${tokens.map(escapeToken).join('/')}`;
}

/**
 * Parses a pointer into decoded reference tokens. `''` is the whole document
 * and parses to an empty list; callers decide whether that is allowed.
 */
export function parsePointer(pointer: string): readonly string[] {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) {
    throw new StoreError(
      StoreErrorCode.PatchInvalid,
      `Malformed JSON Pointer ${JSON.stringify(pointer)}: expected '' or a '/'-prefixed pointer (RFC 6901).`,
    );
  }
  return pointer.slice(1).split('/').map(unescapeToken);
}

/**
 * Parses an array index token. `allowEnd` accepts the `-` append marker
 * (valid only as the final token of an `add` path, per RFC 6902 §4.1).
 * Returns `-1` as the append sentinel when allowed; leading zeros and other
 * non-index tokens are rejected as malformed, not as missing paths.
 */
export function parseArrayIndex(token: string, allowEnd: boolean): number {
  if (allowEnd && token === '-') return -1;
  if (!/^(0|[1-9][0-9]*)$/.test(token)) {
    throw new StoreError(
      StoreErrorCode.PatchInvalid,
      `Malformed array index ${JSON.stringify(token)} in pointer (RFC 6901).`,
    );
  }
  const index = Number(token);
  if (!Number.isSafeInteger(index)) {
    throw new StoreError(
      StoreErrorCode.PatchInvalid,
      `Array index ${JSON.stringify(token)} is not a safe integer.`,
    );
  }
  return index;
}
