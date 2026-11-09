// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '../App';
import { definitionById } from '../mocks';
import { listProjects, openProjectStore } from '@stationeers/persistence';
import { getPersistenceSnapshot, stopPersistence } from '../state/persistence';
import { projectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';

const PROJECT_ID = projectStore.state.meta.id;

function displayNameOf(definitionId: string): string {
  return definitionById(definitionId)?.displayName ?? definitionId;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  stopPersistence();
  // Roll the canonical store back to the seeded revision so tests in this file
  // (and the module-level store they share) start from the same state.
  while (projectStore.canUndo) projectStore.undo();
  useUiStore.getState().setSelection(null);
});

/**
 * The workspace against the canonical store (spec 2.2, 2.2.1): what renders is
 * the store's state, mutations are commands, and undo replays inverse patches.
 */
describe('workspace — canonical store integration', () => {
  it('renders the demo project from the store, not from a static import', () => {
    expect(projectStore.state.intents.length).toBeGreaterThan(0);
    const intent = projectStore.state.intents[0]!;

    renderAt(`/project/${PROJECT_ID}/schematic`);

    // The intent card shows the store's intent…
    expect(screen.getByText(intent.label!)).toBeInTheDocument();
    expect(document.querySelector(`[data-store-revision="${projectStore.revision}"]`)).toBeInTheDocument();

    // …and disappears when the store commits without it.
    act(() => {
      projectStore.dispatch({ type: 'removeEntity', collection: 'intents', id: intent.id });
    });
    expect(projectStore.state.intents).toHaveLength(0);
    cleanup();
    renderAt(`/project/${PROJECT_ID}/schematic`);
    expect(screen.queryByText(intent.label!)).not.toBeInTheDocument();
    expect(screen.getByText(/No connection intents/i)).toBeInTheDocument();
  });

  it('deletes an intent through a command and undo restores it', async () => {
    const user = userEvent.setup();
    const intent = projectStore.state.intents[0]!;
    const revisionBefore = projectStore.revision;

    renderAt(`/project/${PROJECT_ID}/schematic`);
    const undoButton = screen.getByRole('button', { name: 'Undo' });
    expect(undoButton).toBeDisabled();

    await user.click(screen.getByRole('button', { name: `Delete intent ${intent.label}` }));

    // The command committed a revision and the projection re-derived.
    expect(projectStore.revision).toBe(revisionBefore + 1);
    expect(projectStore.state.intents).toHaveLength(0);
    expect(screen.queryByText(intent.label!)).not.toBeInTheDocument();

    // Undo replays the stored inverse patch: same revision stream, intent back.
    expect(undoButton).toBeEnabled();
    await user.click(undoButton);

    expect(projectStore.revision).toBe(revisionBefore + 2);
    expect(projectStore.state.intents).toHaveLength(1);
    expect(screen.getByText(intent.label!)).toBeInTheDocument();

    // Redo is available after undo, and re-deletes the intent.
    await user.click(screen.getByRole('button', { name: 'Redo' }));
    expect(projectStore.state.intents).toHaveLength(0);
  });

  it('undoes and redoes with Ctrl+Z / Shift+Ctrl+Z', async () => {
    const user = userEvent.setup();
    const intent = projectStore.state.intents[0]!;

    renderAt(`/project/${PROJECT_ID}/schematic`);
    await user.click(screen.getByRole('button', { name: `Delete intent ${intent.label}` }));
    expect(projectStore.state.intents).toHaveLength(0);

    await user.keyboard('{Control>}z{/Control}');
    expect(projectStore.state.intents).toHaveLength(1);

    await user.keyboard('{Control>}{Shift>}z{/Shift}{/Control}');
    expect(projectStore.state.intents).toHaveLength(0);
  });

  it('leaves text fields their own undo stack', async () => {
    const user = userEvent.setup();
    const intent = projectStore.state.intents[0]!;
    act(() => {
      projectStore.dispatch({ type: 'removeEntity', collection: 'intents', id: intent.id });
    });

    renderAt(`/project/${PROJECT_ID}/catalog`);
    const search = screen.getByLabelText('Search catalog');
    await user.click(search);
    await user.keyboard('{Control>}z{/Control}');

    // The catalog search box has focus, so the keystroke is not a project command.
    expect(projectStore.state.intents).toHaveLength(0);
  });

  it('reads device instances from the store in the physical tab', () => {
    renderAt(`/project/${PROJECT_ID}/physical`);
    const list = screen.getByRole('region', { name: 'Devices on this level' });
    for (const device of projectStore.state.devices) {
      // Each instance is listed with its placed/unplaced state (SYNC-001/002).
      expect(within(list).getAllByText(displayNameOf(device.definitionId)).length).toBeGreaterThan(0);
    }
    expect(within(list).getAllByText(/^(placed|unplaced)$/).length).toBe(projectStore.state.devices.length);
  });

  it('shares one device selection across the schematic, physical and catalog views (SYNC-004)', async () => {
    const user = userEvent.setup();
    const [first, second] = projectStore.state.devices;
    // Editors label a chip with its definition, the catalog with the instance id.
    const editorLabel = (definitionId: string) => displayNameOf(definitionId);
    const catalogLabel = (id: string) => id.replace('mock.inst.', '');

    renderAt(`/project/${PROJECT_ID}/schematic`);
    await user.click(screen.getByRole('button', { name: editorLabel(first!.definitionId) }));

    // Selecting in the schematic sets the one shared selection…
    expect(useUiStore.getState().selection).toEqual({ kind: 'device-instance', id: first!.id });

    // …the physical layout shows the same instance selected…
    await user.click(screen.getByRole('link', { name: /Physical Layout/i }));
    expect(screen.getByRole('button', { name: editorLabel(first!.definitionId) })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // …the catalog agrees, and selecting another instance there moves the selection.
    await user.click(screen.getByRole('link', { name: /Catalog/i }));
    expect(screen.getByRole('button', { name: catalogLabel(first!.id) })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(screen.getByRole('button', { name: catalogLabel(second!.id) }));
    expect(useUiStore.getState().selection).toEqual({ kind: 'device-instance', id: second!.id });

    // Back in the schematic, the newly selected instance is the pressed one.
    await user.click(screen.getByRole('link', { name: /Schematic/i }));
    expect(screen.getByRole('button', { name: editorLabel(second!.definitionId) })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: editorLabel(first!.definitionId) })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('marks the analysis result stale once the store moves past its revision (5.6)', () => {
    renderAt(`/project/${PROJECT_ID}/analysis`);

    // Fresh: the result is tagged with the revision it was computed on.
    const freshTag = document.querySelector('[data-result-revision]');
    expect(freshTag).toBeInTheDocument();
    expect(screen.queryByText(/project changed since this result/i)).not.toBeInTheDocument();
    expect(document.querySelector('[data-stale-result="true"]')).not.toBeInTheDocument();

    // A committed command bumps the revision, so the tagged result is now stale…
    act(() => {
      projectStore.dispatch({ type: 'renameProject', name: 'Renamed while analysing' });
    });

    expect(screen.getByText(/project changed since this result/i)).toBeInTheDocument();
    const staleTag = document.querySelector('[data-stale-result="true"]');
    expect(staleTag).toHaveAttribute('data-result-revision', freshTag!.getAttribute('data-result-revision'));
    expect(staleTag).toHaveTextContent(new RegExp(`now at revision ${projectStore.revision}`));

    // The dual-status vocabulary is untouched by staleness (3.5): still never exact.
    expect(document.querySelector('[data-model-status="verified"]')).toBeInTheDocument();
    expect(document.querySelector('[data-topology-status="conceptual"]')).toBeInTheDocument();
    expect(screen.queryByText('Exact')).not.toBeInTheDocument();
  });

  it('writes the seeded project to IndexedDB after the autosave debounce', async () => {
    renderAt(`/project/${PROJECT_ID}/schematic`);
    const localStore = openProjectStore();

    // Real autosave against the real Dexie store (fake-indexeddb above): the
    // workspace effect started persistence, and the debounce writes the project.
    await vi.waitFor(
      async () => {
        const records = await listProjects(localStore);
        expect(records.map((record) => record.id)).toContain(PROJECT_ID);
      },
      { timeout: 3000 },
    );

    expect(getPersistenceSnapshot().status).toBe('saved');
    expect(screen.getByText(/^Saved$/)).toBeInTheDocument();
  });
});
