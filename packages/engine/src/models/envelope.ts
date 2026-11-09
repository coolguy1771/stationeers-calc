/**
 * Validity-envelope checking (spec 5.2.1): each Verified model declares the
 * input ranges its fixtures cover; inputs outside the envelope downgrade the
 * capability to Unverified for that result, with a diagnostic naming the input.
 *
 * Bounds are inclusive: `min ≤ value ≤ max` passes. An envelope names the
 * fixture-covered range, and a fixture captured exactly at a declared bound
 * is inside that range; an open end (`min`/`max` absent) is unconstrained.
 * Inputs the envelope does not declare are not checked: envelope coverage is
 * declared per input, and an undeclared-but-consumed input is an authoring
 * gap for SIM-01 fixture validation to catch, not a runtime failure.
 *
 * Preconditions enforced by `BehaviorModelSchema` at every data boundary
 * (9.4): declared bounds are finite numbers and envelope input names are
 * unique (they are record keys). The check does not defend against malformed
 * bounds — pack loaders reject them before registration.
 */
import type { BehaviorModel, ModelStatus, Severity, ValidationDiagnostic } from '@stationeers/domain';
import { compareStrings } from './order';
import { modelRef } from './registry';

/** Stable diagnostic codes emitted by envelope checks (spec 8). */
export const ENVELOPE_DIAGNOSTIC_CODES = {
  /** A finite numeric input lies outside the declared range. */
  OutOfEnvelope: 'SIM-OUT-OF-ENVELOPE',
  /** An input declared in the envelope was not provided at all. */
  MissingInput: 'SIM-MISSING-ENVELOPE-INPUT',
  /** A declared input was provided but is not a finite number. */
  NonNumericInput: 'SIM-NON-NUMERIC-INPUT',
} as const;
export type EnvelopeDiagnosticCode =
  (typeof ENVELOPE_DIAGNOSTIC_CODES)[keyof typeof ENVELOPE_DIAGNOSTIC_CODES];

/** One offending declared input. */
export interface EnvelopeFailure {
  code: EnvelopeDiagnosticCode;
  /** Name of the offending declared input. */
  input: string;
  /** Offending value; absent for missing inputs. */
  value?: unknown;
  /** Declared bounds, as written in the envelope (absent when open). */
  min?: number;
  max?: number;
}

/**
 * Outcome of an envelope check: pass, or a structured failure naming every
 * offending declared input together with one spec-8 diagnostic per failure.
 */
export type EnvelopeCheck =
  | { ok: true }
  | {
      ok: false;
      /** Every offending declared input, sorted by input name (deterministic). */
      failures: EnvelopeFailure[];
      /** One diagnostic per failure, same order as `failures`. */
      diagnostics: ValidationDiagnostic[];
    };

/**
 * Check runtime inputs against a model's declared validity envelope (5.2.1).
 *
 * `undefined` counts as a missing input; any other non-finite-number value
 * (string, NaN, ±Infinity, null, object, …) fails as non-numeric. Severity
 * mapping: a missing or non-numeric input prevents running the model at all
 * ('error'); an out-of-range input still runs but loses its Verified claim
 * ('warning' — see `effectiveStatus` for the downgrade).
 */
export function checkEnvelope(model: BehaviorModel, inputs: Record<string, unknown>): EnvelopeCheck {
  const failures: EnvelopeFailure[] = [];
  const declared = Object.entries(model.envelope.inputs).sort(([a], [b]) => compareStrings(a, b));
  for (const [name, bounds] of declared) {
    const value = inputs[name];
    if (value === undefined) {
      failures.push({ code: ENVELOPE_DIAGNOSTIC_CODES.MissingInput, input: name });
    } else if (typeof value !== 'number' || !Number.isFinite(value)) {
      failures.push({ code: ENVELOPE_DIAGNOSTIC_CODES.NonNumericInput, input: name, value });
    } else if (
      (bounds.min !== undefined && value < bounds.min) ||
      (bounds.max !== undefined && value > bounds.max)
    ) {
      failures.push({
        code: ENVELOPE_DIAGNOSTIC_CODES.OutOfEnvelope,
        input: name,
        value,
        min: bounds.min,
        max: bounds.max,
      });
    }
  }
  if (failures.length === 0) {
    return { ok: true };
  }
  return { ok: false, failures, diagnostics: failures.map((failure) => diagnosticFor(model, failure)) };
}

function diagnosticFor(model: BehaviorModel, failure: EnvelopeFailure): ValidationDiagnostic {
  const ref = modelRef(model);
  const boundsText = `min ${failure.min ?? 'none'}, max ${failure.max ?? 'none'}`;
  const inputName = `'${failure.input}'`;
  let message: string;
  let severity: Severity;
  let suggestion: string;
  switch (failure.code) {
    case ENVELOPE_DIAGNOSTIC_CODES.OutOfEnvelope:
      severity = 'warning';
      message =
        `Input ${inputName} = ${formatValue(failure.value)} is outside the validity envelope of ` +
        `model '${ref}' (declared ${boundsText}); the capability is downgraded to Unverified ` +
        'for this result (spec 5.2.1).';
      suggestion = 'Keep the input within the declared envelope, or treat the result as Unverified.';
      break;
    case ENVELOPE_DIAGNOSTIC_CODES.MissingInput:
      severity = 'error';
      message =
        `Input ${inputName} is declared in the validity envelope of model '${ref}' but was not ` +
        'provided (spec 5.2.1).';
      suggestion = `Provide a value for ${inputName} within the declared envelope.`;
      break;
    case ENVELOPE_DIAGNOSTIC_CODES.NonNumericInput:
      severity = 'error';
      message =
        `Input ${inputName} = ${formatValue(failure.value)} is not a finite number; the validity ` +
        `envelope of model '${ref}' declares a numeric range (spec 5.2.1).`;
      suggestion = `Provide a finite number for ${inputName}.`;
      break;
  }
  return {
    code: failure.code,
    severity,
    entityIds: [model.id],
    message,
    rule: '5.2.1',
    suggestion,
  };
}

function formatValue(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

/**
 * Model status after an envelope check (5.2.1): an out-of-envelope result
 * downgrades Verified to Unverified for that result. Any other base status is
 * returned unchanged — the envelope guards only the Verified claim, and the
 * weaker statuses are already weaker than the downgrade.
 */
export function effectiveStatus(base: ModelStatus, check: EnvelopeCheck): ModelStatus {
  return check.ok || base !== 'verified' ? base : 'unverified';
}
