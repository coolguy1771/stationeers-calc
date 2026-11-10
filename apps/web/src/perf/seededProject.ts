import type {
  ConnectionIntent,
  DeviceInstance,
  PhysicalPlacement,
  Project,
} from '@stationeers/domain';
import { mockDeviceDefinitions } from '../mocks/definitions';

/**
 * Seeded project for the performance harness (spec 11 "smooth manipulation of
 * about 200 device instances"; backlog QA-02).
 *
 * This is synthetic, explicitly `perf.`-prefixed content: disposable devices so
 * a repeatable benchmark can draw a realistic canvas. It is never game data
 * (hard rule 4) and never persisted — the harness swaps it into the canonical
 * store with autosave suspended and restores the previous project afterwards.
 *
 * Determinism is the point: same `count` in, identical project out (no clock,
 * no randomness), so a baseline measured today is comparable tomorrow.
 */

/** Instance count the spec's reference desktop target is stated in (11). */
export const PERF_INSTANCE_COUNT = 200;

/** Columns of the placement grid before wrapping to the next row. */
const PLACEMENT_COLUMNS = 20;
/** Cells between placements on the large grid (one empty cell between devices). */
const PLACEMENT_SPACING = 3;

/** Fixed stamp: the harness must not read a clock (5.1.1). */
const FIXED_TIMESTAMP = '2025-01-01T00:00:00.000Z';

export interface SeedOptions {
  /** Instances to create; defaults to the 200-instance target. */
  readonly count?: number;
}

/**
 * Builds `count` instances, one placement per instance and one gas intent per
 * adjacent pair. Instances cycle through the existing mock definitions, so the
 * canvas renders every node shape the editor has.
 */
export function buildPerfProject(
  { count = PERF_INSTANCE_COUNT }: SeedOptions = {},
): Project {
  const total = Math.max(0, Math.trunc(count));
  const devices: DeviceInstance[] = [];
  const placements: PhysicalPlacement[] = [];
  const intents: ConnectionIntent[] = [];
  /** First gas port of each instance, for the intent chain. */
  const gasPorts: { instanceId: string; portId: string }[] = [];

  for (let index = 0; index < total; index += 1) {
    const definition = mockDeviceDefinitions[index % mockDeviceDefinitions.length];
    if (definition === undefined) break;
    const instanceId = `perf.inst.${index}`;
    const placementId = `perf.place.${index}`;
    const ports = definition.ports.map((port, portIndex) => ({
      id: `perf.port.${index}.${portIndex}`,
      definitionId: port.id,
    }));

    devices.push({
      id: instanceId,
      definitionId: definition.id,
      ports,
      placementId,
      settings: {},
    });
    placements.push({
      id: placementId,
      grid: 'large',
      cell: {
        x: (index % PLACEMENT_COLUMNS) * PLACEMENT_SPACING,
        y: Math.floor(index / PLACEMENT_COLUMNS) * PLACEMENT_SPACING,
        z: 0,
      },
      level: 0,
      orientation: { surface: 'floor', yaw: 0 },
    });

    const gasPort = definition.ports.findIndex(
      (port) => port.medium === 'gas-pipe',
    );
    const gasPortInstance = gasPort === -1 ? undefined : ports[gasPort];
    if (gasPortInstance !== undefined) {
      gasPorts.push({ instanceId, portId: gasPortInstance.id });
    }
  }

  for (let index = 0; index + 1 < gasPorts.length; index += 1) {
    const from = gasPorts[index];
    const to = gasPorts[index + 1];
    if (from === undefined || to === undefined) break;
    intents.push({
      id: `perf.intent.${index}`,
      medium: 'gas-pipe',
      from: { instanceId: from.instanceId, portId: from.portId },
      to: { instanceId: to.instanceId, portId: to.portId },
    });
  }

  return {
    meta: {
      schemaVersion: 1,
      id: `perf.project.${total}`,
      name: `Performance harness — ${total} instances`,
      createdAt: FIXED_TIMESTAMP,
      updatedAt: FIXED_TIMESTAMP,
      packId: 'stationeers.stable',
      packHash: '9f2a11c4d0e8',
      gameBuild: 'mock-build-0.2.8',
      channel: 'published',
    },
    devices,
    placements,
    construction: [],
    connections: [],
    intents,
    scenarios: [],
    settings: { autoSave: false, showExperimental: false },
    // Positions stay derived: the harness measures the real first-render path
    // (including the deterministic slot layout), not a pre-baked one.
    schematicLayout: { nodePositions: {} },
  };
}
