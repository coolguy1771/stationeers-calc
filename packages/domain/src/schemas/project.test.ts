/**
 * Boundary tests for the project bundle (spec 9.1, 9.2, 9.4).
 */
import { describe, expect, it } from 'vitest';
import type { DeviceInstance, Project } from '../entities';
import { ProjectBundleError, ProjectBundleErrorCode, parseProjectBundle, serializeProject } from './project';

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
      gameBuild: '0.8.0.0',
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

describe('project bundle round-trip', () => {
  it('serialize → parse yields the same project', () => {
    const project = makeProject();
    const bundle = serializeProject(project);
    expect(bundle.schemaVersion).toBe(1);
    expect(bundle.meta.schemaVersion).toBe(1);
    const parsed = parseProjectBundle(JSON.parse(JSON.stringify(bundle)));
    expect(parsed).toEqual(project);
  });

  it('round-trips a project with every entity kind', () => {
    const project = makeProject();
    const device: DeviceInstance = {
      id: 'dev-1',
      definitionId: 'gas-filter',
      ports: [{ id: 'port-1', definitionId: 'gas-filter.in' }],
      placementId: 'place-1',
      settings: { power: 100 },
    };
    const parsed = parseProjectBundle(
      JSON.parse(
        JSON.stringify(
          serializeProject({
            ...project,
            devices: [device],
            placements: [
              {
                id: 'place-1',
                grid: 'large',
                cell: { x: 0, y: 1, z: -2 },
                level: 0,
                orientation: { surface: 'floor', yaw: 0 },
              },
            ],
            construction: [
              {
                id: 'elem-1',
                kind: 'pipe-segment',
                definitionId: 'gas-pipe-segment',
                grid: 'small',
                cells: [{ x: 0, y: 0, z: 0 }],
                level: 0,
              },
            ],
            connections: [
              {
                id: 'conn-1',
                medium: 'gas-pipe',
                elements: ['elem-1'],
                endpoints: [
                  { instanceId: 'dev-1', portId: 'port-1' },
                  { instanceId: 'dev-2', portId: 'port-2' },
                ],
              },
            ],
            intents: [
              {
                id: 'intent-1',
                medium: 'gas-pipe',
                from: { instanceId: 'dev-1', portId: 'port-1' },
                to: { instanceId: 'dev-2', portId: 'port-2' },
                label: 'gas main',
              },
            ],
            scenarios: [
              {
                id: 'scenario-1',
                name: 'default',
                inventories: {
                  'intent-1': { species: [{ speciesId: 'oxygen', phase: 'gas', moles: 100 }], thermal: { kind: 'temperature', value: 293, unit: 'K' } },
                },
                assumedVolumes: { 'intent-1': 10.5 },
              },
            ],
            schematicLayout: { nodePositions: { 'dev-1': { x: 0, y: 0 } } },
          }),
        ),
      ),
    );
    expect(parsed.devices).toHaveLength(1);
    expect(parsed.connections).toHaveLength(1);
    expect(parsed.intents).toHaveLength(1);
    expect(parsed.scenarios).toHaveLength(1);
  });
});

describe('project bundle rejections', () => {
  it('rejects an unknown future schema version explicitly', () => {
    const bundle = JSON.parse(JSON.stringify(serializeProject(makeProject())));
    bundle.schemaVersion = 2;
    try {
      parseProjectBundle(bundle);
      expect.fail('expected rejection');
    } catch (error) {
      expect((error as { code: string }).code).toBe(ProjectBundleErrorCode.Future);
    }
  });

  it('rejects a schema version below 1', () => {
    const bundle = JSON.parse(JSON.stringify(serializeProject(makeProject())));
    bundle.schemaVersion = 0;
    expect(() => parseProjectBundle(bundle)).toThrow(ProjectBundleError);
  });

  it('rejects unknown fields', () => {
    const bundle = JSON.parse(JSON.stringify(serializeProject(makeProject())));
    bundle.extraField = 'unexpected';
    expect(() => parseProjectBundle(bundle)).toThrow(ProjectBundleError);
  });

  it('rejects a payload that is not a project bundle object', () => {
    expect(() => parseProjectBundle('not a bundle')).toThrow(ProjectBundleError);
    expect(() => parseProjectBundle(null)).toThrow(ProjectBundleError);
  });
});

describe('project bundle sanitization', () => {
  it('strips control characters from display strings', () => {
    const project = makeProject();
    project.meta.name = 'My\u0001Project\u0007';
    const bundle = serializeProject(project);
    expect(bundle.meta.name).toBe('MyProject');
    const parsed = parseProjectBundle(bundle);
    expect(parsed.meta.name).toBe('MyProject');
  });

  it('keeps a clean display name intact', () => {
    const project = makeProject();
    project.meta.name = 'My Oxygen Project';
    const bundle = serializeProject(project);
    expect(bundle.meta.name).toBe('My Oxygen Project');
  });
});
