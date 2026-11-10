// @vitest-environment jsdom
import '../test/flowEnvironment';
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { listProjects, listSnapshots, openProjectStore } from '@stationeers/persistence';
import { AppRoutes } from '../App';
import { demoProject } from '../mocks/demoProject';
import { stopPersistence } from '../state/persistence';
import {
  configureProjectLibrary,
  ensureProjectLibrary,
  getProjectLibrarySnapshot,
  resetProjectLibrary,
} from '../state/projectLibrary';
import { swapProjectInStore } from '../state/projectStore';

const DEMO_ID = demoProject.meta.id;
const DEMO_NAME = demoProject.meta.name;

let db: ReturnType<typeof openProjectStore>;

beforeEach(async () => {
  db = openProjectStore();
  await db.projects.clear();
  await db.snapshots.clear();
  localStorage.clear();
  stopPersistence();
  swapProjectInStore(demoProject);
  configureProjectLibrary(db);
});

afterEach(() => {
  cleanup();
  stopPersistence();
  resetProjectLibrary();
  swapProjectInStore(demoProject);
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

/** The card for a project, addressed by its stored id. */
async function cardFor(projectId: string): Promise<HTMLElement> {
  const selector = `[data-project-id="${projectId}"]`;
  await waitFor(() => {
    expect(document.querySelector(selector)).not.toBeNull();
  });
  return document.querySelector(selector) as HTMLElement;
}

async function openCardMenu(projectId: string, name: string): Promise<void> {
  const user = userEvent.setup();
  await cardFor(projectId);
  await user.click(screen.getByRole('button', { name: `Actions for ${name}` }));
}

/**
 * The projects page against the real database (7.1): the list is what is
 * stored, and every affordance is a real create / archive / delete / import.
 */
describe('projects page — real project management (7.1)', () => {
  it('lists stored projects with their last-saved time', async () => {
    renderAt('/');

    const card = await cardFor(DEMO_ID);
    expect(within(card).getByText(DEMO_NAME)).toBeInTheDocument();
    // Last-saved time comes from the stored record, not from the mock timestamps.
    expect(within(card).getByText(/^Saved /)).toBeInTheDocument();
    expect(within(card).getByText(new RegExp(demoProject.meta.packId))).toBeInTheDocument();
  });

  it('creates a project from the dialog and opens it', async () => {
    const user = userEvent.setup();
    renderAt('/');
    await cardFor(DEMO_ID);

    await user.click(screen.getByRole('button', { name: /new project/i }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), 'Cold start base');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));

    // The new project was saved and the workspace opened on it.
    expect(await screen.findByRole('heading', { level: 1, name: 'Cold start base' })).toBeInTheDocument();
    const records = await listProjects(db);
    expect(records.map((record) => record.name).sort()).toEqual([DEMO_NAME, 'Cold start base'].sort());
  });

  it('validates the name in the dialog', async () => {
    const user = userEvent.setup();
    renderAt('/');
    await cardFor(DEMO_ID);

    await user.click(screen.getByRole('button', { name: /new project/i }));
    const dialog = await screen.findByRole('dialog');
    // Whitespace only: the submit button stays disabled.
    await user.type(within(dialog).getByLabelText('Name'), '   ');
    expect(within(dialog).getByRole('button', { name: 'Create' })).toBeDisabled();
    // Over-long names are rejected with the same bound the schema uses.
    await user.clear(within(dialog).getByLabelText('Name'));
    await user.type(within(dialog).getByLabelText('Name'), 'x'.repeat(201));
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/200 characters/);
    expect(await listProjects(db)).toHaveLength(1);
  });

  it('archives a project (hidden by default, never deleted) and shows it again', async () => {
    const user = userEvent.setup();
    renderAt('/');
    await openCardMenu(DEMO_ID, DEMO_NAME);

    await user.click(await screen.findByRole('menuitem', { name: /^archive$/i }));

    // Hidden from the default list, still stored.
    await screen.findByRole('heading', { name: /every project is archived/i });
    expect(await listProjects(db)).toHaveLength(1);

    await user.click(screen.getAllByRole('button', { name: /show archived/i })[0]!);
    expect(await cardFor(DEMO_ID)).toBeInTheDocument();
    expect(within(await cardFor(DEMO_ID)).getByText(/archived/i)).toBeInTheDocument();
  });

  it('deletes a project after a confirmation that names it, leaving an empty state that offers create', async () => {
    const user = userEvent.setup();
    renderAt('/');
    await openCardMenu(DEMO_ID, DEMO_NAME);

    await user.click(await screen.findByRole('menuitem', { name: /delete/i }));
    const dialog = await screen.findByRole('dialog');
    // The confirmation names the project and says snapshots go with it.
    expect(within(dialog).getByText(new RegExp(`${DEMO_NAME}.*and its snapshots`))).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: new RegExp(`^Delete “${DEMO_NAME}”`) }));

    expect(await screen.findByRole('heading', { name: /no projects yet/i })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /new project/i }).length).toBeGreaterThan(0);
    expect(await listProjects(db)).toHaveLength(0);
  });

  it('renames a project from the card menu', async () => {
    const user = userEvent.setup();
    renderAt('/');
    await openCardMenu(DEMO_ID, DEMO_NAME);

    await user.click(await screen.findByRole('menuitem', { name: /rename/i }));
    const dialog = await screen.findByRole('dialog');
    const field = within(dialog).getByLabelText('Name');
    await user.clear(field);
    await user.type(field, 'Renamed base');
    await user.click(within(dialog).getByRole('button', { name: 'Rename' }));

    expect(await screen.findByText('Renamed base')).toBeInTheDocument();
    const records = await listProjects(db);
    expect(records[0]!.bundle.meta.name).toBe('Renamed base');
  });

  it('takes and lists a named snapshot from the card menu', async () => {
    const user = userEvent.setup();
    renderAt('/');
    await openCardMenu(DEMO_ID, DEMO_NAME);

    await user.click(await screen.findByRole('menuitem', { name: /snapshots/i }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/no snapshots yet/i)).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText('Snapshot name'), 'Before reroute');
    await user.click(within(dialog).getByRole('button', { name: /take snapshot/i }));

    expect(await within(dialog).findByText('Before reroute')).toBeInTheDocument();
    const stored = await listSnapshots(db, DEMO_ID);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.name).toBe('Before reroute');
  });

  it('reports a rejected import on the page and stores nothing', async () => {
    const user = userEvent.setup();
    renderAt('/');
    await cardFor(DEMO_ID);

    const input = screen.getByLabelText('Import project bundle');
    await user.upload(input, new File(['{"nope":true}'], 'broken.json', { type: 'application/json' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/import rejected/i);
    expect(alert).toHaveTextContent(/not a/i);
    expect(await listProjects(db)).toHaveLength(1);
  });

  it('imports a valid bundle and lists it', async () => {
    const user = userEvent.setup();
    await ensureProjectLibrary();
    renderAt('/');
    await cardFor(DEMO_ID);

    // A second project exists in the database but the page was rendered before
    // it; importing the demo export re-identifies it (id already stored).
    const { buildProjectExport } = await import('../state/exportProject');
    const exported = await buildProjectExport({ ...demoProject, meta: { ...demoProject.meta, id: 'project.elsewhere' } });
    await user.upload(
      screen.getByLabelText('Import project bundle'),
      new File([exported.json], exported.filename, { type: 'application/json' }),
    );

    // Imported projects appear in the list; the page navigates into the bundle's
    // project only from the workspace top bar, so the list is the evidence here.
    expect(await screen.findByText(demoProject.meta.name, { exact: false })).toBeInTheDocument();
    expect(getProjectLibrarySnapshot().projects.map((item) => item.id)).toContain('project.elsewhere');
  });
});
