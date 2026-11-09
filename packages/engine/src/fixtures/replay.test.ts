import { describe, expect, it } from 'vitest';
import { ValidationDiagnosticSchema } from '@stationeers/domain';
import { finalStateModel, perTickModel, promoteFixture, replayFixture } from './replay';
import type { FixtureReplayVerdict, ReplayModel } from './replay';
import { makeBehaviorModel, makeFixture, makeObservation, makeSample } from './testing';

const PRESSURE = 'net-a.outputs.pressureKpa';
const TEMPERATURE = 'net-a.thermal.temperature';

/** A one-sample fixture recording `pressureKpa` with the given tolerance. */
function fixtureAt(
  pressureKpa: number,
  tolerance: { abs?: number; rel?: number } = { abs: 1 },
): ReturnType<typeof makeFixture> {
  return makeFixture({
    ticks: [makeSample(0, 0, pressureKpa)],
    expected: [{ tick: 0, quantities: { [PRESSURE]: pressureKpa } }],
    tolerances: {
      quantities: { [PRESSURE]: { ...tolerance, basis: 'observed run-to-run spread' } },
    },
  });
}

/** A model that answers the end of the observation window with fixed quantities. */
function modelAt(values: Readonly<Record<string, number | undefined>>): ReplayModel {
  return finalStateModel(() => values);
}

function codes(verdict: FixtureReplayVerdict): string[] {
  return verdict.diagnostics.map((diagnostic) => diagnostic.code);
}

describe('replayFixture — matching within tolerance (10.3)', () => {
  it('passes when the model reproduces the recorded output', () => {
    const verdict = replayFixture(fixtureAt(249.4), makeBehaviorModel(), modelAt({ [PRESSURE]: 249.4 }));
    expect(verdict.outcome).toBe('pass');
    expect(verdict.statusClaim).toBe('verified');
    expect(verdict.comparisons).toEqual([
      {
        tick: 0,
        quantity: PRESSURE,
        expected: 249.4,
        actual: 249.4,
        deviation: 0,
        allowed: 1,
        status: 'pass',
      },
    ]);
    expect(verdict.diagnostics).toEqual([]);
  });

  it('passes exactly at the tolerance boundary and fails just beyond it', () => {
    const fixture = fixtureAt(250, { abs: 1 });
    const atBoundary = replayFixture(fixture, makeBehaviorModel(), modelAt({ [PRESSURE]: 251 }));
    expect(atBoundary.outcome).toBe('pass');
    expect(atBoundary.worst?.ratio).toBe(1);

    const beyond = replayFixture(fixture, makeBehaviorModel(), modelAt({ [PRESSURE]: 251.5 }));
    expect(beyond.outcome).toBe('fail');
    expect(beyond.comparisons[0]?.failureCode).toBe('SIM-FIXTURE-QUANTITY-MISMATCH');
  });

  it('applies a relative tolerance against |expected|', () => {
    const fixture = fixtureAt(1000, { abs: 0, rel: 0.01 });
    expect(replayFixture(fixture, makeBehaviorModel(), modelAt({ [PRESSURE]: 1010 })).outcome).toBe(
      'pass',
    );
    expect(replayFixture(fixture, makeBehaviorModel(), modelAt({ [PRESSURE]: 1020 })).outcome).toBe(
      'fail',
    );
  });

  it('adds absolute and relative slack', () => {
    const fixture = fixtureAt(1000, { abs: 5, rel: 0.01 });
    expect(replayFixture(fixture, makeBehaviorModel(), modelAt({ [PRESSURE]: 1014 })).outcome).toBe(
      'pass',
    );
    expect(replayFixture(fixture, makeBehaviorModel(), modelAt({ [PRESSURE]: 1017 })).outcome).toBe(
      'fail',
    );
  });

  it('fails with a diagnostic naming the quantity, tick, values and tolerance', () => {
    const verdict = replayFixture(fixtureAt(250), makeBehaviorModel(), modelAt({ [PRESSURE]: 260 }));
    expect(verdict.outcome).toBe('fail');
    expect(verdict.statusClaim).toBe('unverified');
    expect(codes(verdict)).toContain('SIM-FIXTURE-QUANTITY-MISMATCH');
    const message = verdict.diagnostics[0]?.message ?? '';
    expect(message).toContain(PRESSURE);
    expect(message).toContain('tick 0');
    expect(message).toContain('260');
    expect(message).toContain('250');
    expect(message).toContain('observed run-to-run spread');
  });

  it('compares every asserted tick of a stepped run', () => {
    const fixture = makeFixture({
      observation: makeObservation({ tickCount: 2, tickLengthS: 1 }),
      ticks: [makeSample(0, 0, 250), makeSample(2, 2, 260)],
      expected: [
        { tick: 0, quantities: { [PRESSURE]: 250 } },
        { tick: 2, quantities: { [PRESSURE]: 260 } },
      ],
      tolerances: { quantities: { [PRESSURE]: { abs: 0.01, basis: 'deterministic series' } } },
    });
    const stepped = replayFixture(
      fixture,
      makeBehaviorModel(),
      perTickModel(() => [
        { tick: 0, quantities: { [PRESSURE]: 250 } },
        { tick: 2, quantities: { [PRESSURE]: 260 } },
      ]),
    );
    expect(stepped.outcome).toBe('pass');
    expect(stepped.comparisons.map((comparison) => comparison.tick)).toEqual([0, 2]);

    // A final-state model answers only the end of the window; the earlier
    // assertion is missing, which fails rather than being skipped (8).
    const finalOnly = replayFixture(fixture, makeBehaviorModel(), modelAt({ [PRESSURE]: 260 }));
    expect(finalOnly.outcome).toBe('fail');
    expect(finalOnly.comparisons[0]?.failureCode).toBe('SIM-FIXTURE-MISSING-QUANTITY');
    expect(finalOnly.comparisons[1]?.status).toBe('pass');
  });
});

describe('replayFixture — unsupported is never a pass (8)', () => {
  it('fails when the model produces no value for an asserted quantity', () => {
    const verdict = replayFixture(fixtureAt(250), makeBehaviorModel(), modelAt({}));
    expect(verdict.outcome).toBe('fail');
    expect(verdict.statusClaim).toBe('unverified');
    expect(verdict.comparisons[0]).toMatchObject({
      quantity: PRESSURE,
      actual: undefined,
      status: 'fail',
      failureCode: 'SIM-FIXTURE-MISSING-QUANTITY',
    });
    expect(verdict.worst).toBeUndefined();
    expect(verdict.diagnostics[0]?.message).toContain('is never a pass');
  });

  it('fails on a non-finite or non-numeric model value', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, 'hot' as unknown as number, null as unknown as number]) {
      const verdict = replayFixture(fixtureAt(250), makeBehaviorModel(), modelAt({ [PRESSURE]: value }));
      expect(verdict.outcome).toBe('fail');
      expect(verdict.comparisons[0]?.failureCode).toBe('SIM-FIXTURE-NON-NUMERIC-QUANTITY');
    }
  });

  it('fails when a hand-built fixture declares no tolerance', () => {
    const fixture = makeFixture({
      ticks: [makeSample(0, 0, 250)],
      expected: [{ tick: 0, quantities: { [PRESSURE]: 250 } }],
      tolerances: { quantities: {} },
    });
    const verdict = replayFixture(fixture, makeBehaviorModel(), modelAt({ [PRESSURE]: 250 }));
    expect(verdict.outcome).toBe('fail');
    expect(verdict.comparisons[0]?.failureCode).toBe('SIM-FIXTURE-MISSING-TOLERANCE');
    expect(verdict.statusClaim).toBe('unverified');
  });

  it('fails, rather than crashing, when the model throws', () => {
    const verdict = replayFixture(
      fixtureAt(250),
      makeBehaviorModel(),
      finalStateModel(() => {
        throw new Error('solver diverged');
      }),
    );
    expect(verdict.outcome).toBe('fail');
    expect(verdict.statusClaim).toBe('unverified');
    expect(verdict.comparisons).toEqual([]);
    expect(codes(verdict)).toEqual(['SIM-FIXTURE-MODEL-ERROR']);
    expect(verdict.diagnostics[0]?.message).toContain('solver diverged');
  });

  it('fails when a hand-built fixture asserts nothing', () => {
    const fixture = makeFixture({
      ticks: [makeSample(0, 0, 250)],
      expected: [],
      tolerances: { quantities: {} },
    });
    const verdict = replayFixture(fixture, makeBehaviorModel(), modelAt({ [PRESSURE]: 250 }));
    expect(verdict.outcome).toBe('fail');
    expect(codes(verdict)).toContain('SIM-FIXTURE-NO-EVIDENCE');
  });

  it('emits schema-valid §8 diagnostics', () => {
    const verdict = replayFixture(fixtureAt(250), makeBehaviorModel(), modelAt({ [PRESSURE]: 260 }));
    expect(verdict.diagnostics.length).toBeGreaterThan(0);
    for (const diagnostic of verdict.diagnostics) {
      expect(ValidationDiagnosticSchema.parse(diagnostic)).toEqual(diagnostic);
      expect(diagnostic.entityIds).toEqual(['fx-test-1']);
    }
  });
});

describe('replayFixture — the §5.2 rule (5.2, 5.2.1, 2.4)', () => {
  it('cannot claim verified when the scenario is outside the model envelope', () => {
    const fixture = fixtureAt(249.4);
    fixture.scenario.conditions = { temperatureK: 900, networkVolumeM3: 1 };
    const verdict = replayFixture(fixture, makeBehaviorModel(), modelAt({ [PRESSURE]: 249.4 }));
    expect(verdict.outcome).toBe('pass');
    expect(verdict.envelope.ok).toBe(false);
    expect(verdict.statusClaim).toBe('unverified');
    expect(codes(verdict)).toContain('SIM-OUT-OF-ENVELOPE');
  });

  it('cannot claim verified for a fixture the model does not declare', () => {
    const verdict = replayFixture(
      fixtureAt(249.4),
      makeBehaviorModel({ fixtureIds: ['someone-else'] }),
      modelAt({ [PRESSURE]: 249.4 }),
    );
    expect(verdict.outcome).toBe('pass');
    expect(verdict.statusClaim).toBe('unverified');
    expect(codes(verdict)).toContain('SIM-FIXTURE-UNDECLARED');
  });

  it('cannot claim verified for a capture from another game build', () => {
    const verdict = replayFixture(
      fixtureAt(249.4),
      makeBehaviorModel(),
      modelAt({ [PRESSURE]: 249.4 }),
      { gameBuild: 'v0.9.9.9999' },
    );
    expect(verdict.outcome).toBe('pass');
    expect(verdict.statusClaim).toBe('unverified');
    expect(codes(verdict)).toContain('SIM-INCOMPATIBLE-BUILD');
    expect(verdict.diagnostics.at(-1)?.rule).toBe('2.4');
  });

  it('claims verified when the pinned build matches the capture', () => {
    const verdict = replayFixture(
      fixtureAt(249.4),
      makeBehaviorModel(),
      modelAt({ [PRESSURE]: 249.4 }),
      { gameBuild: 'v0.0.0.1000' },
    );
    expect(verdict.statusClaim).toBe('verified');
  });

  it('reports the worst deviation as deviation/allowed', () => {
    const fixture = makeFixture({
      ticks: [makeSample(0, 0, 250)],
      expected: [{ tick: 0, quantities: { [PRESSURE]: 250, [TEMPERATURE]: 300 } }],
      tolerances: {
        quantities: {
          [PRESSURE]: { abs: 10, basis: 'sensor spread' },
          [TEMPERATURE]: { abs: 1, basis: 'thermal spread' },
        },
      },
    });
    const verdict = replayFixture(
      fixture,
      makeBehaviorModel(),
      modelAt({ [PRESSURE]: 255, [TEMPERATURE]: 300.05 }),
    );
    expect(verdict.outcome).toBe('pass');
    expect(verdict.worst).toMatchObject({ quantity: PRESSURE, deviation: 5, allowed: 10, ratio: 0.5 });
  });

  it('is deterministic: the same fixture and model give an identical verdict', () => {
    const fixture = fixtureAt(250);
    const model = makeBehaviorModel();
    const first = replayFixture(fixture, model, modelAt({ [PRESSURE]: 260 }));
    const second = replayFixture(fixture, model, modelAt({ [PRESSURE]: 260 }));
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});

describe('promoteFixture — the only path to Verified (5.2)', () => {
  it('promotes a fixture whose replay claim is verified, without mutating the input', () => {
    const fixture = fixtureAt(249.4);
    const verdict = replayFixture(fixture, makeBehaviorModel(), modelAt({ [PRESSURE]: 249.4 }));
    const promotion = promoteFixture(fixture, verdict);
    expect(promotion.fixture?.verificationStatus).toBe('verified');
    expect(promotion.reason).toBeUndefined();
    expect(fixture.verificationStatus).toBe('captured');
  });

  it('refuses a failing verdict and explains why', () => {
    const fixture = fixtureAt(250);
    const verdict = replayFixture(fixture, makeBehaviorModel(), modelAt({ [PRESSURE]: 260 }));
    const promotion = promoteFixture(fixture, verdict);
    expect(promotion.fixture).toBeUndefined();
    expect(promotion.reason).toContain('SIM-FIXTURE-QUANTITY-MISMATCH');
  });

  it('refuses an out-of-envelope pass', () => {
    const fixture = fixtureAt(249.4);
    fixture.scenario.conditions = { temperatureK: 900, networkVolumeM3: 1 };
    const verdict = replayFixture(fixture, makeBehaviorModel(), modelAt({ [PRESSURE]: 249.4 }));
    expect(promoteFixture(fixture, verdict).reason).toContain('out of envelope');
  });

  it('refuses a verdict produced for a different fixture', () => {
    const fixture = fixtureAt(249.4);
    const verdict = replayFixture(fixture, makeBehaviorModel(), modelAt({ [PRESSURE]: 249.4 }));
    const other = makeFixture({ fixtureId: 'fx-test-2' });
    expect(promoteFixture(other, verdict).reason).toContain("not 'fx-test-2'");
  });
});
