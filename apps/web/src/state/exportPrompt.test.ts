// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { demoProject } from '../mocks/demoProject';
import {
  EXPORT_PROMPT_REVISION_THRESHOLD,
  dismissExportPrompt,
  ensureExportPromptTracking,
  getExportPromptSnapshot,
  markProjectExported,
  resetExportPrompt,
} from './exportPrompt';
import { dispatchProjectCommand, projectStore, swapProjectInStore } from './projectStore';

/** Commits `count` revisions through the canonical store (renames are cheap and undoable). */
function commit(count: number): void {
  for (let index = 0; index < count; index += 1) {
    dispatchProjectCommand({ type: 'renameProject', name: `Revision ${index}` });
  }
}

beforeEach(() => {
  localStorage.clear();
  swapProjectInStore(demoProject);
  resetExportPrompt();
  ensureExportPromptTracking();
});

afterEach(() => {
  resetExportPrompt();
  swapProjectInStore(demoProject);
});

/**
 * Export nudge (spec 2.1, 7.1): it appears once significant work has piled up
 * since the last export, and a dismissal is remembered per project.
 */
describe('export prompt — significant work since the last export (2.1)', () => {
  it('appears at the revision threshold, not before', () => {
    expect(getExportPromptSnapshot()).toMatchObject({
      visible: false,
      revisions: 0,
      threshold: EXPORT_PROMPT_REVISION_THRESHOLD,
    });

    commit(EXPORT_PROMPT_REVISION_THRESHOLD - 1);
    expect(getExportPromptSnapshot().visible).toBe(false);
    expect(getExportPromptSnapshot().revisions).toBe(EXPORT_PROMPT_REVISION_THRESHOLD - 1);

    commit(1);
    expect(getExportPromptSnapshot().visible).toBe(true);
    expect(getExportPromptSnapshot().revisions).toBe(EXPORT_PROMPT_REVISION_THRESHOLD);
  });

  it('remembers a dismissal for the project, across reloads', () => {
    commit(EXPORT_PROMPT_REVISION_THRESHOLD);
    expect(getExportPromptSnapshot().visible).toBe(true);

    dismissExportPrompt();
    expect(getExportPromptSnapshot().visible).toBe(false);

    // A reload restarts the session counter, but the dismissal is on disk.
    resetExportPrompt();
    ensureExportPromptTracking();
    commit(EXPORT_PROMPT_REVISION_THRESHOLD);
    expect(getExportPromptSnapshot().visible).toBe(false);
  });

  it('dismissal is per project', () => {
    commit(EXPORT_PROMPT_REVISION_THRESHOLD);
    dismissExportPrompt();

    swapProjectInStore({ ...demoProject, meta: { ...demoProject.meta, id: 'project.other' } });
    commit(EXPORT_PROMPT_REVISION_THRESHOLD);
    expect(getExportPromptSnapshot().visible).toBe(true);
  });

  it('an export clears the dismissal and restarts the count', () => {
    const projectId = projectStore.state.meta.id;
    commit(EXPORT_PROMPT_REVISION_THRESHOLD);
    dismissExportPrompt();

    markProjectExported(projectId);

    expect(getExportPromptSnapshot().visible).toBe(false);
    expect(getExportPromptSnapshot().revisions).toBe(0);
    commit(EXPORT_PROMPT_REVISION_THRESHOLD);
    expect(getExportPromptSnapshot().visible).toBe(true);
  });

  it('a project switch starts a fresh count', () => {
    commit(EXPORT_PROMPT_REVISION_THRESHOLD);
    expect(getExportPromptSnapshot().visible).toBe(true);

    swapProjectInStore({ ...demoProject, meta: { ...demoProject.meta, id: 'project.second' } });

    expect(getExportPromptSnapshot()).toMatchObject({
      visible: false,
      revisions: 0,
      projectId: 'project.second',
    });
  });
});
