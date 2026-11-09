import type { ProjectMeta } from '@stationeers/domain';

/**
 * MOCK project metadata for the projects list (7.1) until persistence
 * (FND-03, IndexedDB) supplies real projects. Shape comes from the frozen
 * domain contract; ids are `mock.`-prefixed so nothing masquerades as
 * extracted game data (spec 6.1, hard rule 4).
 */
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const mockProjects: ProjectMeta[] = [
  {
    schemaVersion: 1,
    id: 'mock.project.atmos',
    name: 'Atmospherics — starter base',
    createdAt: iso(9 * DAY),
    updatedAt: iso(2 * HOUR),
    packId: 'stationeers.stable',
    packHash: '9f2a11c4d0e8',
    gameBuild: 'mock-build-0.2.8',
    channel: 'published',
  },
  {
    schemaVersion: 1,
    id: 'mock.project.coolant',
    name: 'Coolant loop experiments',
    createdAt: iso(21 * DAY),
    updatedAt: iso(3 * DAY),
    packId: 'stationeers.stable',
    packHash: '9f2a11c4d0e8',
    gameBuild: 'mock-build-0.2.8',
    channel: 'published',
  },
  {
    schemaVersion: 1,
    id: 'mock.project.hvac',
    name: 'Greenhouse HVAC draft',
    createdAt: iso(2 * DAY),
    updatedAt: iso(40 * 60_000),
    packId: 'mock.pack.local',
    packHash: 'c3f9b2a7d115',
    gameBuild: 'mock-build-0.2.8',
    channel: 'user-generated',
  },
];
