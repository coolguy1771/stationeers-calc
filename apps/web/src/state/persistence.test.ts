// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectBundle } from '@stationeers/domain';
import type { ProjectRecord, ProjectStore } from '@stationeers/persistence';
import {
  getPersistenceSnapshot,
  startPersistence,
  stopPersistence,
  subscribePersistence,
} from './persistence';
import { dispatchProjectCommand, projectStore } from './projectStore';

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
});

/**
 * Autosave wiring (spec 2.2.1 debounced snapshots, 7.1 save states, 2.1
 * persistent storage). Every asserted state comes from a real write attempt.
 */
describe('persistence — the shell renders real save outcomes', () => {
  it('queues the seeded project, then reports dirty → saving → saved', async () => {
    const { writes, store } = recordingStore();
    const seen = trackStatus();

    startPersistence({ store, delayMs: 500, requestStorage: async () => true });
    // The seeded project has never been written: honest initial state is dirty.
    expect(getPersistenceSnapshot().status).toBe('dirty');
    expect(writes).toHaveLength(0);

    await advance(500);
    expect(writes).toHaveLength(1);
    expect(getPersistenceSnapshot().status).toBe('saved');
    expect(seen).toEqual(['saving', 'saved']);

    // A committed revision dirties the project again and is written after the debounce.
    expect(dispatchProjectCommand({ type: 'renameProject', name: 'Renamed' }).ok).toBe(true);
    expect(getPersistenceSnapshot().status).toBe('dirty');

    await advance(500);
    expect(getPersistenceSnapshot().status).toBe('saved');
    expect(seen).toEqual(['saving', 'saved', 'dirty', 'saving', 'saved']);

    const written = writes.at(-1)!;
    expect(written.meta.name).toBe('Renamed');
    // The store never reads a clock (5.1.1); persistence stamps the save time.
    expect(new Date(written.meta.updatedAt).toISOString()).toBe(written.meta.updatedAt);
    expect(written.meta.updatedAt).not.toBe(projectStore.state.meta.updatedAt);
  });

  it('coalesces revisions inside the debounce window into one write', async () => {
    const { writes, store } = recordingStore();
    startPersistence({ store, delayMs: 500, requestStorage: async () => true });
    await advance(500);
    expect(writes).toHaveLength(1);

    dispatchProjectCommand({ type: 'renameProject', name: 'First' });
    dispatchProjectCommand({ type: 'renameProject', name: 'Second' });
    await advance(500);

    expect(writes).toHaveLength(2);
    expect(writes[1]!.meta.name).toBe('Second');
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

    await advance(100);
    expect(getPersistenceSnapshot().persistentStorage).toBe('denied');
    expect(getPersistenceSnapshot().status).toBe('saved');
    expect(writes).toHaveLength(1);
  });
});
