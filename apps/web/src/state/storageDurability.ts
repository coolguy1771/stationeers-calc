/**
 * Storage durability probe (spec 2.1 "show storage usage and quota in
 * settings", 11 "Safari may evict site storage"; backlog QA-02).
 *
 * Reading only: nothing here decides where projects live — that is
 * `./persistence.ts` (autosave) and `./projectLibrary.ts` (the database). This
 * module answers "is this browser keeping the data, and how close is the
 * origin to its quota?", degrades to explicit `unsupported` states where the
 * Storage API is missing (Safari < 15, jsdom), and is written against an
 * injectable `StorageManagerLike` so every branch is unit-tested.
 */

/** Outcome of `navigator.storage.persist()` / `persisted()`. */
export type PersistenceState = 'granted' | 'denied' | 'unsupported' | 'unknown';

/** How close usage is to the origin quota. */
export type StorageUsageLevel = 'unknown' | 'ok' | 'high' | 'critical';

/** Usage fraction at which the panel warns (spec 11: no silent full disk). */
export const STORAGE_HIGH_RATIO = 0.75;
/** Usage fraction at which the panel escalates to "export now". */
export const STORAGE_CRITICAL_RATIO = 0.9;

/** The subset of `navigator.storage` used here. */
export interface StorageManagerLike {
  persisted?: () => Promise<boolean>;
  persist?: () => Promise<boolean>;
  estimate?: () => Promise<{ usage?: number | undefined; quota?: number | undefined }>;
}

export interface StorageDurabilitySnapshot {
  /** Persistent-storage grant; `unsupported` when the API is absent. */
  readonly persistence: PersistenceState;
  /** Bytes used by this origin, or `null` when unknown. */
  readonly usage: number | null;
  /** Bytes available to this origin, or `null` when unknown. */
  readonly quota: number | null;
  readonly level: StorageUsageLevel;
  /** True when `navigator.storage` exists at all. */
  readonly supported: boolean;
  /** Failure detail from a rejected probe; shown, never swallowed. */
  readonly error: string | null;
}

/** `navigator.storage` where the API exists. */
export function defaultStorageManager(): StorageManagerLike | undefined {
  if (typeof navigator === 'undefined') return undefined;
  const storage = (navigator as Navigator & { storage?: StorageManagerLike })
    .storage;
  return storage;
}

/**
 * Human-readable byte size. Binary units, because that is what browsers report
 * and what the quota tooling speaks; `null`/`undefined` reads "unavailable"
 * instead of a fabricated zero.
 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) {
    return 'unavailable';
  }
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'] as const;
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unitIndex]}`;
}

/** Usage against quota → warning level. Unknown numbers stay `unknown`. */
export function usageLevel(
  usage: number | null,
  quota: number | null,
): StorageUsageLevel {
  if (usage === null || quota === null || quota <= 0) return 'unknown';
  const ratio = usage / quota;
  if (ratio >= STORAGE_CRITICAL_RATIO) return 'critical';
  if (ratio >= STORAGE_HIGH_RATIO) return 'high';
  return 'ok';
}

/** Reads grant state and estimate; never throws. */
export async function readStorageDurability(
  api: StorageManagerLike | undefined = defaultStorageManager(),
): Promise<StorageDurabilitySnapshot> {
  if (api === undefined) {
    return {
      persistence: 'unsupported',
      usage: null,
      quota: null,
      level: 'unknown',
      supported: false,
      error: null,
    };
  }

  let persistence: PersistenceState = 'unsupported';
  let error: string | null = null;
  if (api.persisted !== undefined) {
    try {
      persistence = (await api.persisted()) ? 'granted' : 'denied';
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
      persistence = 'unknown';
    }
  }

  let usage: number | null = null;
  let quota: number | null = null;
  if (api.estimate !== undefined) {
    try {
      const estimate = await api.estimate();
      usage = typeof estimate.usage === 'number' ? estimate.usage : null;
      quota = typeof estimate.quota === 'number' ? estimate.quota : null;
    } catch (cause) {
      error = error ?? (cause instanceof Error ? cause.message : String(cause));
    }
  }

  return {
    persistence,
    usage,
    quota,
    level: usageLevel(usage, quota),
    supported: true,
    error,
  };
}

/**
 * Requests persistent storage (2.1) and re-reads the estimate. A browser that
 * cannot grant it, or grants less, is reported exactly — the caller decides how
 * loudly to say it.
 */
export async function requestStorageDurability(
  api: StorageManagerLike | undefined = defaultStorageManager(),
): Promise<StorageDurabilitySnapshot> {
  if (api === undefined || api.persist === undefined) {
    return readStorageDurability(api);
  }
  let error: string | null = null;
  try {
    await api.persist();
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  }
  const snapshot = await readStorageDurability(api);
  return error === null ? snapshot : { ...snapshot, error };
}
