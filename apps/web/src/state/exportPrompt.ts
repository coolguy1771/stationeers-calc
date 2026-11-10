import { useEffect, useSyncExternalStore } from 'react';
import {
  clearExportPromptDismissal,
  dismissExportPrompt as rememberDismissal,
  isExportPromptDismissed,
} from './projectPrefs';
import { projectStore, projectStoreGeneration } from './projectStore';

/**
 * Export nudge (spec 2.1: "prompt for export"; 7.1: "prompt for export as in
 * 2.1"). IndexedDB is the only copy of a project and browsers may evict it, so
 * after significant work the shell asks for a portable backup.
 *
 * "Significant work" is counted in committed revisions of the open project
 * since the last export (or since the project was opened). The count is a
 * session signal: revisions are not persisted, so a reload restarts the count.
 * Dismissal IS remembered per project (`./projectPrefs.ts`), so the nudge never
 * returns for a project the user has waved away — until they export it, which
 * clears the dismissal.
 */

/** Committed revisions after which the export nudge appears (7.1 / 2.1). */
export const EXPORT_PROMPT_REVISION_THRESHOLD = 25;

export interface ExportPromptSnapshot {
  readonly visible: boolean;
  /** Project the count belongs to (the open project). */
  readonly projectId: string | null;
  /** Committed revisions since the last export or since the project was opened. */
  readonly revisions: number;
  readonly threshold: number;
}

let baselineRevision = projectStore.revision;
let baselineGeneration = projectStoreGeneration();
let dismissed = isExportPromptDismissed(projectStore.state.meta.id);
let snapshot: ExportPromptSnapshot = computeSnapshot();
const listeners = new Set<() => void>();
let detachStore: (() => void) | undefined;

function computeSnapshot(): ExportPromptSnapshot {
  const revisions = Math.max(0, projectStore.revision - baselineRevision);
  return {
    visible: revisions >= EXPORT_PROMPT_REVISION_THRESHOLD && !dismissed,
    projectId: projectStore.state.meta.id,
    revisions,
    threshold: EXPORT_PROMPT_REVISION_THRESHOLD,
  };
}

function notify(): void {
  const next = computeSnapshot();
  if (
    next.visible === snapshot.visible &&
    next.projectId === snapshot.projectId &&
    next.revisions === snapshot.revisions
  ) {
    return;
  }
  snapshot = next;
  for (const listener of listeners) listener();
}

/** A different project (or a swapped store) starts a fresh count and dismissal. */
function resetBaseline(): void {
  baselineRevision = projectStore.revision;
  baselineGeneration = projectStoreGeneration();
  dismissed = isExportPromptDismissed(projectStore.state.meta.id);
}

function onStoreChange(): void {
  if (
    projectStoreGeneration() !== baselineGeneration ||
    projectStore.state.meta.id !== snapshot.projectId
  ) {
    resetBaseline();
  }
  notify();
}

/** Starts counting committed revisions for the open project (idempotent). */
export function ensureExportPromptTracking(): void {
  detachStore ??= projectStore.subscribe(onStoreChange);
}

/** Stops counting and drops subscribers (tests, teardown). */
export function resetExportPrompt(): void {
  detachStore?.();
  detachStore = undefined;
  listeners.clear();
  resetBaseline();
  snapshot = computeSnapshot();
}

export function getExportPromptSnapshot(): ExportPromptSnapshot {
  return snapshot;
}

export function subscribeExportPrompt(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Hides the nudge for this project for good (until the project is exported). */
export function dismissExportPrompt(): void {
  rememberDismissal(projectStore.state.meta.id);
  dismissed = true;
  notify();
}

/**
 * Records an export of `projectId` (7.1): the dismissal is cleared and, for the
 * open project, the revision count starts over.
 */
export function markProjectExported(projectId: string): void {
  clearExportPromptDismissal(projectId);
  if (projectId === projectStore.state.meta.id) {
    dismissed = false;
    baselineRevision = projectStore.revision;
  }
  notify();
}

/** Export-nudge state for the workspace shell (2.1). */
export function useExportPrompt(): ExportPromptSnapshot {
  useEffect(() => {
    ensureExportPromptTracking();
  }, []);
  return useSyncExternalStore(subscribeExportPrompt, getExportPromptSnapshot);
}
