import { describe, expect, it } from 'vitest';
import {
  inventoryQuantityEntries,
  networkQuantityEntries,
  tickQuantityEntries,
  tickQuantities,
} from './quantities';

describe('quantity keys (10.3)', () => {
  it('names moles by species and phase, and the thermal variable by kind', () => {
    const entries = networkQuantityEntries('net-a', {
      moles: [
        { speciesId: 'Water', phase: 'gas', moles: 1 },
        { speciesId: 'Water', phase: 'liquid', moles: 2 },
      ],
      thermal: { kind: 'internal-energy', value: 5, unit: 'J' },
      outputs: { pressureKpa: 101.3 },
    });
    expect(entries).toEqual([
      { key: 'net-a.moles.Water.gas', value: 1 },
      { key: 'net-a.moles.Water.liquid', value: 2 },
      { key: 'net-a.outputs.pressureKpa', value: 101.3 },
      { key: 'net-a.thermal.internal-energy', value: 5 },
    ]);
  });

  it('keeps phases apart: 1 mol of steam is not 1 mol of water', () => {
    const keys = networkQuantityEntries('net-a', {
      moles: [
        { speciesId: 'Water', phase: 'gas', moles: 1 },
        { speciesId: 'Water', phase: 'liquid', moles: 1 },
      ],
      thermal: { kind: 'temperature', value: 300, unit: 'K' },
    }).map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives an inventory no output quantities', () => {
    expect(
      inventoryQuantityEntries('net-a', {
        species: [{ speciesId: 'Oxygen', phase: 'gas', moles: 100 }],
        thermal: { kind: 'temperature', value: 300, unit: 'K' },
      }),
    ).toEqual([
      { key: 'net-a.moles.Oxygen.gas', value: 100 },
      { key: 'net-a.thermal.temperature', value: 300 },
    ]);
  });

  it('orders a sample by key regardless of the order it was written in', () => {
    const forward = tickQuantityEntries({
      networks: {
        'net-a': {
          moles: [
            { speciesId: 'Oxygen', phase: 'gas', moles: 1 },
            { speciesId: 'Nitrogen', phase: 'gas', moles: 2 },
          ],
          thermal: { kind: 'temperature', value: 300, unit: 'K' },
        },
        'net-b': {
          moles: [],
          thermal: { kind: 'temperature', value: 300, unit: 'K' },
        },
      },
    });
    const backward = tickQuantityEntries({
      networks: {
        'net-b': { moles: [], thermal: { kind: 'temperature', value: 300, unit: 'K' } },
        'net-a': {
          moles: [
            { speciesId: 'Nitrogen', phase: 'gas', moles: 2 },
            { speciesId: 'Oxygen', phase: 'gas', moles: 1 },
          ],
          thermal: { kind: 'temperature', value: 300, unit: 'K' },
        },
      },
    });
    expect(backward).toEqual(forward);
    expect(forward.map((entry) => entry.key)).toEqual([
      'net-a.moles.Nitrogen.gas',
      'net-a.moles.Oxygen.gas',
      'net-a.thermal.temperature',
      'net-b.thermal.temperature',
    ]);
  });

  it('flattens a sample into a key-sorted lookup', () => {
    const quantities = tickQuantities({
      networks: {
        'net-a': {
          moles: [{ speciesId: 'Oxygen', phase: 'gas', moles: 100 }],
          thermal: { kind: 'temperature', value: 300, unit: 'K' },
          outputs: { pressureKpa: 249.4 },
        },
      },
    });
    expect(quantities).toEqual({
      'net-a.moles.Oxygen.gas': 100,
      'net-a.outputs.pressureKpa': 249.4,
      'net-a.thermal.temperature': 300,
    });
    expect(Object.keys(quantities)).toEqual(Object.keys(quantities).sort());
  });
});
