import type { EntityId } from '@stationeers/domain';
import { useUiStore, type SelectionRef } from './uiStore';

/**
 * Shared selection helpers (SYNC-004, spec 2.1, 3.4).
 *
 * Selection is transient UI state, so it lives in the Zustand store — never in
 * the canonical project (2.2). The vocabulary (`device-instance`, `intent`,
 * `network`) is defined by `SelectionRef` in `./uiStore.ts`; these helpers keep
 * every view reading and writing the same single selection.
 */
export type SelectionKind = NonNullable<SelectionRef>['kind'];

/** The one shared selection; every view reads this. */
export function useSelection(): SelectionRef {
  return useUiStore((state) => state.selection);
}

/** Sets the shared selection (or clears it with `null`). */
export function useSelect(): (selection: SelectionRef) => void {
  return useUiStore((state) => state.setSelection);
}

/** True when the shared selection names this entity. */
export function isSelected(selection: SelectionRef, kind: SelectionKind, id: EntityId): boolean {
  return selection !== null && selection.kind === kind && selection.id === id;
}

/** A device-instance reference, ready for `setSelection` (SYNC-001/004). */
export function deviceSelection(id: EntityId): SelectionRef {
  return { kind: 'device-instance', id };
}
