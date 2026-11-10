// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { demoProject } from '../mocks/demoProject';
import {
  EXPORT_PROMPT_REVISION_THRESHOLD,
  ensureExportPromptTracking,
  resetExportPrompt,
} from '../state/exportPrompt';
import { dispatchProjectCommand, projectStore, swapProjectInStore } from '../state/projectStore';
import { ExportPromptBanner } from './ExportPromptBanner';

function commit(count: number): void {
  act(() => {
    for (let index = 0; index < count; index += 1) {
      dispatchProjectCommand({ type: 'renameProject', name: `Revision ${index}` });
    }
  });
}

beforeEach(() => {
  localStorage.clear();
  swapProjectInStore(demoProject);
  resetExportPrompt();
  ensureExportPromptTracking();
});

afterEach(() => {
  cleanup();
  resetExportPrompt();
  swapProjectInStore(demoProject);
});

/**
 * The export nudge as the user meets it (spec 2.1, 7.1): a non-blocking banner
 * in the workspace that can be waved away for this project.
 */
describe('export prompt banner (2.1)', () => {
  it('stays out of the way until the revision threshold, then offers an export', () => {
    render(<ExportPromptBanner />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    commit(EXPORT_PROMPT_REVISION_THRESHOLD);

    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent(
      new RegExp(`${EXPORT_PROMPT_REVISION_THRESHOLD} revisions since your last export`),
    );
    expect(screen.getByRole('button', { name: /export now/i })).toBeInTheDocument();
  });

  it('remembers a dismissal for the project', async () => {
    const user = userEvent.setup();
    render(<ExportPromptBanner />);
    commit(EXPORT_PROMPT_REVISION_THRESHOLD);

    await user.click(screen.getByRole('button', { name: /not now/i }));

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(
      localStorage.getItem(`stationeers.export-prompt.dismissed.${projectStore.state.meta.id}`),
    ).not.toBeNull();
  });
});
