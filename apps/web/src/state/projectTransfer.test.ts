// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_IMPORT_FILE_SIZE, listProjects, openProjectStore, sha256Hex } from '@stationeers/persistence';
import { demoProject } from '../mocks/demoProject';
import { buildProjectExport } from './exportProject';
import { stopPersistence } from './persistence';
import {
  configureProjectLibrary,
  deleteProject,
  ensureProjectLibrary,
  getProjectLibrarySnapshot,
  resetProjectLibrary,
} from './projectLibrary';
import { swapProjectInStore } from './projectStore';
import { describeImportError, importProjectFile } from './projectTransfer';

const DEMO_ID = demoProject.meta.id;
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
  stopPersistence();
  resetProjectLibrary();
  swapProjectInStore(demoProject);
});

/** The exported envelope of the demo project, as a downloadable file. */
async function bundleFile(): Promise<{ json: string; file: File }> {
  const exported = await buildProjectExport(demoProject);
  return {
    json: exported.json,
    file: new File([exported.json], exported.filename, { type: 'application/json' }),
  };
}

/** Rebuilds an envelope with a matching content hash (i.e. a validly-hashed payload). */
async function hashEnvelope(envelope: Record<string, unknown>): Promise<string> {
  const bundleBytes = new TextEncoder().encode(JSON.stringify(envelope.bundle));
  return JSON.stringify({ ...envelope, contentHash: await sha256Hex(bundleBytes) });
}

/**
 * Import (spec 7.1, 9.1, 9.4). Every rejected file is rejected by the real
 * untrusted-import pipeline and says why; every accepted file lands in the
 * project list.
 */
describe('project import — untrusted bundles (7.1, 9.4)', () => {
  it('imports a valid bundle into the project list', async () => {
    await ensureProjectLibrary();
    // No project holds the id, so the bundle keeps its identity.
    await deleteProject(DEMO_ID);
    const { file } = await bundleFile();

    const imported = await importProjectFile(file);

    expect(imported.id).toBe(DEMO_ID);
    expect(imported.name).toBe(demoProject.meta.name);
    expect(getProjectLibrarySnapshot().projects.map((item) => item.id)).toContain(DEMO_ID);
    const stored = (await listProjects(db)).find((record) => record.id === DEMO_ID)!;
    expect(stored.bundle.devices).toEqual(demoProject.devices);
    expect(stored.bundle.intents).toEqual(demoProject.intents);
  });

  it('re-identifies a bundle whose project id is already stored', async () => {
    await ensureProjectLibrary();
    const { file } = await bundleFile();

    const imported = await importProjectFile(file);

    expect(imported.id).not.toBe(DEMO_ID);
    expect(imported.name).toBe(`${demoProject.meta.name} (imported)`);
    // The local project with the same id is untouched.
    expect((await listProjects(db)).find((record) => record.id === DEMO_ID)!.bundle.meta.name).toBe(
      demoProject.meta.name,
    );
  });

  it('rejects a bundle whose content hash does not match', async () => {
    await ensureProjectLibrary();
    const exported = await buildProjectExport(demoProject);
    const envelope = JSON.parse(exported.json) as Record<string, unknown>;
    const corrupt = JSON.stringify({
      ...envelope,
      bundle: { ...(envelope.bundle as object), devices: [] },
    });

    const file = new File([corrupt], 'corrupt.json', { type: 'application/json' });
    const error = await importProjectFile(file).catch((reason: unknown) => reason);
    expect(describeImportError(error)).toMatch(/corrupt/i);
    expect((await listProjects(db)).map((record) => record.id)).toEqual([DEMO_ID]);
  });

  it('rejects a bundle from a newer schema version with a clear message', async () => {
    await ensureProjectLibrary();
    const exported = await buildProjectExport(demoProject);
    const envelope = JSON.parse(exported.json) as { bundle: Record<string, unknown> };
    const future = await hashEnvelope({
      ...envelope,
      bundle: {
        ...envelope.bundle,
        schemaVersion: 99,
        meta: { ...(envelope.bundle.meta as object), schemaVersion: 99 },
      },
    });

    const error = await importProjectFile(
      new File([future], 'future.json', { type: 'application/json' }),
    ).catch((reason: unknown) => reason);

    expect(describeImportError(error)).toMatch(/newer version of Stationeers Engineer/i);
    expect(describeImportError(error)).toMatch(/schema version 99/i);
    expect((await listProjects(db)).map((record) => record.id)).toEqual([DEMO_ID]);
  });

  it('rejects an oversized file before reading it', async () => {
    await ensureProjectLibrary();
    const { file } = await bundleFile();
    // The size guard runs on the browser-reported size, before any parsing.
    Object.defineProperty(file, 'size', { value: MAX_IMPORT_FILE_SIZE + 1 });

    const error = await importProjectFile(file).catch((reason: unknown) => reason);

    expect(describeImportError(error)).toMatch(/too large/i);
    expect((await listProjects(db)).map((record) => record.id)).toEqual([DEMO_ID]);
  });

  it('rejects a file that is not a project bundle at all', async () => {
    await ensureProjectLibrary();
    for (const body of ['not json at all', '{"kind":"other"}']) {
      const error = await importProjectFile(
        new File([body], 'junk.json', { type: 'application/json' }),
      ).catch((reason: unknown) => reason);
      expect(describeImportError(error)).toMatch(/not a/i);
    }
  });
});
