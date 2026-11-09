import type { DataQuality, DeviceDefinition, DefinitionId } from '@stationeers/domain';

/**
 * MOCK device definitions for the catalog tab (7.2) until packs (EXT-03) ship
 * real extracted data. All ids are `mock.`-prefixed (hard rule 4: never invent
 * game data and present it as extracted — these are explicitly demo entries).
 * `PropertyRow` is a PRESENTATION view model for per-property provenance
 * display (spec 13 #3), not a domain entity.
 */
export interface PropertyRow {
  label: string;
  value: string;
  quality: DataQuality;
  note?: string;
}

const port = (
  id: string,
  medium: DeviceDefinition['ports'][number]['medium'],
  capabilities: string[],
  quality: DataQuality,
  mediation: 'passive' | 'device' = 'device',
): DeviceDefinition['ports'][number] => ({
  id: `mock.port.${id}`,
  medium,
  localPosition: { x: 0, y: 0, z: 0 },
  direction: { x: 1, y: 0, z: 0 },
  categories: [medium],
  mediation,
  capabilities,
  sourceQuality: quality,
});

export const mockDeviceDefinitions: DeviceDefinition[] = [
  {
    id: 'mock.active-vent',
    displayName: 'Active Vent',
    category: 'gas-control',
    grid: 'large',
    allowedOrientations: [
      { surface: 'floor', yaw: 0 },
      { surface: 'wall', yaw: 0 },
      { surface: 'wall', yaw: 1 },
      { surface: 'wall', yaw: 2 },
      { surface: 'wall', yaw: 3 },
    ],
    footprint: [{ local: { x: 0, y: 0, z: 0 }, solid: true }],
    ports: [
      port('av.gas', 'gas-pipe', ['pressure-control'], 'extracted-and-validated'),
      port('av.power', 'electrical', ['power-input'], 'extracted-unverified'),
    ],
    networkRole: 'boundary',
    construction: [{ elementId: 'mock.element.steel-plate', quantity: 1 }],
    sourceQuality: 'extracted-and-validated',
  },
  {
    id: 'mock.gas-mixer',
    displayName: 'Gas Mixer',
    category: 'gas-control',
    grid: 'large',
    allowedOrientations: [
      { surface: 'floor', yaw: 0 },
      { surface: 'floor', yaw: 1 },
      { surface: 'floor', yaw: 2 },
      { surface: 'floor', yaw: 3 },
    ],
    footprint: [
      { local: { x: 0, y: 0, z: 0 }, solid: true },
      { local: { x: 1, y: 0, z: 0 }, solid: true },
    ],
    ports: [
      port('gm.in-a', 'gas-pipe', ['gas-input'], 'extracted-and-validated'),
      port('gm.in-b', 'gas-pipe', ['gas-input'], 'extracted-and-validated'),
      port('gm.out', 'gas-pipe', ['gas-output'], 'extracted-and-validated'),
    ],
    networkRole: 'boundary',
    construction: [{ elementId: 'mock.element.steel-plate', quantity: 2 }],
    sourceQuality: 'extracted-and-validated',
  },
  {
    id: 'mock.passive-vent',
    displayName: 'Passive Vent',
    category: 'gas-control',
    grid: 'large',
    allowedOrientations: [{ surface: 'wall', yaw: 0 }],
    footprint: [{ local: { x: 0, y: 0, z: 0 }, solid: true }],
    ports: [
      port('pv.gas', 'gas-pipe', ['gas-flow', 'heat-exchange'], 'extracted-and-validated', 'passive'),
    ],
    networkRole: 'boundary',
    construction: [{ elementId: 'mock.element.steel-plate', quantity: 1 }],
    sourceQuality: 'extracted-and-validated',
  },
  {
    // Deliberately shaky example: exercises the weaker data-quality levels so
    // the provenance display (13 #3) has something honest to show.
    id: 'mock.digital-valve',
    displayName: 'Digital Valve',
    category: 'gas-control',
    grid: 'large',
    allowedOrientations: [{ surface: 'floor', yaw: 0 }],
    footprint: [{ local: { x: 0, y: 0, z: 0 }, solid: true }],
    ports: [
      port('dv.in', 'gas-pipe', ['gas-flow'], 'inferred'),
      port('dv.out', 'gas-pipe', ['gas-flow'], 'inferred'),
    ],
    construction: [],
    sourceQuality: 'inferred',
  },
];

/**
 * Per-property provenance rows (view model) — one row per displayed property
 * with its own 6.5 level, so every displayed property shows provenance (13 #3).
 */
export const mockCatalog: { definition: DeviceDefinition; propertyRows: PropertyRow[] }[] = [
  {
    definition: mockDeviceDefinitions[0]!,
    propertyRows: [
      { label: 'Grid', value: 'large', quality: 'extracted-and-validated' },
      { label: 'Footprint', value: '1 cell, solid', quality: 'extracted-and-validated' },
      { label: 'Orientations', value: 'floor, wall ×4', quality: 'extracted-and-validated' },
      { label: 'Network role', value: 'boundary', quality: 'extracted-and-validated', note: 'Verified property (4.4)' },
      { label: 'Construction', value: '1 × steel plate', quality: 'extracted-and-validated' },
    ],
  },
  {
    definition: mockDeviceDefinitions[1]!,
    propertyRows: [
      { label: 'Grid', value: 'large', quality: 'extracted-and-validated' },
      { label: 'Footprint', value: '2 cells, solid', quality: 'extracted-and-validated' },
      { label: 'Orientations', value: 'floor ×4', quality: 'extracted-and-validated' },
      { label: 'Network role', value: 'boundary', quality: 'extracted-and-validated' },
      { label: 'Construction', value: '2 × steel plate', quality: 'extracted-unverified', note: 'Recipe expansion pending EXT-01' },
    ],
  },
  {
    definition: mockDeviceDefinitions[2]!,
    propertyRows: [
      { label: 'Grid', value: 'large', quality: 'extracted-and-validated' },
      { label: 'Footprint', value: '1 cell, solid', quality: 'extracted-and-validated' },
      { label: 'Orientations', value: 'wall', quality: 'extracted-and-validated' },
      { label: 'Network role', value: 'boundary', quality: 'extracted-and-validated' },
      { label: 'Heat exchange', value: 'present', quality: 'extracted-unverified', note: 'Behavior verification pending (Adapter D)' },
    ],
  },
  {
    definition: mockDeviceDefinitions[3]!,
    propertyRows: [
      { label: 'Grid', value: 'large', quality: 'extracted-unverified', note: 'Geometry probe pending (EXT-05)' },
      { label: 'Footprint', value: '1 cell, solid', quality: 'extracted-unverified' },
      { label: 'Orientations', value: 'floor ×1 vs floor ×4', quality: 'conflicting', note: 'Configuration XML and Stationpedia disagree' },
      { label: 'Construction', value: '—', quality: 'missing', note: 'No recipe extracted yet; shown as missing, not zero (7.6)' },
      { label: 'Ports', value: 'in / out', quality: 'inferred', note: 'Derived from function; dependencies: geometry probe' },
    ],
  },
];

const definitionsById = new Map<DefinitionId, DeviceDefinition>(
  mockDeviceDefinitions.map((definition) => [definition.id, definition]),
);

export function definitionById(id: DefinitionId): DeviceDefinition | undefined {
  return definitionsById.get(id);
}
