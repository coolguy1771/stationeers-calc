/**
 * Import/export limits (spec 9.4: "Enforce file-size and decompressed-size limits.
 * Bound graph sizes, entity counts, and nesting.").
 *
 * Entity and graph bounds are enforced by the domain bundle schema itself
 * (`packages/domain/src/schemas/limits.ts`); the file-level caps live here.
 */

/** Raw file cap for imported bundles (compressed or not). */
export const MAX_IMPORT_FILE_SIZE = 10 * 1024 * 1024; // 10 MiB
/** Cap after decompression, to stop decompression bombs. */
export const MAX_IMPORT_DECOMPRESSED_SIZE = 32 * 1024 * 1024; // 32 MiB
/** Cap for exported bundles (a safety net against runaway projects). */
export const MAX_EXPORT_FILE_SIZE = 32 * 1024 * 1024; // 32 MiB