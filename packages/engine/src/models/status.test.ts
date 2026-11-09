import { describe, expect, it } from 'vitest';
import type { ModelStatus } from '@stationeers/domain';
import { MODEL_STATUS_RANK, propagateStatus } from './status';
import type { ModelContribution } from './status';

const contribution = (modelId: string, status: ModelStatus): ModelContribution => ({
  modelId,
  status,
});

const STATUSES: ModelStatus[] = ['verified', 'unverified', 'unsupported', 'incompatible'];

/** All orderings of a small array. */
function permutations<T>(values: readonly T[]): T[][] {
  let out: T[][] = [[]];
  for (const head of values) {
    const next: T[][] = [];
    for (const prefix of out) {
      for (let i = 0; i <= prefix.length; i++) {
        next.push([...prefix.slice(0, i), head, ...prefix.slice(i)]);
      }
    }
    out = next;
  }
  return out;
}

// 16 ordered pairs with hardcoded expectations — deliberately not derived
// from MODEL_STATUS_RANK so the test cannot inherit a wrong ordering table.
const PAIRS: [ModelStatus, ModelStatus, ModelStatus][] = [
  ['verified', 'verified', 'verified'],
  ['verified', 'unverified', 'unverified'],
  ['verified', 'unsupported', 'unsupported'],
  ['verified', 'incompatible', 'incompatible'],
  ['unverified', 'verified', 'unverified'],
  ['unverified', 'unverified', 'unverified'],
  ['unverified', 'unsupported', 'unsupported'],
  ['unverified', 'incompatible', 'incompatible'],
  ['unsupported', 'verified', 'unsupported'],
  ['unsupported', 'unverified', 'unsupported'],
  ['unsupported', 'unsupported', 'unsupported'],
  ['unsupported', 'incompatible', 'incompatible'],
  ['incompatible', 'verified', 'incompatible'],
  ['incompatible', 'unverified', 'incompatible'],
  ['incompatible', 'unsupported', 'incompatible'],
  ['incompatible', 'incompatible', 'incompatible'],
];

describe('propagateStatus — weakest wins (spec 5.2.2)', () => {
  it.each(PAIRS)('%s + %s → %s', (a, b, expected) => {
    expect(propagateStatus([contribution('m1', a), contribution('m2', b)]).modelStatus).toBe(
      expected,
    );
  });

  it('aggregates the weakest status regardless of order (all 24 permutations of the four statuses)', () => {
    const orderings = permutations(STATUSES);
    expect(orderings).toHaveLength(24);
    for (const ordering of orderings) {
      const contributions = ordering.map((status, i) => contribution(`m${i}`, status));
      expect(propagateStatus(contributions).modelStatus).toBe('incompatible');
    }
  });

  it('uniform contributions keep that status', () => {
    for (const status of STATUSES) {
      expect(
        propagateStatus([contribution('a', status), contribution('b', status)]).modelStatus,
      ).toBe(status);
    }
  });

  it('empty contributions aggregate to unsupported — no contributing model is no usable implementation (spec 8)', () => {
    expect(propagateStatus([])).toEqual({ modelStatus: 'unsupported', contributions: [] });
  });

  it('returns a canonical per-model breakdown sorted by model id, then status', () => {
    const result = propagateStatus([
      contribution('b', 'verified'),
      contribution('a', 'verified'),
      contribution('a', 'unverified'),
    ]);
    expect(result.modelStatus).toBe('unverified');
    expect(result.contributions).toEqual([
      { modelId: 'a', status: 'unverified' },
      { modelId: 'a', status: 'verified' },
      { modelId: 'b', status: 'verified' },
    ]);
  });

  it('does not mutate the contributions it receives', () => {
    const input = [contribution('b', 'verified'), contribution('a', 'incompatible')];
    const snapshot = [...input];
    propagateStatus(input);
    expect(input).toEqual(snapshot);
  });

  it('rank table encodes Incompatible < Unsupported < Unverified < Verified (spec 5.2.2)', () => {
    expect(MODEL_STATUS_RANK).toEqual({
      incompatible: 0,
      unsupported: 1,
      unverified: 2,
      verified: 3,
    });
  });
});
