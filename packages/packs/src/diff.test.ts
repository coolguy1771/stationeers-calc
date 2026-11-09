/**
 * Semantic pack diff (EXT-04; spec 6.6 steps 4–6, 10.2 "behavior models with
 * changed inputs are invalidated").
 *
 * Every pack here is built from the synthetic extraction in `test-fixtures.ts`
 * and then varied in one dimension, so each test isolates one rule of the
 * changelog: a moved value, a moved §6.5 level (in both directions), a moved
 * source, an entity appearing/disappearing, a join, a counter, a manifest field,
 * and order-independence.
 */
import { describe, expect, it } from 'vitest';
import { canonicalJson } from './canonical';
import { diffPacks } from './diff';
import type { CoverageInput, IrInput, ManifestFragmentInput, PackBuildMetadata } from './input';
import { loadPackJson } from './load';
import type { Pack, PropertyQuality, ReadonlyPack } from './schema';
import { buildSyntheticPack, SYNTHETIC_DATE, syntheticExtraction, syntheticMetadata } from './test-fixtures';

const ALPHA = 'InventedSmithyRecipes/ItemFixtureIngotAlpha';
const BETA = 'InventedSmithyRecipes/ItemFixtureIngotBeta';
const GAMMA = 'InventedSmithyRecipes/ItemFixtureIngotGamma';

/** The promotion input that validates one text property (no unit to establish). */
const PROMOTE_TIER = {
  promotions: [
    {
      entityType: 'recipe',
      entityId: ALPHA,
      property: 'tier',
      approvedBy: 'alice',
      approvedAt: SYNTHETIC_DATE,
      reference: 'fixture smelter-tier/v1',
    },
  ],
};

interface PackVariation {
  ir?: (ir: IrInput) => void;
  coverage?: (coverage: CoverageInput) => void;
  manifest?: (manifest: ManifestFragmentInput) => void;
  metadata?: Partial<PackBuildMetadata>;
  promotions?: unknown;
  displayNames?: unknown;
}

/** Build the synthetic pack with exactly one dimension varied. */
async function buildPackWith(variation: PackVariation = {}): Promise<Pack> {
  const extraction = syntheticExtraction();
  variation.ir?.(extraction.ir);
  variation.coverage?.(extraction.coverage);
  variation.manifest?.(extraction.manifest);
  return buildSyntheticPack({
    ir: extraction.ir,
    coverage: extraction.coverage,
    manifest: extraction.manifest,
    metadata: syntheticMetadata(variation.metadata),
    ...(variation.promotions === undefined ? {} : { promotions: variation.promotions }),
    ...(variation.displayNames === undefined ? {} : { displayNames: variation.displayNames }),
  });
}

function recipe(ir: IrInput, id: string): IrInput['recipes'][number] {
  const found = ir.recipes.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`fixture recipe ${id} is missing`);
  return found;
}

/** The one entity change for `entityId`, or a failure naming what was reported. */
function entityChange(changelog: ReturnType<typeof diffPacks>, entityId: string) {
  const found = changelog.entities.find((change) => change.entityId === entityId);
  if (found === undefined) {
    throw new Error(`no entity change for ${entityId}: ${changelog.entities.map((c) => c.entityId).join(', ')}`);
  }
  return found;
}

/** The one property change for `property`, or a failure naming what was reported. */
function propertyChange(change: ReturnType<typeof entityChange>, property: string) {
  const found = change.properties.find((candidate) => candidate.property === property);
  if (found === undefined) {
    throw new Error(`no property change for ${property}: ${change.properties.map((c) => c.property).join(', ')}`);
  }
  return found;
}

/** A copy of a pack with payload arrays and property maps in reverse order. */
function reordered(pack: ReadonlyPack): ReadonlyPack {
  const reverseProperties = <T extends { properties: Record<string, PropertyQuality> }>(
    entities: readonly T[],
  ): T[] =>
    [...entities].reverse().map((entity) => ({
      ...entity,
      properties: Object.fromEntries(Object.entries(entity.properties).reverse()) as Record<string, PropertyQuality>,
    }));

  const clone = structuredClone(pack) as Pack;
  clone.payload = {
    recipes: reverseProperties(clone.payload.recipes),
    items: reverseProperties(clone.payload.items),
    devices: reverseProperties(clone.payload.devices),
  };
  return clone;
}

describe('diffPacks — identity', () => {
  it('reports a pack against itself as identical with nothing to invalidate', async () => {
    const pack = await buildSyntheticPack();
    const changelog = diffPacks(pack, pack);

    expect(changelog.identical).toBe(true);
    expect(changelog.entities).toEqual([]);
    expect(changelog.manifest).toEqual({ entityCounts: [] });
    expect(changelog.invalidatingProperties).toEqual([]);
    expect(changelog.invalidatingConstants).toEqual([]);
    expect(changelog.coverage).toEqual({
      familiesMapped: [],
      familiesUnmapped: [],
      familiesAdded: [],
      familiesRemoved: [],
      joins: [],
      controls: [],
      missingFieldsDelta: 0,
      diagnosticsDelta: [],
      counts: [],
      sourceFilesAdded: [],
      sourceFilesRemoved: [],
      sourceFilesChanged: [],
    });
    expect(changelog.prevPackId).toBe(changelog.nextPackId);
  });

  it('is independent of payload order and property-map insertion order', async () => {
    const pack = await buildSyntheticPack();
    const shuffled = reordered(pack);

    expect(diffPacks(pack, shuffled).identical).toBe(true);
    expect(diffPacks(shuffled, pack).identical).toBe(true);
    expect(diffPacks(shuffled, reordered(shuffled)).identical).toBe(true);
  });

  it('produces the same entity and coverage sections whatever the key order', async () => {
    const before = await buildPackWith();
    const after = await buildPackWith({
      ir: (ir) => {
        recipe(ir, ALPHA).time = { text: '4', value: 4, unitStatus: 'unverified' };
      },
    });
    const plain = diffPacks(before, after);
    const shuffled = diffPacks(before, reordered(after));

    expect(canonicalJson(plain.entities)).toBe(canonicalJson(shuffled.entities));
    expect(canonicalJson(plain.coverage)).toBe(canonicalJson(shuffled.coverage));
    expect(plain.invalidatingProperties).toEqual(shuffled.invalidatingProperties);
  });

  it('is deterministic: repeated diffs are byte-identical', async () => {
    const before = await buildPackWith();
    const after = await buildPackWith({
      ir: (ir) => {
        recipe(ir, ALPHA).time = { text: '4', value: 4, unitStatus: 'unverified' };
      },
      metadata: { gameBuild: '0.2.2000.2222' },
      displayNames: { [ALPHA]: 'Fixture Ingot Alpha' },
    });

    expect(canonicalJson(diffPacks(before, after))).toBe(canonicalJson(diffPacks(before, after)));
  });

  it('diffs packs that came back from a file as loaded, frozen data', async () => {
    const before = await buildPackWith();
    const after = await buildPackWith({
      ir: (ir) => {
        recipe(ir, ALPHA).time = { text: '4', value: 4, unitStatus: 'unverified' };
      },
    });
    const loadedBefore = await loadPackJson(JSON.stringify(before));
    const loadedAfter = await loadPackJson(JSON.stringify(after));

    const fromMemory = diffPacks(before, after);
    const fromFiles = diffPacks(loadedBefore, loadedAfter);

    expect(canonicalJson(fromFiles)).toBe(canonicalJson(fromMemory));
    expect(fromFiles.invalidatingProperties).toEqual(['time']);
  });

  it('does not modify either pack', async () => {
    const before = await buildPackWith();
    const after = await buildPackWith({
      ir: (ir) => {
        recipe(ir, BETA).time = { text: '9', value: 9, unitStatus: 'unverified' };
      },
    });
    const beforeJson = canonicalJson(before);
    const afterJson = canonicalJson(after);

    diffPacks(before, after);

    expect(canonicalJson(before)).toBe(beforeJson);
    expect(canonicalJson(after)).toBe(afterJson);
  });
});

describe('diffPacks — values and quality (§6.5, §6.6 step 5)', () => {
  it('reports a value change with its old and new value, and invalidates the name', async () => {
    const before = await buildPackWith();
    const after = await buildPackWith({
      ir: (ir) => {
        recipe(ir, ALPHA).time = { text: '4', value: 4, unitStatus: 'unverified' };
      },
    });

    const changelog = diffPacks(before, after);
    const change = entityChange(changelog, ALPHA);
    const time = propertyChange(change, 'time');

    expect(changelog.identical).toBe(false);
    expect(change.kind).toBe('changed');
    expect(change.entityType).toBe('recipe');
    expect(time.kinds).toEqual(['value-changed']);
    expect(time.beforeValue).toEqual({ kind: 'number', text: '3', value: 3, unitStatus: 'unverified' });
    expect(time.afterValue).toEqual({ kind: 'number', text: '4', value: 4, unitStatus: 'unverified' });
    expect(time.qualityChange).toBeUndefined();
    expect(time.invalidating).toBe(true);
    expect(changelog.invalidatingProperties).toEqual(['time']);
  });

  it('treats a quantity gaining unit semantics as a value change', async () => {
    const before = await buildPackWith();
    const after = await buildPackWith({
      ir: (ir) => {
        recipe(ir, ALPHA).time = { text: '3', value: 3, unitStatus: 'verified', unit: 's' };
      },
    });

    const time = propertyChange(entityChange(diffPacks(before, after), ALPHA), 'time');

    expect(time.kinds).toEqual(['value-changed']);
    expect(time.afterValue).toEqual({ kind: 'number', text: '3', value: 3, unitStatus: 'verified', unit: 's' });
    expect(time.invalidating).toBe(true);
  });

  it('invalidates a quality downgrade (validated -> unverified)', async () => {
    const validated = await buildPackWith({ promotions: PROMOTE_TIER });
    const rebuilt = await buildPackWith();

    const changelog = diffPacks(validated, rebuilt);
    const tier = propertyChange(entityChange(changelog, ALPHA), 'tier');

    expect(tier.kinds).toEqual(['quality-changed']);
    expect(tier.qualityChange).toEqual({
      from: 'extracted-and-validated',
      to: 'extracted-unverified',
      direction: 'downgrade',
    });
    expect(tier.invalidating).toBe(true);
    expect(changelog.invalidatingProperties).toEqual(['tier']);
  });

  it('reports a quality improvement without invalidating anything', async () => {
    const unvalidated = await buildPackWith();
    const validated = await buildPackWith({ promotions: PROMOTE_TIER });

    const changelog = diffPacks(unvalidated, validated);
    const tier = propertyChange(entityChange(changelog, ALPHA), 'tier');

    expect(changelog.identical).toBe(false);
    expect(tier.kinds).toEqual(['quality-changed']);
    expect(tier.qualityChange).toEqual({
      from: 'extracted-unverified',
      to: 'extracted-and-validated',
      direction: 'improvement',
    });
    expect(tier.invalidating).toBe(false);
    expect(changelog.invalidatingProperties).toEqual([]);
  });

  it('ranks missing -> unverified as an improvement and unverified -> missing as a regression', async () => {
    const withoutName = await buildPackWith();
    const withName = await buildPackWith({ displayNames: { [ALPHA]: 'Fixture Ingot Alpha' } });

    const filled = propertyChange(entityChange(diffPacks(withoutName, withName), ALPHA), 'displayName');
    expect(filled.qualityChange).toEqual({
      from: 'missing',
      to: 'extracted-unverified',
      direction: 'improvement',
    });
    // The value arrived at the same time, and *that* is what invalidates — not
    // the level going up.
    expect(filled.kinds).toEqual(['value-changed', 'quality-changed']);
    expect(filled.invalidating).toBe(true);
    expect(filled.beforeValue).toEqual({ kind: 'text', text: '' });
    expect(filled.afterValue).toEqual({ kind: 'text', text: 'Fixture Ingot Alpha' });

    const emptied = propertyChange(entityChange(diffPacks(withName, withoutName), ALPHA), 'displayName');
    expect(emptied.qualityChange).toEqual({
      from: 'extracted-unverified',
      to: 'missing',
      direction: 'downgrade',
    });
    expect(emptied.invalidating).toBe(true);
  });

  it('invalidates on a downgrade alone, with no value movement', async () => {
    const validated = await buildPackWith({ promotions: PROMOTE_TIER });
    const rebuilt = await buildPackWith();

    const tier = propertyChange(entityChange(diffPacks(validated, rebuilt), ALPHA), 'tier');

    expect(tier.kinds).toEqual(['quality-changed']);
    expect(tier.beforeValue).toEqual(tier.afterValue);
    expect(tier.invalidating).toBe(true);
  });

  it('reports a provenance-only change and does not invalidate it', async () => {
    const before = await buildPackWith();
    const after = await buildPackWith({
      ir: (ir) => {
        const target = recipe(ir, ALPHA);
        target.fieldProvenance = {
          ...target.fieldProvenance,
          time: {
            qualityLevel: 'extracted-unverified',
            sourcePath: '/GameData/InventedSmithyRecipes/RecipeData[1]/Recipe/TimeMoved',
          },
        };
      },
    });

    const changelog = diffPacks(before, after);
    const change = entityChange(changelog, ALPHA);
    const time = propertyChange(change, 'time');

    expect(time.kinds).toEqual(['provenance-changed']);
    expect(time.beforeValue).toEqual(time.afterValue);
    expect(time.qualityChange).toBeUndefined();
    expect(time.invalidating).toBe(false);
    expect(time.after?.sourcePath).toBe('/GameData/InventedSmithyRecipes/RecipeData[1]/Recipe/TimeMoved');
    expect(changelog.invalidatingProperties).toEqual([]);
    expect(change.kind).toBe('changed');
  });

  it('reports the approval record moving with a validated value', async () => {
    const first = await buildPackWith({ promotions: PROMOTE_TIER });
    const second = await buildPackWith({
      promotions: {
        promotions: [{ ...PROMOTE_TIER.promotions[0], reference: 'fixture smelter-tier/v2' }],
      },
    });

    const tier = propertyChange(entityChange(diffPacks(first, second), ALPHA), 'tier');

    expect(tier.kinds).toEqual(['provenance-changed']);
    expect(tier.invalidating).toBe(false);
    expect(tier.after?.approval?.reference).toBe('fixture smelter-tier/v2');
  });
});

describe('diffPacks — entities', () => {
  it('reports a removed entity and every property it carried as invalidating', async () => {
    const before = await buildPackWith();
    const after = await buildPackWith({
      ir: (ir) => {
        ir.recipes = ir.recipes.filter((candidate) => candidate.id !== BETA);
      },
    });

    const changelog = diffPacks(before, after);
    const change = entityChange(changelog, BETA);

    expect(changelog.entities).toHaveLength(1);
    expect(change.kind).toBe('removed');
    expect(change.fields).toEqual([]);
    expect(change.properties.map((candidate) => candidate.property)).toEqual([
      'displayName',
      'inputs[0].quantity',
      'output.prefabId',
      'output.quantity',
      'time',
    ]);
    expect(change.properties.every((candidate) => candidate.kinds[0] === 'removed')).toBe(true);
    expect(changelog.invalidatingProperties).toEqual([
      'displayName',
      'inputs[0].quantity',
      'output.prefabId',
      'output.quantity',
      'time',
    ]);
  });

  it('reports an added entity with the properties that appeared', async () => {
    const before = await buildPackWith();
    const after = await buildPackWith({
      ir: (ir) => {
        const template = structuredClone(recipe(ir, BETA));
        ir.recipes.push({ ...template, id: GAMMA, output: { prefabId: 'ItemFixtureIngotGamma' } });
      },
    });

    const changelog = diffPacks(before, after);
    const change = entityChange(changelog, GAMMA);

    expect(change.kind).toBe('added');
    expect(change.properties.every((candidate) => candidate.beforeValue.kind === 'absent')).toBe(true);
    expect(change.properties.every((candidate) => candidate.invalidating)).toBe(true);
    expect(changelog.invalidatingProperties).toContain('time');
    expect(changelog.coverage.counts).toContainEqual({ counter: 'recipes', before: 3, after: 4, delta: 1 });
  });

  it('reports a structural change the property map does not address', async () => {
    const before = await buildPackWith();
    const after = await buildPackWith({
      ir: (ir) => {
        recipe(ir, ALPHA).inputs[0]!.materialName = 'MetalPlate';
      },
    });

    const changelog = diffPacks(before, after);
    const change = entityChange(changelog, ALPHA);

    expect(change.kind).toBe('changed');
    expect(change.properties).toEqual([]);
    expect(change.fields).toEqual([
      {
        field: 'inputs.materialNames',
        before: '["MetalOre","Slag"]',
        after: '["MetalPlate","Slag"]',
      },
    ]);
    expect(changelog.invalidatingProperties).toEqual([]);
  });
});

describe('diffPacks — coverage and manifest', () => {
  it('reports a join going missing -> supplied and back', async () => {
    const withoutNames = await buildPackWith();
    const withNames = await buildPackWith({ displayNames: { [ALPHA]: 'Fixture Ingot Alpha' } });

    expect(diffPacks(withoutNames, withNames).coverage.joins).toEqual([
      { join: 'display-name', before: 'missing', after: 'supplied' },
    ]);
    expect(diffPacks(withNames, withoutNames).coverage.joins).toEqual([
      { join: 'display-name', before: 'supplied', after: 'missing' },
    ]);
  });

  it('reports §6.5 tallies and per-family recipe counts as counters', async () => {
    const before = await buildPackWith();
    const after = await buildPackWith({ promotions: PROMOTE_TIER });

    const counts = diffPacks(before, after).coverage.counts;
    const tally = (level: string) => counts.find((change) => change.counter === `byPropertyQuality.${level}`);

    expect(tally('extracted-and-validated')).toEqual({
      counter: 'byPropertyQuality.extracted-and-validated',
      before: 0,
      after: 1,
      delta: 1,
    });
    expect(tally('extracted-unverified')?.delta).toBe(-1);
    expect(tally('missing')).toBeUndefined();
  });

  it('reports a moved game build, tool versions, and family mapping', async () => {
    const before = await buildPackWith();
    const after = await buildPackWith({
      metadata: {
        gameBuild: '0.2.2000.2222',
        normalizationVersion: '2',
        toolVersions: { extractor: '0.0.2', ir: 2 },
      },
    });

    const changelog = diffPacks(before, after);

    expect(changelog.identical).toBe(false);
    expect(changelog.manifest.gameBuild).toEqual({ before: '0.2.1000.1111', after: '0.2.2000.2222' });
    expect(changelog.manifest.normalizationVersion).toEqual({ before: '1', after: '2' });
    expect(changelog.manifest.toolVersions).toEqual({
      before: { extractor: '0.0.1', ir: 2 },
      after: { extractor: '0.0.2', ir: 2 },
    });
    expect(changelog.prevPackId).not.toBe(changelog.nextPackId);
  });

  it('reports a family losing its mapping and a changed source file', async () => {
    const before = await buildPackWith();
    const after = await buildPackWith({
      coverage: (coverage) => {
        for (const family of coverage.families) {
          if (family.family === 'InventedSmithyRecipes') {
            family.status = 'unmapped';
            family.reason = 'the wrapper format changed in this build';
          }
        }
      },
      manifest: (manifest) => {
        manifest.files = { 'recipes.xml': { sha256: 'd'.repeat(64), bytes: 640 } };
      },
    });

    const coverage = diffPacks(before, after).coverage;

    expect(coverage.familiesUnmapped).toEqual(['InventedSmithyRecipes']);
    expect(coverage.sourceFilesChanged).toEqual(['recipes.xml']);
  });

  it('keeps a pure rebuild (new extraction date) identical', async () => {
    const before = await buildPackWith();
    const after = await buildPackWith({ metadata: { extractionDate: '2025-12-01T00:00:00Z' } });

    const changelog = diffPacks(before, after);

    expect(changelog.identical).toBe(true);
    expect(changelog.manifest.extractionDate).toEqual({
      before: SYNTHETIC_DATE,
      after: '2025-12-01T00:00:00Z',
    });
    expect(changelog.prevContentHash).not.toBe(changelog.nextContentHash);
  });
});
