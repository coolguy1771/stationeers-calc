import { describe, expect, it, vi } from 'vitest';
import {
  formatBytes,
  readStorageDurability,
  requestStorageDurability,
  STORAGE_CRITICAL_RATIO,
  STORAGE_HIGH_RATIO,
  usageLevel,
  type StorageManagerLike,
} from './storageDurability';

/**
 * Storage durability probe (spec 2.1, 11; backlog QA-02). Every browser answer
 * is reported exactly: a missing API is `unsupported`, a refused grant is
 * `denied`, and a failed measurement is an error message — never a comforting
 * zero that makes the panel look fine while the data is at risk.
 */
describe('byte formatting (2.1 "show storage usage and quota")', () => {
  it('reads binary units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1024 * 1024 * 1.25)).toBe('1.3 MB');
    expect(formatBytes(60 * 1024 ** 3)).toBe('60 GB');
    expect(formatBytes(2 * 1024 ** 4)).toBe('2 TB');
  });

  it('says "unavailable" rather than inventing a number', () => {
    expect(formatBytes(null)).toBe('unavailable');
    expect(formatBytes(undefined)).toBe('unavailable');
    expect(formatBytes(Number.NaN)).toBe('unavailable');
    expect(formatBytes(-1)).toBe('unavailable');
  });
});

describe('quota warning levels', () => {
  it('warns as the origin approaches its quota', () => {
    expect(usageLevel(10, 100)).toBe('ok');
    expect(usageLevel(STORAGE_HIGH_RATIO * 100, 100)).toBe('high');
    expect(usageLevel(STORAGE_CRITICAL_RATIO * 100, 100)).toBe('critical');
  });

  it('stays unknown without numbers', () => {
    expect(usageLevel(null, 100)).toBe('unknown');
    expect(usageLevel(10, null)).toBe('unknown');
    expect(usageLevel(10, 0)).toBe('unknown');
  });
});

describe('reading the browser storage state', () => {
  it('reports an absent Storage API as unsupported', async () => {
    expect(await readStorageDurability(undefined)).toEqual({
      persistence: 'unsupported',
      usage: null,
      quota: null,
      level: 'unknown',
      supported: false,
      error: null,
    });
  });

  it('reports a granted origin with its estimate', async () => {
    const api: StorageManagerLike = {
      persisted: async () => true,
      estimate: async () => ({ usage: 2_500_000, quota: 60 * 1024 ** 3 }),
    };
    const snapshot = await readStorageDurability(api);
    expect(snapshot.persistence).toBe('granted');
    expect(snapshot.usage).toBe(2_500_000);
    expect(snapshot.quota).toBe(60 * 1024 ** 3);
    expect(snapshot.level).toBe('ok');
    expect(snapshot.supported).toBe(true);
    expect(snapshot.error).toBeNull();
  });

  it('reports a denied origin and a near-full quota', async () => {
    const api: StorageManagerLike = {
      persisted: async () => false,
      estimate: async () => ({ usage: 95, quota: 100 }),
    };
    const snapshot = await readStorageDurability(api);
    expect(snapshot.persistence).toBe('denied');
    expect(snapshot.level).toBe('critical');
  });

  it('degrades to unknown with the error text when a probe rejects', async () => {
    const api: StorageManagerLike = {
      persisted: async () => {
        throw new Error('blocked by policy');
      },
      estimate: async () => {
        throw new Error('quota unavailable');
      },
    };
    const snapshot = await readStorageDurability(api);
    expect(snapshot.persistence).toBe('unknown');
    expect(snapshot.usage).toBeNull();
    expect(snapshot.error).toBe('blocked by policy');
  });

  it('handles a Storage API without estimate or persisted', async () => {
    const snapshot = await readStorageDurability({});
    expect(snapshot.persistence).toBe('unsupported');
    expect(snapshot.supported).toBe(true);
    expect(snapshot.usage).toBeNull();
  });
});

describe('requesting persistent storage (2.1)', () => {
  it('asks once and reports the grant', async () => {
    const persist = vi.fn(async () => true);
    const api: StorageManagerLike = {
      persist,
      persisted: async () => true,
      estimate: async () => ({ usage: 10, quota: 100 }),
    };
    const snapshot = await requestStorageDurability(api);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(snapshot.persistence).toBe('granted');
  });

  it('reports a refusal as denied', async () => {
    const api: StorageManagerLike = {
      persist: async () => false,
      persisted: async () => false,
    };
    expect((await requestStorageDurability(api)).persistence).toBe('denied');
  });

  it('does not request where the API cannot grant, and reports it', async () => {
    const snapshot = await requestStorageDurability({ persisted: async () => false });
    expect(snapshot.persistence).toBe('denied');
    expect((await requestStorageDurability(undefined)).persistence).toBe('unsupported');
  });

  it('surfaces a rejected request without losing the rest of the snapshot', async () => {
    const api: StorageManagerLike = {
      persist: async () => {
        throw new Error('user activation required');
      },
      persisted: async () => false,
      estimate: async () => ({ usage: 1, quota: 100 }),
    };
    const snapshot = await requestStorageDurability(api);
    expect(snapshot.persistence).toBe('denied');
    expect(snapshot.usage).toBe(1);
    expect(snapshot.error).toBe('user activation required');
  });
});
