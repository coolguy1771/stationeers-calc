/**
 * Text inputs keep their own native edit/undo stack; editor-level keyboard
 * shortcuts (undo/redo in `state/undoRedo.ts`, delete on the schematic canvas)
 * must not steal their keystrokes.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
}
