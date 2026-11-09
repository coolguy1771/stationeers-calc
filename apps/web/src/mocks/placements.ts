import type { PhysicalPlacement } from '@stationeers/domain';

/**
 * MOCK physical placements (3.2, 4.2) for the three placed demo instances; the
 * fourth demo instance (`mock.inst.pipe-sensor-1`) stays unplaced so the physical
 * tab can show the placed/unplaced distinction (SYNC-001/002).
 *
 * Cells are demo layout data, not extracted game geometry: grid sizes, footprints
 * and real cell coordinates come from the pinned pack (hard rule 4, EXT-03/
 * EXT-05). Ids stay `mock.`-prefixed for the same reason as the rest of
 * `src/mocks/`.
 */
export const mockPlacements: PhysicalPlacement[] = [
  {
    id: 'mock.place.av1',
    grid: 'large',
    cell: { x: 0, y: 0, z: 0 },
    level: 0,
    orientation: { surface: 'floor', yaw: 0 },
  },
  {
    id: 'mock.place.gm1',
    grid: 'large',
    cell: { x: 2, y: 0, z: 0 },
    level: 0,
    orientation: { surface: 'floor', yaw: 0 },
  },
  {
    id: 'mock.place.pv1',
    grid: 'large',
    cell: { x: 4, y: 0, z: 0 },
    level: 0,
    orientation: { surface: 'wall', yaw: 0 },
  },
];
