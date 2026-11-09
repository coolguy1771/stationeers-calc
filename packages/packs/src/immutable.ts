/**
 * Recursively freeze plain data so a shared pack cannot be mutated by one
 * consumer under another (packs are read-only data once built or loaded).
 * Returns its input for chaining.
 */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return value;
}
