/**
 * Stable failure codes and the error type for the pack format (spec 8).
 *
 * Codes are part of the pack contract: they are logged, shown next to a
 * rejected pack, and must never be renamed once a release ships. Every
 * rejection here names what was wrong instead of coercing the input (spec 9.2,
 * 9.4).
 */

export const PackErrorCode = {
  /** The builder input failed validation (extractor output or metadata). */
  BuildInputInvalid: 'PACK-BUILD-INPUT-INVALID',
  /** The IR version the extractor produced is not one this pack schema packs. */
  IrVersionUnsupported: 'PACK-IR-VERSION-UNSUPPORTED',
  /** The metadata's declared IR version disagrees with the IR it describes. */
  IrVersionMismatch: 'PACK-IR-VERSION-MISMATCH',
  /** The extractor manifest's file list and file count disagree. */
  ManifestInconsistent: 'PACK-MANIFEST-INCONSISTENT',
  /** A promotion names an entity the pack does not contain. */
  PromotionUnknownEntity: 'PACK-PROMOTION-UNKNOWN-ENTITY',
  /** A promotion names a property the entity does not carry. */
  PromotionUnknownProperty: 'PACK-PROMOTION-UNKNOWN-PROPERTY',
  /** A promotion tries to validate a property the source does not supply. */
  PromotionMissingProperty: 'PACK-PROMOTION-MISSING-PROPERTY',
  /** A promotion tries to validate one side of a conflicting record. */
  PromotionConflicting: 'PACK-PROMOTION-CONFLICTING',
  /** The same property is promoted twice in one input. */
  PromotionDuplicate: 'PACK-PROMOTION-DUPLICATE',
  /** A promoted quantity has no unit semantics, so it cannot back exact math. */
  PromotionUnitRequired: 'PACK-PROMOTION-UNIT-REQUIRED',
  /** A promotion declares a unit that contradicts the value's verified unit. */
  PromotionUnitMismatch: 'PACK-PROMOTION-UNIT-MISMATCH',
  /** A promotion declares a unit for a property that is not a quantity. */
  PromotionUnitNotApplicable: 'PACK-PROMOTION-UNIT-NOT-APPLICABLE',
  /** Only stable-branch builds may be published as supported (spec 6.4). */
  PublishedOnBetaBranch: 'PACK-PUBLISHED-BETA-BRANCH',
  /** The pack JSON exceeds the file-size cap (spec 9.4). */
  LoadTooLarge: 'PACK-LOAD-TOO-LARGE',
  /** The payload is not JSON. */
  LoadNotJson: 'PACK-LOAD-NOT-JSON',
  /** The payload is not a pack object (no `packSchemaVersion`). */
  LoadNotPack: 'PACK-LOAD-NOT-PACK',
  /** An older pack schema version with no registered migration (spec 9.2). */
  SchemaUnsupported: 'PACK-SCHEMA-UNSUPPORTED',
  /** A future pack schema version; rejected, never coerced (spec 9.2). */
  SchemaFuture: 'PACK-SCHEMA-FUTURE',
  /** The payload fails the pack schema. */
  SchemaInvalid: 'PACK-SCHEMA-INVALID',
  /** The recomputed content hash disagrees with the declared one (spec 9.4). */
  HashMismatch: 'PACK-HASH-MISMATCH',
  /** A quality invariant is broken (validated without approval, unitless quantity). */
  QualityInvariant: 'PACK-QUALITY-INVARIANT',
  /** A capability claim consumes a property that is not validated (spec 6.5). */
  CapabilityUnvalidatedInput: 'PACK-CAPABILITY-UNVALIDATED-INPUT',
  /** EXT-04's diff is not implemented yet (seam). */
  DiffNotImplemented: 'PACK-DIFF-NOT-IMPLEMENTED',
} as const;

export type PackErrorCode = (typeof PackErrorCode)[keyof typeof PackErrorCode];

/** A pack build, load, or quality failure carrying a stable code. */
export class PackError extends Error {
  readonly code: PackErrorCode;
  /** Human-readable specifics: offending entity ids, schema issues, … */
  readonly details: string[];

  constructor(code: PackErrorCode, message: string, details: string[] = []) {
    super(details.length > 0 ? `${message}\n${details.join('\n')}` : message);
    this.name = 'PackError';
    this.code = code;
    this.details = details;
  }
}
