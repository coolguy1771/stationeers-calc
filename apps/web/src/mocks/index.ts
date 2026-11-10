/**
 * MOCK data module (UI-01).
 *
 * Everything here is explicitly mock: `mock.`-prefixed ids, fake hashes, fake
 * build numbers. Two things still come from here:
 *
 * - `demoProject` — the seeded canonical project. It is loaded into the FND-04
 *   store once at startup (`src/state/projectStore.ts`); views must read the
 *   PROJECT from the store, never from this module.
 * - catalog definitions, the mock calculation result and the mock diagnostics,
 *   which stand in for EXT-03 packs and SIM-02/SIM-03 engine output. Remaining
 *   mock entities are assembled into `demoProject` and reached through the store.
 *
 * Shapes come from the frozen domain contract (`@stationeers/domain`); no
 * parallel entity types are defined here.
 */
export { demoProject } from './demoProject';
export { definitionById, mockCatalog, type PropertyRow } from './definitions';
export { placedInstanceCount } from './instances';
export { mockCalculationResult } from './analysis';
export { mockDiagnostics } from './diagnostics';
