/**
 * MOCK data module (UI-01).
 *
 * Everything here is explicitly mock: `mock.`-prefixed ids, fake hashes, fake
 * build numbers. It exists so the UI foundation can be reviewed before
 * FND-04 (canonical store), FND-03 (persistence), and EXT-03 (packs) land.
 * Wave-2 replaces these exports with selectors over the canonical store —
 * see the seam comment in `src/state/uiStore.ts` (spec 2.2, FND-04).
 * Shapes come from the frozen domain contract (`@stationeers/domain`); no
 * parallel entity types are defined here.
 */
export { mockProjects } from './projects';
export { definitionById, mockCatalog, mockDeviceDefinitions, type PropertyRow } from './definitions';
export { instanceById, mockDeviceInstances, placedInstanceCount } from './instances';
export { mockIntentTopology, mockIntents } from './intents';
export { mockCalculationResult } from './analysis';
export { mockDiagnostics } from './diagnostics';
