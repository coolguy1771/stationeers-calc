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
import { projectStore } from './projectStore';

/**
 * Autosave ↔ UI adapter (spec 2.2.1, 2.1, 7.1; backlog FND-03 + FND-04 wiring).
 *
 * Every committed revision is written to IndexedDB as a debounced snapshot of
 * the canonical project (`@stationeers/persistence`), and the shell renders the
 * real outcome: `dirty` while a revision awaits its write, `saving` while the
 * write runs, `saved` once it is on disk, `error` when it is not. Nothing here
 * is a placeholder machine.
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
let snapshot: PersistenceSnapshot = { status, persistentStorage };
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

function notify(): void {
  snapshot = { status, persistentStorage };
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
  if (handle === undefined) return;
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
 * it from an effect, and the first call also queues the seeded project's initial
 * write (it has never been persisted).
 */
export function startPersistence(options: PersistenceOptions = {}): void {
  if (started) return;
  started = true;
  storageRequest = options.requestStorage;
  requestedRevision = 0;
  writingRevision = 0;
  writtenRevision = 0;
  autosave = createAutosave(options.store ?? openProjectStore(), {
    delayMs: options.delayMs ?? SAVE_DEBOUNCE_MS,
  });
  autosave.onStatus(onAutosaveStatus);
  // Every committed command, undo and redo produces a snapshot to write (2.2.1).
  unsubscribeStore = projectStore.subscribe(() => scheduleSave(projectStore.revision));
  scheduleSave(projectStore.revision);
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
  snapshot = { status, persistentStorage };
  requestedRevision = 0;
  writingRevision = 0;
  writtenRevision = 0;
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
