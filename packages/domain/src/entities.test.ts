import { describe, expect, it } from 'vitest';
import type { DeviceInstance } from './entities';

describe('domain entity contract', () => {
  it('accepts a minimal unplaced device instance', () => {
    const device: DeviceInstance = {
      id: 'dev-1',
      definitionId: 'gas-filter',
      ports: [],
      settings: {},
    };
    expect(device.placementId).toBeUndefined();
  });
});
