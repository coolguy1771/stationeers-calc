import { useSyncExternalStore } from 'react';
import {
  createStore,
  type Command,
  type Project,
  type RevisionId,
  type Store,
  type StoreResult,
} from '@stationeers/domain';
import { toast } from 'sonner';
import { demoProject } from '../mocks/demoProject';

/**
 * Canonical model store ↔ UI adapter (spec 2.2, 2.2.1; backlog FND-04).
 *
 * `projectStore` is THE authoritative project document of the app: one store,
 * one project, commands in, patches + monotonic revisions out. Components read
 * it through `useProjectSnapshot()` and mutate it only through
 * `dispatchProjectCommand` / `undoProject` / `redoProject`. React Flow, PixiJS
 * and Zustand never hold project data (2.2); Zustand keeps transient UI state
 * only — see the seam comment in `./uiStore.ts`.
 *
 * Persistence is wired on top of this store in `./persistence.ts`; export in
 * `./exportProject.ts`. Both read `projectStore.state` and never write to it.
 */
export const projectStore: Store = createStore({ project: demoProject });

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

/**
 * Rebuilds the snapshot only when the store's revision moved, so
 * `useSyncExternalStore` sees a referentially stable value between commits.
 * Undo and redo bump the revision too, so `canUndo`/`canRedo` stay in sync.
 */
function getSnapshot(): ProjectSnapshot {
  if (snapshot.revision !== projectStore.revision) snapshot = readSnapshot();
  return snapshot;
}

function subscribe(onStoreChange: () => void): () => void {
  return projectStore.subscribe(onStoreChange);
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
