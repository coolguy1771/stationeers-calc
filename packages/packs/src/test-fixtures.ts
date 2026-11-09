/**
 * Synthetic extraction data for pack tests (spec 10.2: fake fixtures only).
 *
 * The SHAPE matches what `tools/extractor` writes (IR v2, coverage report,
 * manifest fragment — see `input.ts`); every VALUE is invented. No value from a
 * game installation is used here or committed anywhere (spec 6.3, 6.8).
 */
import { buildPack, type PackBuildInput } from './build';
import type { CoverageInput, IrInput, ManifestFragmentInput, PackBuildMetadata } from './input';
import type { Pack } from './schema';

/** Fixed date so pack builds in tests are byte-reproducible. */
export const SYNTHETIC_DATE = '2025-11-10T00:00:00Z';

const RECIPE_FIELD_PROVENANCE = {
  displayName: { qualityLevel: 'missing' as const, notes: 'the XML format carries no display name' },
  'output.prefabId': { qualityLevel: 'extracted-unverified' as const, sourcePath: '/GameData/InventedSmithyRecipes/RecipeData[1]/PrefabName' },
  'output.quantity': { qualityLevel: 'extracted-unverified' as const, sourcePath: '/GameData/InventedSmithyRecipes/RecipeData[1]/Output' },
  'inputs[0].quantity': { qualityLevel: 'extracted-unverified' as const, sourcePath: '/GameData/InventedSmithyRecipes/RecipeData[1]/Recipe/MetalOre' },
  time: { qualityLevel: 'extracted-unverified' as const, sourcePath: '/GameData/InventedSmithyRecipes/RecipeData[1]/Recipe/Time' },
  'temperature.stop': { qualityLevel: 'extracted-unverified' as const, sourcePath: '/GameData/InventedSmithyRecipes/RecipeData[1]/Recipe/Temperature/Stop' },
};

/** Three recipes, one item, one world ref: enough to exercise every pack path. */
export function syntheticExtraction(): { ir: IrInput; coverage: CoverageInput; manifest: ManifestFragmentInput } {
  const ir: IrInput = {
    irVersion: 2,
    recipes: [
      {
        id: 'InventedSmithyRecipes/ItemFixtureIngotAlpha',
        displayName: '',
        family: 'InventedSmithyRecipes',
        output: {
          prefabId: 'ItemFixtureIngotAlpha',
          quantity: { text: '0.25', value: 0.25, unitStatus: 'unverified' },
        },
        inputs: [
          { materialName: 'MetalOre', quantity: { text: '.5', value: 0.5, unitStatus: 'unverified' } },
          { materialName: 'Slag', quantity: { text: '.25', value: 0.25, unitStatus: 'unverified' } },
        ],
        time: { text: '3', value: 3, unitStatus: 'unverified' },
        energy: { text: '120', value: 120, unitStatus: 'unverified' },
        temperature: {
          start: { text: '900', value: 900, unitStatus: 'unverified' },
          stop: { text: '1500', value: 1500, unitStatus: 'unverified' },
        },
        pressure: {
          start: { text: '20000', value: 20000, unitStatus: 'unverified' },
          stop: { text: '30000', value: 30000, unitStatus: 'unverified' },
        },
        tier: 'TierTwo',
        provenance: {
          sourceFile: 'recipes.xml',
          sourcePath: '/GameData/InventedSmithyRecipes/RecipeData[1]',
          qualityLevel: 'extracted-unverified',
        },
        fieldProvenance: RECIPE_FIELD_PROVENANCE,
      },
      {
        id: 'InventedSmithyRecipes/ItemFixtureIngotBeta',
        displayName: '',
        family: 'InventedSmithyRecipes',
        // No <Output> in the source: the amount is unknown, not 1.
        output: { prefabId: 'ItemFixtureIngotBeta' },
        inputs: [{ materialName: 'MetalOre', quantity: { text: '.5', value: 0.5, unitStatus: 'unverified' } }],
        time: { text: '2', value: 2, unitStatus: 'unverified' },
        provenance: {
          sourceFile: 'recipes.xml',
          sourcePath: '/GameData/InventedSmithyRecipes/RecipeData[2]',
          qualityLevel: 'extracted-unverified',
        },
        fieldProvenance: {
          displayName: { qualityLevel: 'missing', notes: 'the XML format carries no display name' },
          'output.quantity': { qualityLevel: 'missing', notes: 'absent in source' },
        },
      },
      {
        // A quantity whose unit semantics a (future) validation did establish.
        id: 'InventedPrinterRecipes/ItemFixtureGadget',
        displayName: '',
        family: 'InventedPrinterRecipes',
        output: { prefabId: 'ItemFixtureGadget' },
        inputs: [
          { materialName: 'MetalPlate', quantity: { text: '2', value: 2, unitStatus: 'verified', unit: 'g' } },
        ],
        provenance: {
          sourceFile: 'recipes.xml',
          sourcePath: '/GameData/InventedPrinterRecipes/RecipeData[1]',
          qualityLevel: 'extracted-unverified',
        },
        fieldProvenance: {
          'inputs[0].quantity': {
            qualityLevel: 'extracted-unverified',
            sourcePath: '/GameData/InventedPrinterRecipes/RecipeData[1]/Recipe/MetalPlate',
            notes: 'unit established by hand for this fixture',
          },
        },
      },
    ],
    items: [
      {
        id: 'ItemFixtureWidget',
        displayName: '',
        category: 'Fixture',
        provenance: {
          sourceFile: 'items.xml',
          sourcePath: '/GameData/ItemFixtureWidget',
          qualityLevel: 'extracted-unverified',
        },
        fieldProvenance: { displayName: { qualityLevel: 'missing', notes: 'absent in source' } },
      },
    ],
    worldRefs: [
      {
        id: 'CelestialFixture',
        kind: 'CelestialBody',
        values: ['alpha'],
        provenance: {
          sourceFile: 'celestialbodies.xml',
          sourcePath: '/GameData/CelestialBody/CelestialFixture',
          qualityLevel: 'extracted-unverified',
        },
      },
    ],
  };

  const coverage: CoverageInput = {
    counts: {
      byType: { recipe: 3, item: 1, worldref: 1 },
      byQualityLevel: { 'extracted-unverified': 5 },
      byFieldQualityLevel: { 'extracted-unverified': 8, missing: 4 },
      byFamily: { InventedSmithyRecipes: 2, InventedPrinterRecipes: 1 },
    },
    families: [
      {
        family: 'InventedPrinterRecipes',
        status: 'mapped',
        files: ['recipes.xml'],
        recordElements: ['RecipeData'],
        recipes: 1,
      },
      {
        family: 'InventedSmithyRecipes',
        status: 'mapped',
        files: ['recipes.xml'],
        recordElements: ['RecipeData'],
        recipes: 2,
      },
      {
        family: 'Blueprint',
        status: 'unmapped',
        files: ['non-recipe.xml'],
        recordElements: ['Edge', 'Mesh'],
        recipes: 0,
        reason: 'build-shape geometry, not recipes; Adapter C (EXT-05) will own it',
      },
    ],
    controls: [
      { element: 'Energy', mapping: 'scalar', occurrences: 1 },
      { element: 'RequiredMix', mapping: 'unmapped', occurrences: 1 },
      { element: 'Time', mapping: 'scalar', occurrences: 2 },
    ],
    missingFields: [
      {
        entityType: 'recipe',
        entityId: 'InventedSmithyRecipes/ItemFixtureIngotAlpha',
        field: 'displayName',
        sourceFile: 'recipes.xml',
        sourcePath: '/GameData/InventedSmithyRecipes/RecipeData[1]',
      },
      {
        entityType: 'recipe',
        entityId: 'InventedSmithyRecipes/ItemFixtureIngotBeta',
        field: 'output.quantity',
        sourceFile: 'recipes.xml',
        sourcePath: '/GameData/InventedSmithyRecipes/RecipeData[2]/Output',
      },
    ],
    diagnostics: [
      { code: 'XML-FAMILY-UNMAPPED', severity: 'info', message: 'Blueprint is not a recipe family' },
      { code: 'XML-CONTROL-UNMAPPED', severity: 'warning', message: 'RequiredMix has no mapping' },
      { code: 'IR-DUP-EXACT', severity: 'info', message: 'a record was defined twice identically' },
    ],
    skippedFiles: ['malformed.xml'],
    inputDir: 'Data',
  };

  const manifest: ManifestFragmentInput = {
    irVersion: 2,
    generatedFrom: 'Data',
    fileCount: 1,
    files: { 'recipes.xml': { sha256: 'a'.repeat(64), bytes: 512 } },
    ir: { sha256: 'b'.repeat(64), bytes: 2048 },
    coverage: { sha256: 'c'.repeat(64), bytes: 1024 },
  };

  return { ir, coverage, manifest };
}

/**
 * Build a pack from the synthetic extraction and metadata. Tests pass
 * `overrides` to vary one input (promotions, display names, a mutated IR).
 */
export async function buildSyntheticPack(overrides: Partial<PackBuildInput> = {}): Promise<Pack> {
  const extraction = syntheticExtraction();
  return buildPack({
    ir: extraction.ir,
    coverage: extraction.coverage,
    manifest: extraction.manifest,
    metadata: syntheticMetadata(),
    ...overrides,
  });
}

/** Install-supplied metadata for a synthetic build. */
export function syntheticMetadata(overrides: Partial<PackBuildMetadata> = {}): PackBuildMetadata {
  return {
    gameBuild: '0.2.1000.1111',
    gameBranch: 'stable',
    channel: 'user-generated',
    extractionDate: SYNTHETIC_DATE,
    toolVersions: { extractor: '0.0.1', ir: 2 },
    normalizationVersion: '1',
    ...overrides,
  };
}
