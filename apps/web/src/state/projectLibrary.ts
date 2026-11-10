import { useSyncExternalStore } from 'react';
import {
  MAX_DISPLAY_NAME_LENGTH,
  PROJECT_SCHEMA_VERSION,
  parseProjectBundle,
  sanitizeDisplayString,
  serializeProject,
  type PackChannel,
  type Project,
  type ProjectMeta,
} from '@stationeers/domain';
import {
  createSnapshot,
  deleteProject as deleteStoredProject,
  listProjects,
  listSnapshots,
  loadProject,
  openProjectStore,
  saveProject,
  type ProjectRecord,
  type ProjectSnapshotRecord,
  type ProjectStore,
} from '@stationeers/persistence';
import { newEntityId } from '../lib/ids';
import { demoProject } from '../mocks/demoProject';
import {
  flushAutosave,
  getPersistenceSnapshot,
  resumeAutosave,
  suspendAutosave,
  subscribePersistence,
} from './persistence';
import {
  forgetProjectPreferences,
  hasSeededDemoProject,
  isProjectArchived,
  markDemoProjectSeeded,
  setProjectArchivedPreference,
} from './projectPrefs';
import { dispatchProjectCommand, projectStore, swapProjectInStore } from './projectStore';
import { useUiStore } from './uiStore';

/**
 * Project library — the multi-project index over `@stationeers/persistence`
 * (spec 7.1: create, rename, duplicate, archive, delete, snapshots, open).
 *
 * The library is the only reader/writer of the project database from the UI:
 * the projects list is whatever the database holds, autosave writes the open
 * project through `./persistence.ts`, and opening a project swaps the canonical
 * store through `loadProjectIntoStore`. Nothing here invents project content:
 * new documents are empty and carry a pack pin copied from the open project (or
 * an explicitly unpinned placeholder).
 *
 * Known gaps, reported rather than worked around (see the module comments below):
 * - `ProjectRecord` has no archived field → the soft archive flag is device-local
 *   (`./projectPrefs.ts`).
 * - The canonical store has no whole-project replace command → restoring a
 *   snapshot swaps the store and restarts the revision stream (FND-04).
 * - `@stationeers/persistence` has no delete-snapshot or get-snapshot helper →
 *   snapshots are listed and re-read through `listSnapshots`.
 */

/** Stable codes for project-management failures (spec 8 vocabulary). */
export const ProjectLibraryErrorCode = {
  InvalidName: 'PROJECT-NAME-INVALID',
  NotFound: 'PROJECT-NOT-FOUND',
  SaveFailed: 'PROJECT-SAVE-FAILED',
  SnapshotMissing: 'PROJECT-SNAPSHOT-MISSING',
} as const;

export type ProjectLibraryErrorCode =
  (typeof ProjectLibraryErrorCode)[keyof typeof ProjectLibraryErrorCode];

/** A project-management failure the UI can show directly. */
export class ProjectLibraryError extends Error {
  readonly code: ProjectLibraryErrorCode;

  constructor(code: ProjectLibraryErrorCode, message: string) {
    super(message);
    this.name = 'ProjectLibraryError';
    this.code = code;
  }
}

/** One row of the projects list (7.1), derived from the stored record. */
export interface ProjectListItem {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  /** Last save time — the stamp autosave wrote (2.2.1, 7.1). */
  readonly updatedAt: string;
  readonly packId: string;
  readonly packHash: string;
  readonly gameBuild: string;
  readonly channel: PackChannel;
  /** Soft flag: hidden from the default list, never deleted (7.1). */
  readonly archived: boolean;
  /** True for the project the canonical store currently holds. */
  readonly active: boolean;
}

export type ProjectLibraryStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ProjectLibrarySnapshot {
  readonly status: ProjectLibraryStatus;
  readonly error: string | null;
  /** Every stored project, newest save first. Archived rows are included. */
  readonly projects: readonly ProjectListItem[];
  /** Whether the list shows archived projects (7.1: toggleable visibility). */
  readonly showArchived: boolean;
}

/**
 * Pack pin used by a new project when the open project has none of its own.
 * `mock.`-prefixed and honest: `unpinned` is a marker, not a fabricated hash
 * (hard rule 4: never invent pack data). `channel` is a required enum with no
 * neutral member, so the placeholder uses `published`.
 */
export const UNPINNED_PACK_ID = 'mock.pack.unpinned';
const UNPINNED_PACK_PIN: Pick<ProjectMeta, 'packId' | 'packHash' | 'gameBuild' | 'channel'> = {
  packId: UNPINNED_PACK_ID,
  packHash: 'unpinned',
  gameBuild: 'unpinned',
  channel: 'published',
};

// ------------------------------------------------------------- module state --

let database: ProjectStore | undefined;
let status: ProjectLibraryStatus = 'idle';
let error: string | null = null;
let projects: readonly ProjectListItem[] = [];
let showArchived = false;
let snapshot: ProjectLibrarySnapshot = {
  status,
  error,
  projects,
  showArchived,
};
const listeners = new Set<() => void>();
let loading: Promise<void> | undefined;
let detachStore: (() => void) | undefined;
let detachPersistence: (() => void) | undefined;
/** Project id the list's `active` flags were computed for. */
let activeIdSeen: string | null = null;
let pendingLoad: { id: string; promise: Promise<void> } | undefined;

function store(): ProjectStore {
  database ??= openProjectStore();
  return database;
}

function notify(): void {
  snapshot = { status, error, projects, showArchived };
  for (const listener of listeners) listener();
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

// ------------------------------------------------------------- subscriptions --

/**
 * The open project can change without the list being reloaded (open, delete,
 * snapshot restore), so the `active` flags are re-derived on every store
 * notification — cheap, and it keeps the card's live save chip on the right row.
 */
function onOpenProjectChanged(): void {
  const activeId = projectStore.state.meta.id;
  if (activeId === activeIdSeen) return;
  activeIdSeen = activeId;
  projects = projects.map((item) => ({ ...item, active: item.id === activeId }));
  notify();
}

/**
 * A completed autosave changes a record's last-saved time, which the list
 * shows, so the index is re-read after each write.
 */
function onPersistenceChanged(): void {
  if (status !== 'ready') return;
  // Only a completed write changes a row; other transitions (saving, storage
  // durability) leave the index untouched.
  if (getPersistenceSnapshot().status !== 'saved') return;
  void refresh().catch(() => {
    // A failed refresh leaves the previous list; the save status already reports errors.
  });
}

function wireSubscriptions(): void {
  detachStore ??= projectStore.subscribe(onOpenProjectChanged);
  detachPersistence ??= subscribePersistence(onPersistenceChanged);
}

// ---------------------------------------------------------------- the index --

function toItem(record: ProjectRecord): ProjectListItem {
  const meta = record.bundle.meta;
  return {
    id: record.id,
    name: meta.name,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    packId: meta.packId,
    packHash: meta.packHash,
    gameBuild: meta.gameBuild,
    channel: meta.channel,
    archived: isProjectArchived(record.id),
    active: record.id === projectStore.state.meta.id,
  };
}

/** Newest save first; id breaks ties so the order is stable between reloads. */
function toItems(records: readonly ProjectRecord[]): ProjectListItem[] {
  return records
    .map(toItem)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}

/** Re-reads the index from the database and notifies subscribers. */
export async function refresh(): Promise<void> {
  const records = await listProjects(store());
  activeIdSeen = projectStore.state.meta.id;
  projects = toItems(records);
  notify();
}

/**
 * First run only (7.1): with an empty database, seed the `mock.`-prefixed demo
 * project so the app is never empty. The decision is remembered locally, so
 * deleting every project leaves an empty library — it is not re-seeded.
 */
async function seedDemoProjectOnce(): Promise<void> {
  if (hasSeededDemoProject()) return;
  const existing = await listProjects(store());
  if (existing.length === 0) {
    await saveProject(store(), serializeProject(demoProject));
  }
  markDemoProjectSeeded();
}

async function loadLibrary(): Promise<void> {
  status = 'loading';
  error = null;
  notify();
  try {
    await seedDemoProjectOnce();
    wireSubscriptions();
    await refresh();
    status = 'ready';
  } catch (cause) {
    status = 'error';
    error = messageOf(cause);
  }
  notify();
}

/**
 * Loads the project index once per session (idempotent; retries after an error).
 * Both the projects page and the workspace call it before touching the database.
 */
export function ensureProjectLibrary(): Promise<void> {
  if (status === 'ready') return Promise.resolve();
  loading ??= loadLibrary().finally(() => {
    loading = undefined;
  });
  return loading;
}

/**
 * Points the library at a specific project store and drops all module state.
 * Tests use it to run against an isolated Dexie (fake-indexeddb) database.
 */
export function configureProjectLibrary(projectStoreInstance: ProjectStore): void {
  resetProjectLibrary();
  database = projectStoreInstance;
}

/** Drops every subscription and cached row (tests, teardown). */
export function resetProjectLibrary(): void {
  detachStore?.();
  detachStore = undefined;
  detachPersistence?.();
  detachPersistence = undefined;
  database = undefined;
  status = 'idle';
  error = null;
  projects = [];
  showArchived = false;
  loading = undefined;
  activeIdSeen = null;
  pendingLoad = undefined;
  listeners.clear();
  snapshot = { status, error, projects, showArchived };
}

/** Current index + list preferences for the projects page (7.1). */
export function getProjectLibrarySnapshot(): ProjectLibrarySnapshot {
  return snapshot;
}

/** Subscribes to index changes; returns an unsubscribe function. */
export function subscribeProjectLibrary(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Index + archived visibility for React (`ProjectsPage`). */
export function useProjectLibrary(): ProjectLibrarySnapshot {
  return useSyncExternalStore(subscribeProjectLibrary, getProjectLibrarySnapshot);
}

/** Shows or hides archived projects (7.1: archived is a soft, reversible flag). */
export function setShowArchived(next: boolean): void {
  if (showArchived === next) return;
  showArchived = next;
  notify();
}

/** True when the stored index contains this project. */
export function hasStoredProject(projectId: string): boolean {
  return projects.some((item) => item.id === projectId);
}

// ------------------------------------------------------------------- naming --

export type ProjectNameValidation =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly message: string };

/**
 * Validates a user-entered project (or snapshot) name: control characters are
 * stripped (9.4 sanitization), surrounding whitespace trimmed, empty names
 * rejected, and the schema's display-length bound enforced (200).
 */
export function validateProjectName(raw: string): ProjectNameValidation {
  const name = sanitizeDisplayString(raw).trim();
  if (name.length === 0) return { ok: false, message: 'Enter a name.' };
  if (name.length > MAX_DISPLAY_NAME_LENGTH) {
    return {
      ok: false,
      message: `Names are limited to ${MAX_DISPLAY_NAME_LENGTH} characters.`,
    };
  }
  return { ok: true, name };
}

function requireName(raw: string): string {
  const validated = validateProjectName(raw);
  if (!validated.ok) {
    throw new ProjectLibraryError(ProjectLibraryErrorCode.InvalidName, validated.message);
  }
  return validated.name;
}

// ------------------------------------------------------------------ project --

/**
 * Pack pin for a new or restored project: the open project's pin, or the
 * explicit unpinned placeholder when the open project has none of its own.
 */
function currentPackPin(): Pick<ProjectMeta, 'packId' | 'packHash' | 'gameBuild' | 'channel'> {
  const meta = projectStore.state.meta;
  if (meta.packId === UNPINNED_PACK_ID) return UNPINNED_PACK_PIN;
  return {
    packId: meta.packId,
    packHash: meta.packHash,
    gameBuild: meta.gameBuild,
    channel: meta.channel,
  };
}

/** A new, empty project document with fresh identity (7.1 create). */
export function blankProject(name: string): Project {
  const now = new Date().toISOString();
  return {
    meta: {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: newEntityId('project'),
      name,
      createdAt: now,
      updatedAt: now,
      ...currentPackPin(),
    },
    devices: [],
    placements: [],
    construction: [],
    connections: [],
    intents: [],
    scenarios: [],
    settings: { autoSave: true, showExperimental: false },
    schematicLayout: { nodePositions: {} },
  };
}

/** Reads and validates a stored project (9.2, 9.4 boundary). */
async function readProject(projectId: string): Promise<Project> {
  const bundle = await loadProject(store(), projectId);
  if (bundle === undefined) {
    throw new ProjectLibraryError(
      ProjectLibraryErrorCode.NotFound,
      `No stored project with id ${projectId}.`,
    );
  }
  return parseProjectBundle(bundle);
}

/**
 * The project document to operate on: the live canonical state for the open
 * project (it may hold revisions autosave has not written yet), the stored
 * bundle otherwise.
 */
async function projectDocument(projectId: string): Promise<Project> {
  return projectStore.state.meta.id === projectId ? projectStore.state : readProject(projectId);
}

/** Creates, saves and lists a new empty project (7.1). */
export async function createProject(rawName: string): Promise<ProjectListItem> {
  const name = requireName(rawName);
  await ensureProjectLibrary();
  const project = blankProject(name);
  const record = await saveProject(store(), serializeProject(project));
  await refresh();
  return toItem(record);
}

/**
 * Renames a project (7.1). The open project is renamed through the canonical
 * command so the change is undoable and autosaved like any other edit (2.2.1);
 * a non-open project is renamed in its stored record.
 */
export async function renameProject(projectId: string, rawName: string): Promise<void> {
  const name = requireName(rawName);
  await ensureProjectLibrary();
  if (projectStore.state.meta.id === projectId) {
    const result = dispatchProjectCommand({ type: 'renameProject', name });
    if (!result.ok) {
      throw new ProjectLibraryError(ProjectLibraryErrorCode.InvalidName, result.error.message);
    }
    // The card's last-saved time must reflect the rename once the dialog closes.
    await flushAutosave();
  } else {
    const project = await readProject(projectId);
    const renamed: Project = {
      ...project,
      meta: { ...project.meta, name, updatedAt: new Date().toISOString() },
    };
    await saveProject(store(), serializeProject(renamed));
  }
  await refresh();
}

/** `name (copy)`, trimmed to the display-length bound. */
function copyName(name: string): string {
  const suffix = ' (copy)';
  const head = name.slice(0, MAX_DISPLAY_NAME_LENGTH - suffix.length).trimEnd();
  return `${head}${suffix}`;
}

/**
 * Duplicates a project (7.1): the same content under a fresh id and a
 * " (copy)" name. Entity ids inside the copy are project-scoped (4.1: stable
 * ids are unique *within* a project), so they are kept as-is.
 */
export async function duplicateProject(projectId: string): Promise<ProjectListItem> {
  await ensureProjectLibrary();
  const source = await projectDocument(projectId);
  const now = new Date().toISOString();
  const copy: Project = {
    ...source,
    meta: {
      ...source.meta,
      id: newEntityId('project'),
      name: copyName(source.meta.name),
      createdAt: now,
      updatedAt: now,
    },
  };
  const record = await saveProject(store(), serializeProject(copy));
  await refresh();
  return toItem(record);
}

/** Archives or unarchives a project (7.1). Nothing is deleted. */
export async function setProjectArchived(
  projectId: string,
  archived: boolean,
): Promise<void> {
  await ensureProjectLibrary();
  setProjectArchivedPreference(projectId, archived);
  await refresh();
}

/**
 * Deletes a project and its snapshots (7.1, hard delete).
 *
 * Deleting the OPEN project first stops autosave, so the deleted record cannot
 * be recreated by a pending or later write. If another project remains, the
 * canonical store moves to the most recently saved one; with none left the
 * store keeps the deleted document in memory as a detached placeholder (the
 * canonical store always holds one project, 2.2.1) — the workspace route
 * refuses it because the database no longer holds the id, and the projects page
 * shows its empty state.
 */
export async function deleteProject(projectId: string): Promise<void> {
  await ensureProjectLibrary();
  const wasOpen = projectStore.state.meta.id === projectId;
  if (wasOpen) suspendAutosave();
  await deleteStoredProject(store(), projectId);
  forgetProjectPreferences(projectId);
  const remaining = await listProjects(store());
  if (wasOpen) {
    const next = remaining[0];
    if (next !== undefined) await loadProjectIntoStore(next.id);
  }
  await refresh();
}

/**
 * Opens a stored project in the canonical store (7.1 open/switch).
 *
 * Contract:
 * 1. The open project's pending autosave is flushed and awaited — a failed
 *    write aborts the switch instead of dropping the edit (7.1, 2.2.1).
 * 2. The bundle is read from IndexedDB and validated at the boundary (9.2, 9.4).
 * 3. `swapProjectInStore` replaces the canonical store; subscribers re-read it.
 * 4. Transient UI state is reset (shared selection, SYNC-004).
 *
 * Autosave re-points itself: it adopts the new project on the swap notification
 * (`./persistence.ts`), so the next committed revision is written under the new
 * project id.
 */
export function loadProjectIntoStore(projectId: string): Promise<void> {
  // Already open: nothing to flush, nothing to swap.
  if (projectStore.state.meta.id === projectId) return ensureProjectLibrary();
  const inFlight = pendingLoad;
  if (inFlight?.id === projectId) return inFlight.promise;

  const promise = (async () => {
    await ensureProjectLibrary();
    const saveStatus = await flushAutosave();
    if (saveStatus === 'error') {
      throw new ProjectLibraryError(
        ProjectLibraryErrorCode.SaveFailed,
        'The open project has changes that could not be saved. Fix the save error before ' +
          'switching projects — nothing was dropped.',
      );
    }
    const project = await readProject(projectId);
    // The store may have moved on while the write flushed (a concurrent open).
    if (projectStore.state.meta.id === projectId) return;
    swapProjectInStore(project);
    // The project is on disk, so committed revisions are written again (7.1).
    resumeAutosave();
    useUiStore.getState().setSelection(null);
    await refresh();
  })().finally(() => {
    if (pendingLoad?.promise === promise) pendingLoad = undefined;
  });
  pendingLoad = { id: projectId, promise };
  return promise;
}

/**
 * Addition of an imported project document (7.1 import) to the stored index.
 * The document itself was validated by the untrusted-import path (9.4) in
 * `./projectTransfer.ts`; this only decides its identity.
 */
export async function addImportedProject(project: Project): Promise<ProjectListItem> {
  await ensureProjectLibrary();
  const now = new Date().toISOString();
  // An id that is already stored is re-identified instead of silently
  // overwriting the local project with the same id (7.1, 9.4).
  const collides = hasStoredProject(project.meta.id);
  const imported: Project = {
    ...project,
    meta: {
      ...project.meta,
      id: collides ? newEntityId('project') : project.meta.id,
      name: collides ? importedName(project.meta.name) : project.meta.name,
      // The record's `updatedAt` is its save time on this device.
      updatedAt: now,
    },
  };
  const record = await saveProject(store(), serializeProject(imported));
  await refresh();
  return toItem(record);
}

/** `name (imported)`, trimmed to the display-length bound. */
function importedName(name: string): string {
  const suffix = ' (imported)';
  const head = name.slice(0, MAX_DISPLAY_NAME_LENGTH - suffix.length).trimEnd();
  return `${head}${suffix}`;
}

// --------------------------------------------------------------- snapshots --

/** Lists a project's snapshots, newest first (7.1). */
export async function listProjectSnapshots(
  projectId: string,
): Promise<ProjectSnapshotRecord[]> {
  await ensureProjectLibrary();
  const records = await listSnapshots(store(), projectId);
  return [...records].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
  );
}

/**
 * Creates a named snapshot of the current state (7.1). The snapshot bundle is
 * stamped now, so `ProjectSnapshotRecord.createdAt` (which persistence derives
 * from `meta.updatedAt`) is the time the snapshot was taken.
 */
export async function createProjectSnapshot(
  projectId: string,
  rawName: string,
): Promise<ProjectSnapshotRecord> {
  const name = requireName(rawName);
  await ensureProjectLibrary();
  const project = await projectDocument(projectId);
  const bundle = serializeProject({
    ...project,
    meta: { ...project.meta, updatedAt: new Date().toISOString() },
  });
  return createSnapshot(store(), bundle, newEntityId('snap'), name);
}

/**
 * Restores a snapshot into the project (7.1): its content becomes the project's
 * current revision, saved to the record.
 *
 * The canonical store cannot replace a whole project as an undoable, revision-
 * changing command (FND-04 gap), so when the snapshot belongs to the OPEN
 * project the store is swapped with `swapProjectInStore`: content is restored
 * and persisted, but the revision stream restarts and the previous undo history
 * is gone. Closing that gap needs a `replaceProject`-style domain command.
 */
export async function restoreProjectSnapshot(
  projectId: string,
  snapshotId: string,
): Promise<void> {
  await ensureProjectLibrary();
  const snapshots = await listSnapshots(store(), projectId);
  const snapshot = snapshots.find((record) => record.id === snapshotId);
  if (snapshot === undefined) {
    throw new ProjectLibraryError(
      ProjectLibraryErrorCode.SnapshotMissing,
      `Snapshot ${snapshotId} no longer exists.`,
    );
  }
  const restored = parseProjectBundle(snapshot.bundle);
  const project: Project = {
    ...restored,
    meta: { ...restored.meta, id: projectId, updatedAt: new Date().toISOString() },
  };
  // Write the outgoing state first, so a debounced write queued before the
  // restore cannot land after the restored content and resurrect the old state.
  await flushAutosave();
  await saveProject(store(), serializeProject(project));
  if (projectStore.state.meta.id === projectId) {
    swapProjectInStore(project);
    resumeAutosave();
    useUiStore.getState().setSelection(null);
  }
  await refresh();
}
