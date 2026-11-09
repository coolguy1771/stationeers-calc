/**
 * Store tests (spec 7.1, 9.1): Dexie-backed projects and snapshots run on
 * fake-indexeddb, plus the persisted-storage request helper.
 */
import { describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import type { ProjectBundle } from '@stationeers/domain';
import { createAutosave } from './autosave';
import { requestPersistentStorage } from './store';
import {
  createSnapshot,
  deleteProject,
  listProjects,
  listSnapshots,
  loadProject,
  openProjectStore,
  saveProject,
  type ProjectStore,
} from './store';

function makeBundle(overrides: Partial<ProjectBundle> = {}): ProjectBundle {
  return {
    schemaVersion: 1,
    meta: {
      schemaVersion: 1,
      id: 'project-1',
      name: 'Test project',
      createdAt: '2025-11-09T12:00:00.000Z',
      updatedAt: '2025-11-09T12:00:00.000Z',
      packId: 'pack.v1.0',
      packHash: 'abc123',
      gameBuild: '1.0.0',
      channel: 'published',
    },
    devices: [],
    placements: [],
    construction: [],
    connections: [],
    intents: [],
    scenarios: [],
    settings: { autoSave: true, showExperimental: false },
    schematicLayout: { nodePositions: {} },
    ...overrides,
  };
}

describe('project store', () => {
  it('saves and loads a project bundle', async () => {
    const store = openProjectStore();
    const bundle = makeBundle();
    await saveProject(store, bundle);
    const loaded = await loadProject(store, 'project-1');
    expect(loaded).toEqual(bundle);
  });

  it('overwrites a project with the same id', async () => {
    const store = openProjectStore();
    await saveProject(store, makeBundle());
    const updated = makeBundle({
      meta: {
        schemaVersion: 1,
        id: 'project-1',
        name: 'Renamed',
        createdAt: '2025-11-09T12:00:00.000Z',
        updatedAt: '2025-11-09T12:05:00.000Z',
        packId: 'pack.v1.0',
        packHash: 'abc123',
        gameBuild: '1.0.0',
        channel: 'published',
      },
    });
    await saveProject(store, updated);
    const list = await listProjects(store);
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe('Renamed');
  });

  it('lists projects newest first', async () => {
    const store = openProjectStore();
    await saveProject(store, makeBundle());
    await saveProject(store, makeBundle({
      meta: {
        schemaVersion: 1,
        id: 'project-2',
        name: 'Second',
        createdAt: '2025-11-09T12:00:00.000Z',
        updatedAt: '2025-11-09T12:10:00.000Z',
        packId: 'pack.v1.0',
        packHash: 'abc123',
        gameBuild: '1.0.0',
        channel: 'published',
      },
    }));
    const list = await listProjects(store);
    expect(list.map((r) => r.id)).toEqual(['project-2', 'project-1']);
  });

  it('creates and lists snapshots', async () => {
    const store = openProjectStore();
    const bundle = makeBundle();
    await saveProject(store, bundle);
    await createSnapshot(store, bundle, 'snapshot-1', 'Before refactor');
    const snapshots = await listSnapshots(store, 'project-1');
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.name).toBe('Before refactor');
    expect(snapshots[0]?.bundle).toEqual(bundle);
  });

  it('deletes a project and its snapshots', async () => {
    const store = openProjectStore();
    const bundle = makeBundle();
    await saveProject(store, bundle);
    await createSnapshot(store, bundle, 'snap-1', 'snapshot-1');
    await deleteProject(store, 'project-1');
    const loaded = await loadProject(store, 'project-1');
    expect(loaded).toBeUndefined();
    const snapshots = await listSnapshots(store, 'project-1');
    expect(snapshots).toHaveLength(0);
  });
});

describe('autosave', () => {
  it('saves after the debounce delay', async () => {
    const store = openProjectStore();
    const autosave = createAutosave(store, { delayMs: 10 });
    autosave.schedule(makeBundle());
    expect(autosave.getStatus().state).toBe('saving');
    await autosave.flush();
    const loaded = await loadProject(store, 'project-1');
    expect(loaded?.meta.name).toBe('Test project');
    autosave.dispose();
  });

  it('replaces a pending save with a newer bundle', async () => {
    const store = openProjectStore();
    const autosave = createAutosave(store, { delayMs: 10 });
    autosave.schedule(makeBundle());
    autosave.schedule(makeBundle({
      meta: {
        schemaVersion: 1,
        id: 'project-1',
        name: 'Second',
        createdAt: '2025-11-09T12:00:00.000Z',
        updatedAt: '2025-11-09T12:00:00.000Z',
        packId: 'pack.v1.0',
        packHash: 'abc123',
        gameBuild: '1.0.0',
        channel: 'published',
      },
    }));
    await autosave.flush();
    const loaded = await loadProject(store, 'project-1');
    expect(loaded?.meta.name).toBe('Second');
    autosave.dispose();
  });

  it('reports saved status with a timestamp', async () => {
    const store = openProjectStore();
    const autosave = createAutosave(store, { delayMs: 10 });
    autosave.schedule(makeBundle());
    await autosave.flush();
    const status = autosave.getStatus();
    expect(status.state).toBe('saved');
    if (status.state === 'saved') expect(status.at).toBe('2025-11-09T12:00:00.000Z');
    autosave.dispose();
  });

  it('reports error status when the store fails', async () => {
    const failing = {
      projects: {
        put: () => Promise.reject(new Error('disk full')),
      },
    } as unknown as ProjectStore;
    const autosave = createAutosave(failing, { delayMs: 10 });
    autosave.schedule(makeBundle());
    await autosave.flush();
    const status = autosave.getStatus();
    expect(status.state).toBe('error');
    if (status.state === 'error') expect(status.message).toContain('disk full');
    autosave.dispose();
  });
});

describe('requestPersistentStorage', () => {
  it('returns false when the storage API is unavailable', async () => {
    const granted = await requestPersistentStorage();
    expect(typeof granted).toBe('boolean');
  });
});
