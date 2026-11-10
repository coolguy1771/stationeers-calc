// @vitest-environment jsdom
import './test/flowEnvironment';
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from './App';
import { mockCalculationResult } from './mocks';
import { stopPersistence } from './state/persistence';
import { projectStore } from './state/projectStore';

const PROJECT = projectStore.state.meta;

afterEach(() => {
  cleanup();
  stopPersistence();
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

describe('app shell — routes resolve (UI-01)', () => {
  it('renders the projects list at / from the project database (7.1)', async () => {
    renderAt('/');
    expect(screen.getByRole('heading', { level: 1, name: /stationeers engineer/i })).toBeInTheDocument();
    // The list is read from IndexedDB; the first run seeds the demo project once.
    expect((await screen.findAllByText(PROJECT.name)).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /new project/i })).toBeInTheDocument();
  });

  it('opens a project workspace with top bar, tabs, and the schematic editor', async () => {
    const user = userEvent.setup();
    renderAt('/');
    await user.click((await screen.findAllByText(PROJECT.name))[0]!);

    // Workspace shell: project name in the top bar…
    expect(screen.getByText(PROJECT.name)).toBeInTheDocument();
    // …pinned pack + hash…
    expect(screen.getAllByText(new RegExp(PROJECT.packId)).length).toBeGreaterThan(0);
    // …all four tabs…
    for (const label of ['Schematic', 'Physical Layout', 'Catalog', 'Analysis']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    // …and the schematic editor itself (UI-02): canvas + intents inspector.
    expect(screen.getByRole('region', { name: 'Schematic canvas' })).toBeInTheDocument();
    expect(screen.getByText(/Connection intents/i)).toBeInTheDocument();
  });

  it('serves each tab route directly (deep link)', () => {
    renderAt('/project/mock.project.atmos/catalog');
    expect(screen.getByLabelText('Search catalog')).toBeInTheDocument();
    expect(screen.getByText('Active Vent')).toBeInTheDocument();
  });

  it('redirects /project/:id to the schematic tab', () => {
    renderAt('/project/mock.project.atmos');
    expect(screen.getByRole('region', { name: 'Schematic canvas' })).toBeInTheDocument();
  });

  it('renders the analysis tab with the dual-status result (Verified + Conceptual, never exact)', () => {
    renderAt('/project/mock.project.atmos/analysis');
    // Both independent statuses render side by side (spec 3.5).
    expect(document.querySelector('[data-model-status="verified"]')).toBeInTheDocument();
    expect(document.querySelector('[data-topology-status="conceptual"]')).toBeInTheDocument();
    expect(screen.getByText('Correct mechanics — assumed topology')).toBeInTheDocument();
    expect(screen.queryByText('Exact')).not.toBeInTheDocument();
    expect(screen.getByText(mockCalculationResult.capabilityId)).toBeInTheDocument();
    expect(screen.getByText(/Provenance/i)).toBeInTheDocument();
  });

  it('shows the /design showcase with every status vocabulary section', () => {
    renderAt('/design');
    expect(screen.getByRole('heading', { level: 1, name: /design system/i })).toBeInTheDocument();
    for (const section of [
      /Model status \(5\.2\)/i,
      /Topology status \(3\.5\)/i,
      /Data quality \(6\.5\)/i,
    ]) {
      expect(screen.getByRole('heading', { level: 2, name: section })).toBeInTheDocument();
    }
  });

  it('falls back to a not-found page for unknown routes and unknown project ids', async () => {
    renderAt('/nowhere');
    expect(screen.getByText(/no such route/i)).toBeInTheDocument();
    cleanup();
    renderAt('/project/does-not-exist');
    // The workspace asks the project database; an id it does not hold is unknown.
    expect(await screen.findByText(/unknown project id/i)).toBeInTheDocument();
  });
});
