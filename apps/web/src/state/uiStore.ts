import { create } from 'zustand';
import type { EntityId } from '@stationeers/domain';

/*
 * SPEC SEAM — canonical model store (FND-04, wave 2).
 *
 * This store is TRANSIENT UI STATE ONLY (spec 2.1: "Zustand for transient UI
 * state only (selection, hover, tool mode, viewport)"). The canonical project
 * model — devices, placements, construction, connections, intents, scenarios,
 * settings — never lives here. It belongs to the single canonical store
 * outside any rendering library, with command/patch log, inverse patches,
 * monotonic revision IDs, and undo/redo (spec 2.2.1); both editors re-derive
 * their views from it. When FND-04 lands, selectors over the canonical store
 * replace the mock data in `src/mocks/` one-for-one — no UI code above this
 * seam should change.
 */

/** Workspace tabs (spec 3: dual editor + catalog + analysis). */
export type WorkspaceTab = 'schematic' | 'physical' | 'catalog' | 'analysis';

/** Save-state placeholder machine (7.1 "show unsaved/error states").
 * Wired to real persistence in FND-03/FND-04; the indicator already consumes it. */
export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error';

/** Shared selection across both editors (SYNC-004) — one instance id. */
export type SelectionRef =
  | { kind: 'device-instance'; id: EntityId }
  | { kind: 'intent'; id: EntityId }
  | { kind: 'network'; id: EntityId }
  | null;

interface UiState {
  activeProjectId: EntityId | null;
  activeTab: WorkspaceTab | null;
  selection: SelectionRef;
  saveStatus: SaveStatus;
  setActiveProject: (id: EntityId | null) => void;
  setActiveTab: (tab: WorkspaceTab | null) => void;
  setSelection: (selection: SelectionRef) => void;
  setSaveStatus: (status: SaveStatus) => void;
}

export const useUiStore = create<UiState>()((set) => ({
  activeProjectId: null,
  activeTab: null,
  selection: null,
  saveStatus: 'saved',
  setActiveProject: (id) => set({ activeProjectId: id }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setSelection: (selection) => set({ selection }),
  setSaveStatus: (saveStatus) => set({ saveStatus }),
}));
