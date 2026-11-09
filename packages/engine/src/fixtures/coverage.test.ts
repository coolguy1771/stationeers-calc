import { describe, expect, it } from 'vitest';
import { ValidationDiagnosticSchema } from '@stationeers/domain';
import { collectCoveredEnvelope, reportModelFixtureCoverage } from './coverage';
import type { FixtureCoverageReport } from './coverage';
import { finalStateModel } from './replay';
import type { ReplayModel } from './replay';
import { makeBehaviorModel, makeFixture } from './testing';

const PRESSURE = 'net-a.outputs.pressureKpa';

function fixture(fixtureId: string, status: 'captured' | 'verified' = 'captured') {
  return makeFixture({ fixtureId, verificationStatus: status });
}

function pressureModel(pressureKpa: number): ReplayModel {
  return finalStateModel(() => ({ [PRESSURE]: pressureKpa }));
}

function codes(report: FixtureCoverageReport): string[] {
  return report.diagnostics.map((diagnostic) => diagnostic.code);
}

describe('reportModelFixtureCoverage — the §6.6 step 7 surface', () => {
  it('separates verified, pending, missing, and undeclared fixtures', () => {
    const report = reportModelFixtureCoverage(
      makeBehaviorModel({ fixtureIds: ['fx-a', 'fx-b', 'fx-c'] }),
      [fixture('fx-a', 'verified'), fixture('fx-b'), fixture('fx-extra')],
      pressureModel(249.4),
    );
    expect(report.declared).toEqual(['fx-a', 'fx-b', 'fx-c']);
    expect(report.verified).toEqual(['fx-a']);
    expect(report.pending).toEqual(['fx-b']);
    expect(report.missing).toEqual(['fx-c']);
    expect(report.failing).toEqual([]);
    expect(report.undeclared).toEqual(['fx-extra']);
    expect(report.ready).toBe(false);
    // Declared fixtures are reported in id order, then supply-side bookkeeping.
    expect(codes(report)).toEqual([
      'SIM-FIXTURE-PENDING',
      'SIM-FIXTURE-MISSING',
      'SIM-FIXTURE-UNDECLARED',
    ]);
    for (const diagnostic of report.diagnostics) {
      expect(ValidationDiagnosticSchema.parse(diagnostic)).toEqual(diagnostic);
    }
  });

  it('is ready when every declared fixture is verified, passing and covering the envelope', () => {
    const report = reportModelFixtureCoverage(
      makeBehaviorModel({ fixtureIds: ['fx-a'] }),
      [fixture('fx-a', 'verified')],
      pressureModel(249.4),
    );
    expect(report.ready).toBe(true);
    expect(report.uncovered).toEqual([]);
    expect(report.diagnostics).toEqual([]);
  });

  it('treats a stored-verified fixture that now fails as a regression', () => {
    const report = reportModelFixtureCoverage(
      makeBehaviorModel({ fixtureIds: ['fx-a'] }),
      [fixture('fx-a', 'verified')],
      pressureModel(300),
    );
    expect(report.failing).toEqual(['fx-a']);
    expect(report.verified).toEqual([]);
    expect(report.ready).toBe(false);
    expect(codes(report)).toContain('SIM-FIXTURE-QUANTITY-MISMATCH');
    expect(codes(report)).toContain('SIM-FIXTURE-REGRESSION');
    expect(report.diagnostics.at(-1)?.severity).toBe('error');
  });

  it('reports a stored-captured failing fixture without calling it a regression', () => {
    const report = reportModelFixtureCoverage(
      makeBehaviorModel({ fixtureIds: ['fx-a'] }),
      [fixture('fx-a')],
      pressureModel(300),
    );
    expect(report.failing).toEqual(['fx-a']);
    expect(codes(report)).toContain('SIM-FIXTURE-QUANTITY-MISMATCH');
    expect(codes(report)).not.toContain('SIM-FIXTURE-REGRESSION');
  });

  it('reports envelope ranges the verified fixtures do not cover', () => {
    const report = reportModelFixtureCoverage(
      makeBehaviorModel({
        fixtureIds: ['fx-a'],
        envelope: { inputs: { temperatureK: { min: 200, max: 400 } } },
      }),
      [fixture('fx-a', 'verified')],
      pressureModel(249.4),
    );
    expect(report.uncovered).toEqual([
      { input: 'temperatureK', declared: { min: 200, max: 400 }, covered: { min: 300, max: 300 } },
    ]);
    expect(codes(report)).toContain('SIM-ENVELOPE-UNCOVERED');
    expect(report.ready).toBe(false);
  });

  it('reports an envelope input no verified fixture declares', () => {
    const report = reportModelFixtureCoverage(
      makeBehaviorModel({
        fixtureIds: ['fx-a'],
        envelope: { inputs: { pressureKpa: { min: 1, max: 2 } } },
      }),
      [fixture('fx-a', 'verified')],
      pressureModel(249.4),
    );
    expect(report.uncovered).toEqual([{ input: 'pressureKpa', declared: { min: 1, max: 2 } }]);
    expect(codes(report)).toContain('SIM-ENVELOPE-UNCOVERED');
  });

  it('is not ready for a model that declares no fixtures at all', () => {
    const report = reportModelFixtureCoverage(
      makeBehaviorModel({ fixtureIds: [] }),
      [],
      pressureModel(249.4),
    );
    expect(report.ready).toBe(false);
    expect(codes(report)).toContain('SIM-FIXTURE-NO-EVIDENCE');
  });

  it('is deterministic', () => {
    const run = () =>
      reportModelFixtureCoverage(
        makeBehaviorModel({ fixtureIds: ['fx-a', 'fx-b'] }),
        [fixture('fx-a', 'verified'), fixture('fx-b')],
        pressureModel(249.4),
      );
    expect(run()).toEqual(run());
  });
});

describe('collectCoveredEnvelope (5.2.1)', () => {
  it('unions the verified fixtures only, keeping open ends open', () => {
    const covered = collectCoveredEnvelope([
      makeFixture({
        fixtureId: 'fx-a',
        verificationStatus: 'verified',
        envelope: { inputs: { temperatureK: { min: 280, max: 320 } } },
      }),
      makeFixture({
        fixtureId: 'fx-b',
        verificationStatus: 'verified',
        envelope: { inputs: { temperatureK: { min: 300, max: 360 }, pressureKpa: { min: 1 } } },
      }),
      // Captured, not promoted: contributes nothing yet (5.2).
      makeFixture({
        fixtureId: 'fx-c',
        envelope: { inputs: { temperatureK: { min: 0, max: 1000 } } },
      }),
    ]);
    expect(covered.inputs).toEqual({
      pressureKpa: { min: 1 },
      temperatureK: { min: 280, max: 360 },
    });
    expect(covered.notes).toContain('fx-a, fx-b');
    expect(covered.notes).not.toContain('fx-c');
  });

  it('stays open at an end one fixture leaves open', () => {
    const covered = collectCoveredEnvelope([
      makeFixture({
        fixtureId: 'fx-a',
        verificationStatus: 'verified',
        envelope: { inputs: { temperatureK: { min: 300 } } },
      }),
      makeFixture({
        fixtureId: 'fx-b',
        verificationStatus: 'verified',
        envelope: { inputs: { temperatureK: { min: 280, max: 360 } } },
      }),
    ]);
    expect(covered.inputs['temperatureK']).toEqual({ min: 280 });
  });

  it('declares no coverage when no fixture is verified', () => {
    const covered = collectCoveredEnvelope([makeFixture({ fixtureId: 'fx-a' })]);
    expect(covered.inputs).toEqual({});
    expect(covered.notes).toBe('No verified fixture contributes coverage.');
  });
});
