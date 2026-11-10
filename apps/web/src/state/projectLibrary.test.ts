// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listProjects, listSnapshots, openProjectStore, type ProjectStore } from '@stationeers/persistence';
import { demoProject } from '../mocks/demoProject';
import { flushAutosave, startPersistence, stopPersistence } from './persistence';
import { hasSeededDemoProject } from './projectPrefs';
import {
  configureProjectLibrary,
  createProject,
  createProjectSnapshot,
  deleteProject,
  duplicateProject,
  ensureProjectLibrary,
  getProjectLibrarySnapshot,
  loadProjectIntoStore,
  renameProject,
  resetProjectLibrary,
  restoreProjectSnapshot,
  setProjectArchived,
  UNPINNED_PACK_ID,
  validateProjectName,
} from './projectLibrary';
import { dispatchProjectCommand, projectStore, swapProjectInStore } from './projectStore';
import { useUiStore } from './uiStore';

const DEMO_ID = demoProject.meta.id;

/**
 * Project management against a real Dexie database (fake-indexeddb, 9.4: no
 * browser needed). Every assertion reads the same store the app uses.
 */
let db: ProjectStore;

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
  stopPersistence();
  resetProjectLibrary();
  swapProjectInStore(demoProject);
  useUiStore.getState().setSelection(null);
});

function items() {
  return getProjectLibrarySnapshot().projects;
}

async function records() {
  return listProjects(db);
}

describe('project library — first run (7.1)', () => {
  it('seeds the demo project once into an empty database', async () => {
    expect(hasSeededDemoProject()).toBe(false);
    await ensureProjectLibrary();

    expect(items()).toHaveLength(1);
    expect(items()[0]).toMatchObject({ id: DEMO_ID, active: true, archived: false });
    expect(hasSeededDemoProject()).toBe(true);
    const stored = await records();
    expect(stored[0]!.bundle.meta.id).toBe(DEMO_ID);
  });

  it('never re-seeds: an emptied database stays empty', async () => {
    await ensureProjectLibrary();
    await deleteProject(DEMO_ID);
    expect(items()).toHaveLength(0);

    // Reloading the library re-reads the database; the first-run marker is kept.
    resetProjectLibrary();
    configureProjectLibrary(db);
    await ensureProjectLibrary();
    expect(items()).toHaveLength(0);
  });
});

describe('project library — create (7.1)', () => {
  it('validates names: trimmed, non-empty, length-bounded, control chars stripped', () => {
    expect(validateProjectName('  ')).toEqual({ ok: false, message: 'Enter a name.' });
    expect(validateProjectName('x'.repeat(201)).ok).toBe(false);
    expect(validateProjectName('  Base\u0000 A  ')).toEqual({ ok: true, name: 'Base A' });
  });

  it('creates an empty project with fresh meta, saves it and lists it', async () => {
    await ensureProjectLibrary();
    const created = await createProject('  New base  ');

    expect(created.name).toBe('New base');
    expect(created.id).toMatch(/^project\./);
    expect(created.id).not.toBe(DEMO_ID);
    // The pack pin is copied from the open project (no pack picker yet).
    expect(created.packId).toBe(demoProject.meta.packId);
    expect(created.packHash).toBe(demoProject.meta.packHash);

    const stored = (await records()).find((record) => record.id === created.id)!;
    expect(stored.bundle.devices).toEqual([]);
    expect(stored.bundle.settings).toEqual(demoProject.settings);
    expect(new Date(stored.createdAt).toISOString()).toBe(stored.createdAt);

    expect(items().map((item) => item.id)).toContain(created.id);
  });

  it('rejects an invalid name without storing anything', async () => {
    await ensureProjectLibrary();
    await expect(createProject('   ')).rejects.toThrow(/Enter a name/);
    await expect(createProject('x'.repeat(201))).rejects.toThrow(/200 characters/);
    expect(await records()).toHaveLength(1);
  });

  it('falls back to the honest unpinned placeholder when nothing is pinned', async () => {
    // An open project with no pack pin (pack selection lands with EXT-03).
    swapProjectInStore({
      ...demoProject,
      meta: {
        ...demoProject.meta,
        id: 'project.unpinned',
        packId: UNPINNED_PACK_ID,
        packHash: 'unpinned',
        gameBuild: 'unpinned',
      },
    });
    await ensureProjectLibrary();

    const created = await createProject('Unpinned base');

    expect(created.packId).toBe(UNPINNED_PACK_ID);
    expect(created.packHash).toBe('unpinned');
  });
});

describe('project library — rename and duplicate (7.1)', () => {
  it('renames a stored project', async () => {
    await ensureProjectLibrary();
    const created = await createProject('Old name');

    await renameProject(created.id, 'New name');

    const stored = (await records()).find((record) => record.id === created.id)!;
    expect(stored.bundle.meta.name).toBe('New name');
    expect(stored.name).toBe('New name');
    expect(items().find((item) => item.id === created.id)!.name).toBe('New name');
  });

  it('renames the open project through the canonical store and autosaves it', async () => {
    startPersistence({ store: db, delayMs: 60_000 });
    await ensureProjectLibrary();
    const created = await createProject('Draft');
    await loadProjectIntoStore(created.id);

    await renameProject(created.id, 'Draft, renamed');

    expect(projectStore.state.meta.name).toBe('Draft, renamed');
    const stored = (await records()).find((record) => record.id === created.id)!;
    expect(stored.bundle.meta.name).toBe('Draft, renamed');
  });

  it('duplicates a project with a new id, a copy name and the same content', async () => {
    await ensureProjectLibrary();
    const copy = await duplicateProject(DEMO_ID);

    expect(copy.id).not.toBe(DEMO_ID);
    expect(copy.name).toBe(`${demoProject.meta.name} (copy)`);

    const all = await records();
    const source = all.find((record) => record.id === DEMO_ID)!.bundle;
    const duplicated = all.find((record) => record.id === copy.id)!.bundle;
    expect(duplicated.devices).toEqual(source.devices);
    expect(duplicated.intents).toEqual(source.intents);
    expect(duplicated.settings).toEqual(source.settings);
    expect(duplicated.meta.id).toBe(copy.id);
  });
});

describe('project library — archive is a soft flag (7.1)', () => {
  it('hides an archived project without deleting it, and remembers the flag', async () => {
    await ensureProjectLibrary();
    await setProjectArchived(DEMO_ID, true);

    expect(items().find((item) => item.id === DEMO_ID)!.archived).toBe(true);
    expect(await records()).toHaveLength(1);

    resetProjectLibrary();
    configureProjectLibrary(db);
    await ensureProjectLibrary();
    expect(items().find((item) => item.id === DEMO_ID)!.archived).toBe(true);

    await setProjectArchived(DEMO_ID, false);
    expect(items().find((item) => item.id === DEMO_ID)!.archived).toBe(false);
  });
});

describe('project library — delete (7.1)', () => {
  it('deletes the project, its snapshots and its preferences', async () => {
    await ensureProjectLibrary();
    await setProjectArchived(DEMO_ID, true);
    await createProjectSnapshot(DEMO_ID, 'keep me');
    expect(await listSnapshots(db, DEMO_ID)).toHaveLength(1);

    await deleteProject(DEMO_ID);

    expect(await records()).toHaveLength(0);
    expect(await listSnapshots(db, DEMO_ID)).toHaveLength(0);
    expect(items()).toHaveLength(0);
    // The open project was detached; autosave must not recreate its record.
    startPersistence({ store: db, delayMs: 5 });
    dispatchProjectCommand({ type: 'renameProject', name: 'Ghost edit' });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(await records()).toHaveLength(0);

    await setProjectArchived(DEMO_ID, false);
    resetProjectLibrary();
    configureProjectLibrary(db);
    await ensureProjectLibrary();
    expect(items()).toHaveLength(0);
  });
});

describe('project library — switching projects (7.1)', () => {
  it('isolates content: edit A, switch to B, switch back to A', async () => {
    startPersistence({ store: db, delayMs: 5 });
    await ensureProjectLibrary();
    const a = await createProject('Project A');
    await loadProjectIntoStore(a.id);
    expect(projectStore.state.devices).toHaveLength(0);

    // Edit A through the canonical store, then switch without waiting.
    dispatchProjectCommand({ type: 'renameProject', name: 'A, edited' });
    useUiStore.getState().setSelection({ kind: 'intent', id: 'intent.x' });

    await loadProjectIntoStore(DEMO_ID);
    // B is untouched by A's edit, and the shared selection was reset.
    expect(projectStore.state.meta.id).toBe(DEMO_ID);
    expect(projectStore.state.meta.name).toBe(demoProject.meta.name);
    expect(projectStore.state.devices.length).toBeGreaterThan(0);
    expect(useUiStore.getState().selection).toBeNull();

    await loadProjectIntoStore(a.id);
    expect(projectStore.state.meta.name).toBe('A, edited');
    expect(projectStore.state.devices).toHaveLength(0);
  });

  it('flushes the outgoing project before switching (no dropped edit)', async () => {
    // A debounce far beyond the test: only the switch's flush can write.
    startPersistence({ store: db, delayMs: 60_000 });
    await ensureProjectLibrary();
    const a = await createProject('A');
    await loadProjectIntoStore(a.id);

    dispatchProjectCommand({ type: 'renameProject', name: 'Pending edit' });
    expect(await flushAutosave()).not.toBe('error');
    expect((await records()).find((record) => record.id === a.id)!.bundle.meta.name).toBe(
      'Pending edit',
    );
  });

  it('aborts the switch when the open project cannot be saved', async () => {
    await ensureProjectLibrary();
    const a = await createProject('A');
    await loadProjectIntoStore(a.id);
    // A store whose writes always fail: the switch must not drop the edit.
    startPersistence({
      store: { projects: { put: async () => Promise.reject(new Error('quota exceeded')) } } as unknown as ProjectStore,
      delayMs: 0,
      requestStorage: async () => false,
    });
    dispatchProjectCommand({ type: 'renameProject', name: 'Unsaved' });
    await new Promise((resolve) => setTimeout(resolve, 10));

    await expect(loadProjectIntoStore(DEMO_ID)).rejects.toThrow(/could not be saved/);
    expect(projectStore.state.meta.id).toBe(a.id);
  });
});

describe('project library — snapshots (7.1)', () => {
  it('takes a named snapshot and restores it into the project', async () => {
    startPersistence({ store: db, delayMs: 5 });
    await ensureProjectLibrary();
    const intentsBefore = projectStore.state.intents.length;

    const snapshot = await createProjectSnapshot(DEMO_ID, 'before the reroute');
    expect(snapshot.name).toBe('before the reroute');
    expect(snapshot.projectId).toBe(DEMO_ID);

    const intent = projectStore.state.intents[0]!;
    dispatchProjectCommand({ type: 'removeEntity', collection: 'intents', id: intent.id });
    await flushAutosave();
    expect(projectStore.state.intents).toHaveLength(intentsBefore - 1);

    await restoreProjectSnapshot(DEMO_ID, snapshot.id);

    expect(projectStore.state.intents).toHaveLength(intentsBefore);
    const stored = (await records()).find((record) => record.id === DEMO_ID)!;
    expect(stored.bundle.intents).toHaveLength(intentsBefore);
  });
});
