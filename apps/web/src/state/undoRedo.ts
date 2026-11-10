import { useEffect } from 'react';
import { toast } from 'sonner';
import type { StoreResult } from '@stationeers/domain';
import { isEditableTarget } from '../lib/dom';
import { projectStore, redoProject, undoProject, useProjectSnapshot } from './projectStore';

/**
 * Undo/redo over the canonical command log (spec 2.2.1, SYNC-010: undo/redo
 * affects the canonical model and every projection re-derives from it).
 *
 * The store owns the log and the cursor; this module only exposes the cursor as
 * disabled states plus the two actions the shell buttons and the keyboard
 * shortcuts share.
 */
export interface UndoRedoState {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undo: () => void;
  readonly redo: () => void;
}

function report(result: StoreResult, label: string): void {
  if (result.ok) return;
  toast.error(`${label} unavailable`, { description: result.error.message });
}

/** Undo the last committed command and surface an unexpected rejection. */
export function undoLastCommand(): void {
  report(undoProject(), 'Undo');
}

/** Redo the next command in the redo tail and surface an unexpected rejection. */
export function redoLastCommand(): void {
  report(redoProject(), 'Redo');
}

/** Cursor state + stable actions for the shell controls. */
export function useUndoRedo(): UndoRedoState {
  const { canUndo, canRedo } = useProjectSnapshot();
  return { canUndo, canRedo, undo: undoLastCommand, redo: redoLastCommand };
}

/**
 * Ctrl/Cmd+Z undoes, Shift+Ctrl/Cmd+Z redoes. Attached once by the workspace
 * shell; the store's cursor decides whether a keystroke does anything.
 */
export function useUndoRedoShortcuts(): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (event.key.toLowerCase() !== 'z') return;
      if (isEditableTarget(event.target)) return;
      if (event.shiftKey) {
        if (!projectStore.canRedo) return;
        event.preventDefault();
        redoLastCommand();
        return;
      }
      if (!projectStore.canUndo) return;
      event.preventDefault();
      undoLastCommand();
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
