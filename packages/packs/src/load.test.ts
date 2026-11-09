/**
 * Pack loader tests (EXT-03): untrusted input handling — size cap, version gate,
 * schema validation, content-hash verification, quality invariants, and frozen
 * output (spec 6.7, 9.2, 9.4).
 *
 * Fixtures are synthetic (`test-fixtures.ts`).
 */
import { describe, expect, it } from 'vitest';
import { canonicalJson, contentHashOf, withoutContentHash } from './canonical';
import { PackError, PackErrorCode } from './errors';
import { MAX_PACK_FILE_SIZE } from './limits';
import { loadPack, loadPackBytes, loadPackJson } from './load';
import type { Pack } from './schema';
import { SYNTHETIC_DATE, buildSyntheticPack } from './test-fixtures';

const ALPHA = 'InventedSmithyRecipes/ItemFixtureIngotAlpha';

function serialize(pack: Pack): string {
  return `${canonicalJson(pack)}\n`;
}

/** JSON round-trip into a mutable copy, for tampering tests. */
function mutableCopy(pack: Pack): Pack {
  return JSON.parse(JSON.stringify(pack)) as Pack;
}

function recipe(pack: Pack, id: string): Pack['payload']['recipes'][number] {
  const found = pack.payload.recipes.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no recipe "${id}" in the pack`);
  return found;
}

async function loadError(load: () => Promise<unknown>): Promise<PackError> {
  try {
    await load();
  } catch (error) {
    if (error instanceof PackError) return error;
    throw error;
  }
  throw new Error('expected the load to fail');
}

describe('pack loader: round trip', () => {
  it('loads a built pack from a JSON string and from bytes, unchanged', async () => {
    const pack = await buildSyntheticPack();
    const json = serialize(pack);

    const fromJson = await loadPackJson(json);
    const fromBytes = await loadPackBytes(new TextEncoder().encode(json));

    expect(canonicalJson(fromJson)).toBe(canonicalJson(pack));
    expect(canonicalJson(fromBytes)).toBe(canonicalJson(pack));
    expect(fromJson.contentHash).toBe(pack.contentHash);
  });

  it('returns frozen data', async () => {
    const loaded = await loadPackJson(serialize(await buildSyntheticPack()));

    expect(Object.isFrozen(loaded)).toBe(true);
    expect(Object.isFrozen(loaded.payload)).toBe(true);
    expect(Object.isFrozen(loaded.payload.recipes[0])).toBe(true);

    const mutable = loaded.payload.recipes as unknown as Pack['payload']['recipes'];
    expect(() => mutable.pop()).toThrow(TypeError);
  });
});

describe('pack loader: unknown versions are rejected, never coerced', () => {
  it('rejects a future pack schema version with its own code', async () => {
    const pack = mutableCopy(await buildSyntheticPack());
    const candidate = { ...pack, packSchemaVersion: 999 };

    const error = await loadError(() => loadPack(candidate));
    expect(error.code).toBe(PackErrorCode.SchemaFuture);
    expect(error.message).toContain('999');
  });

  it('rejects an older pack schema version with no migration', async () => {
    const pack = mutableCopy(await buildSyntheticPack());
    const error = await loadError(() => loadPack({ ...pack, packSchemaVersion: 0 }));
    expect(error.code).toBe(PackErrorCode.SchemaUnsupported);
  });

  it('rejects something that is not a pack at all', async () => {
    expect((await loadError(() => loadPack({}))).code).toBe(PackErrorCode.LoadNotPack);
    expect((await loadError(() => loadPack([]))).code).toBe(PackErrorCode.LoadNotPack);
    expect((await loadError(() => loadPack('a pack'))).code).toBe(PackErrorCode.LoadNotPack);
    expect((await loadError(() => loadPackJson('not json'))).code).toBe(PackErrorCode.LoadNotJson);
  });
});

describe('pack loader: untrusted input bounds (spec 9.4)', () => {
  it('rejects a pack above the file-size cap before parsing it', async () => {
    const oversized = 'x'.repeat(MAX_PACK_FILE_SIZE + 1);
    const error = await loadError(() => loadPackJson(oversized));
    expect(error.code).toBe(PackErrorCode.LoadTooLarge);
  });

  it('rejects a schema-invalid pack with the offending paths', async () => {
    const pack = mutableCopy(await buildSyntheticPack());
    const candidate = { ...pack, gameBranch: 'nightly' };
    const error = await loadError(() => loadPack(candidate));
    expect(error.code).toBe(PackErrorCode.SchemaInvalid);
    expect(error.details.join('\n')).toMatch(/gameBranch/);
  });

  it('rejects unknown keys instead of ignoring them', async () => {
    const pack = mutableCopy(await buildSyntheticPack());
    const error = await loadError(() => loadPack({ ...pack, extraField: 'surprise' }));
    expect(error.code).toBe(PackErrorCode.SchemaInvalid);
    expect(error.details.join('\n')).toMatch(/Unrecognized key/);
  });

  it('rejects manifest counts that disagree with the payload', async () => {
    const pack = mutableCopy(await buildSyntheticPack());
    pack.entityCounts.recipes = 99;
    const error = await loadError(() => loadPack(pack));
    expect(error.code).toBe(PackErrorCode.SchemaInvalid);
    expect(error.details.join('\n')).toMatch(/entityCounts\.recipes/);
  });

  it('rejects duplicate entity ids', async () => {
    const pack = mutableCopy(await buildSyntheticPack());
    const duplicate = recipe(pack, ALPHA);
    pack.payload.recipes.push(duplicate);
    const error = await loadError(() => loadPack(pack));
    expect(error.code).toBe(PackErrorCode.SchemaInvalid);
    expect(error.details.join('\n')).toMatch(/duplicate recipes id/);
  });
});

describe('pack loader: content hash and quality invariants', () => {
  it('rejects a pack whose content changed without its hash', async () => {
    const pack = mutableCopy(await buildSyntheticPack());
    const alpha = recipe(pack, ALPHA);
    alpha.displayName = 'Renamed Without Rehashing';

    const error = await loadError(() => loadPack(pack));
    expect(error.code).toBe(PackErrorCode.HashMismatch);
    expect(error.message).toMatch(/content hash mismatch/);
  });

  it('rejects a validated quantity whose unit is unverified', async () => {
    const pack = mutableCopy(await buildSyntheticPack());
    const alpha = recipe(pack, ALPHA);
    // Schema-valid (approval present) but semantically broken: no unit.
    alpha.properties['time'] = {
      quality: 'extracted-and-validated',
      approval: { approvedBy: 'someone', approvedAt: SYNTHETIC_DATE, reference: 'no evidence' },
    };
    pack.contentHash = await contentHashOf(withoutContentHash(pack));

    const error = await loadError(() => loadPack(pack));
    expect(error.code).toBe(PackErrorCode.QualityInvariant);
    expect(error.details.join('\n')).toMatch(/unit is unverified/);
  });
});
