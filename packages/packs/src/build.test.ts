/**
 * Pack builder tests (EXT-03): unverified-by-default, auditable promotion, the
 * §6.5 Verified link, honest missing data, and byte-reproducible output.
 *
 * Fixtures are synthetic (`test-fixtures.ts`): real extraction SHAPE, invented
 * values. No game data is committed (spec 6.3, 6.8, 10.2).
 */
import { describe, expect, it } from 'vitest';
import { canonicalJson } from './canonical';
import { PackError, PackErrorCode } from './errors';
import { assertCapabilityVerified, propertyQuality, type PropertyRef } from './quality';
import type { Pack } from './schema';
import { packIdFor, type PackBuildInput } from './build';
import {
  SYNTHETIC_DATE,
  buildSyntheticPack,
  syntheticExtraction,
  syntheticMetadata,
} from './test-fixtures';

const ALPHA = 'InventedSmithyRecipes/ItemFixtureIngotAlpha';
const BETA = 'InventedSmithyRecipes/ItemFixtureIngotBeta';
const GADGET = 'InventedPrinterRecipes/ItemFixtureGadget';

function recipe(pack: Pack, id: string): Pack['payload']['recipes'][number] {
  const found = pack.payload.recipes.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no recipe "${id}" in the pack`);
  return found;
}

const build = buildSyntheticPack;

function promotionInput(overrides: Record<string, unknown> = {}, extra: Record<string, unknown>[] = []): unknown {
  return {
    promotions: [
      {
        entityType: 'recipe',
        entityId: ALPHA,
        property: 'time',
        approvedBy: 'reviewer',
        approvedAt: SYNTHETIC_DATE,
        reference: 'cross-checked against fixture plan',
        // <Time> carries no unit semantics in the XML; an approval names one.
        unit: 's',
        ...overrides,
      },
      ...extra,
    ],
  };
}

async function buildError(overrides: Partial<PackBuildInput>): Promise<PackError> {
  try {
    await build(overrides);
  } catch (error) {
    if (error instanceof PackError) return error;
    throw error;
  }
  throw new Error('expected the build to fail');
}

describe('pack builder: unverified by default', () => {
  it('validates nothing without an explicit promotion input', async () => {
    const pack = await build();

    expect(pack.packSchemaVersion).toBe(1);
    expect(pack.packId).toBe(packIdFor(syntheticMetadata()));
    expect(pack.gameBuild).toBe('0.2.1000.1111');
    expect(pack.gameBranch).toBe('stable');
    expect(pack.channel).toBe('user-generated');
    expect(pack.toolVersions).toEqual({ extractor: '0.0.1', ir: 2 });
    expect(pack.normalizationVersion).toBe('1');
    expect(pack.extractionDate).toBe(SYNTHETIC_DATE);
    expect(pack.entityCounts).toEqual({ recipes: 3, items: 1, devices: 0 });
    expect(pack.behaviorModelCompatibility.status).toBe('not-declared');
    expect(pack.contentHash).toMatch(/^[0-9a-f]{64}$/);

    const qualities = pack.payload.recipes.flatMap((entity) =>
      Object.values(entity.properties).map((property) => property.quality),
    );
    expect(qualities).not.toContain('extracted-and-validated');
    expect(pack.coverage.counts.byPropertyQuality['extracted-and-validated']).toBe(0);
    expect(pack.coverage.counts.byPropertyQuality['extracted-unverified']).toBeGreaterThan(0);
    expect(pack.coverage.counts.byPropertyQuality.missing).toBeGreaterThan(0);
  });

  it('carries no invented units on extracted quantities', async () => {
    const pack = await build();
    const alpha = recipe(pack, ALPHA);

    expect(alpha.inputs.map((input) => input.quantity)).toEqual([
      { text: '.5', value: 0.5, unitStatus: 'unverified' },
      { text: '.25', value: 0.25, unitStatus: 'unverified' },
    ]);
    // The one fixture quantity whose unit was established keeps it.
    expect(recipe(pack, GADGET).inputs[0]?.quantity).toEqual({
      text: '2',
      value: 2,
      unitStatus: 'verified',
      unit: 'g',
    });
  });

  it('records an undeclared output amount as missing, never as 1', async () => {
    const pack = await build();
    const beta = recipe(pack, BETA);

    expect(beta.output).toEqual({ prefabId: 'ItemFixtureIngotBeta' });
    expect(beta.properties['output.quantity']?.quality).toBe('missing');
    expect(beta.properties['output.quantity']?.notes).toMatch(/unknown, not 1/);
    // Alpha declares one, so it is present and unverified.
    expect(recipe(pack, ALPHA).output.quantity).toEqual({ text: '0.25', value: 0.25, unitStatus: 'unverified' });
  });

  it('downgrades an extractor that claims a value is already validated', async () => {
    const extraction = syntheticExtraction();
    const alpha = extraction.ir.recipes[0];
    if (alpha === undefined) throw new Error('fixture is missing its first recipe');
    alpha.provenance.qualityLevel = 'extracted-and-validated';
    alpha.fieldProvenance = {
      ...alpha.fieldProvenance,
      time: { qualityLevel: 'extracted-and-validated' },
    };

    const pack = await build({ ir: extraction.ir });
    const packed = recipe(pack, ALPHA);

    expect(packed.provenance.quality).toBe('extracted-unverified');
    expect(packed.properties['time']?.quality).toBe('extracted-unverified');
    expect(packed.properties['time']?.notes).toMatch(/only an explicit promotion may validate/);
  });

  it('poisons every value of a record whose sources conflict', async () => {
    const extraction = syntheticExtraction();
    const alpha = extraction.ir.recipes[0];
    if (alpha === undefined) throw new Error('fixture is missing its first recipe');
    alpha.provenance.qualityLevel = 'conflicting';

    const pack = await build({ ir: extraction.ir });
    expect(recipe(pack, ALPHA).properties['time']?.quality).toBe('conflicting');
  });
});

describe('pack builder: explicit, auditable promotion', () => {
  it('promotes exactly the named property and records who approved it', async () => {
    const pack = await build({ promotions: promotionInput() });
    const alpha = recipe(pack, ALPHA);

    expect(alpha.properties['time']).toEqual({
      quality: 'extracted-and-validated',
      sourcePath: '/GameData/InventedSmithyRecipes/RecipeData[1]/Recipe/Time',
      sourceFile: 'recipes.xml',
      notes: 'unit "s" established by this approval',
      approval: {
        approvedBy: 'reviewer',
        approvedAt: SYNTHETIC_DATE,
        reference: 'cross-checked against fixture plan',
        unit: 's',
      },
    });
    // The approval establishes the unit semantics Adapter A cannot: the number
    // itself keeps its source text and value and gains the verified unit.
    expect(alpha.time).toEqual({ text: '3', value: 3, unitStatus: 'verified', unit: 's' });

    // Everything else is untouched, in this entity and every other.
    expect(alpha.properties['energy']?.quality).toBe('extracted-unverified');
    expect(alpha.properties['temperature.stop']?.quality).toBe('extracted-unverified');
    expect(recipe(pack, BETA).properties['time']?.quality).toBe('extracted-unverified');
    expect(pack.coverage.counts.byPropertyQuality['extracted-and-validated']).toBe(1);
  });

  it('requires the promotion input to be explicit and well-formed', async () => {
    const empty = await buildError({ promotions: { promotions: [] } });
    expect(empty.code).toBe(PackErrorCode.BuildInputInvalid);

    const incomplete = await buildError({
      promotions: { promotions: [{ entityType: 'recipe', entityId: ALPHA, property: 'time' }] },
    });
    expect(incomplete.code).toBe(PackErrorCode.BuildInputInvalid);

    const stringSwitch = await buildError({ promotions: true });
    expect(stringSwitch.code).toBe(PackErrorCode.BuildInputInvalid);
  });

  it('rejects a promotion that cannot be defended', async () => {
    const unknownEntity = await buildError({ promotions: promotionInput({ entityId: 'NoSuchRecipe' }) });
    expect(unknownEntity.code).toBe(PackErrorCode.PromotionUnknownEntity);

    const unknownProperty = await buildError({ promotions: promotionInput({ property: 'enthalpy' }) });
    expect(unknownProperty.code).toBe(PackErrorCode.PromotionUnknownProperty);

    const missingProperty = await buildError({
      promotions: promotionInput({ entityId: BETA, property: 'output.quantity' }),
    });
    expect(missingProperty.code).toBe(PackErrorCode.PromotionMissingProperty);

    const duplicate = await buildError({
      promotions: promotionInput({}, [
        {
          entityType: 'recipe',
          entityId: ALPHA,
          property: 'time',
          approvedBy: 'reviewer',
          approvedAt: SYNTHETIC_DATE,
          reference: 'again',
          unit: 's',
        },
      ]),
    });
    expect(duplicate.code).toBe(PackErrorCode.PromotionDuplicate);
  });

  it('refuses to validate one side of a conflicting record', async () => {
    const extraction = syntheticExtraction();
    const alpha = extraction.ir.recipes[0];
    if (alpha === undefined) throw new Error('fixture is missing its first recipe');
    alpha.provenance.qualityLevel = 'conflicting';

    const error = await buildError({ ir: extraction.ir, promotions: promotionInput() });
    expect(error.code).toBe(PackErrorCode.PromotionConflicting);
  });

  it('requires a unit before a quantity can be validated, and rejects a contradicting one', async () => {
    const noUnit = await buildError({
      promotions: promotionInput({ property: 'inputs[0].quantity', unit: undefined }),
    });
    expect(noUnit.code).toBe(PackErrorCode.PromotionUnitRequired);

    const wrongUnit = await buildError({
      promotions: promotionInput({ entityId: GADGET, property: 'inputs[0].quantity', unit: 'kg' }),
    });
    expect(wrongUnit.code).toBe(PackErrorCode.PromotionUnitMismatch);

    // A quantity whose unit the extraction already established needs no unit in
    // the promotion, and promotion does not touch its value.
    const pack = await build({
      promotions: promotionInput({ entityId: GADGET, property: 'inputs[0].quantity', unit: undefined }),
    });
    expect(recipe(pack, GADGET).properties['inputs[0].quantity']?.quality).toBe('extracted-and-validated');
    expect(recipe(pack, GADGET).inputs[0]?.quantity).toEqual({ text: '2', value: 2, unitStatus: 'verified', unit: 'g' });
  });

  it('rejects a unit declared for a property that is not a quantity', async () => {
    const error = await buildError({
      displayNames: { [ALPHA]: 'FixtureIngotAlpha' },
      promotions: promotionInput({ property: 'displayName' }),
    });
    expect(error.code).toBe(PackErrorCode.PromotionUnitNotApplicable);
  });
});

describe('pack builder: honest about what is missing', () => {
  it('names the joins the game data cannot supply', async () => {
    const pack = await build();
    const joins = Object.fromEntries(pack.coverage.joins.map((join) => [join.join, join]));

    expect(pack.coverage.joins).toHaveLength(3);
    expect(joins['material-to-prefab']?.status).toBe('missing');
    expect(joins['material-to-prefab']?.detail).toMatch(/no material-to-prefab mapping/);
    expect(joins['family-to-machine-prefab']?.status).toBe('missing');
    expect(joins['display-name']?.status).toBe('missing');

    // Absent names are empty and marked missing, for recipes and items alike.
    expect(recipe(pack, ALPHA).displayName).toBe('');
    expect(recipe(pack, ALPHA).properties['displayName']?.quality).toBe('missing');
    expect(pack.payload.items[0]?.properties['displayName']?.quality).toBe('missing');
  });

  it('carries Adapter B display names as unverified and marks the join supplied', async () => {
    const pack = await build({ displayNames: { [ALPHA]: 'FixtureIngotAlpha', ItemFixtureWidget: 'Fixture Widget' } });

    expect(recipe(pack, ALPHA).displayName).toBe('FixtureIngotAlpha');
    expect(recipe(pack, ALPHA).properties['displayName']?.quality).toBe('extracted-unverified');
    expect(pack.payload.items[0]?.displayName).toBe('Fixture Widget');
    const join = pack.coverage.joins.find((candidate) => candidate.join === 'display-name');
    expect(join?.status).toBe('supplied');
    expect(join?.detail).toMatch(/2 entities/);
    // Names never become a key: the id is unchanged.
    expect(recipe(pack, ALPHA).id).toBe(ALPHA);
  });

  it('reports IR entity types it has no pack representation for', async () => {
    const pack = await build();
    expect(pack.coverage.counts.sourceWorldRefs).toBe(1);
    expect(pack.coverage.unpacked).toEqual([
      { entityType: 'worldref', count: 1, reason: expect.stringMatching(/no pack representation/) },
    ]);
  });

  it('summarizes the extractor coverage report', async () => {
    const pack = await build();

    expect(pack.coverage.inputDir).toBe('Data');
    expect(pack.coverage.families.map((family) => family.family)).toEqual([
      'Blueprint',
      'InventedPrinterRecipes',
      'InventedSmithyRecipes',
    ]);
    expect(pack.coverage.counts.byFamily).toEqual({ InventedPrinterRecipes: 1, InventedSmithyRecipes: 2 });
    expect(pack.coverage.controls.map((control) => control.element)).toEqual(['Energy', 'RequiredMix', 'Time']);
    expect(pack.coverage.missingFields.total).toBe(2);
    expect(pack.coverage.diagnostics.total).toBe(3);
    expect(pack.coverage.diagnostics.byCode).toEqual([
      { code: 'IR-DUP-EXACT', severity: 'info', count: 1 },
      { code: 'XML-CONTROL-UNMAPPED', severity: 'warning', count: 1 },
      { code: 'XML-FAMILY-UNMAPPED', severity: 'info', count: 1 },
    ]);
    expect(pack.coverage.skippedFiles).toEqual(['malformed.xml']);
    expect(pack.sourceDigests.files['recipes.xml']?.sha256).toBe('a'.repeat(64));
  });
});

describe('§6.5 link: a Verified capability may only consume validated properties', () => {
  const timeRef: PropertyRef = { entityType: 'recipe', entityId: ALPHA, property: 'time' };
  const energyRef: PropertyRef = { entityType: 'recipe', entityId: ALPHA, property: 'energy' };
  const missingRef: PropertyRef = { entityType: 'recipe', entityId: BETA, property: 'output.quantity' };
  const absentRef: PropertyRef = { entityType: 'recipe', entityId: 'NoSuchRecipe', property: 'time' };

  it('fails with a stable diagnostic code when any consumed property is unvalidated', async () => {
    const pack = await build();

    expect(() => assertCapabilityVerified(pack, { id: 'smithy-throughput', consumes: [timeRef] })).toThrow(PackError);
    try {
      assertCapabilityVerified(pack, { id: 'smithy-throughput', consumes: [timeRef] });
    } catch (error) {
      const packError = error as PackError;
      expect(packError.code).toBe(PackErrorCode.CapabilityUnvalidatedInput);
      expect(packError.details).toHaveLength(1);
      expect(packError.details[0]).toMatch(/is extracted-unverified/);
    }

    expect(propertyQuality(pack, timeRef)).toBe('extracted-unverified');
    // Fails closed for anything the pack does not carry.
    expect(propertyQuality(pack, missingRef)).toBe('missing');
    expect(propertyQuality(pack, absentRef)).toBe('missing');
  });

  it('passes only when every consumed property is validated', async () => {
    const pack = await build({
      promotions: promotionInput({}, []),
    });
    expect(() => assertCapabilityVerified(pack, { id: 'smithy-throughput', consumes: [timeRef] })).not.toThrow();

    // One validated input plus one unvalidated input still fails, naming the input.
    try {
      assertCapabilityVerified(pack, { id: 'smithy-energy', consumes: [timeRef, energyRef] });
      throw new Error('expected the capability check to fail');
    } catch (error) {
      const packError = error as PackError;
      expect(packError.code).toBe(PackErrorCode.CapabilityUnvalidatedInput);
      expect(packError.details[0]).toMatch(/energy/);
    }
  });
});

describe('pack builder: reproducible, versioned output', () => {
  it('produces identical bytes and hash for identical inputs', async () => {
    const [first, second] = await Promise.all([build(), build()]);

    expect(canonicalJson(first)).toBe(canonicalJson(second));
    expect(first.contentHash).toBe(second.contentHash);
  });

  it('changes the hash when the source or the metadata changes', async () => {
    const base = await build();
    const otherBuild = await build({ metadata: syntheticMetadata({ gameBuild: '0.2.1000.2222' }) });
    const promoted = await build({ promotions: promotionInput() });

    expect(otherBuild.contentHash).not.toBe(base.contentHash);
    expect(otherBuild.packId).not.toBe(base.packId);
    expect(promoted.contentHash).not.toBe(base.contentHash);
    // The promotion changed quality and unit semantics, never the extracted number.
    expect(recipe(base, ALPHA).time).toEqual({ text: '3', value: 3, unitStatus: 'unverified' });
    expect(recipe(promoted, ALPHA).time).toMatchObject({ text: '3', value: 3 });
  });

  it('records the extraction date as supplied, not as the build time', async () => {
    const pack = await build({ metadata: syntheticMetadata({ extractionDate: '2025-11-11T12:34:56Z' }) });
    expect(pack.extractionDate).toBe('2025-11-11T12:34:56Z');
  });
});

describe('pack builder: refuses inputs it cannot stand behind', () => {
  it('rejects a published pack from a beta branch (spec 6.4)', async () => {
    const error = await buildError({ metadata: syntheticMetadata({ gameBranch: 'beta', channel: 'published' }) });
    expect(error.code).toBe(PackErrorCode.PublishedOnBetaBranch);
  });

  it('rejects an unsupported IR version instead of coercing it', async () => {
    const extraction = syntheticExtraction();
    extraction.ir.irVersion = 3;
    const error = await buildError({ ir: extraction.ir });
    expect(error.code).toBe(PackErrorCode.IrVersionUnsupported);
    expect(error.message).toMatch(/IR v2/);
  });

  it('rejects documents that disagree about the IR version', async () => {
    const error = await buildError({ metadata: syntheticMetadata({ toolVersions: { extractor: '0.0.1', ir: 1 } }) });
    expect(error.code).toBe(PackErrorCode.IrVersionMismatch);

    const extraction = syntheticExtraction();
    extraction.manifest.irVersion = 1;
    const manifestError = await buildError({ manifest: extraction.manifest });
    expect(manifestError.code).toBe(PackErrorCode.IrVersionMismatch);
  });

  it('rejects an extractor manifest whose file count disagrees with its file list', async () => {
    const extraction = syntheticExtraction();
    extraction.manifest.fileCount = 4;
    const error = await buildError({ manifest: extraction.manifest });
    expect(error.code).toBe(PackErrorCode.ManifestInconsistent);
  });

  it('rejects malformed metadata and IR instead of filling gaps', async () => {
    const badBuild = await buildError({ metadata: syntheticMetadata({ gameBuild: 'v0.2' }) });
    expect(badBuild.code).toBe(PackErrorCode.BuildInputInvalid);

    const badDate = await buildError({ metadata: syntheticMetadata({ extractionDate: '2025-11-10' }) });
    expect(badDate.code).toBe(PackErrorCode.BuildInputInvalid);

    const badIr = await buildError({ ir: { irVersion: 2 } });
    expect(badIr.code).toBe(PackErrorCode.BuildInputInvalid);
  });
});
