import { useSyncExternalStore } from 'react';
import { serializeProject, type ProjectBundle } from '@stationeers/domain';
import {
  createAutosave,
  openProjectStore,
  requestPersistentStorage,
  type AutosaveHandle,
  type ProjectStore,
  type SaveStatus as AutosaveStatus,
} from '@stationeers/persistence';
import { toast } from 'sonner';
import { projectStore, projectStoreGeneration } from './projectStore';

/**
 * Autosave ↔ UI adapter (spec 2.2.1, 2.1, 7.1; backlog FND-03 + FND-04 wiring).
 *
 * Every committed revision of the OPEN project is written to IndexedDB as a
 * debounced snapshot of the canonical project (`@stationeers/persistence`), and
 * the shell renders the real outcome: `dirty` while a revision awaits its
 * write, `saving` while the write runs, `saved` once it is on disk, `error`
 * when it is not. Nothing here is a placeholder machine.
 *
 * Two invariants keep the states honest now that several projects exist (7.1):
 *
 * 1. Autosave follows the open project. A store swap (`swapProjectInStore`) is
 *    adopted as "this project is on disk as of `meta.updatedAt`" — the project
 *    library persists a project before opening it, so starting a session must
 *    not rewrite it just because it is open.
 * 2. Switching never drops work: `flushAutosave()` awaits the pending write
 *    and reports its outcome before the caller swaps (`loadProjectIntoStore`).
 *
 * Durability (2.1): the first save requests persistent storage and surfaces the
 * granted/denied result.
 */

/** Visible save state of the project on this device (7.1). */
export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error';

/** Outcome of the persistent-storage request (2.1); `unknown` before the first save. */
export type PersistentStorageState = 'unknown' | 'granted' | 'denied';

export interface PersistenceSnapshot {
  readonly status: SaveStatus;
  readonly persistentStorage: PersistentStorageState;
  /** Project the save state belongs to — the open project (7.1); `null` before autosave starts. */
  readonly projectId: string | null;
  /** ISO time of the last successful write of the open project; `null` when unknown. */
  readonly lastSavedAt: string | null;
}

/** Default autosave debounce, in milliseconds. */
export const SAVE_DEBOUNCE_MS = 600;

export interface PersistenceOptions {
  /** Dexie-backed project store; tests inject fake-indexeddb-backed instances. */
  readonly store?: ProjectStore;
  /** Autosave debounce in milliseconds (2.2.1 "debounced snapshots"). */
  readonly delayMs?: number;
  /** Persistent-storage request; injectable so tests never hit the real API. */
  readonly requestStorage?: () => Promise<boolean>;
}

// ------------------------------------------------------------- module state --

let started = false;
let status: SaveStatus = 'dirty';
let persistentStorage: PersistentStorageState = 'unknown';
let activeProjectId: string | null = null;
let lastSavedAt: string | null = null;
let snapshot: PersistenceSnapshot = buildSnapshot();
const listeners = new Set<() => void>();

let autosave: AutosaveHandle | undefined;
let unsubscribeStore: (() => void) | undefined;
let storageRequest: (() => Promise<boolean>) | undefined;
let storageRequested = false;
/** Newest revision handed to autosave. */
let requestedRevision = 0;
/** Revision captured when the running write started. */
let writingRevision = 0;
/** Newest revision a completed write covered. */
let writtenRevision = 0;
/** Set while `schedule()` emits its synchronous `saving` (queued, not running). */
let queueing = false;
/** Store generation the current bookkeeping belongs to (see `adoptOpenProject`). */
let adoptedGeneration = 0;
/** True while the open project has no stored record to write to (see `suspendAutosave`). */
let suspended = false;

function buildSnapshot(): PersistenceSnapshot {
  return { status, persistentStorage, projectId: activeProjectId, lastSavedAt };
}

function notify(): void {
  snapshot = buildSnapshot();
  for (const listener of listeners) listener();
}

function setStatus(next: SaveStatus): void {
  if (status === next) return;
  status = next;
  notify();
}

function setPersistentStorage(next: PersistentStorageState): void {
  if (persistentStorage === next) return;
  persistentStorage = next;
  notify();
}

// ---------------------------------------------------------------- autosave --

/**
 * The bundle to persist, stamped with the save time. The canonical store never
 * reads a clock (5.1.1): the persistence layer stamps `meta.updatedAt`.
 */
function stampedBundle(): ProjectBundle {
  const bundle = serializeProject(projectStore.state);
  return { ...bundle, meta: { ...bundle.meta, updatedAt: new Date().toISOString() } };
}

function scheduleSave(revision: number): void {
  const handle = autosave;
  if (handle === undefined || suspended) return;
  requestedRevision = revision;
  queueing = true;
  try {
    handle.schedule(stampedBundle());
  } finally {
    queueing = false;
  }
  // `schedule()` reports `saving` as soon as a write is QUEUED. The write has
  // not started yet, so the shell keeps the honest `dirty` state until the
  // helper reports progress asynchronously.
  setStatus('dirty');
}

/**
 * Store notification. A swap (new generation) is not an edit: autosave adopts
 * the newly opened project instead of writing the old one under the new id.
 */
function onStoreChange(): void {
  if (projectStoreGeneration() !== adoptedGeneration) {
    adoptOpenProject();
    return;
  }
  if (suspended) return;
  scheduleSave(projectStore.revision);
}

/**
 * Takes the open project as the autosave target: its revision stream restarts
 * at 0 on a swap, so the written/requested bookkeeping resets with it, and the
 * state is `saved` because the project library persists a project before it is
 * opened (or before it replaces the open one).
 *
 * Deliberately does NOT lift `suspended`: adoption says "this is the project
 * autosave is about", not "this project has a stored record". `resumeAutosave`
 * is called by the library when it opens a project that does have one.
 */
function adoptOpenProject(): void {
  adoptedGeneration = projectStoreGeneration();
  activeProjectId = projectStore.state.meta.id;
  lastSavedAt = projectStore.state.meta.updatedAt;
  requestedRevision = projectStore.revision;
  writingRevision = requestedRevision;
  writtenRevision = requestedRevision;
  status = 'saved';
  notify();
}

function onAutosaveStatus(next: AutosaveStatus): void {
  if (queueing) return;
  switch (next.state) {
    case 'saving':
      // The write captured the newest bundle queued at this moment.
      writingRevision = requestedRevision;
      setStatus('saving');
      break;
    case 'saved':
      writtenRevision = Math.max(writtenRevision, writingRevision);
      // `at` is the stamp on the bundle that was written: the record's save time.
      lastSavedAt = next.at;
      setStatus(writtenRevision >= projectStore.revision ? 'saved' : 'dirty');
      void ensurePersistentStorage();
      break;
    case 'error':
      // The revision stays unwritten; the next commit retries.
      setStatus('error');
      break;
    case 'idle':
      break;
  }
}

/**
 * Requests persistent storage once, on the first successful save, and shows the
 * result (2.1: "request persistent storage and show the result").
 */
async function ensurePersistentStorage(): Promise<void> {
  if (storageRequested) return;
  storageRequested = true;
  const request = storageRequest ?? requestPersistentStorage;
  let granted = false;
  try {
    granted = await request();
  } catch {
    granted = false;
  }
  setPersistentStorage(granted ? 'granted' : 'denied');
  if (granted) {
    toast.success('Persistent storage granted', {
      description: 'The browser keeps local project data instead of evicting it (spec 2.1).',
    });
  } else {
    toast.warning('Persistent storage unavailable', {
      description:
        'The browser may evict local projects. Export a bundle as your backup — there is no server copy (spec 2.1).',
    });
  }
}

// ------------------------------------------------------------------ public --

/**
 * Starts autosave for the canonical store. Idempotent: the workspace shell calls
 * it from an effect. The open project is adopted as already on disk (the
 * project library persists a project before it is opened), so only committed
 * revisions are written.
 */
export function startPersistence(options: PersistenceOptions = {}): void {
  if (started) return;
  started = true;
  storageRequest = options.requestStorage;
  autosave = createAutosave(options.store ?? openProjectStore(), {
    delayMs: options.delayMs ?? SAVE_DEBOUNCE_MS,
  });
  autosave.onStatus(onAutosaveStatus);
  // Every committed command, undo and redo produces a snapshot to write (2.2.1);
  // a swap re-points autosave at the newly opened project instead.
  unsubscribeStore = projectStore.subscribe(onStoreChange);
  adoptOpenProject();
}

/**
 * Waits for the pending write and returns the save status afterwards. Project
 * switching calls this before swapping the store, so unsaved work is either on
 * disk or reported as failed — never dropped silently (7.1).
 *
 * Returns `saved` when autosave is not running: nothing has been queued, so
 * there is nothing to lose.
 */
export async function flushAutosave(): Promise<SaveStatus> {
  if (autosave === undefined) return 'saved';
  await autosave.flush();
  return status;
}

/**
 * Stops writing the open project (7.1 delete): its record no longer exists, so
 * autosave must not recreate it behind the user's back. The pending write is
 * cancelled and the save state reverts to `saved` — there is no record left to
 * be unsaved about. Opening a stored project resumes writing (`resumeAutosave`,
 * called by `loadProjectIntoStore`).
 */
export function suspendAutosave(): void {
  suspended = true;
  autosave?.cancel();
  status = 'saved';
  notify();
}

/** Resumes writing the open project after it was suspended (delete, then open). */
export function resumeAutosave(): void {
  suspended = false;
}

/**
 * Stops autosave and drops subscribers. The app keeps persistence alive for its
 * whole lifetime; this exists so tests can restart it and future hot-reload code
 * can tear it down.
 */
export function stopPersistence(): void {
  autosave?.dispose();
  autosave = undefined;
  unsubscribeStore?.();
  unsubscribeStore = undefined;
  listeners.clear();
  started = false;
  storageRequested = false;
  storageRequest = undefined;
  status = 'dirty';
  persistentStorage = 'unknown';
  activeProjectId = null;
  lastSavedAt = null;
  snapshot = buildSnapshot();
  requestedRevision = 0;
  writingRevision = 0;
  writtenRevision = 0;
  adoptedGeneration = projectStoreGeneration();
  suspended = false;
}

/** Current save state and storage durability (7.1, 2.1). */
export function getPersistenceSnapshot(): PersistenceSnapshot {
  return snapshot;
}

/** Non-React subscription to save-state changes; returns an unsubscribe function. */
export function subscribePersistence(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Save status + storage durability for the shell. Subscription only: call
 * `startPersistence()` once (the workspace shell does) to begin saving.
 */
export function usePersistence(): PersistenceSnapshot {
  return useSyncExternalStore(subscribePersistence, getPersistenceSnapshot);
}
