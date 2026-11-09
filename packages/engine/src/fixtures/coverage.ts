/**
 * Fixture coverage for a behavior model (SIM-01; spec 5.2, 5.2.1, 6.6 step 7,
 * 13).
 *
 * §6.6 step 7 re-runs the fixtures of every model a pack change invalidated, and
 * a Verified claim is only as good as the evidence set behind it. This module
 * turns "which fixtures back this model, and what do they currently say?" into
 * one report: declared fixtures that are missing, captured-but-not-yet-verified,
 * or failing, plus the parts of the model's declared envelope that no verified
 * fixture actually covers.
 *
 * A model is `ready` only when it has at least one verified, passing fixture and
 * nothing missing, pending, failing, or uncovered. Ready is not a status: it is
 * the precondition for claiming Verified (5.2).
 */
import type { BehaviorModel, ValidityEnvelope, ValidationDiagnostic } from '@stationeers/domain';
import { compareStrings } from '../models/order';
import { modelRef } from '../models/registry';
import { FIXTURE_DIAGNOSTIC_CODES, replayFixture } from './replay';
import type { ReplayModel } from './replay';
import type { ReferenceFixture } from './schema';

/** Stable diagnostic codes emitted by coverage reporting (spec 8). */
export const COVERAGE_DIAGNOSTIC_CODES = {
  /** A fixture the model declares in `fixtureIds` was not supplied. */
  MissingFixture: 'SIM-FIXTURE-MISSING',
  /** A supplied fixture passes replay but is still stored as 'captured'. */
  PendingFixture: 'SIM-FIXTURE-PENDING',
  /** The model declares an envelope range no verified fixture covers. */
  UncoveredEnvelopeInput: 'SIM-ENVELOPE-UNCOVERED',
} as const;
export type CoverageDiagnosticCode =
  (typeof COVERAGE_DIAGNOSTIC_CODES)[keyof typeof COVERAGE_DIAGNOSTIC_CODES];

/** A declared envelope range the verified fixtures do not cover (5.2.1). */
export interface UncoveredEnvelopeRange {
  input: string;
  /** Bounds the model declares. */
  declared: { min?: number; max?: number };
  /** Bounds the verified fixtures cover; absent when none declares the input. */
  covered?: { min?: number; max?: number };
}

/** Coverage of one model's declared evidence set, plus the blockers behind it. */
export interface FixtureCoverageReport {
  modelId: string;
  modelVersion: string;
  /** Declared fixture ids, sorted and deduplicated (code-unit order). */
  declared: string[];
  /** Declared ids with no supplied fixture. */
  missing: string[];
  /** Supplied fixtures that pass replay but are still stored as 'captured'. */
  pending: string[];
  /** Supplied fixtures whose replay fails (includes stored-verified regressions). */
  failing: string[];
  /** Supplied fixtures stored and replaying as verified. */
  verified: string[];
  /** Supplied fixtures the model does not declare in `fixtureIds`. */
  undeclared: string[];
  /** Declared envelope ranges no verified fixture covers (5.2.1). */
  uncovered: UncoveredEnvelopeRange[];
  /** Union of the envelopes contributed by the model's verified fixtures. */
  covered: ValidityEnvelope;
  /** True only when the model may claim Verified on this fixture set (5.2). */
  ready: boolean;
  /** Every §8 diagnostic explaining the report, in a deterministic order. */
  diagnostics: ValidationDiagnostic[];
}

export interface CoverageOptions {
  /** Game build the verification is pinned to (2.4); forwarded to every replay. */
  gameBuild?: string;
}

/**
 * Union of the envelopes contributed by the **verified** fixtures of a set
 * (5.2.1). A captured-but-unpromoted fixture contributes nothing: its numbers
 * have not been accepted as evidence yet. Open ends stay open — one fixture
 * without a lower bound means the union has no lower bound.
 */
export function collectCoveredEnvelope(fixtures: readonly ReferenceFixture[]): ValidityEnvelope {
  const verified = fixtures
    .filter((fixture) => fixture.verificationStatus === 'verified')
    .sort((a, b) => compareStrings(a.fixtureId, b.fixtureId));

  const names = new Set<string>();
  for (const fixture of verified) {
    for (const input of Object.keys(fixture.envelope.inputs)) {
      names.add(input);
    }
  }

  const inputs: Record<string, { min?: number; max?: number }> = {};
  for (const input of [...names].sort(compareStrings)) {
    let min: number | undefined;
    let max: number | undefined;
    let minOpen = false;
    let maxOpen = false;
    for (const fixture of verified) {
      const bounds = fixture.envelope.inputs[input];
      if (bounds === undefined) {
        continue;
      }
      if (bounds.min === undefined) {
        minOpen = true;
      } else {
        min = min === undefined ? bounds.min : Math.min(min, bounds.min);
      }
      if (bounds.max === undefined) {
        maxOpen = true;
      } else {
        max = max === undefined ? bounds.max : Math.max(max, bounds.max);
      }
    }
    inputs[input] = boundsObject(minOpen ? undefined : min, maxOpen ? undefined : max);
  }

  return {
    inputs,
    notes:
      verified.length === 0
        ? 'No verified fixture contributes coverage.'
        : `Covered by ${verified.length} verified fixture(s): ${verified
            .map((fixture) => fixture.fixtureId)
            .join(', ')}.`,
  };
}

/**
 * Report which of a model's declared fixtures are missing, pending, or failing,
 * and whether its declared envelope is covered (6.6 step 7 surface).
 *
 * Every declared fixture is replayed with `model`, so the report is current
 * evidence, not a stored claim. Supplying fixtures the model does not declare is
 * reported (`undeclared`) but does not block readiness: the extra fixture is not
 * part of this model's evidence set.
 */
export function reportModelFixtureCoverage(
  behaviorModel: BehaviorModel,
  fixtures: readonly ReferenceFixture[],
  model: ReplayModel,
  options: CoverageOptions = {},
): FixtureCoverageReport {
  const diagnostics: ValidationDiagnostic[] = [];
  const supplied = new Map<string, ReferenceFixture>();
  for (const fixture of fixtures) {
    if (!supplied.has(fixture.fixtureId)) {
      supplied.set(fixture.fixtureId, fixture);
    }
  }

  const declared = [...new Set(behaviorModel.fixtureIds)].sort(compareStrings);
  const declaredSet = new Set(declared);
  const missing: string[] = [];
  const pending: string[] = [];
  const failing: string[] = [];
  const verified: string[] = [];
  const declaredFixtures: ReferenceFixture[] = [];

  for (const fixtureId of declared) {
    const fixture = supplied.get(fixtureId);
    if (fixture === undefined) {
      missing.push(fixtureId);
      diagnostics.push(missingFixtureDiagnostic(behaviorModel, fixtureId));
      continue;
    }
    declaredFixtures.push(fixture);
    const verdict = replayFixture(fixture, behaviorModel, model, options);
    if (verdict.outcome === 'pass') {
      if (fixture.verificationStatus === 'verified') {
        verified.push(fixtureId);
      } else {
        pending.push(fixtureId);
        diagnostics.push(pendingFixtureDiagnostic(behaviorModel, fixture));
      }
      continue;
    }
    failing.push(fixtureId);
    diagnostics.push(...verdict.diagnostics);
    if (fixture.verificationStatus === 'verified') {
      diagnostics.push(regressionDiagnostic(behaviorModel, fixture));
    }
  }

  const undeclared = [...supplied.keys()].filter((fixtureId) => !declaredSet.has(fixtureId)).sort(compareStrings);
  for (const fixtureId of undeclared) {
    diagnostics.push(undeclaredFixtureDiagnostic(behaviorModel, fixtureId));
  }

  const covered = collectCoveredEnvelope(declaredFixtures);
  const uncovered = uncoveredEnvelopeRanges(behaviorModel.envelope, covered);
  for (const range of uncovered) {
    diagnostics.push(uncoveredEnvelopeDiagnostic(behaviorModel, range));
  }

  if (declared.length === 0) {
    diagnostics.push(noDeclaredFixtureDiagnostic(behaviorModel));
  }

  return {
    modelId: behaviorModel.id,
    modelVersion: behaviorModel.version,
    declared,
    missing,
    pending,
    failing,
    verified,
    undeclared,
    uncovered,
    covered,
    ready:
      declared.length > 0 &&
      verified.length > 0 &&
      missing.length === 0 &&
      pending.length === 0 &&
      failing.length === 0 &&
      uncovered.length === 0,
    diagnostics,
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function boundsObject(min: number | undefined, max: number | undefined): { min?: number; max?: number } {
  const bounds: { min?: number; max?: number } = {};
  if (min !== undefined) {
    bounds.min = min;
  }
  if (max !== undefined) {
    bounds.max = max;
  }
  return bounds;
}

function uncoveredEnvelopeRanges(
  declaredEnvelope: ValidityEnvelope,
  covered: ValidityEnvelope,
): UncoveredEnvelopeRange[] {
  const ranges: UncoveredEnvelopeRange[] = [];
  for (const input of Object.keys(declaredEnvelope.inputs).sort(compareStrings)) {
    const declared = declaredEnvelope.inputs[input];
    if (declared === undefined) {
      continue;
    }
    const coveredBounds = covered.inputs[input];
    if (coveredBounds === undefined) {
      ranges.push({ input, declared: boundsObject(declared.min, declared.max) });
      continue;
    }
    // An open bound in the declared range is only covered by an open bound in
    // the fixtures: "up to anything" is never implied by a finite capture.
    const minCovered =
      coveredBounds.min === undefined ||
      (declared.min !== undefined && declared.min >= coveredBounds.min);
    const maxCovered =
      coveredBounds.max === undefined ||
      (declared.max !== undefined && declared.max <= coveredBounds.max);
    if (!minCovered || !maxCovered) {
      ranges.push({
        input,
        declared: boundsObject(declared.min, declared.max),
        covered: boundsObject(coveredBounds.min, coveredBounds.max),
      });
    }
  }
  return ranges;
}

function missingFixtureDiagnostic(behaviorModel: BehaviorModel, fixtureId: string): ValidationDiagnostic {
  return {
    code: COVERAGE_DIAGNOSTIC_CODES.MissingFixture,
    severity: 'warning',
    entityIds: [behaviorModel.id],
    message:
      `Model '${modelRef(behaviorModel)}' declares fixture '${fixtureId}' in fixtureIds but no such ` +
      'fixture was supplied; the evidence set behind the model is incomplete (5.2.1).',
    rule: '5.2.1',
    suggestion: 'Capture or import the fixture, or remove the id from fixtureIds.',
  };
}

function pendingFixtureDiagnostic(
  behaviorModel: BehaviorModel,
  fixture: ReferenceFixture,
): ValidationDiagnostic {
  return {
    code: COVERAGE_DIAGNOSTIC_CODES.PendingFixture,
    severity: 'warning',
    entityIds: [fixture.fixtureId],
    message:
      `Fixture '${fixture.fixtureId}' replays within tolerance against '${modelRef(behaviorModel)}' but ` +
      "is still stored as 'captured'; until it is promoted it is not part of the Verified evidence (5.2).",
    rule: '5.2',
    suggestion: "Promote the fixture with promoteFixture once the replay verdict is reviewed.",
  };
}

function regressionDiagnostic(
  behaviorModel: BehaviorModel,
  fixture: ReferenceFixture,
): ValidationDiagnostic {
  return {
    code: FIXTURE_DIAGNOSTIC_CODES.FixtureRegression,
    severity: 'error',
    entityIds: [fixture.fixtureId],
    message:
      `Fixture '${fixture.fixtureId}' is stored as verified but no longer replays within tolerance ` +
      `against '${modelRef(behaviorModel)}'; a Verified capability with a failing fixture blocks ` +
      'release (13).',
    rule: '5.2',
    suggestion: 'Fix the model, or re-capture and re-promote the fixture on the pinned build.',
  };
}

function undeclaredFixtureDiagnostic(
  behaviorModel: BehaviorModel,
  fixtureId: string,
): ValidationDiagnostic {
  return {
    code: FIXTURE_DIAGNOSTIC_CODES.UndeclaredFixture,
    severity: 'warning',
    entityIds: [fixtureId],
    message:
      `Fixture '${fixtureId}' was supplied but model '${modelRef(behaviorModel)}' does not list it ` +
      'in fixtureIds, so it is not part of the model\'s declared evidence (5.2.1).',
    rule: '5.2.1',
    suggestion: "Add the id to the model's fixtureIds, or stop supplying the fixture to this model.",
  };
}

function uncoveredEnvelopeDiagnostic(
  behaviorModel: BehaviorModel,
  range: UncoveredEnvelopeRange,
): ValidationDiagnostic {
  const coveredText =
    range.covered === undefined
      ? 'no verified fixture declares this input'
      : `verified fixtures cover min ${range.covered.min ?? 'none'}, max ${range.covered.max ?? 'none'}`;
  return {
    code: COVERAGE_DIAGNOSTIC_CODES.UncoveredEnvelopeInput,
    severity: 'warning',
    entityIds: [behaviorModel.id],
    message:
      `Model '${modelRef(behaviorModel)}' declares envelope input '${range.input}' over min ` +
      `${range.declared.min ?? 'none'}, max ${range.declared.max ?? 'none'}, but ${coveredText}; ` +
      'a Verified claim may only cover the ranges its fixtures captured (5.2.1).',
    rule: '5.2.1',
    suggestion: 'Narrow the declared envelope to the captured ranges, or capture fixtures for the rest.',
  };
}

function noDeclaredFixtureDiagnostic(behaviorModel: BehaviorModel): ValidationDiagnostic {
  return {
    code: FIXTURE_DIAGNOSTIC_CODES.NoEvidence,
    severity: 'warning',
    entityIds: [behaviorModel.id],
    message:
      `Model '${modelRef(behaviorModel)}' lists no fixtures, so no recorded game behaviour backs it; ` +
      'it can only be Unverified or Unsupported (5.2).',
    rule: '5.2',
    suggestion: 'Capture a reference fixture for the mechanic and add its id to fixtureIds.',
  };
}
