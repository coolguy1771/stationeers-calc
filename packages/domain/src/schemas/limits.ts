/**
 * Hard upper bounds for every collection and identifier in the domain model
 * (spec 9.4: "Bound graph sizes, entity counts, and nesting").
 *
 * Values are generous safety nets against pathological inputs, not game facts.
 * Grid sizes and other real limits are extracted per build (4.2) and never live here.
 */

// Per-entity bounds
export const MAX_PORT_DEFINITIONS_PER_DEVICE = 64;
export const MAX_PORTS_PER_DEVICE = 64;
export const MAX_FOOTPRINT_CELLS_PER_DEVICE = 256;
export const MAX_ORIENTATIONS_PER_DEVICE = 32;
export const MAX_CONSTRUCTION_REQUIREMENTS_PER_DEVICE = 64;
export const MAX_CELLS_PER_CONSTRUCTION = 64;
export const MAX_ELEMENTS_PER_CONNECTION = 64;
export const MAX_SPECIES_PER_INVENTORY = 64;
export const MAX_CATEGORIES_PER_PORT = 32;
export const MAX_CAPABILITIES_PER_PORT = 32;
export const MAX_INPUTS_PER_ENVELOPE = 64;
export const MAX_CONTRIBUTING_MODELS = 64;
export const MAX_EXPLANATION_LINES = 256;
export const MAX_ENTITY_IDS_PER_DIAGNOSTIC = 64;

// Per-bundle bounds
export const MAX_DEVICES = 10_000;
export const MAX_PLACEMENTS = 10_000;
export const MAX_CONSTRUCTION = 50_000;
export const MAX_CONNECTIONS = 50_000;
export const MAX_INTENTS = 10_000;
export const MAX_SCENARIOS = 100;
export const MAX_INVENTORIES_PER_SCENARIO = 10_000;
export const MAX_NODE_POSITIONS = 10_000;
export const MAX_DEVICE_SETTINGS_PER_SCENARIO = 10_000;
export const MAX_SETTING_KEYS = 64;

// String bounds
export const MAX_ID_LENGTH = 128;
export const MAX_DISPLAY_NAME_LENGTH = 200;
export const MAX_LABEL_LENGTH = 200;
export const MAX_SETTING_VALUE_LENGTH = 2_000;

// Coordinate sanity bound (real grid sizes are extracted per build, 4.2)
export const MAX_COORDINATE = 1_000_000;
