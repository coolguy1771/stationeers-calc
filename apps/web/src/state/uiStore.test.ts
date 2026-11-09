import { describe, expect, it } from 'vitest';
import { useUiStore } from './uiStore';

/** Light state-machine coverage for the transient save-status placeholder (7.1). */
describe('uiStore — transient UI state (spec 2.1 seam)', () => {
  it('defaults to a saved, unselected, tab-less state', () => {
    const state = useUiStore.getState();
    expect(state.activeProjectId).toBeNull();
    expect(state.activeTab).toBeNull();
    expect(state.selection).toBeNull();
    expect(state.saveStatus).toBe('saved');
  });

  it('walks the full save-status machine', () => {
    const { setSaveStatus } = useUiStore.getState();
    setSaveStatus('dirty');
    expect(useUiStore.getState().saveStatus).toBe('dirty');
    setSaveStatus('saving');
    expect(useUiStore.getState().saveStatus).toBe('saving');
    setSaveStatus('error');
    expect(useUiStore.getState().saveStatus).toBe('error');
    setSaveStatus('saved');
    expect(useUiStore.getState().saveStatus).toBe('saved');
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
