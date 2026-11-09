/**
 * Hard upper bounds for the pack format (spec 9.4: packs are untrusted input —
 * "Bound graph sizes, entity counts, and nesting").
 *
 * Values are safety nets against pathological input, not game facts, and are
 * deliberately generous: a real build has ~600 recipes, ~20 families, and a few
 * hundred distinct property paths. Anything past these bounds is reported as a
 * load failure rather than silently truncated.
 */

/** Raw pack file cap (bytes) before parsing. A full vanilla pack is ~1 MiB. */
export const MAX_PACK_FILE_SIZE = 16 * 1024 * 1024; // 16 MiB

// Payload entity bounds
export const MAX_PACK_RECIPES = 5_000;
export const MAX_PACK_ITEMS = 5_000;
export const MAX_PACK_DEVICES = 2_000;
/** IR world references accepted from one extraction (no pack form yet). */
export const MAX_IR_WORLD_REFS = 5_000;

/** Inputs (ingredients) per recipe. */
export const MAX_INPUTS_PER_RECIPE = 64;

/** Property-quality entries per entity: one per emitted value plus missing fields. */
export const MAX_PROPERTIES_PER_ENTITY = 128;

/** Length of a property path such as `temperature.start` or `inputs[3].quantity`. */
export const MAX_PROPERTY_PATH_LENGTH = 64;

// Manifest bounds
export const MAX_SOURCE_FILES = 5_000;

/** Recipe families listed in the coverage report. */
export const MAX_COVERAGE_FAMILIES = 512;
/** Control elements listed in the coverage report. */
export const MAX_COVERAGE_CONTROLS = 256;
/** Structured missing-field entries embedded in the pack (the total is kept). */
export const MAX_COVERAGE_MISSING_FIELD_ENTRIES = 2_000;
/** Diagnostic tallies embedded in the pack (the total is kept). */
export const MAX_COVERAGE_DIAGNOSTIC_ENTRIES = 200;
/** `unpacked` report entries (IR entity types with no pack representation). */
export const MAX_COVERAGE_UNPACKED_ENTRIES = 8;

// Promotion input bounds
/** Explicit promotions accepted from one validation input file. */
export const MAX_PROMOTIONS = 10_000;

// String bounds
export const MAX_SOURCE_PATH_LENGTH = 512;
/** Per-property notes (ours and the extractor's). Real extraction notes are ~225 chars. */
export const MAX_NOTE_LENGTH = 500;
/**
 * Coverage prose: a family's "why it is unmapped" line, a join's explanation, or
 * a pipeline diagnostic message. These are one-off sentences, not per-property
 * repeats, and the extractor writes them up to ~600 chars.
 */
export const MAX_REASON_LENGTH = 2_000;
export const MAX_NUMBER_TEXT_LENGTH = 64;
export const MAX_UNIT_LENGTH = 32;
export const MAX_SCHEMA_VERSION_LABEL = 64;
export const MAX_APPROVER_LENGTH = 128;
