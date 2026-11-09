/**
 * Stable diagnostic codes for the canonical store (FND-04; spec 8, 2.2.1).
 *
 * Every failure carries one of these codes, the affected entity ids, and the
 * source rule, so callers can surface store rejections in the diagnostics
 * panel without re-mapping strings.
 */
import type { ValidationDiagnostic, EntityId, Severity } from '../entities';

export const StoreErrorCode = {
  // Command envelope and semantics
  CommandInvalid: 'STORE-COMMAND-INVALID',
  SchemaInvalid: 'STORE-SCHEMA-INVALID',
  EntityExists: 'STORE-ENTITY-EXISTS',
  EntityMissing: 'STORE-ENTITY-MISSING',
  EntityReferenced: 'STORE-ENTITY-REFERENCED',
  PortDuplicate: 'STORE-PORT-DUPLICATE',
  PortMissing: 'STORE-PORT-MISSING',
  PlacementInUse: 'STORE-PLACEMENT-IN-USE',
  PlacementMissing: 'STORE-PLACEMENT-MISSING',
  SettingMissing: 'STORE-SETTING-MISSING',
  PositionMissing: 'STORE-POSITION-MISSING',
  // Undo/redo and revision bookkeeping
  NothingToUndo: 'STORE-NOTHING-TO-UNDO',
  NothingToRedo: 'STORE-NOTHING-TO-REDO',
  RevisionExhausted: 'STORE-REVISION-EXHAUSTED',
  // Patch engine (RFC 6902)
  PatchInvalid: 'STORE-PATCH-INVALID',
  PatchPathMissing: 'STORE-PATCH-PATH-MISSING',
  PatchRoot: 'STORE-PATCH-ROOT',
  PatchTestFailed: 'STORE-PATCH-TEST-FAILED',
} as const;

export type StoreErrorCode = (typeof StoreErrorCode)[keyof typeof StoreErrorCode];

/**
 * A store failure as data. Shape mirrors `ValidationDiagnostic` (spec 8):
 * stable code, severity, affected entity ids, message, source rule.
 */
export class StoreError extends Error {
  readonly code: StoreErrorCode;
  readonly severity: Severity = 'error';
  readonly entityIds: readonly EntityId[];
  /** Spec section or SYNC contract the rule comes from (8). */
  readonly rule: string;

  constructor(
    code: StoreErrorCode,
    message: string,
    options: { entityIds?: readonly EntityId[]; rule?: string } = {},
  ) {
    super(message);
    this.name = 'StoreError';
    this.code = code;
    this.entityIds = options.entityIds ?? [];
    this.rule = options.rule ?? '2.2.1';
  }

  /** Spec-8 diagnostic view of this failure, ready for a diagnostics panel. */
  toDiagnostic(): ValidationDiagnostic {
    return {
      code: this.code,
      severity: this.severity,
      entityIds: [...this.entityIds],
      message: this.message,
      rule: this.rule,
    };
  }
}

/** Wraps an unknown thrown value (bug or foreign error) into a `StoreError`. */
export function asStoreError(error: unknown): StoreError {
  if (error instanceof StoreError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new StoreError(StoreErrorCode.CommandInvalid, `Unexpected store failure: ${message}`);
}
