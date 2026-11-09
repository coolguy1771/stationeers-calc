import { create } from 'zustand';
import type { EntityId } from '@stationeers/domain';

/*
 * SPEC SEAM — canonical model store (FND-04) and persistence wiring.
 *
 * This store is TRANSIENT UI STATE ONLY (spec 2.1: "Zustand for transient UI
 * state only (selection, hover, tool mode, viewport)"). The canonical project
 * model — devices, placements, construction, connections, intents, scenarios,
 * settings — lives in the single canonical store in `./projectStore.ts`, with
 * command/patch log, inverse patches, monotonic revision IDs, and undo/redo
 * (spec 2.2.1). Both editors re-derive their views from that store, so nothing
 * here may ever hold project data: what is listed below is UI-only and is
 * allowed to be lost on reload. Save status is not here either — it is a real
 * persistence outcome, not a UI flag.
 */

/** Workspace tabs (spec 3: dual editor + catalog + analysis). */
export type WorkspaceTab = 'schematic' | 'physical' | 'catalog' | 'analysis';

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
  setActiveProject: (id: EntityId | null) => void;
  setActiveTab: (tab: WorkspaceTab | null) => void;
  setSelection: (selection: SelectionRef) => void;
}

export const useUiStore = create<UiState>()((set) => ({
  activeProjectId: null,
  activeTab: null,
  selection: null,
  setActiveProject: (id) => set({ activeProjectId: id }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setSelection: (selection) => set({ selection }),
}));
