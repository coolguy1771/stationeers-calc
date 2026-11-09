/**
 * Canonical JSON (EXT-01): deterministic serialization used for content
 * comparison, manifest hashing, and byte-identical output files.
 *
 * Object keys are sorted lexicographically; arrays keep their order (the
 * IR is a list of records in scan order, which is itself deterministic).
 * `undefined` properties are omitted. Numbers are serialized by
 * `JSON.stringify` (Bun's number-to-string is deterministic for the values
 * the pipeline produces).
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalJson(item));
    return `[${items.join(',')}]`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value)
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .sort();
    const parts = keys.map((key) => {
      const item = (value as Record<string, unknown>)[key];
      return `${JSON.stringify(key)}:${canonicalJson(item)}`;
    });
    return `{${parts.join(',')}}`;
  }
  // function, symbol, undefined, bigint: not serializable in the IR.
  throw new Error(`canonicalJson: unsupported value type ${typeof value}`);
}
