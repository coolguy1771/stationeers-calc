/**
 * Deterministic serialization and hashing for packs (spec 6.4: content hashes;
 * 9.4: corruption detection).
 *
 * `canonicalJson` sorts object keys so a pack's bytes do not depend on key
 * insertion order — the builder must be able to reproduce a pack byte for byte
 * from the same inputs, and the loader must recompute the same content hash
 * from a file that a JSON round-trip may have reordered. Arrays keep their
 * order: the builder canonicalizes entity order itself (sorted by id).
 *
 * This mirrors `tools/extractor/src/canonical.ts` (build-time) on purpose: the
 * runtime package must not depend on the extraction tool.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    const keys = Object.keys(object)
      .filter((key) => object[key] !== undefined)
      .sort();
    const parts = keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`);
    return `{${parts.join(',')}}`;
  }
  throw new Error(`canonicalJson: unsupported value type ${typeof value}`);
}

/**
 * Code-unit ordering for ids, property names, and every other string a pack
 * diff sorts. Explicit (never locale-aware) so output order is a property of the
 * data, not of the machine that ran the diff.
 */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * SHA-256 of a string or byte sequence, lowercase hex.
 *
 * Uses WebCrypto so the same code hashes in the browser loader and in the Bun
 * CLI; `packages/persistence` uses the same primitive for project bundles.
 */
export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Content hash of a pack: SHA-256 over canonical JSON with `contentHash`
 * removed, so a pack can carry its own digest (spec 6.4, 9.4).
 */
export async function contentHashOf(packWithoutHash: object): Promise<string> {
  return sha256Hex(canonicalJson(packWithoutHash));
}

/** A shallow copy of a pack object without its `contentHash` field. */
export function withoutContentHash(pack: object): Record<string, unknown> {
  const { contentHash: _contentHash, ...rest } = pack as Record<string, unknown>;
  return rest;
}
