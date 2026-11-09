import { describe, expect, it } from 'vitest';
import { CalculationResultSchema, ValidationDiagnosticSchema } from '@stationeers/domain';
import type { BehaviorModel, ModelStatus, ValidityEnvelope } from '@stationeers/domain';
import { checkEnvelope, effectiveStatus } from './envelope';
import { assembleCalculationResult, BEHAVIOR_ENGINE_VERSION } from './result';
import { modelRef } from './registry';
import type { ModelContribution } from './status';

const contribution = (modelId: string, status: ModelStatus): ModelContribution => ({
  modelId,
  status,
});

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

function assemble(overrides: Partial<Parameters<typeof assembleCalculationResult>[0]> = {}) {
  return assembleCalculationResult({
    id: 'res-1',
    capabilityId: 'atmospherics.static-pressure',
    networkRef: 'net-1',
    contributingModels: [contribution('atmo.pressure', 'verified')],
    inputs: { temperatureK: 300 },
    computedWith: { packHash: 'sha256:abc123', scenarioDigest: 'digest-1' },
    ...overrides,
  });
}

describe('assembleCalculationResult — schema agreement (spec 3.5, 5.2.2)', () => {
  it('assembles a skeleton that satisfies the domain CalculationResult schema', () => {
    const result = assemble({ topologyStatus: 'buildable' });
    // Strict schema, no transforms: parsing must return the identical data.
    expect(CalculationResultSchema.parse(result)).toEqual(result);
  });

  it('stays schema-valid across the status vocabulary and empty contributions', () => {
    for (const status of ['verified', 'unverified', 'unsupported', 'incompatible'] as ModelStatus[]) {
      const result = assemble({ contributingModels: [contribution('m', status)] });
      expect(result.modelStatus).toBe(status);
      expect(CalculationResultSchema.parse(result)).toEqual(result);
    }
    const empty = assemble({ contributingModels: [] });
    expect(empty.modelStatus).toBe('unsupported');
    expect(CalculationResultSchema.parse(empty)).toEqual(empty);
  });

  it('fills modelStatus via weakest-wins propagation', () => {
    const result = assemble({
      contributingModels: [
        contribution('atmo.pressure', 'verified'),
        contribution('atmo.heat', 'incompatible'),
      ],
    });
    expect(result.modelStatus).toBe('incompatible');
  });

  it('fills the canonical contributing-model breakdown', () => {
    const result = assemble({
      contributingModels: [
        contribution('b.model', 'verified'),
        contribution('a.model', 'unverified'),
      ],
    });
    expect(result.contributingModels).toEqual([
      { modelId: 'a.model', status: 'unverified' },
      { modelId: 'b.model', status: 'verified' },
    ]);
  });

  it('leaves outputs and explanation empty for the caller (SIM-02)', () => {
    const result = assemble();
    expect(result.outputs).toEqual({});
    expect(result.explanation).toEqual([]);
  });

  it('echoes inputs and copies the record — later caller mutation cannot corrupt the result', () => {
    const inputs: Record<string, unknown> = { temperatureK: 300 };
    const result = assemble({ inputs });
    inputs.temperatureK = 999;
    expect(result.inputs).toEqual({ temperatureK: 300 });
  });

  it('defaults computedWith.behaviorEngineVersion to the engine version stamp', () => {
    const result = assemble();
    expect(result.computedWith).toEqual({
      packHash: 'sha256:abc123',
      behaviorEngineVersion: BEHAVIOR_ENGINE_VERSION,
      scenarioDigest: 'digest-1',
    });
  });

  it('keeps an explicit behaviorEngineVersion override', () => {
    const result = assemble({
      computedWith: {
        packHash: 'sha256:abc123',
        scenarioDigest: 'digest-1',
        behaviorEngineVersion: '9.9.9-test',
      },
    });
    expect(result.computedWith.behaviorEngineVersion).toBe('9.9.9-test');
  });

  it('defaults topologyStatus to the conservative conceptual — no fake exactness without DOM-02', () => {
    expect(assemble().topologyStatus).toBe('conceptual');
    expect(assemble({ topologyStatus: 'buildable' }).topologyStatus).toBe('buildable');
  });
});

describe('envelope → status → result (SIM-00 integration path)', () => {
  it('an out-of-envelope Verified model contributes Unverified to a schema-valid result', () => {
    const model = makeModel({ inputs: { temperatureK: { min: 3, max: 1500 } } });
    const check = checkEnvelope(model, { temperatureK: 2000 });
    if (check.ok) {
      throw new Error('expected envelope failure');
    }
    const status = effectiveStatus(model.status, check);
    expect(status).toBe('unverified');

    const result = assembleCalculationResult({
      id: 'res-1',
      capabilityId: 'atmospherics.static-pressure',
      networkRef: 'net-1',
      contributingModels: [contribution(modelRef(model), status)],
      inputs: { temperatureK: 2000 },
      computedWith: { packHash: 'sha256:abc123', scenarioDigest: 'digest-1' },
    });
    expect(result.modelStatus).toBe('unverified');
    expect(CalculationResultSchema.parse(result)).toEqual(result);
    expect(ValidationDiagnosticSchema.parse(check.diagnostics[0])).toEqual(check.diagnostics[0]);
  });
});
