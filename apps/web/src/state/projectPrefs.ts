/**
 * Local, per-project preferences (spec 7.1, 2.1).
 *
 * Two things about a project are deliberately NOT part of the project document:
 *
 * - **Archived** — a soft flag (7.1 "archive"): the project is hidden from the
 *   default list and never deleted. `@stationeers/persistence`'s `ProjectRecord`
 *   has no archive/UI metadata field, and autosave rewrites that record whole,
 *   so the flag lives here, next to the export-prompt dismissal, instead of
 *   being smuggled into an untracked Dexie field that the next save would drop.
 *   GAP: a first-class `archived` field on `ProjectRecord` would make the flag
 *   part of the stored project instead of device-local UI state.
 * - **Export-prompt dismissal** (2.1: export is the backup, so nag until the
 *   user says "not now") — dismissal is remembered per project.
 *
 * Everything here is best-effort device-local state: storage can be unavailable
 * (private mode, quota), so every read falls back to the in-memory value and
 * nothing throws.
 */

/** Key of the first-run demo seed marker (7.1: seed once, never re-seed). */
const DEMO_SEED_KEY = 'stationeers.projects.demo-seeded';
/** Key holding the JSON array of archived project ids. */
const ARCHIVED_KEY = 'stationeers.projects.archived';
/** Per-project export-prompt dismissal key prefix. */
const EXPORT_DISMISSED_PREFIX = 'stationeers.export-prompt.dismissed.';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** In-memory fallback so behaviour is identical when storage is unavailable. */
const memory = new Map<string, string>();

function storage(): StorageLike | undefined {
  try {
    if (typeof localStorage === 'undefined') return undefined;
    return localStorage;
  } catch {
    return undefined;
  }
}

function read(key: string): string | null {
  const store = storage();
  if (store !== undefined) {
    try {
      // Storage is the source of truth while it is available and writable;
      // the in-memory copy only substitutes when it is not.
      return store.getItem(key);
    } catch {
      // Fall through to the in-memory copy.
    }
  }
  return memory.get(key) ?? null;
}

function write(key: string, value: string): void {
  memory.set(key, value);
  const store = storage();
  try {
    store?.setItem(key, value);
  } catch {
    // Quota or a locked-down storage: the in-memory copy still serves this session.
  }
}

function remove(key: string): void {
  memory.delete(key);
  const store = storage();
  try {
    store?.removeItem(key);
  } catch {
    // Ignore: nothing to clean up when storage is unavailable.
  }
}

// ---------------------------------------------------------------- demo seed --

/** True once the first-run demo seed decision has been made on this device. */
export function hasSeededDemoProject(): boolean {
  return read(DEMO_SEED_KEY) !== null;
}

/** Records that the demo seed ran (or that the database already had projects). */
export function markDemoProjectSeeded(): void {
  write(DEMO_SEED_KEY, new Date().toISOString());
}

// ------------------------------------------------------------------ archive --

function readArchived(): Set<string> {
  const raw = read(ARCHIVED_KEY);
  if (raw === null) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((id): id is string => typeof id === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

function writeArchived(ids: Set<string>): void {
  write(ARCHIVED_KEY, JSON.stringify([...ids].sort()));
}

/** True when the project is archived (hidden from the default list, still stored). */
export function isProjectArchived(projectId: string): boolean {
  return readArchived().has(projectId);
}

/** Archives or unarchives a project (7.1: archive is a soft flag, never a delete). */
export function setProjectArchivedPreference(projectId: string, archived: boolean): void {
  const ids = readArchived();
  if (archived) ids.add(projectId);
  else ids.delete(projectId);
  writeArchived(ids);
}

// ----------------------------------------------------------- export prompt --

/** True when the user dismissed the export nudge for this project (2.1). */
export function isExportPromptDismissed(projectId: string): boolean {
  return read(`${EXPORT_DISMISSED_PREFIX}${projectId}`) !== null;
}

/** Remembers a dismissal for this project. */
export function dismissExportPrompt(projectId: string): void {
  write(`${EXPORT_DISMISSED_PREFIX}${projectId}`, new Date().toISOString());
}

/** Forgets a dismissal — an export happened, so the nudge may earn its place again. */
export function clearExportPromptDismissal(projectId: string): void {
  remove(`${EXPORT_DISMISSED_PREFIX}${projectId}`);
}

/** Drops every preference belonging to a deleted project. */
export function forgetProjectPreferences(projectId: string): void {
  setProjectArchivedPreference(projectId, false);
  clearExportPromptDismissal(projectId);
}
