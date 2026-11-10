// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectBundle } from '@stationeers/domain';
import type { ProjectRecord, ProjectStore } from '@stationeers/persistence';
import { demoProject } from '../mocks/demoProject';
import {
  flushAutosave,
  getPersistenceSnapshot,
  startPersistence,
  stopPersistence,
  subscribePersistence,
  suspendAutosave,
} from './persistence';
import { dispatchProjectCommand, projectStore, swapProjectInStore } from './projectStore';

/**
 * Dexie-shaped fake: `saveProject` only calls `projects.put` with the
 * `ProjectRecord` it derives from the bundle, so autosave can be driven without
 * IndexedDB.
 */
function memoryStore(write: (record: ProjectRecord) => Promise<void>): ProjectStore {
  return { projects: { put: write } } as unknown as ProjectStore;
}

function recordingStore() {
  const writes: ProjectBundle[] = [];
  const store = memoryStore(async (record) => {
    writes.push(record.bundle);
  });
  return { writes, store };
}

/** Status transitions, deduplicated (storage-durability changes share the channel). */
function trackStatus(): string[] {
  const seen: string[] = [];
  subscribePersistence(() => {
    const next = getPersistenceSnapshot().status;
    if (seen.at(-1) !== next) seen.push(next);
  });
  return seen;
}

/** Lets the debounce timer fire and the write promise settle. */
async function advance(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  stopPersistence();
  vi.useRealTimers();
  // The module-level canonical store is shared by this file's tests.
  swapProjectInStore(demoProject);
});

/**
 * Autosave wiring (spec 2.2.1 debounced snapshots, 7.1 save states, 2.1
 * persistent storage). Every asserted state comes from a real write attempt.
 *
 * The open project is adopted as already on disk (the project library persists
 * a project before opening it, 7.1), so autosave writes committed revisions —
 * not the fact that a project is open.
 */
describe('persistence — the shell renders real save outcomes', () => {
  it('reports the open project as saved, then dirty → saving → saved for a revision', async () => {
    const { writes, store } = recordingStore();

    startPersistence({ store, delayMs: 500, requestStorage: async () => true });
    // Opening a persisted project writes nothing: it is already on disk.
    expect(getPersistenceSnapshot().status).toBe('saved');
    expect(getPersistenceSnapshot().projectId).toBe(projectStore.state.meta.id);
    expect(writes).toHaveLength(0);
    const seen = trackStatus();

    // A committed revision dirties the project and is written after the debounce.
    expect(dispatchProjectCommand({ type: 'renameProject', name: 'Renamed' }).ok).toBe(true);
    expect(getPersistenceSnapshot().status).toBe('dirty');

    await advance(500);
    expect(writes).toHaveLength(1);
    expect(getPersistenceSnapshot().status).toBe('saved');
    expect(seen).toEqual(['dirty', 'saving', 'saved']);

    const written = writes.at(-1)!;
    expect(written.meta.name).toBe('Renamed');
    // The store never reads a clock (5.1.1); persistence stamps the save time.
    expect(new Date(written.meta.updatedAt).toISOString()).toBe(written.meta.updatedAt);
    expect(written.meta.updatedAt).not.toBe(projectStore.state.meta.updatedAt);
    expect(getPersistenceSnapshot().lastSavedAt).toBe(written.meta.updatedAt);
  });

  it('coalesces revisions inside the debounce window into one write', async () => {
    const { writes, store } = recordingStore();
    startPersistence({ store, delayMs: 500, requestStorage: async () => true });

    dispatchProjectCommand({ type: 'renameProject', name: 'First' });
    dispatchProjectCommand({ type: 'renameProject', name: 'Second' });
    await advance(500);

    expect(writes).toHaveLength(1);
    expect(writes[0]!.meta.name).toBe('Second');
  });

  it('flushes a pending revision before a project switch returns', async () => {
    const { writes, store } = recordingStore();
    startPersistence({ store, delayMs: 5_000, requestStorage: async () => true });

    dispatchProjectCommand({ type: 'renameProject', name: 'About to switch' });
    const status = await flushAutosave();

    // The debounce has not elapsed; flush wrote it anyway (7.1: no silent drop).
    expect(status).toBe('saved');
    expect(writes).toHaveLength(1);
    expect(writes[0]!.meta.name).toBe('About to switch');
  });

  it('re-points at the newly opened project after a store swap', async () => {
    const { writes, store } = recordingStore();
    startPersistence({ store, delayMs: 100, requestStorage: async () => true });

    // Opening a project swaps the canonical store (7.1 open/switch).
    swapProjectInStore({ ...demoProject, meta: { ...demoProject.meta, id: 'project.second' } });
    expect(getPersistenceSnapshot()).toMatchObject({
      status: 'saved',
      projectId: 'project.second',
    });

    dispatchProjectCommand({ type: 'renameProject', name: 'Second renamed' });
    await advance(100);

    expect(writes).toHaveLength(1);
    expect(writes[0]!.meta.id).toBe('project.second');
    expect(writes[0]!.meta.name).toBe('Second renamed');
  });

  it('stops writing while the open project has no stored record', async () => {
    const { writes, store } = recordingStore();
    startPersistence({ store, delayMs: 100, requestStorage: async () => true });
    suspendAutosave();

    dispatchProjectCommand({ type: 'renameProject', name: 'Detached' });
    await advance(100);

    expect(writes).toHaveLength(0);
  });

  it('surfaces a failed write as error and retries on the next revision', async () => {
    let failing = true;
    const writes: ProjectBundle[] = [];
    startPersistence({
      store: memoryStore(async (record) => {
        if (failing) throw new Error('QuotaExceededError: local storage is full');
        writes.push(record.bundle);
      }),
      delayMs: 100,
      requestStorage: async () => false,
    });

    dispatchProjectCommand({ type: 'renameProject', name: 'Fails' });
    await advance(100);
    expect(getPersistenceSnapshot().status).toBe('error');
    expect(writes).toHaveLength(0);

    failing = false;
    dispatchProjectCommand({ type: 'renameProject', name: 'Retry' });
    expect(getPersistenceSnapshot().status).toBe('dirty');
    await advance(100);

    expect(getPersistenceSnapshot().status).toBe('saved');
    expect(writes).toHaveLength(1);
  });

  it('requests persistent storage once, on the first save, and surfaces the result', async () => {
    const request = vi.fn(async () => true);
    const { store } = recordingStore();
    startPersistence({ store, delayMs: 100, requestStorage: request });

    expect(getPersistenceSnapshot().persistentStorage).toBe('unknown');
    dispatchProjectCommand({ type: 'renameProject', name: 'First save' });
    await advance(100);

    expect(request).toHaveBeenCalledTimes(1);
    expect(getPersistenceSnapshot().persistentStorage).toBe('granted');

    // Later saves do not ask again.
    dispatchProjectCommand({ type: 'renameProject', name: 'Later' });
    await advance(100);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('reports a denied persistent-storage request without blocking saves', async () => {
    const { writes, store } = recordingStore();
    startPersistence({ store, delayMs: 100, requestStorage: async () => false });

    dispatchProjectCommand({ type: 'renameProject', name: 'Denied' });
    await advance(100);
    expect(getPersistenceSnapshot().persistentStorage).toBe('denied');
    expect(getPersistenceSnapshot().status).toBe('saved');
    expect(writes).toHaveLength(1);
  });
});
