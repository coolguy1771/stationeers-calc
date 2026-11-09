/**
 * EXT-01b tests: Adapter A against the confirmed `<GameData>` format, the IR
 * normalization rules, the coverage report, and the manifest.
 *
 * Fixtures are synthetic: real STRUCTURE (`<GameData>` root, named wrapper,
 * `<RecipeData>` with `PrefabName`/`Recipe`/controls/`Output`/`RecipeTier`,
 * comments, `.5`-style numbers), INVENTED values. No value from a game install
 * is used (spec 6.3/6.8 — the reference install is modded and must not
 * contaminate packs).
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseGameDataFile } from './adapters/xml/gamedata';
import { scanInputDir } from './adapters/xml/scan';
import { normalize } from './normalize';
import { IrDataSchema, type Recipe } from './ir';
import type { RawRecord } from './ir/raw';
import { buildCoverageReport, sha256Hex } from './report';

const fixturesDir = join(__dirname, '..', 'test', 'fixtures');
const cliPath = join(__dirname, 'cli.ts');

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), 'utf8');
}

/** Parse one fixture file into raw records plus its diagnostics. */
function parseFixture(name: string) {
  const diagnostics: Parameters<typeof buildCoverageReport>[0]['diagnostics'] = [];
  const result = parseGameDataFile(readFixture(name), {
    sourceFile: name,
    onDiagnostics: (diagnostic) => diagnostics.push(diagnostic),
  });
  return { ...result, diagnostics };
}

/** Parse + normalize one fixture file. */
function irOf(name: string) {
  const parsed = parseFixture(name);
  const normalized = normalize(parsed.records);
  return {
    records: parsed.records,
    families: parsed.families,
    controls: parsed.controls,
    irData: normalized.irData,
    missingFields: normalized.missingFields,
    diagnostics: [...parsed.diagnostics, ...normalized.diagnostics],
    coverage: buildCoverageReport({
      irData: normalized.irData,
      diagnostics: [...parsed.diagnostics, ...normalized.diagnostics],
      missingFields: normalized.missingFields,
      skippedFiles: [],
      inputDir: name,
      families: parsed.families,
      controls: parsed.controls,
    }),
  };
}

function recipeById(recipes: Recipe[], id: string): Recipe {
  const recipe = recipes.find((candidate) => candidate.id === id);
  if (recipe === undefined) throw new Error(`no recipe "${id}"`);
  return recipe;
}

function runCli(inputDir: string, outDir: string): void {
  // Run with bun explicitly: bun's extensionless TS resolution applies
  // (node would fail on './run'), and the shebang does not resolve reliably
  // from inside vitest workers.
  const result = spawnSync('bun', [cliPath, 'xml', inputDir, '--out', outDir], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`CLI exited with code ${result.status}: ${result.stderr}`);
  }
}

describe('Adapter A: confirmed <GameData> recipes', () => {
  it('maps a real-shaped file to typed IR (family, prefab, amounts, controls)', () => {
    const { irData } = irOf('recipes.xml');

    expect(irData.recipes.map((recipe) => recipe.id)).toEqual([
      'InventedSmithyRecipes/ItemFixtureIngotAlpha',
      'InventedSmithyRecipes/ItemFixtureIngotBeta',
      'InventedPrinterRecipes/ItemFixtureGadget',
    ]);

    const alpha = recipeById(irData.recipes, 'InventedSmithyRecipes/ItemFixtureIngotAlpha');
    expect(alpha.family).toBe('InventedSmithyRecipes');
    // Ingredient element name -> amount, with the exact source text kept ("`.5`").
    expect(alpha.inputs).toEqual([
      { materialName: 'MetalOre', quantity: { text: '.5', value: 0.5, unitStatus: 'unverified' } },
      { materialName: 'Slag', quantity: { text: '.25', value: 0.25, unitStatus: 'unverified' } },
    ]);
    expect(alpha.output).toEqual({
      prefabId: 'ItemFixtureIngotAlpha',
      quantity: { text: '0.25', value: 0.25, unitStatus: 'unverified' },
    });
    expect(alpha.time).toEqual({ text: '3', value: 3, unitStatus: 'unverified' });
    expect(alpha.energy).toEqual({ text: '120', value: 120, unitStatus: 'unverified' });
    expect(alpha.temperature).toEqual({
      start: { text: '900', value: 900, unitStatus: 'unverified' },
      stop: { text: '1500', value: 1500, unitStatus: 'unverified' },
    });
    expect(alpha.pressure).toEqual({
      start: { text: '20000', value: 20000, unitStatus: 'unverified' },
      stop: { text: '30000', value: 30000, unitStatus: 'unverified' },
    });
    // No display name in the XML: missing, never invented.
    expect(alpha.displayName).toBe('');
    expect(alpha.provenance).toEqual({
      sourceFile: 'recipes.xml',
      sourcePath: '/GameData/InventedSmithyRecipes/RecipeData[1]',
      qualityLevel: 'extracted-unverified',
    });
    // Per-field provenance names the element that supplied each value.
    expect(alpha.fieldProvenance?.['time']).toEqual({
      qualityLevel: 'extracted-unverified',
      sourcePath: '/GameData/InventedSmithyRecipes/RecipeData[1]/Recipe/Time',
    });
    expect(alpha.fieldProvenance?.['temperature.stop']?.sourcePath).toBe(
      '/GameData/InventedSmithyRecipes/RecipeData[1]/Recipe/Temperature/Stop',
    );
    expect(alpha.fieldProvenance?.['inputs[0].quantity']?.sourcePath).toBe(
      '/GameData/InventedSmithyRecipes/RecipeData[1]/Recipe/MetalOre',
    );
    expect(alpha.fieldProvenance?.['output.quantity']?.sourcePath).toBe(
      '/GameData/InventedSmithyRecipes/RecipeData[1]/Output',
    );
    expect(alpha.fieldProvenance?.['displayName']?.qualityLevel).toBe('missing');

    // An omitted <Output> is absent, not 1; the tier is carried verbatim.
    const beta = recipeById(irData.recipes, 'InventedSmithyRecipes/ItemFixtureIngotBeta');
    expect(beta.output).toEqual({ prefabId: 'ItemFixtureIngotBeta' });
    expect(beta.fieldProvenance?.['output.quantity']?.qualityLevel).toBe('missing');
    expect(beta.tier).toBe('TierTwo');
    expect(beta.fieldProvenance?.['tier']?.sourcePath).toBe(
      '/GameData/InventedSmithyRecipes/RecipeData[2]/RecipeTier',
    );

    // One file may declare several families; each keeps its own wrapper name.
    expect(recipeById(irData.recipes, 'InventedPrinterRecipes/ItemFixtureGadget').family).toBe(
      'InventedPrinterRecipes',
    );
  });

  it('reports unknown, unmapped, malformed, and incomplete controls instead of reading them as ingredients', () => {
    const { irData, diagnostics, coverage } = irOf('unknown-controls.xml');
    const codes = diagnostics.map((diagnostic) => diagnostic.code);

    // RequiredMix is a recognized control we cannot map yet; Enthalpy is unknown;
    // neither may appear as an ingredient.
    expect(codes).toContain('XML-CONTROL-UNMAPPED');
    expect(codes).toContain('XML-CONTROL-UNKNOWN');
    expect(codes).toContain('XML-CONTROL-BAD-VALUE');
    expect(codes).toContain('XML-CONTROL-INCOMPLETE');

    const alpha = recipeById(irData.recipes, 'InventedSmithyRecipes/ItemFixtureIngotAlpha');
    expect(alpha.inputs.map((input) => input.materialName)).toEqual(['MetalOre']);
    expect(alpha.time).toBeUndefined();

    const beta = recipeById(irData.recipes, 'InventedSmithyRecipes/ItemFixtureIngotBeta');
    expect(beta.inputs.map((input) => input.materialName)).toEqual(['MetalOre']);
    expect(beta.temperature?.start?.value).toBe(900);
    expect(beta.temperature?.stop).toBeUndefined();

    // The coverage report tallies how each control element was handled.
    const controls = Object.fromEntries(coverage.controls.map((control) => [control.element, control]));
    expect(controls['Time']).toEqual({ element: 'Time', mapping: 'scalar', occurrences: 1 });
    expect(controls['RequiredMix']).toEqual({ element: 'RequiredMix', mapping: 'unmapped', occurrences: 1 });
    expect(controls['Enthalpy']).toEqual({ element: 'Enthalpy', mapping: 'unknown', occurrences: 1 });
    expect(controls['Volatiles']).toBeUndefined();
  });

  it('reports non-recipe and unrecognized families in the coverage report', () => {
    const scan = scanInputDir({ inputDir: fixturesDir });
    const normalized = normalize(scan.records);
    const coverage = buildCoverageReport({
      irData: normalized.irData,
      diagnostics: [...scan.diagnostics, ...normalized.diagnostics],
      missingFields: normalized.missingFields,
      skippedFiles: scan.skippedFiles,
      inputDir: 'fixtures',
      families: scan.families,
      controls: scan.controls,
    });

    const families = Object.fromEntries(coverage.families.map((entry) => [entry.family, entry]));
    expect(families['Blueprint']).toMatchObject({
      status: 'unmapped',
      files: ['non-recipe.xml'],
      recipes: 0,
      // What the family actually holds, so a reader sees why it is not a recipe family.
      recordElements: ['Edge', 'Mesh'],
    });
    expect(families['Blueprint']?.reason).toMatch(/geometry/);
    expect(families['TraderContactData']?.status).toBe('unmapped');
    expect(families['InventedGrinderRecipes']).toMatchObject({
      status: 'unmapped',
      files: ['unrecognized-record.xml'],
      // The wrapper holds a record shape Adapter A does not map.
      recordElements: ['ProcessingData'],
      recipes: 0,
    });

    // Mapped families report their recipe counts.
    expect(families['InventedSmithyRecipes']?.status).toBe('mapped');
    expect(coverage.counts.byFamily['InventedSmithyRecipes']).toBeGreaterThan(0);
    expect(coverage.counts.byFamily['Blueprint']).toBeUndefined();

    // A wrapper that names recipes but yields no <RecipeData> is a warning; a
    // family Adapter A never mapped (geometry) is informational.
    const blueprint = scan.diagnostics.find(
      (diagnostic) => diagnostic.code === 'XML-FAMILY-UNMAPPED' && diagnostic.sourcePath === '/GameData/Blueprint',
    );
    expect(blueprint?.severity).toBe('info');
    expect(blueprint?.suggestedResolution).toMatch(/EXT-05/);
    const grinder = scan.diagnostics.find(
      (diagnostic) => diagnostic.code === 'XML-FAMILY-UNMAPPED' && diagnostic.sourcePath === '/GameData/InventedGrinderRecipes',
    );
    expect(grinder?.severity).toBe('warning');

    // Nothing is fabricated for unmapped families.
    expect(normalized.irData.recipes.every((recipe) => recipe.family.startsWith('Invented'))).toBe(true);
    expect(normalized.irData.items).toEqual([]);
  });

  it('collapses identical definitions and numbers alternates', () => {
    const { irData, diagnostics } = irOf('recipe-alternates.xml');

    expect(irData.recipes.map((recipe) => recipe.id)).toEqual([
      'InventedSmithyRecipes/ItemFixtureIngotAlpha',
      'InventedSmithyRecipes/ItemFixtureIngotAlpha#2',
      'InventedSmithyRecipes/ItemFixturePlate',
    ]);

    const codes = diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes).toContain('IR-RECIPE-ALTERNATE');
    expect(codes).toContain('IR-DUP-EXACT');

    // Alternates say so in their provenance notes.
    const alternate = recipeById(irData.recipes, 'InventedSmithyRecipes/ItemFixtureIngotAlpha#2');
    expect(alternate.provenance.notes).toMatch(/2 of 2 alternate definitions/);
    expect(alternate.inputs.map((input) => input.materialName)).toEqual(['IngotAlpha']);

    // `1` and `1.0` are the same amount: one recipe, first spelling kept.
    const plate = irData.recipes.filter((recipe) => recipe.output.prefabId === 'ItemFixturePlate');
    expect(plate).toHaveLength(1);
    expect(plate[0]?.inputs[0]?.quantity.text).toBe('1');
    expect(plate[0]?.provenance.qualityLevel).toBe('extracted-unverified');
  });

  it('reports missing required fields instead of defaulting them', () => {
    const { irData, diagnostics, coverage } = irOf('missing-fields.xml');
    const codes = diagnostics.map((diagnostic) => diagnostic.code);

    // The record without <PrefabName> has no identity: rejected with an error.
    expect(codes).toContain('XML-REC-MISSING-PREFAB');
    expect(codes).toContain('XML-RECIPE-MISSING');
    expect(codes).toContain('XML-OUTPUT-BAD-QUANTITY');
    expect(codes).toContain('XML-RECORD-UNKNOWN-ELEMENT');
    expect(irData.recipes.map((recipe) => recipe.output.prefabId)).toEqual([
      'ItemFixtureIngotBeta',
      'ItemFixtureIngotGamma',
      'ItemFixtureIngotDelta',
      'ItemFixtureIngotEpsilon',
    ]);

    // Every recipe lacks a display name (not in the XML), and none of these
    // declares an output amount: 4 + 4 structured entries.
    const missing = coverage.missingFields.map((entry) => entry.field);
    expect(missing.filter((field) => field === 'displayName')).toHaveLength(4);
    expect(missing.filter((field) => field === 'output.quantity')).toHaveLength(4);
    for (const entry of coverage.missingFields) {
      expect(entry.sourcePath).toMatch(/^\/GameData\/InventedSmithyRecipes\/RecipeData\[\d+\]/);
    }
  });

  it('keeps game ids verbatim', () => {
    const records = scanInputDir({ inputDir: fixturesDir }).records;
    const prefabs = records
      .filter((record) => record.type === 'recipe')
      .map((record) => (record.type === 'recipe' ? record.prefabId : ''));
    expect(prefabs).toContain('ItemFixtureIngotAlpha');
    expect(prefabs).toContain('ItemFixtureGadget');
  });

  it('accepts the BOM and CRLF line endings the real files use', () => {
    const text = readFixture('recipes.xml').replace(/\n/g, '\r\n');
    const plain = parseGameDataFile(text, { sourceFile: 'crlf.xml', onDiagnostics: () => {} });
    const withBom = parseGameDataFile(`\uFEFF${text}`, { sourceFile: 'crlf.xml', onDiagnostics: () => {} });
    expect(withBom.records).toEqual(plain.records);
    expect(plain.records).toHaveLength(3);
  });
});

describe('normalizer identity rules', () => {
  it('marks same-id items with different content as conflicting', () => {
    const raw: RawRecord[] = [
      {
        type: 'item',
        id: 'ItemFixtureWidget',
        displayName: 'First Version',
        provenance: { sourceFile: 'a.xml', sourcePath: '/a', qualityLevel: 'extracted-unverified' },
      },
      {
        type: 'item',
        id: 'ItemFixtureWidget',
        displayName: 'Second Version',
        provenance: { sourceFile: 'b.xml', sourcePath: '/b', qualityLevel: 'extracted-unverified' },
      },
    ];

    const { irData, diagnostics } = normalize(raw);
    const item = irData.items[0];
    expect(irData.items).toHaveLength(1);
    expect(item?.displayName).toBe('First Version');
    expect(item?.provenance.qualityLevel).toBe('conflicting');
    expect(item?.provenance.notes).toMatch(/a\.xml.*b\.xml/);
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['IR-DUP-CONFLICT']);
  });

  it('collapses identical item duplicates', () => {
    const raw: RawRecord[] = [
      {
        type: 'item',
        id: 'ItemFixtureWidget',
        displayName: 'Widget',
        provenance: { sourceFile: 'a.xml', sourcePath: '/a', qualityLevel: 'extracted-unverified' },
      },
      {
        type: 'item',
        id: 'ItemFixtureWidget',
        displayName: 'Widget',
        provenance: { sourceFile: 'b.xml', sourcePath: '/b', qualityLevel: 'extracted-unverified' },
      },
    ];

    const { irData, diagnostics } = normalize(raw);
    expect(irData.items).toHaveLength(1);
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['IR-DUP-EXACT']);
  });
});

describe('pipeline output', () => {
  it('malformed XML is reported and skipped, not fatal', () => {
    const scan = scanInputDir({ inputDir: fixturesDir });
    expect(scan.skippedFiles).toContain('malformed.xml');
    const malformed = scan.diagnostics.find((diagnostic) => diagnostic.code === 'XML-MALFORMED');
    expect(malformed?.sourceFile).toBe('malformed.xml');
    expect(malformed?.message).toMatch(/malformed XML/);
  });

  it('two runs produce byte-identical output and self-consistent hashes', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'ext01b-cli-'));
    try {
      const run1 = join(tmpDir, 'run1');
      const run2 = join(tmpDir, 'run2');
      runCli(fixturesDir, run1);
      runCli(fixturesDir, run2);

      for (const fileName of ['ir.json', 'coverage.json', 'manifest.json']) {
        expect(readFileSync(join(run1, fileName), 'utf8')).toEqual(readFileSync(join(run2, fileName), 'utf8'));
      }

      const irJson = readFileSync(join(run1, 'ir.json'), 'utf8');
      const manifest = JSON.parse(readFileSync(join(run1, 'manifest.json'), 'utf8')) as {
        irVersion: number;
        fileCount: number;
        files: Record<string, { sha256: string; bytes: number }>;
        ir: { sha256: string; bytes: number };
        coverage: { sha256: string; bytes: number };
      };
      expect(manifest.irVersion).toBe(2);
      expect(manifest.ir.sha256).toBe(sha256Hex(irJson));
      const xmlFiles = readdirSync(fixturesDir).filter((name) => name.endsWith('.xml'));
      expect(manifest.fileCount).toBe(xmlFiles.length);
      expect(Object.keys(manifest.files).sort()).toEqual(xmlFiles.sort());
      for (const [fileName, hash] of Object.entries(manifest.files)) {
        expect(hash.sha256).toBe(sha256Hex(readFileSync(join(fixturesDir, fileName))));
      }

      // The written IR is schema-valid (zod), so consumers can trust the shape.
      expect(() => IrDataSchema.parse(JSON.parse(irJson))).not.toThrow();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
