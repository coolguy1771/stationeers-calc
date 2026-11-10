import { useSyncExternalStore } from 'react';
import {
  createStore,
  type Command,
  type Project,
  type RevisionId,
  type Store,
  type StoreListener,
  type StoreResult,
} from '@stationeers/domain';
import { toast } from 'sonner';
import { demoProject } from '../mocks/demoProject';

/**
 * Canonical model store ↔ UI adapter (spec 2.2, 2.2.1; backlog FND-04).
 *
 * `projectStore` is THE authoritative project document of the app: one open
 * project at a time, commands in, patches + monotonic revisions out.
 * Components read it through `useProjectSnapshot()` and mutate it only through
 * `dispatchProjectCommand` / `undoProject` / `redoProject`. React Flow, PixiJS
 * and Zustand never hold project data (2.2); Zustand keeps transient UI state
 * only — see the seam comment in `./uiStore.ts`.
 *
 * `projectStore` is a stable facade over a *swappable* store: opening another
 * project replaces the underlying store (`swapProjectInStore`, called by
 * `./projectLibrary.ts`), so imports and `useSyncExternalStore` subscriptions
 * survive the switch — but a swap restarts the revision stream at 0 and clears
 * the command log/undo history, because the canonical store has no
 * whole-project replace command (FND-04 gap, see below).
 *
 * Persistence is wired on top of this store in `./persistence.ts`; export in
 * `./exportProject.ts`. Both read `projectStore.state` and never write to it.
 */

/** The store holding the currently open project; replaced by `swapProjectInStore`. */
let current: Store = createStore({ project: demoProject });

/**
 * Bumped on every swap. Callers that cache anything derived from a store
 * (snapshot memo, autosave bookkeeping) watch it to tell "a commit moved the
 * revision" apart from "a different project was opened".
 */
let generation = 0;

interface OpenSubscription {
  readonly listener: StoreListener;
  detachFrom: () => void;
}

/** Subscribers of the facade, re-attached to each new store on swap. */
const subscriptions = new Set<OpenSubscription>();

/** The generation of the currently open store (see `swapProjectInStore`). */
export function projectStoreGeneration(): number {
  return generation;
}

/**
 * Replaces the open project: a fresh store is created from `project` (validated
 * and sanitized by `createStore`, 9.4), every subscriber is re-attached to it
 * and notified, and the revision stream restarts at 0 with an empty command log.
 *
 * This is the store's only "open a different document" capability. Restoring a
 * snapshot or undoing across a swap would need a canonical command that
 * replaces the whole project as a revision-changing edit; the store vocabulary
 * has none (FND-04 gap), so callers accept the reset instead of faking one.
 */
export function swapProjectInStore(project: Project): void {
  current = createStore({ project });
  generation += 1;
  for (const subscription of subscriptions) {
    subscription.detachFrom = current.subscribe(subscription.listener);
    // Notify through the facade so React re-reads the snapshot for the new store.
    subscription.listener();
  }
}

function subscribe(listener: StoreListener): () => void {
  const subscription: OpenSubscription = { listener, detachFrom: current.subscribe(listener) };
  subscriptions.add(subscription);
  return () => {
    subscriptions.delete(subscription);
    subscription.detachFrom();
  };
}

export const projectStore: Store = {
  get state() {
    return current.state;
  },
  get revision() {
    return current.revision;
  },
  get revisionId() {
    return current.revisionId;
  },
  get canUndo() {
    return current.canUndo;
  },
  get canRedo() {
    return current.canRedo;
  },
  dispatch: (command: Command) => current.dispatch(command),
  undo: () => current.undo(),
  redo: () => current.redo(),
  isStale: (revisionId: RevisionId) => current.isStale(revisionId),
  isCurrent: (revisionId: RevisionId) => current.isCurrent(revisionId),
  exportLog: () => current.exportLog(),
  subscribe,
};

/** Everything a view needs to render one revision of the project. */
export interface ProjectSnapshot {
  readonly project: Project;
  readonly revision: number;
  /** `String(revision)` — the id worker jobs and results are tagged with (5.6). */
  readonly revisionId: RevisionId;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

function readSnapshot(): ProjectSnapshot {
  return {
    project: projectStore.state,
    revision: projectStore.revision,
    revisionId: projectStore.revisionId,
    canUndo: projectStore.canUndo,
    canRedo: projectStore.canRedo,
  };
}

let snapshot: ProjectSnapshot = readSnapshot();
let snapshotGeneration = generation;

/**
 * Rebuilds the snapshot only when the store's revision moved or a different
 * project was opened, so `useSyncExternalStore` sees a referentially stable
 * value between commits. Undo and redo bump the revision too, so
 * `canUndo`/`canRedo` stay in sync.
 */
function getSnapshot(): ProjectSnapshot {
  if (snapshotGeneration !== generation || snapshot.revision !== projectStore.revision) {
    snapshotGeneration = generation;
    snapshot = readSnapshot();
  }
  return snapshot;
}

/** Subscribes a component to the canonical store (re-renders per revision). */
export function useProjectSnapshot(): ProjectSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/** The canonical project document of the current revision. */
export function useProject(): Project {
  return useProjectSnapshot().project;
}

/**
 * Applies one command. Never throws: a rejected command returns a `StoreResult`
 * carrying a stable `StoreError` (spec 8) and leaves state and revision intact.
 */
export function dispatchProjectCommand(command: Command): StoreResult {
  return projectStore.dispatch(command);
}

/** Replays the inverse of the last command; bumps the revision (2.2.1). */
export function undoProject(): StoreResult {
  return projectStore.undo();
}

/** Replays the next command in the redo tail; bumps the revision (2.2.1). */
export function redoProject(): StoreResult {
  return projectStore.redo();
}

/**
 * Dispatch and surface a rejection as a diagnostic toast instead of failing
 * silently. Use this from UI handlers; use `dispatchProjectCommand` where the
 * caller wants the raw `StoreResult`.
 */
export function runProjectCommand(command: Command): StoreResult {
  const result = dispatchProjectCommand(command);
  if (!result.ok) {
    toast.error(result.error.code, {
      description: `${result.error.message} (rule ${result.error.rule})`,
    });
  }
  return result;
}
