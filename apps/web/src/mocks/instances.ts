import type { DeviceInstance, EntityId } from '@stationeers/domain';

/**
 * MOCK device instances (3.3) matching the mock definitions. One instance is
 * deliberately unplaced (no placementId) so the physical tab can show the
 * placed/unplaced distinction (SYNC-001/002) and the analysis mock can lean on
 * it for its Conceptual topology status.
 */
export const mockDeviceInstances: DeviceInstance[] = [
  {
    id: 'mock.inst.active-vent-1',
    definitionId: 'mock.active-vent',
    ports: [
      { id: 'mock.port.av1.gas', definitionId: 'mock.port.av.gas' },
      { id: 'mock.port.av1.power', definitionId: 'mock.port.av.power' },
    ],
    placementId: 'mock.place.av1',
    settings: { 'pressure-limit-kpa': 101 },
  },
  {
    id: 'mock.inst.mixer-1',
    definitionId: 'mock.gas-mixer',
    ports: [
      { id: 'mock.port.gm1.in-a', definitionId: 'mock.port.gm.in-a' },
      { id: 'mock.port.gm1.in-b', definitionId: 'mock.port.gm.in-b' },
      { id: 'mock.port.gm1.out', definitionId: 'mock.port.gm.out' },
    ],
    placementId: 'mock.place.gm1',
    settings: { 'mix-ratio-a': 50 },
  },
  {
    id: 'mock.inst.passive-vent-1',
    definitionId: 'mock.passive-vent',
    ports: [{ id: 'mock.port.pv1.gas', definitionId: 'mock.port.pv.gas' }],
    placementId: 'mock.place.pv1',
    settings: {},
  },
  {
    id: 'mock.inst.pipe-sensor-1',
    definitionId: 'mock.digital-valve',
    ports: [
      { id: 'mock.port.dv1.in', definitionId: 'mock.port.dv.in' },
      { id: 'mock.port.dv1.out', definitionId: 'mock.port.dv.out' },
    ],
    settings: {},
  },
];

const instancesById = new Map<EntityId, DeviceInstance>(
  mockDeviceInstances.map((instance) => [instance.id, instance]),
);

export function instanceById(id: EntityId): DeviceInstance | undefined {
  return instancesById.get(id);
}

export function placedInstanceCount(instances: readonly DeviceInstance[]): number {
  return instances.filter((instance) => instance.placementId !== undefined).length;
}
