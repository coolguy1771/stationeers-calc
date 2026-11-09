import type { Project } from '@stationeers/domain';
import { mockDeviceInstances } from './instances';
import { mockIntents } from './intents';
import { mockPlacements } from './placements';

/**
 * The seeded demo project — the ONE canonical `Project` this session loads into
 * the FND-04 store at startup (spec 2.2.1).
 *
 * It assembles the `mock.`-prefixed demo content from `src/mocks/` into the
 * frozen entity contract; none of it is extracted game data (6.1, hard rule 4).
 * Derived entities — resolved networks, rooms, intent topology status — are
 * absent by design: they are recomputed on load and never serialized (9.1).
 *
 * Timestamps are stamped at module load because the canonical store never reads
 * a clock (5.1.1); the persistence layer stamps `meta.updatedAt` when it saves.
 */
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const isoAgo = (msAgo: number): string => new Date(Date.now() - msAgo).toISOString();

export const demoProject: Project = {
  meta: {
    schemaVersion: 1,
    id: 'mock.project.atmos',
    name: 'Atmospherics — starter base',
    createdAt: isoAgo(9 * DAY),
    updatedAt: isoAgo(2 * HOUR),
    packId: 'stationeers.stable',
    packHash: '9f2a11c4d0e8',
    gameBuild: 'mock-build-0.2.8',
    channel: 'published',
  },
  devices: mockDeviceInstances,
  placements: mockPlacements,
  construction: [],
  connections: [],
  intents: mockIntents,
  // No scenarios yet: scenario editing lands with SIM-02, and a scenario that
  // keys an inventory or an assumed volume on an intent makes that intent
  // undeletable (the store refuses rather than silently discarding settings,
  // SYNC-009) — which would block the undo/redo demonstration.
  scenarios: [],
  settings: { autoSave: true, showExperimental: false },
  schematicLayout: { nodePositions: {} },
};
