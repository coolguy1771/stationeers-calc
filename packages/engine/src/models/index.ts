/**
 * Behavior-model registry, validity envelopes, and status propagation (SIM-00;
 * spec 5.2, 5.3, 6.6). Pure data + functions, deterministic, no I/O.
 *
 * Topology seam (DOM-02): everything here aggregates MODEL status only
 * (weakest-wins, 5.2.2). Topology status (buildable/conceptual, 3.5) is a
 * separate, independently reported status over resolved networks; DOM-02 will
 * provide its own aggregator and pass the outcome into
 * `assembleCalculationResult` (result.ts). The two statuses join only in
 * `CalculationResult`, exactly as the entity contract fixes them.
 *
 * Pack-diff seam (EXT-04, 6.6): `findModelsAffectedBy` is the invalidation
 * hook — the changed-properties/constants query that lets the semantic pack
 * diff mark consuming models Unverified. The diff itself lives in EXT-04.
 */
export * from './order';
export * from './status';
export * from './registry';
export * from './envelope';
export * from './result';
