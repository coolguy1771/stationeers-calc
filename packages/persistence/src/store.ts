/**
 * Local project store (spec 7.1, 9.1, 2.2.1): Dexie-backed projects and
 * snapshots, plus the persisted-storage request helper (7.1).
 */
import Dexie, { type Table } from 'dexie';
import type { ProjectBundle } from '@stationeers/domain';

/** A project as stored in IndexedDB: the portable bundle, not the canonical model. */
export interface ProjectRecord {
  /** Primary key: ProjectMeta.id. */
  id: string;
  name: string;
  updatedAt: string;
  createdAt: string;
  bundle: ProjectBundle;
}

/** A named snapshot of a project bundle (7.1). */
export interface ProjectSnapshotRecord {
  /** Primary key: `${projectId}:${snapshotId}`. */
  id: string;
  projectId: string;
  name: string;
  createdAt: string;
  schemaVersion: number;
  bundle: ProjectBundle;
}

export class ProjectStore extends Dexie {
  projects!: Table<ProjectRecord, string>;
  snapshots!: Table<ProjectSnapshotRecord, string>;

  constructor() {
    super('stationeers-engineer');
    this.version(1).stores({
      projects: 'id, name, updatedAt',
      snapshots: 'id, projectId, createdAt',
    });
  }
}

/**
 * Open the project store. The Dexie instance is injected so tests can supply
 * a fake-indexeddb-backed one (9.4: no code execution, no real browser needed).
 */
export function openProjectStore(dexie?: Dexie): ProjectStore {
  return (dexie as ProjectStore) ?? new ProjectStore();
}

/**
 * Request persistent storage for the app (7.1). Called on first project save.
 * Must not crash in non-browser test environments; returns the granted
 * boolean, or `false` when the API is unavailable.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage || typeof navigator.storage.persist !== 'function') {
    return false;
  }
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/**
 * Persist a project bundle (7.1). Returns the stored record.
 */
export async function saveProject(
  store: ProjectStore,
  bundle: ProjectBundle,
): Promise<ProjectRecord> {
  const record: ProjectRecord = {
    id: bundle.meta.id,
    name: bundle.meta.name,
    updatedAt: bundle.meta.updatedAt,
    createdAt: bundle.meta.createdAt,
    bundle,
  };
  await store.projects.put(record);
  return record;
}

/** Load a project bundle by id. */
export async function loadProject(store: ProjectStore, projectId: string): Promise<ProjectBundle | undefined> {
  const record = await store.projects.get(projectId);
  return record?.bundle;
}

/** List all stored projects (7.1). */
export async function listProjects(store: ProjectStore): Promise<ProjectRecord[]> {
  return store.projects.orderBy('updatedAt').reverse().toArray();
}

/** Delete a project and its snapshots. */
export async function deleteProject(store: ProjectStore, projectId: string): Promise<void> {
  await store.transaction('rw', store.projects, store.snapshots, async () => {
    await store.projects.delete(projectId);
    await store.snapshots.where('projectId').equals(projectId).delete();
  });
}

/** Create a named snapshot of a project bundle (7.1). */
export async function createSnapshot(
  store: ProjectStore,
  bundle: ProjectBundle,
  snapshotId: string,
  name: string,
): Promise<ProjectSnapshotRecord> {
  const record: ProjectSnapshotRecord = {
    id: `${bundle.meta.id}:${snapshotId}`,
    projectId: bundle.meta.id,
    name,
    createdAt: bundle.meta.updatedAt,
    schemaVersion: bundle.schemaVersion,
    bundle,
  };
  await store.snapshots.put(record);
  return record;
}

/** List a project's snapshots. */
export async function listSnapshots(store: ProjectStore, projectId: string): Promise<ProjectSnapshotRecord[]> {
  return store.snapshots.where('projectId').equals(projectId).sortBy('createdAt');
}
