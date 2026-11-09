/**
 * Hard upper bounds for fixture documents (spec 9.4: bound collection sizes and
 * nesting at every data boundary).
 *
 * Fixture files are hand-authored and travel with the repository, but they are
 * still parsed as untrusted input: a fixture is a document a human typed, and
 * nothing about it may be assumed well-formed. Values are generous safety nets,
 * not game facts.
 */

// String bounds
export const MAX_FIXTURE_ID_LENGTH = 128;
export const MAX_BUILD_LENGTH = 64;
export const MAX_NAME_LENGTH = 128;
export const MAX_UNIT_LENGTH = 32;
export const MAX_TEXT_LENGTH = 2_000;
export const MAX_NOTES_LENGTH = 8_000;

// Per-scenario bounds
export const MAX_NETWORKS_PER_SCENARIO = 64;
export const MAX_DEVICES_PER_SCENARIO = 64;
export const MAX_DEVICES_PER_NETWORK = 64;
/** Matches the domain's `MAX_INPUTS_PER_ENVELOPE`: conditions mirror envelope inputs. */
export const MAX_CONDITIONS_PER_SCENARIO = 64;
/** Domains with their own update cadence (atmospherics, electrical, logic, …). */
export const MAX_CADENCE_DOMAINS = 16;

// Per-observation bounds
export const MAX_TICK_SAMPLES = 10_000;
export const MAX_TICKS = 1_000_000;
export const MAX_NETWORKS_PER_SAMPLE = 64;
export const MAX_QUANTITIES_PER_RECORD = 256;
export const MAX_EXPECTATIONS = 1_000;
export const MAX_TOLERANCES = 512;
export const MAX_ARTIFACTS = 32;
