/**
 * Debounced autosave (7.1, 2.2.1): "Persistence writes debounced snapshots plus
 * the command log since the last snapshot." Save status is plain data so the
 * UI can render Saved / Saving / Error states without holding a subscription.
 */
import type { ProjectBundle } from '@stationeers/domain';
import type { ProjectStore } from './store';
import { saveProject } from './store';

/**
 * Visible save-status states (7.1): saved / saving / error as plain data.
 * `idle` is the initial state before any save is scheduled.
 */
export type SaveStatus =
  | { state: 'idle' }
  | { state: 'saving' }
  | { state: 'saved'; at: string }
  | { state: 'error'; at: string; message: string };

export interface AutosaveHandle {
  /** Schedule a save of the current bundle; replaces any pending save. */
  schedule(bundle: ProjectBundle): void;
  /** Cancel any pending save without writing. */
  cancel(): void;
  /** Flush the pending save immediately; resolves when the write finishes. */
  flush(): Promise<void>;
  /** Read the current save status. */
  getStatus(): SaveStatus;
  /** Subscribe to save-status changes; returns an unsubscribe function. */
  onStatus(listener: (status: SaveStatus) => void): () => void;
  /** Stop the timer and drop listeners; pending saves are cancelled. */
  dispose(): void;
}

export interface AutosaveOptions {
  /** Debounce delay in milliseconds. */
  delayMs?: number;
}

export function createAutosave(
  store: ProjectStore,
  options: AutosaveOptions = {},
): AutosaveHandle {
  const delayMs = options.delayMs ?? 1_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: ProjectBundle | undefined;
  let status: SaveStatus = { state: 'idle' };
  const listeners = new Set<(status: SaveStatus) => void>();
  let inFlight: Promise<void> = Promise.resolve();

  function setStatus(next: SaveStatus): void {
    status = next;
    for (const listener of listeners) listener(status);
  }

  async function write(): Promise<void> {
    const bundle = pending;
    if (!bundle) return;
    pending = undefined;
    setStatus({ state: 'saving' });
    try {
      await saveProject(store, bundle);
      setStatus({ state: 'saved', at: bundle.meta.updatedAt });
    } catch (error) {
      setStatus({ state: 'error', at: new Date().toISOString(), message: String(error) });
    }
  }

  return {
    schedule(bundle) {
      pending = bundle;
      setStatus({ state: 'saving' });
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        inFlight = inFlight.then(write);
      }, delayMs);
    },
    cancel() {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      pending = undefined;
    },
    async flush() {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      inFlight = inFlight.then(write);
      await inFlight;
    },
    getStatus() {
      return status;
    },
    onStatus(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      pending = undefined;
      listeners.clear();
    },
  };
}