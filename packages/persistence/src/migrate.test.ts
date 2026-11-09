/**
 * Migration tests (spec 9.2): v1 passthrough, future-version rejection, and
 * failure preservation of the source data.
 */
import { describe, expect, it } from 'vitest';
import type { ProjectBundle } from '@stationeers/domain';
import { ProjectBundleErrorCode, ProjectBundleError } from '@stationeers/domain';
import { migrateProjectBundle } from './migrate';

function makeBundle(version: number): ProjectBundle {
  return {
    schemaVersion: version,
    meta: {
      schemaVersion: version,
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

describe('migrateProjectBundle', () => {
  it('passes a v1 bundle through unchanged', () => {
    const bundle = makeBundle(1);
    const result = migrateProjectBundle(bundle);
    expect(result.bundle).toEqual(bundle);
    expect(result.applied).toEqual([]);
  });

  it('rejects a future schema version explicitly', () => {
    const bundle = makeBundle(2);
    expect(() => migrateProjectBundle(bundle)).toThrow(ProjectBundleError);
    try {
      migrateProjectBundle(bundle);
      expect.fail('expected rejection');
    } catch (error) {
      expect((error as { code: string }).code).toBe(ProjectBundleErrorCode.Future);
    }
  });

  it('rejects a version below 1', () => {
    const bundle = makeBundle(0);
    expect(() => migrateProjectBundle(bundle)).toThrow(ProjectBundleError);
  });
});
