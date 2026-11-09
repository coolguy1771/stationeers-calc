/**
 * Test fixtures for the canonical store tests (FND-04). Test-only helper; not
 * part of the package API.
 *
 * All devices are built from this two-port set (`in`, `out`); connections and
 * intents therefore reference ports that resolve against freshly added or
 * replaced devices without extra wiring in each test.
 */
import type {
  ConnectionIntent,
  ConstructionElement,
  DeviceInstance,
  PhysicalConnection,
  PhysicalPlacement,
  PortRef,
  Project,
  Scenario,
  SettingValue,
} from '../entities';

export function makeProject(): Project {
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

/** The fixed local port ids every fixture device declares. Devices carry at most these two. */
export const DEVICE_PORTS = ['in', 'out'] as const;

export function makeDevice(id: string, ports: readonly string[]): DeviceInstance {
  return {
    id,
    definitionId: `def-${id}`,
    ports: ports.map((portId) => ({ id: portId, definitionId: `port-def-${portId}` })),
    settings: {},
  };
}

export function makePlacement(id: string, index: number): PhysicalPlacement {
  return {
    id,
    grid: 'large',
    cell: { x: index, y: index, z: 0 },
    level: 0,
    orientation: { surface: 'floor', yaw: 0 },
  };
}

export function makeConstruction(id: string, index: number): ConstructionElement {
  return {
    id,
    kind: 'pipe-segment',
    definitionId: `pipe-segment-${id}`,
    grid: 'small',
    cells: [{ x: index, y: index, z: 0 }],
    level: 0,
  };
}

export function makeConnection(
  id: string,
  medium: PhysicalConnection['medium'],
  endpoints: [PortRef, PortRef],
  elements: readonly string[] = [],
): PhysicalConnection {
  return { id, medium, elements: [...elements], endpoints };
}

export function makeIntent(
  id: string,
  medium: ConnectionIntent['medium'],
  from: PortRef,
  to: PortRef,
  label?: string,
): ConnectionIntent {
  return { id, medium, from, to, ...(label !== undefined ? { label } : {}) };
}

export function makeScenario(id: string, name: string): Scenario {
  return { id, name, inventories: {}, assumedVolumes: {} };
}

export const INVENTORY_FIXTURE = {
  species: [{ speciesId: 'oxygen', phase: 'gas' as const, moles: 1.5 }],
  thermal: { kind: 'temperature' as const, value: 293.15, unit: 'K' },
};

export function makeSettingValue(index: number): SettingValue {
  switch (index % 3) {
    case 0: return index;
    case 1: return `value-${index}`;
    default: return index % 2 === 0;
  }
}

export function makeProjectName(index: number): string {
  return `Project ${index}`;
}

export const CONNECTION_MEDIUMS = [
  'gas-pipe',
  'liquid-pipe',
  'electrical',
  'data',
  'chute',
] as const;

export function makeMedium(index: number): ConnectionIntent['medium'] {
  return CONNECTION_MEDIUMS[index % CONNECTION_MEDIUMS.length]!;
}
