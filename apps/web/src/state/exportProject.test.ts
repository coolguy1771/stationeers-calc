import { describe, expect, it } from 'vitest';
import { importProjectJson } from '@stationeers/persistence';
import { buildProjectExport } from './exportProject';
import { projectStore } from './projectStore';

/**
 * Export contract (spec 7.1, 9.1, 9.4): the file is the transfer envelope around
 * the canonical project, and it survives the untrusted import path — hash check,
 * migration and schema validation included — with its content intact.
 */
describe('project export', () => {
  it('wraps the canonical project in the SHA-256 envelope', async () => {
    const file = await buildProjectExport(projectStore.state);

    expect(file.filename).toMatch(/^mock\.project\.atmos-[0-9a-f]{8}\.json$/);
    expect(file.contentHash).toMatch(/^[0-9a-f]{64}$/);

    const envelope = JSON.parse(file.json) as {
      kind: string;
      envelopeVersion: number;
      contentHash: string;
      bundle: { meta: { id: string } };
    };
    expect(envelope.kind).toBe('stationeers-project');
    expect(envelope.envelopeVersion).toBe(1);
    expect(envelope.contentHash).toBe(file.contentHash);
    expect(envelope.bundle.meta.id).toBe(projectStore.state.meta.id);
  });

  it('round-trips through the import path with the project intact', async () => {
    const file = await buildProjectExport(projectStore.state);
    const imported = await importProjectJson(file.json);

    expect(imported.meta).toEqual(projectStore.state.meta);
    expect(imported.devices).toEqual(projectStore.state.devices);
    expect(imported.placements).toEqual(projectStore.state.placements);
    expect(imported.intents).toEqual(projectStore.state.intents);
  });

  it('hashes the canonical state, so a committed command changes the hash', async () => {
    const before = await buildProjectExport(projectStore.state);

    projectStore.dispatch({ type: 'renameProject', name: 'Exported after a rename' });
    const after = await buildProjectExport(projectStore.state);

    expect(after.contentHash).not.toBe(before.contentHash);
    projectStore.undo();
  });
});
