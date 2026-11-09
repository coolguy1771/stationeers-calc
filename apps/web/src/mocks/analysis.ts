import type { CalculationResult } from '@stationeers/domain';

/**
 * MOCK calculation result proving the dual-status display (spec 3.5):
 * Verified mechanics (fixture-backed behavior models) on a Conceptual
 * topology (the network volume is an explicit scenario assumption because
 * the intent is unrouted — spec 4.7). The UI must render this as "correct
 * mechanics, assumed topology", never as exact.
 */
export const mockCalculationResult: CalculationResult = {
  id: 'mock.result.1',
  capabilityId: 'gas.static-pressure',
  networkRef: 'mock.intent.1',
  modelStatus: 'verified',
  topologyStatus: 'conceptual',
  contributingModels: [
    { modelId: 'mock.model.ideal-gas-pressure', status: 'verified' },
    { modelId: 'mock.model.network-volume', status: 'verified' },
  ],
  inputs: {
    totalMoles: 12.4,
    temperatureK: 293.15,
    assumedVolumeM3: 2.0,
    species: [
      { speciesId: 'mock.oxygen', phase: 'gas', moles: 4.0 },
      { speciesId: 'mock.nitrogen', phase: 'gas', moles: 8.4 },
    ],
  },
  outputs: {
    pressureKpa: 15.11,
    partialPressuresKpa: { 'mock.oxygen': 4.87, 'mock.nitrogen': 10.24 },
  },
  explanation: [
    'Inputs: 12.4 mol total (O₂ 4.0, N₂ 8.4) at 293.15 K — canonical thermal state per spec 4.5.',
    'Network volume is an explicit scenario assumption of 2.0 m³ because the intent is unrouted (spec 4.7).',
    'Behavior model: ideal-gas static pressure, version 1.2, within its validity envelope.',
    'Topology status is Conceptual: the volume is assumed, not resolved from physical routing (spec 3.5).',
  ],
  computedWith: {
    packHash: '9f2a11c4d0e8a1b2c3d4e5f60718293a4b5c6d7e',
    behaviorEngineVersion: 'engine 0.1.0 (mock)',
    scenarioDigest: 'fnv1a:7c3e91ab',
  },
};
