/**
 * Pack schema tests (EXT-03): the manifest contract itself — round trip, derived
 * counts, per-property quality invariants, and the bounds that make a pack
 * importable from untrusted input (spec 6.4, 6.5, 9.4).
 *
 * Fixtures are synthetic (`test-fixtures.ts`).
 */
import { describe, expect, it } from 'vitest';
import { canonicalJson } from './canonical';
import { MAX_PACK_RECIPES } from './limits';
import { PACK_SCHEMA_VERSION, PackPayloadSchema, PackSchema, PropertyQualitySchema, type Pack, type PackedRecipe } from './schema';
import { SYNTHETIC_DATE, buildSyntheticPack } from './test-fixtures';

const ALPHA = 'InventedSmithyRecipes/ItemFixtureIngotAlpha';

function mutableCopy(pack: Pack): Pack {
  return JSON.parse(JSON.stringify(pack)) as Pack;
}

function recipe(pack: Pack, id: string): Pack['payload']['recipes'][number] {
  const found = pack.payload.recipes.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no recipe "${id}" in the pack`);
  return found;
}

describe('pack schema: round trip', () => {
  it('parses exactly what the builder produced', async () => {
    const pack = await buildSyntheticPack();
    const reparsed = PackSchema.parse(JSON.parse(canonicalJson(pack)));

    expect(reparsed).toEqual(pack);
    expect(reparsed.packSchemaVersion).toBe(PACK_SCHEMA_VERSION);
  });

  it('is independent of object key order (hash stability)', async () => {
    const pack = await buildSyntheticPack();
    const shuffled: Record<string, unknown> = {};
    for (const key of Object.keys(pack).reverse()) {
      shuffled[key] = (pack as unknown as Record<string, unknown>)[key];
    }

    expect(canonicalJson(shuffled)).toBe(canonicalJson(pack));
  });
});

describe('pack schema: the §6.5 level and its approval are inseparable', () => {
  it('rejects a validated property with no approval record', () => {
    const result = PropertyQualitySchema.safeParse({ quality: 'extracted-and-validated' });
    expect(result.success).toBe(false);
  });

  it('rejects an approval recorded on an unvalidated property', () => {
    const result = PropertyQualitySchema.safeParse({
      quality: 'extracted-unverified',
      approval: { approvedBy: 'reviewer', approvedAt: SYNTHETIC_DATE, reference: 'x' },
    });
    expect(result.success).toBe(false);
  });

  it('accepts all five §6.5 levels', () => {
    for (const quality of [
      'extracted-and-validated',
      'extracted-unverified',
      'missing',
      'conflicting',
      'inferred',
    ] as const) {
      const value =
        quality === 'extracted-and-validated'
          ? {
              quality,
              approval: { approvedBy: 'reviewer', approvedAt: SYNTHETIC_DATE, reference: 'x' },
            }
          : { quality };
      expect(PropertyQualitySchema.safeParse(value).success).toBe(true);
    }
  });
});

describe('pack schema: versioned provenance', () => {
  it('rejects a marketing version instead of a full build number', async () => {
    const pack = mutableCopy(await buildSyntheticPack());
    const result = PackSchema.safeParse({ ...pack, gameBuild: 'v0.2' });
    expect(result.success).toBe(false);
  });

  it('rejects a non-UTC extraction date', async () => {
    const pack = mutableCopy(await buildSyntheticPack());
    const result = PackSchema.safeParse({ ...pack, extractionDate: '2025-11-10 10:00' });
    expect(result.success).toBe(false);
  });

  it('rejects a published pack from a beta branch', async () => {
    const pack = mutableCopy(await buildSyntheticPack());
    const result = PackSchema.safeParse({ ...pack, channel: 'published', gameBranch: 'beta' });
    expect(result.success).toBe(false);
  });

  it('requires a content hash', async () => {
    const pack = mutableCopy(await buildSyntheticPack());
    const { contentHash: _contentHash, ...rest } = pack;
    expect(PackSchema.safeParse(rest).success).toBe(false);
  });
});

describe('pack schema: bounded, self-consistent payload', () => {
  it('rejects counts that disagree with the payload', async () => {
    const pack = mutableCopy(await buildSyntheticPack());
    pack.coverage.counts.items = 7;
    expect(PackSchema.safeParse(pack).success).toBe(false);
  });

  it('rejects duplicate entity ids', async () => {
    const pack = mutableCopy(await buildSyntheticPack());
    pack.payload.recipes.push(recipe(pack, ALPHA));
    pack.entityCounts.recipes += 1;
    pack.coverage.counts.recipes += 1;
    expect(PackSchema.safeParse(pack).success).toBe(false);
  });

  it('rejects a payload above the recipe bound', async () => {
    const pack = await buildSyntheticPack();
    const template = recipe(pack, ALPHA);
    const many: PackedRecipe[] = Array.from({ length: MAX_PACK_RECIPES + 1 }, (_unused, index) => ({
      ...template,
      id: `InventedSmithyRecipes/Synthetic${index}`,
    }));

    const result = PackPayloadSchema.safeParse({ recipes: many, items: [], devices: [] });
    expect(result.success).toBe(false);
  });
});
