/**
 * Structured diagnostics for the extraction pipeline (spec 8).
 *
 * Mirrors `@stationeers/domain`'s ValidationDiagnostic vocabulary minus
 * pack-scoped fields, extended with the extraction-source location that
 * adapters know at parse time.
 */
import type { EntityId } from '@stationeers/domain';

/** Severity values shared with the domain validation vocabulary (spec 8). */
export type Severity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  /** Stable code, e.g. "IR-DUP-ID"; never changes once published to packs. */
  code: string;
  severity: Severity;
  /** Human-readable description of what happened and where. */
  message: string;
  /** IDs of the entities affected; empty when nothing addressable is known. */
  entityIds?: EntityId[];
  /** Spec section or rule this diagnostic derives from, e.g. "6.3", "9.4". */
  sourceRule?: string;
  /** File within the extraction input, relative to the scanned directory. */
  sourceFile?: string;
  /** Path inside the source file to the offending node/attribute. */
  sourcePath?: string;
  /** Actionable next step, when one exists. */
  suggestedResolution?: string;
}

/** Non-throwing warning sink used by adapters and pipeline stages. */
export type SinkFn = (diagnostic: Diagnostic) => void;
