/**
 * Import/export tests (spec 9.4): round-trips, gzip, size caps, hash
 * verification, envelope validation, and schema-version rejection.
 */
import { describe, expect, it } from 'vitest';
import type { ProjectBundle } from '@stationeers/domain';
import { ProjectBundleErrorCode, ProjectBundleError } from '@stationeers/domain';
import { MAX_IMPORT_DECOMPRESSED_SIZE, MAX_IMPORT_FILE_SIZE } from './limits';
import { exportProject, exportProjectBytes, importProject, importProjectBytes, importProjectJson, sha256Hex } from './transfer';
import type { Project } from '@stationeers/domain';

function makeProject(): Project {
  return {
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
  };
}

describe('export/import round-trip', () => {
  it('export → import yields the same project', async () => {
    const project = makeProject();
    const envelope = await exportProject(project);
    const parsed = await importProject(JSON.parse(JSON.stringify(envelope)));
    expect(parsed).toEqual(project);
  });

  it('round-trips via JSON string', async () => {
    const project = makeProject();
    const envelope = await exportProject(project);
    const parsed = await importProjectJson(JSON.stringify(envelope));
    expect(parsed).toEqual(project);
  });

  it('round-trips through gzip bytes', async () => {
    const project = makeProject();
    const bytes = await exportProjectBytes(project, true);
    const parsed = await importProjectBytes(bytes);
    expect(parsed).toEqual(project);
  });

  it('round-trips through uncompressed bytes', async () => {
    const project = makeProject();
    const bytes = await exportProjectBytes(project, false);
    const parsed = await importProjectBytes(bytes);
    expect(parsed).toEqual(project);
  });
});

describe('content hash', () => {
  it('sha256Hex matches the well-known SHA-256 of a byte sequence', async () => {
    const bytes = new TextEncoder().encode('');
    expect(await sha256Hex(bytes)).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('rejects a corrupted envelope', async () => {
    const project = makeProject();
    const envelope = await exportProject(project);
    envelope.bundle.meta.name = 'Tampered';
    await expect(importProject(envelope)).rejects.toThrow('Content hash mismatch');
  });
});

describe('import rejections', () => {
  it('rejects a payload that is not an envelope', async () => {
    await expect(importProject('not an envelope')).rejects.toThrow();
  });

  it('rejects invalid JSON', async () => {
    await expect(importProjectJson('{')).rejects.toThrow();
  });

  it('rejects oversize JSON', async () => {
    const big = 'x'.repeat(MAX_IMPORT_FILE_SIZE + 1);
    await expect(importProjectJson(big)).rejects.toThrow('Import file exceeds');
  });

  it('rejects oversize bytes', async () => {
    const big = new Uint8Array(MAX_IMPORT_FILE_SIZE + 1);
    await expect(importProjectBytes(big)).rejects.toThrow('Import file exceeds');
  });
});

describe('schema-version rejection', () => {
  it('rejects a future schema version', async () => {
    const project = makeProject();
    const envelope = await exportProject(project);
    const bundle: ProjectBundle = {
      ...envelope.bundle,
      schemaVersion: 2,
      meta: { ...envelope.bundle.meta, schemaVersion: 2 },
    };
    const bytes = new TextEncoder().encode(JSON.stringify(bundle));
    const hash = await sha256Hex(bytes);
    const tampered = { ...envelope, contentHash: hash, bundle };
    try {
      await importProject(tampered);
      expect.fail('expected rejection');
    } catch (error) {
      expect((error as { code: string }).code).toBe(ProjectBundleErrorCode.Future);
    }
  });
});

void ProjectBundleError;
void MAX_IMPORT_DECOMPRESSED_SIZE;
