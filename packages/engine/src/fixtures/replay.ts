/**
 * Replay/comparison harness for reference fixtures (SIM-01; spec 10.3, 5.2,
 * 5.2.1, 5.4, 8).
 *
 * `replayFixture` runs a model implementation against one fixture's scenario and
 * compares every asserted quantity with the recorded game output inside the
 * fixture's declared tolerance. It is a pure function: same fixture, same model,
 * same verdict (5.5).
 *
 * The §5.2 rule is enforced in one place: `statusClaim` is `'verified'` only
 * when every quantity passes **and** the scenario is inside the model's declared
 * envelope (5.2.1) **and** the model declares the fixture in `fixtureIds` **and**
 * the fixture was captured on the pinned build (2.4). Anything else yields
 * `'unverified'` with the diagnostics that explain why — there is no path where
 * a mismatch or an out-of-envelope scenario silently passes, and a quantity the
 * model did not produce is an explicit failure (8: an unsupported result is not
 * a pass).
 *
 * A verdict is evidence, not a status change: only `promoteFixture` writes
 * `verificationStatus: 'verified'`, and it refuses anything but a `'verified'`
 * claim.
 */
import type { BehaviorModel, ValidationDiagnostic } from '@stationeers/domain';
import { checkEnvelope } from '../models/envelope';
import type { EnvelopeCheck } from '../models/envelope';
import { compareStrings } from '../models/order';
import { modelRef } from '../models/registry';
import type { ObservationProtocol, ReferenceFixture, FixtureScenario, Tolerance } from './schema';

/** Stable diagnostic codes emitted by fixture replay and coverage (spec 8). */
export const FIXTURE_DIAGNOSTIC_CODES = {
  /** A model-produced quantity lies outside the declared tolerance. */
  QuantityMismatch: 'SIM-FIXTURE-QUANTITY-MISMATCH',
  /** The model produced no value for an asserted quantity. */
  MissingQuantity: 'SIM-FIXTURE-MISSING-QUANTITY',
  /** The model produced a value that is not a finite number. */
  NonNumericQuantity: 'SIM-FIXTURE-NON-NUMERIC-QUANTITY',
  /** An asserted quantity has no declared tolerance. */
  MissingTolerance: 'SIM-FIXTURE-MISSING-TOLERANCE',
  /** The model's `fixtureIds` does not list the fixture being replayed. */
  UndeclaredFixture: 'SIM-FIXTURE-UNDECLARED',
  /** The fixture was captured on a different game build than the pinned one. */
  IncompatibleBuild: 'SIM-INCOMPATIBLE-BUILD',
  /** A fixture stored as 'verified' no longer replays within tolerance. */
  FixtureRegression: 'SIM-FIXTURE-REGRESSION',
  /** Nothing was compared, so there is no evidence for any claim (8). */
  NoEvidence: 'SIM-FIXTURE-NO-EVIDENCE',
  /** The model implementation threw while simulating the fixture. */
  ModelError: 'SIM-FIXTURE-MODEL-ERROR',
} as const;
export type FixtureDiagnosticCode =
  (typeof FIXTURE_DIAGNOSTIC_CODES)[keyof typeof FIXTURE_DIAGNOSTIC_CODES];

/**
 * Model output for one tick: values keyed by the canonical quantity keys of
 * `quantities.ts`. `undefined` means "the model has no value for this
 * quantity" and is reported as a failure, never skipped.
 */
export interface ModelSample {
  readonly tick: number;
  readonly quantities: Readonly<Record<string, number | undefined>>;
}

/**
 * What a model implementation returns: a per-tick series, or the final state of
 * the observation window. Both are legitimate: a static/closed-form mechanic
 * (13 #11) only ever answers for the steady state.
 */
export type ModelRun =
  | { readonly kind: 'ticks'; readonly samples: readonly ModelSample[] }
  | { readonly kind: 'final-state'; readonly quantities: Readonly<Record<string, number | undefined>> };

/**
 * A model implementation under test. It receives the scenario and the
 * observation protocol only — never `expected` (the answer) nor the recorded
 * ticks.
 */
export type ReplayModel = (
  scenario: FixtureScenario,
  observation: ObservationProtocol,
) => ModelRun;

/** Wrap a stepping implementation (one sample per simulated tick). */
export function perTickModel(
  simulate: (scenario: FixtureScenario, observation: ObservationProtocol) => readonly ModelSample[],
): ReplayModel {
  return (scenario, observation) => ({ kind: 'ticks', samples: simulate(scenario, observation) });
}

/**
 * Wrap a closed-form/final-state implementation. Its answer is placed at the
 * end of the observation window (`observation.tickCount`), so it satisfies
 * assertions anchored to the last recorded sample and leaves any earlier-tick
 * assertion unanswered — which fails explicitly rather than being skipped.
 */
export function finalStateModel(
  compute: (
    scenario: FixtureScenario,
    observation: ObservationProtocol,
  ) => Readonly<Record<string, number | undefined>>,
): ReplayModel {
  return (scenario, observation) => ({
    kind: 'final-state',
    quantities: compute(scenario, observation),
  });
}

export interface ReplayOptions {
  /**
   * Game build the verification is pinned to (2.4). When given, a fixture
   * captured on another build cannot support a Verified claim.
   */
  gameBuild?: string;
}

/** Comparison of one asserted quantity against the model's value. */
export interface ReplayComparison {
  tick: number;
  /** Canonical quantity key (`quantities.ts`). */
  quantity: string;
  /** Value the capture recorded. */
  expected: number;
  /** Model value; absent when the model produced none or a non-finite value. */
  actual: number | undefined;
  /** `|actual − expected|`; absent when there is no numeric actual. */
  deviation: number | undefined;
  /** Allowed deviation `abs + rel × |expected|`; absent when no tolerance was declared. */
  allowed: number | undefined;
  status: 'pass' | 'fail';
  /** Why it failed (stable code), when it failed. */
  failureCode?: FixtureDiagnosticCode;
}

/** The comparison furthest outside tolerance: largest `deviation / allowed`. */
export interface WorstDeviation {
  tick: number;
  quantity: string;
  expected: number;
  actual: number;
  deviation: number;
  allowed: number;
  /** `deviation / allowed`; 1 is exactly at the tolerance boundary, >1 fails. */
  ratio: number;
}

/** Structured result of replaying one fixture against one model. */
export interface FixtureReplayVerdict {
  fixtureId: string;
  modelId: string;
  modelVersion: string;
  /** 'pass' only when every asserted quantity is within its tolerance and something was compared. */
  outcome: 'pass' | 'fail';
  /**
   * The model status this fixture supports right now (5.2): `'verified'` only
   * for a passing replay inside the envelope, declared, on the pinned build.
   */
  statusClaim: 'verified' | 'unverified';
  /** One entry per asserted quantity, in (tick, quantity) order. */
  comparisons: ReplayComparison[];
  /** Largest deviation/allowed ratio; absent when nothing numeric was compared. */
  worst: WorstDeviation | undefined;
  /** Envelope check of the scenario conditions against the model's envelope (5.2.1). */
  envelope: EnvelopeCheck;
  /** Every §8 diagnostic that explains the verdict, in a deterministic order. */
  diagnostics: ValidationDiagnostic[];
}

/**
 * Simulate a fixture's scenario with `model` and compare the result against the
 * fixture's recorded outputs (10.3).
 *
 * The fixture is expected to be schema-validated (`parseReferenceFixture`); a
 * hand-built fixture that lacks a tolerance or an assertion is still reported
 * as a failure rather than passed silently.
 */
export function replayFixture(
  fixture: ReferenceFixture,
  behaviorModel: BehaviorModel,
  model: ReplayModel,
  options: ReplayOptions = {},
): FixtureReplayVerdict {
  const diagnostics: ValidationDiagnostic[] = [];

  const envelope = checkEnvelope(behaviorModel, fixture.scenario.conditions);
  if (!envelope.ok) {
    diagnostics.push(...envelope.diagnostics);
  }

  const declared = behaviorModel.fixtureIds.includes(fixture.fixtureId);
  if (!declared) {
    diagnostics.push(undeclaredDiagnostic(fixture, behaviorModel));
  }

  const pinnedBuild = options.gameBuild;
  const buildMatches = pinnedBuild === undefined || pinnedBuild === fixture.gameBuild;
  if (pinnedBuild !== undefined && !buildMatches) {
    diagnostics.push(buildMismatchDiagnostic(fixture, pinnedBuild));
  }

  // A throwing model is a failing model, not a crash of the harness: a coverage
  // re-run over a fixture set must report every fixture, not stop at the first
  // one that breaks.
  let run: ModelRun | undefined;
  try {
    run = model(fixture.scenario, fixture.observation);
  } catch (error) {
    diagnostics.push(modelErrorDiagnostic(fixture, behaviorModel, error));
  }

  const comparisons: ReplayComparison[] = [];
  if (run !== undefined) {
    const computed = indexModelRun(run, fixture);
    for (const expectation of fixture.expected) {
      const values = computed.get(expectation.tick);
      for (const quantity of Object.keys(expectation.quantities).sort(compareStrings)) {
        const expected = expectation.quantities[quantity];
        if (expected === undefined) {
          continue;
        }
        const tolerance = fixture.tolerances.quantities[quantity];
        const comparison = compareQuantity({
          tick: expectation.tick,
          quantity,
          expected,
          raw: values === undefined ? undefined : values[quantity],
          tolerance,
        });
        comparisons.push(comparison);
        const failure = failureDiagnostic(fixture, behaviorModel, comparison, tolerance);
        if (failure !== undefined) {
          diagnostics.push(failure);
        }
      }
    }
    comparisons.sort((a, b) =>
      a.tick !== b.tick ? a.tick - b.tick : compareStrings(a.quantity, b.quantity),
    );

    if (comparisons.length === 0) {
      diagnostics.push(noEvidenceDiagnostic(fixture));
    }
  }

  const outcome: 'pass' | 'fail' =
    comparisons.length > 0 && comparisons.every((comparison) => comparison.status === 'pass')
      ? 'pass'
      : 'fail';
  const statusClaim =
    outcome === 'pass' && envelope.ok && declared && buildMatches ? ('verified' as const) : ('unverified' as const);

  return {
    fixtureId: fixture.fixtureId,
    modelId: behaviorModel.id,
    modelVersion: behaviorModel.version,
    outcome,
    statusClaim,
    comparisons,
    worst: worstDeviation(comparisons),
    envelope,
    diagnostics,
  };
}

/** Outcome of asking to record a fixture as Verified (5.2). */
export interface FixturePromotion {
  /** The fixture with `verificationStatus: 'verified'`; present only when allowed. */
  fixture?: ReferenceFixture;
  /** Why the promotion was refused, when it was. */
  reason?: string;
}

/**
 * Record a fixture as Verified — the only path from a replay verdict to the
 * stored `verificationStatus` (5.2). Refuses unless the verdict is for this
 * fixture and claims 'verified' (passing, inside the envelope, declared, on the
 * pinned build); returns a copy and never mutates its input.
 */
export function promoteFixture(
  fixture: ReferenceFixture,
  verdict: FixtureReplayVerdict,
): FixturePromotion {
  if (verdict.fixtureId !== fixture.fixtureId) {
    return {
      reason: `verdict is for fixture '${verdict.fixtureId}', not '${fixture.fixtureId}'`,
    };
  }
  if (verdict.statusClaim !== 'verified') {
    const codes = verdict.diagnostics.map((diagnostic) => diagnostic.code);
    return {
      reason:
        `replay outcome '${verdict.outcome}' does not support a Verified claim ` +
        `(envelope ${verdict.envelope.ok ? 'ok' : 'out of envelope'}; ` +
        `codes: ${codes.length === 0 ? 'none' : codes.join(', ')})`,
    };
  }
  return { fixture: { ...fixture, verificationStatus: 'verified' } };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface CompareInput {
  tick: number;
  quantity: string;
  expected: number;
  /** Raw model value: untrusted by design, so non-numeric output is reported. */
  raw: unknown;
  tolerance: Tolerance | undefined;
}

function compareQuantity(input: CompareInput): ReplayComparison {
  const { tick, quantity, expected, tolerance } = input;
  const allowed =
    tolerance === undefined
      ? undefined
      : (tolerance.abs ?? 0) + (tolerance.rel ?? 0) * Math.abs(expected);
  const actual = typeof input.raw === 'number' && Number.isFinite(input.raw) ? input.raw : undefined;
  const deviation = actual === undefined ? undefined : Math.abs(actual - expected);
  const base: ReplayComparison = { tick, quantity, expected, actual, deviation, allowed, status: 'fail' };

  if (tolerance === undefined || allowed === undefined) {
    return { ...base, failureCode: FIXTURE_DIAGNOSTIC_CODES.MissingTolerance };
  }
  if (input.raw === undefined) {
    return { ...base, failureCode: FIXTURE_DIAGNOSTIC_CODES.MissingQuantity };
  }
  if (actual === undefined || deviation === undefined) {
    return { ...base, failureCode: FIXTURE_DIAGNOSTIC_CODES.NonNumericQuantity };
  }
  // Exactly at the tolerance passes: the tolerance is the announced range of
  // observed game behaviour, and a value on its boundary is inside that range.
  if (deviation <= allowed) {
    return { ...base, status: 'pass' };
  }
  return { ...base, failureCode: FIXTURE_DIAGNOSTIC_CODES.QuantityMismatch };
}

function indexModelRun(
  run: ModelRun,
  fixture: ReferenceFixture,
): Map<number, Readonly<Record<string, number | undefined>>> {
  const byTick = new Map<number, Readonly<Record<string, number | undefined>>>();
  if (run.kind === 'final-state') {
    byTick.set(fixture.observation.tickCount, run.quantities);
    return byTick;
  }
  for (const sample of run.samples) {
    byTick.set(sample.tick, sample.quantities);
  }
  return byTick;
}

function worstDeviation(comparisons: readonly ReplayComparison[]): WorstDeviation | undefined {
  let worst: WorstDeviation | undefined;
  for (const comparison of comparisons) {
    const { actual, deviation, allowed } = comparison;
    if (actual === undefined || deviation === undefined || allowed === undefined) {
      continue;
    }
    const ratio = allowed === 0 ? (deviation === 0 ? 0 : Number.POSITIVE_INFINITY) : deviation / allowed;
    // Comparisons arrive in (tick, quantity) order, so the first of two equal
    // ratios wins and the choice is stable across runs (5.5).
    if (worst === undefined || ratio > worst.ratio) {
      worst = {
        tick: comparison.tick,
        quantity: comparison.quantity,
        expected: comparison.expected,
        actual,
        deviation,
        allowed,
        ratio,
      };
    }
  }
  return worst;
}

function toleranceText(tolerance: Tolerance | undefined): string {
  if (tolerance === undefined) {
    return 'no declared tolerance';
  }
  return `abs ${tolerance.abs ?? 0}, rel ${tolerance.rel ?? 0} (basis: ${tolerance.basis})`;
}

function failureDiagnostic(
  fixture: ReferenceFixture,
  behaviorModel: BehaviorModel,
  comparison: ReplayComparison,
  tolerance: Tolerance | undefined,
): ValidationDiagnostic | undefined {
  const code = comparison.failureCode;
  if (code === undefined) {
    return undefined;
  }
  const ref = modelRef(behaviorModel);
  const where = `'${comparison.quantity}' at tick ${comparison.tick}`;
  const base = { code, severity: 'error' as const, entityIds: [fixture.fixtureId], rule: '10.3' };
  switch (code) {
    case FIXTURE_DIAGNOSTIC_CODES.MissingTolerance:
      return {
        ...base,
        message:
          `Fixture '${fixture.fixtureId}' asserts ${where} = ${comparison.expected} but declares no ` +
          'tolerance for that quantity; a comparison without a declared tolerance is never a pass (5.4).',
        suggestion:
          'Declare the tolerance in tolerances.quantities with the basis that justifies it (5.4).',
      };
    case FIXTURE_DIAGNOSTIC_CODES.MissingQuantity:
      return {
        ...base,
        message:
          `Model '${ref}' produced no value for ${where}; the capture records ` +
          `${comparison.expected} (${toleranceText(tolerance)}). An unsupported quantity is never a pass (8).`,
        suggestion: 'Implement the quantity, or mark the capability Unsupported for this result (5.2).',
      };
    case FIXTURE_DIAGNOSTIC_CODES.NonNumericQuantity:
      return {
        ...base,
        message:
          `Model '${ref}' produced a non-finite, non-numeric value for ${where}; the capture records ` +
          `${comparison.expected} (${toleranceText(tolerance)}). Only finite numbers can be compared (5.1.1).`,
        suggestion: 'Return a finite number for this quantity, or report the quantity as Unsupported (5.2).',
      };
    case FIXTURE_DIAGNOSTIC_CODES.QuantityMismatch:
      return {
        ...base,
        message:
          `Model '${ref}' produced ${comparison.actual} for ${where}; fixture '${fixture.fixtureId}' recorded ` +
          `${comparison.expected} and allows ${comparison.allowed} (${toleranceText(tolerance)}). ` +
          `The deviation ${comparison.deviation} exceeds the tolerance, so this fixture cannot verify the ` +
          'model (5.2).',
        suggestion:
          'Fix the model, or re-capture the scenario and justify a tolerance that covers the observed ' +
          'run-to-run spread (5.4).',
      };
    default:
      return undefined;
  }
}

function undeclaredDiagnostic(
  fixture: ReferenceFixture,
  behaviorModel: BehaviorModel,
): ValidationDiagnostic {
  return {
    code: FIXTURE_DIAGNOSTIC_CODES.UndeclaredFixture,
    severity: 'error',
    entityIds: [fixture.fixtureId],
    message:
      `Model '${modelRef(behaviorModel)}' does not list fixture '${fixture.fixtureId}' in fixtureIds, so ` +
      'this capture is not part of the evidence the model declares (5.2.1).',
    rule: '5.2.1',
    suggestion: `Add '${fixture.fixtureId}' to the model's fixtureIds once this replay passes.`,
  };
}

function buildMismatchDiagnostic(fixture: ReferenceFixture, pinnedBuild: string): ValidationDiagnostic {
  return {
    code: FIXTURE_DIAGNOSTIC_CODES.IncompatibleBuild,
    severity: 'error',
    entityIds: [fixture.fixtureId],
    message:
      `Fixture '${fixture.fixtureId}' was captured on game build '${fixture.gameBuild}' but the ` +
      `verification is pinned to '${pinnedBuild}'; an observation from another build cannot verify a ` +
      'model for this one (2.4).',
    rule: '2.4',
    suggestion: 'Re-capture the scenario on the pinned build, or pin the verification to the captured build.',
  };
}

function modelErrorDiagnostic(
  fixture: ReferenceFixture,
  behaviorModel: BehaviorModel,
  error: unknown,
): ValidationDiagnostic {
  const detail = error instanceof Error ? error.message : String(error);
  return {
    code: FIXTURE_DIAGNOSTIC_CODES.ModelError,
    severity: 'error',
    entityIds: [fixture.fixtureId],
    message:
      `Model '${modelRef(behaviorModel)}' threw while simulating fixture '${fixture.fixtureId}': ` +
      `${detail}. Nothing was produced to compare, so the fixture cannot verify the model (5.2).`,
    rule: '10.3',
    suggestion: 'Fix the model implementation; a throwing run is never a pass.',
  };
}

function noEvidenceDiagnostic(fixture: ReferenceFixture): ValidationDiagnostic {
  return {
    code: FIXTURE_DIAGNOSTIC_CODES.NoEvidence,
    severity: 'error',
    entityIds: [fixture.fixtureId],
    message:
      `Fixture '${fixture.fixtureId}' asserts no quantities, so nothing was compared; a comparison over ` +
      'no evidence is never a pass (8).',
    rule: '10.3',
    suggestion: 'Assert at least one recorded quantity in expected.',
  };
}
