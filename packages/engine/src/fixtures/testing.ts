/**
 * Test-support builders for the fixture suite. Not part of the engine's runtime
 * surface (deliberately absent from `index.ts`): these builders exist so each
 * test states only the field it is about, while everything else stays a valid
 * document.
 */
import type { BehaviorModel } from '@stationeers/domain';
import type { ObservationProtocol, ReferenceFixture, TickSample } from './schema';

const BASE_FIXTURE: ReferenceFixture = {
  fixtureVersion: '1',
  fixtureId: 'fx-test-1',
  gameBuild: 'v0.0.0.1000',
  branch: 'public',
  capturedAt: '2025-11-09T12:00:00.000Z',
  capturedBy: { operator: 'test operator', method: 'manual-read' },
  scenario: {
    inventories: {
      'net-a': {
        species: [{ speciesId: 'Oxygen', phase: 'gas', moles: 100 }],
        thermal: { kind: 'temperature', value: 300, unit: 'K' },
      },
    },
    networks: [{ ref: 'net-a', medium: 'gas-pipe', volumeM3: 1, devices: [] }],
    devices: [],
    conditions: { temperatureK: 300, networkVolumeM3: 1 },
  },
  observation: {
    tickLengthS: 0.5,
    tickLengthSource: 'measured',
    tickCount: 0,
    sampleIntervalS: 1,
    sampling: 'one steady-state read per run',
    runs: 1,
  },
  ticks: [
    {
      tick: 0,
      timeS: 0,
      networks: {
        'net-a': {
          moles: [{ speciesId: 'Oxygen', phase: 'gas', moles: 100 }],
          thermal: { kind: 'temperature', value: 300, unit: 'K' },
          outputs: { pressureKpa: 249.4 },
        },
      },
    },
  ],
  expected: [{ tick: 0, quantities: { 'net-a.outputs.pressureKpa': 249.4 } }],
  tolerances: {
    quantities: {
      'net-a.outputs.pressureKpa': { abs: 1, basis: 'readout resolves 0.1 kPa; one run' },
    },
  },
  envelope: {
    inputs: { temperatureK: { min: 300, max: 300 }, networkVolumeM3: { min: 1, max: 1 } },
  },
  sourceReference: { procedure: 'test procedure' },
  verificationStatus: 'captured',
};

/** A schema-valid fixture with the given fields replaced (deep-copied, so tests do not share state). */
export function makeFixture(overrides: Partial<ReferenceFixture> = {}): ReferenceFixture {
  return { ...structuredClone(BASE_FIXTURE), ...overrides };
}

/**
 * A model whose envelope is exactly what `makeFixture` covers and which declares
 * `fx-test-1` — i.e. a model that may legitimately claim Verified on that
 * fixture (5.2.1). Tests that need a wider claim or an outside condition
 * override the envelope.
 */
export function makeBehaviorModel(overrides: Partial<BehaviorModel> = {}): BehaviorModel {
  return {
    id: 'atmo.pressure',
    version: '1',
    domain: 'atmospherics',
    consumes: { properties: ['network.volume'], constants: [] },
    envelope: { inputs: { temperatureK: { min: 300, max: 300 } } },
    status: 'unverified',
    fixtureIds: ['fx-test-1'],
    ...overrides,
  };
}

/** A sample at `tick`, carrying one network whose thermal value is the tick index. */
export function makeSample(tick: number, timeS: number, pressureKpa: number): TickSample {
  return {
    tick,
    timeS,
    networks: {
      'net-a': {
        moles: [{ speciesId: 'Oxygen', phase: 'gas', moles: 100 }],
        thermal: { kind: 'temperature', value: 300 + tick, unit: 'K' },
        outputs: { pressureKpa },
      },
    },
  };
}

/** An observation protocol matching `makeSample` series: one tick per second. */
export function makeObservation(overrides: Partial<ObservationProtocol> = {}): ObservationProtocol {
  return {
    tickLengthS: 1,
    tickLengthSource: 'measured',
    tickCount: 0,
    sampleIntervalS: 1,
    sampling: 'test series',
    runs: 1,
    ...overrides,
  };
}
