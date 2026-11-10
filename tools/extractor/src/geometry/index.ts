/*
 * Adapter C geometry capture harness (EXT-05).
 *
 * There is no game access in this build, so Adapter C ships as an instrument
 * the human drives against a clean vanilla install:
 *
 *   geometry init <irDir|pack.json> --out <worksheet.json>
 *   geometry import <observations.json> --out <dir>
 *
 * The procedure is `docs/plan/ext-05-probe.md`. Observations are never
 * verified data: `geometry import` writes geometry records whose per-field
 * provenance is `extracted-unverified`, leaves every unmeasured value null, and
 * reports what still blocks buildability.
 */
export * from './observations';
export * from './records';
export * from './protocol';
export * from './worksheet';
export * from './import';
