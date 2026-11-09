import { describe, expect, it } from 'vitest';
import { useUiStore } from './uiStore';

/** Transient UI state coverage (spec 2.1 seam) — no project data may live here. */
describe('uiStore — transient UI state (spec 2.1 seam)', () => {
  it('defaults to an unselected, tab-less state', () => {
    const state = useUiStore.getState();
    expect(state.activeProjectId).toBeNull();
    expect(state.activeTab).toBeNull();
    expect(state.selection).toBeNull();
  });

  it('holds only transient UI keys — save status and project data are elsewhere', () => {
    const state = useUiStore.getState();
    expect(Object.keys(state).sort()).toEqual([
      'activeProjectId',
      'activeTab',
      'selection',
      'setActiveProject',
      'setActiveTab',
      'setSelection',
    ]);
  });

  it('tracks the shared selection (SYNC-004) and workspace tab', () => {
    const { setActiveProject, setActiveTab, setSelection } = useUiStore.getState();
    setActiveProject('mock.project.atmos');
    setActiveTab('analysis');
    setSelection({ kind: 'device-instance', id: 'mock.inst.mixer-1' });
    const state = useUiStore.getState();
    expect(state.activeProjectId).toBe('mock.project.atmos');
    expect(state.activeTab).toBe('analysis');
    expect(state.selection).toEqual({ kind: 'device-instance', id: 'mock.inst.mixer-1' });
    // Reset so other test files (which share the module store) start clean.
    setActiveProject(null);
    setActiveTab(null);
    setSelection(null);
  });
});
