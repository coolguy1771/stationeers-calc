/**
 * Deterministic ordering helpers (spec 5.5): identical inputs must yield
 * identical output in every engine, so ordering never depends on the runtime.
 */

/**
 * String comparison by UTF-16 code units.
 *
 * Never `localeCompare`: its result depends on the runtime locale and would
 * break the cross-engine determinism contract (spec 5.5).
 */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
