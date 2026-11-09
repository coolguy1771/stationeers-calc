/**
 * Semantic-diff seam tests (EXT-04 placeholder): the seam must fail loudly, not
 * return an empty changelog that looks like "nothing changed" (spec 6.6).
 */
import { describe, expect, it } from 'vitest';
import { diffPacks } from './diff';
import { PackError, PackErrorCode } from './errors';
import { buildSyntheticPack } from './test-fixtures';

describe('pack diff seam', () => {
  it('is not implemented yet and says so with a stable code', async () => {
    const pack = await buildSyntheticPack();

    try {
      diffPacks(pack, pack);
      throw new Error('expected the diff seam to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(PackError);
      expect((error as PackError).code).toBe(PackErrorCode.DiffNotImplemented);
      expect((error as PackError).message).toMatch(/EXT-04/);
    }
  });
});
