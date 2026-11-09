import { describe, expect, it } from 'vitest';
import { ValidationDiagnosticSchema } from '@stationeers/domain';
import type { BehaviorModel, ModelStatus, ValidityEnvelope } from '@stationeers/domain';
import { ENVELOPE_DIAGNOSTIC_CODES, checkEnvelope, effectiveStatus } from './envelope';
import { modelRef } from './registry';

function makeModel(envelope: ValidityEnvelope, overrides: Partial<BehaviorModel> = {}): BehaviorModel {
  return {
    id: 'atmo.pressure',
    version: '2',
    domain: 'atmospherics',
    consumes: { properties: [], constants: [] },
    envelope,
    status: 'verified',
    fixtureIds: ['fx-1'],
    ...overrides,
  };
}

/** Runs the check and asserts it failed, narrowing the type for the caller. */
function expectFailure(model: BehaviorModel, inputs: Record<string, unknown>) {
  const check = checkEnvelope(model, inputs);
  if (!check.ok) {
    return check;
  }
  throw new Error(`expected envelope failure, got pass (inputs: ${JSON.stringify(inputs)})`);
}

describe('checkEnvelope — inside the envelope (spec 5.2.1)', () => {
  it('passes when every declared input is within its range', () => {
    const model = makeModel({ inputs: { temperatureK: { min: 3, max: 1500 } } });
    expect(checkEnvelope(model, { temperatureK: 300 })).toEqual({ ok: true });
  });

  it('treats declared bounds as inclusive — a fixture captured exactly at a bound is covered', () => {
    const model = makeModel({ inputs: { temperatureK: { min: 3, max: 1500 } } });
    expect(checkEnvelope(model, { temperatureK: 3 })).toEqual({ ok: true });
    expect(checkEnvelope(model, { temperatureK: 1500 })).toEqual({ ok: true });
  });

  it('leaves open ends unconstrained', () => {
    const minOnly = makeModel({ inputs: { temperatureK: { min: 3 } } });
    expect(checkEnvelope(minOnly, { temperatureK: 1e9 })).toEqual({ ok: true });
    expect(checkEnvelope(minOnly, { temperatureK: 2.9 }).ok).toBe(false);

    const maxOnly = makeModel({ inputs: { temperatureK: { max: 1500 } } });
    expect(checkEnvelope(maxOnly, { temperatureK: -1e9 })).toEqual({ ok: true });
    expect(checkEnvelope(maxOnly, { temperatureK: 1500.5 }).ok).toBe(false);
  });

  it('treats a declared input with neither bound as unconstrained', () => {
    const model = makeModel({ inputs: { pressureKpa: {} } });
    expect(checkEnvelope(model, { pressureKpa: 42 })).toEqual({ ok: true });
  });

  it('passes when the envelope declares nothing and ignores undeclared inputs', () => {
    const emptyEnvelope = makeModel({ inputs: {} });
    expect(checkEnvelope(emptyEnvelope, {})).toEqual({ ok: true });
    expect(checkEnvelope(emptyEnvelope, { anythingAtAll: 1 })).toEqual({ ok: true });

    const model = makeModel({ inputs: { temperatureK: { min: 3, max: 1500 } } });
    expect(checkEnvelope(model, { temperatureK: 300, pressureKpa: 1e12 })).toEqual({ ok: true });
  });
});

describe('checkEnvelope — out of envelope', () => {
  const model = makeModel({
    inputs: { temperatureK: { min: 3, max: 1500 } },
    notes: 'fixtures 1–12',
  });

  it('fails above max, naming the exact input, value, and declared bounds', () => {
    const check = expectFailure(model, { temperatureK: 2000 });
    expect(check.failures).toEqual([
      {
        code: 'SIM-OUT-OF-ENVELOPE',
        input: 'temperatureK',
        value: 2000,
        min: 3,
        max: 1500,
      },
    ]);
    expect(check.diagnostics[0]?.message).toContain('temperatureK');
    expect(check.diagnostics[0]?.message).toContain(modelRef(model));
  });

  it('fails below min with the declared bounds reported', () => {
    const check = expectFailure(model, { temperatureK: 2.9 });
    expect(check.failures[0]).toEqual({
      code: 'SIM-OUT-OF-ENVELOPE',
      input: 'temperatureK',
      value: 2.9,
      min: 3,
      max: 1500,
    });
  });

  it('reports multiple offending inputs in canonical (name-sorted) order', () => {
    const two = makeModel({
      inputs: { bK: { min: 0, max: 10 }, aK: { min: 0, max: 10 } },
    });
    const check = expectFailure(two, { aK: 11, bK: -1 });
    expect(check.failures.map((failure) => failure.input)).toEqual(['aK', 'bK']);
    expect(check.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'SIM-OUT-OF-ENVELOPE',
      'SIM-OUT-OF-ENVELOPE',
    ]);
  });
});

describe('checkEnvelope — missing and non-numeric declared inputs', () => {
  const model = makeModel({ inputs: { temperatureK: { min: 3, max: 1500 } } });

  it('fails explicitly when a declared input is not provided', () => {
    const check = expectFailure(model, {});
    expect(check.failures).toEqual([{ code: 'SIM-MISSING-ENVELOPE-INPUT', input: 'temperatureK' }]);
    expect(check.diagnostics[0]?.message).toContain('temperatureK');
  });

  it('treats an undefined value as missing', () => {
    const check = expectFailure(model, { temperatureK: undefined });
    expect(check.failures[0]?.code).toBe('SIM-MISSING-ENVELOPE-INPUT');
  });

  it('fails explicitly on non-numeric declared inputs', () => {
    for (const value of ['300', NaN, Infinity, -Infinity, null, true, { kelvin: 300 }]) {
      const check = expectFailure(model, { temperatureK: value });
      expect(check.failures[0]?.code).toBe('SIM-NON-NUMERIC-INPUT');
      expect(check.failures[0]?.input).toBe('temperatureK');
    }
  });
});

describe('checkEnvelope — diagnostics (spec 8)', () => {
  const model = makeModel({ inputs: { aK: { min: 0, max: 10 }, bK: { min: 0, max: 10 } } });

  it('emits one schema-valid diagnostic per offending input, aligned with the failures', () => {
    const check = expectFailure(model, { aK: 11, bK: undefined });
    expect(check.diagnostics).toHaveLength(check.failures.length);
    for (const [i, diagnostic] of check.diagnostics.entries()) {
      const failure = check.failures[i];
      expect(failure).toBeDefined();
      // Proves the two layers agree: the produced diagnostic is a valid spec-8
      // ValidationDiagnostic under the domain schema.
      expect(ValidationDiagnosticSchema.parse(diagnostic)).toEqual(diagnostic);
      expect(diagnostic.code).toBe(failure?.code);
      expect(diagnostic.entityIds).toEqual([model.id]);
      expect(diagnostic.rule).toBe('5.2.1');
      expect(diagnostic.message).toContain(`'${failure?.input}'`);
      expect(diagnostic.suggestion).toBeDefined();
    }
  });

  it('maps severities: out-of-envelope warns (runs, downgraded); missing/non-numeric are errors', () => {
    const check = expectFailure(model, { aK: 11, bK: undefined });
    expect(check.diagnostics.map((diagnostic) => diagnostic.severity)).toEqual(['warning', 'error']);

    const nonNumeric = expectFailure(model, { aK: 'hot' });
    expect(nonNumeric.diagnostics[0]?.severity).toBe('error');
  });
});

describe('effectiveStatus — envelope downgrade (spec 5.2.1)', () => {
  const model = makeModel({ inputs: { temperatureK: { min: 3, max: 1500 } } });
  const passing = checkEnvelope(model, { temperatureK: 300 });
  const failing = expectFailure(model, { temperatureK: 2000 });

  it('keeps Verified inside the envelope', () => {
    expect(effectiveStatus('verified', passing)).toBe('verified');
  });

  it('downgrades Verified to Unverified outside the envelope', () => {
    expect(effectiveStatus('verified', failing)).toBe('unverified');
  });

  it('leaves non-Verified base statuses unchanged outside the envelope', () => {
    for (const base of ['unverified', 'unsupported', 'incompatible'] as ModelStatus[]) {
      expect(effectiveStatus(base, failing)).toBe(base);
    }
  });

  it('exposes the stable diagnostic code vocabulary', () => {
    expect(ENVELOPE_DIAGNOSTIC_CODES).toEqual({
      OutOfEnvelope: 'SIM-OUT-OF-ENVELOPE',
      MissingInput: 'SIM-MISSING-ENVELOPE-INPUT',
      NonNumericInput: 'SIM-NON-NUMERIC-INPUT',
    });
  });
});
