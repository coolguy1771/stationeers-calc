/*
 * EXT-05 geometry capture harness tests: the observation schema, the worksheet
 * generator, and the import/normalize step.
 *
 * Fixtures are SYNTHETIC: the document structure is real, every value is
 * invented (spec 6.3/6.8 — no game value may be committed). The tests exist to
 * pin the rules that keep the harness honest: unknown stays unknown, no default
 * is ever filled in, observations are never verified, and an incomplete
 * document reports gaps instead of failing silently.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalJson } from '../canonical';
import {
  buildWorksheet,
  emptySlot,
  MAX_OBSERVATIONS_FILE_BYTES,
  GeometryImportError,
  importObservations,
  normalizeObservations,
  ObservationDocumentSchema,
  parseObservationDocument,
  QUESTIONS,
  seedFromPrefabIds,
  worksheetJson,
  type ObservationDocument,
} from '.';

const fixturePath = join(__dirname, '..', '..', 'test', 'fixtures', 'geometry-observations.json');

function fixtureText(): string {
  return readFileSync(fixturePath, 'utf8');
}

/** Fixture as a mutable object, for the drift/refusal cases. */
function fixtureObject(): Record<string, unknown> {
  return JSON.parse(fixtureText()) as Record<string, unknown>;
}

function definitionsOf(document: Record<string, unknown>): Record<string, unknown>[] {
  return document['definitions'] as Record<string, unknown>[];
}

function codesOf(result: ReturnType<typeof importObservations>): string[] {
  return result.coverage.blockers.map((blocker) => blocker.code);
}

describe('observation document schema', () => {
  it('round-trips an empty worksheet through canonical JSON', () => {
    const worksheet = buildWorksheet(seedFromPrefabIds(['ItemFixtureGadget']));
    const parsed = ObservationDocumentSchema.parse(worksheet);
    const reparsed = ObservationDocumentSchema.parse(JSON.parse(canonicalJson(parsed)));
    expect(reparsed).toEqual(parsed);
  });

  it('rejects a recorded value that declares no confidence', () => {
    const document = fixtureObject();
    definitionsOf(document)[0]!['gridKind'] = { value: 'large' };
    try {
      importObservations(JSON.stringify(document));
      expect.unreachable('a value without confidence must be refused');
    } catch (error) {
      expect(error).toBeInstanceOf(GeometryImportError);
      const refusal = error as GeometryImportError;
      expect(refusal.code).toBe('schema');
      expect(refusal.issues.join('\n')).toMatch(/gridKind\.confidence: .*must declare confidence/);
    }
  });

  it('rejects a slot that claims confidence without a value', () => {
    const document = fixtureObject();
    definitionsOf(document)[0]!['internalVolumeM3'] = { value: null, confidence: 'observed' };
    try {
      importObservations(JSON.stringify(document));
      expect.unreachable('confidence without a value must be refused');
    } catch (error) {
      expect(error).toBeInstanceOf(GeometryImportError);
      expect((error as GeometryImportError).issues.join('\n')).toMatch(
        /internalVolumeM3\.confidence: confidence "observed"\/"inferred" requires a recorded value/,
      );
    }
  });
});

describe('worksheet generation', () => {
  const seed = seedFromPrefabIds([
    'ItemFixturePipeStraight',
    'ItemFixtureGadget',
    'ItemFixtureCable',
    'ItemFixtureGadget',
  ]);

  it('is deterministic and independent of seed order', () => {
    const forward = worksheetJson(buildWorksheet(seed));
    const shuffled = worksheetJson(
      buildWorksheet({
        ...seed,
        prefabIds: [...seed.prefabIds].reverse(),
        elementCandidates: [...seed.elementCandidates].reverse(),
      }),
    );
    expect(shuffled).toBe(forward);
  });

  it('sorts and de-duplicates prefab rows', () => {
    const worksheet = buildWorksheet(seed);
    expect(worksheet.definitions.map((row) => row.prefabId)).toEqual([
      'ItemFixtureCable',
      'ItemFixtureGadget',
      'ItemFixturePipeStraight',
    ]);
    expect(worksheet.worksheet?.prefabIds).toBe(3);
  });

  it('seeds pipe/cable element candidates without guessing their kind', () => {
    const worksheet = buildWorksheet(seed);
    expect(worksheet.elements.map((row) => row.definitionId)).toEqual([
      'ItemFixtureCable',
      'ItemFixturePipeStraight',
    ]);
    for (const row of worksheet.elements) {
      expect(row.kind).toBeNull();
      expect(row.volumeM3?.value).toBeNull();
      expect(row.notes).toMatch(/A prompt, not extracted geometry/);
    }
  });

  it('leaves every slot empty and carries the protocol question inline', () => {
    const worksheet = buildWorksheet(seed);
    const gadget = worksheet.definitions.find((row) => row.prefabId === 'ItemFixtureGadget');
    expect(gadget?.placeable).toEqual(emptySlot(QUESTIONS.placeable));
    expect(gadget?.gridKind?.value).toBeNull();
    expect(gadget?.gridKind?.confidence).toBe('unknown');
    expect(gadget?.footprint?.cells?.value).toBeNull();
    expect(gadget?.footprint?.cells?.question).toBe(QUESTIONS.footprintCells);
    expect(gadget?.ports?.question).toBe(QUESTIONS.ports);
    expect(worksheet.install.gameBuild).toBeNull();
    expect(worksheet.grid.largeCellSizeM?.value).toBeNull();
    expect(worksheet.protocol?.document).toBe('docs/plan/ext-05-probe.md');
    expect(worksheet.protocol?.steps.map((step) => step.id)).toContain('P6');
  });

  it('keeps a full-install-sized worksheet inside the input cap', () => {
    const ids = Array.from({ length: 2_000 }, (_, index) => `ItemFixtureDevice${index}`);
    const json = worksheetJson(buildWorksheet(seedFromPrefabIds(ids)));
    const bytes = new TextEncoder().encode(json).length;
    expect(bytes).toBeGreaterThan(1_000_000);
    expect(bytes).toBeLessThan(MAX_OBSERVATIONS_FILE_BYTES);
    expect(() => ObservationDocumentSchema.parse(JSON.parse(json))).not.toThrow();
  });
});

describe('import of the synthetic observations fixture', () => {
  const result = importObservations(fixtureText());

  it('normalizes definitions in id order, items triaged out of geometry', () => {
    expect(result.document.definitions.map((record) => record.id)).toEqual([
      'ItemFixtureAtmosphericsUnit',
      'ItemFixtureIngot',
      'ItemFixtureWall',
    ]);
    const ingot = result.document.definitions.find((record) => record.id === 'ItemFixtureIngot')!;
    expect(ingot.placeable).toBe(false);
    expect(ingot.sourceQuality).toBe('missing');
    expect(ingot.provenance).toEqual([]);
    expect(ingot.gaps).toEqual([]);
    expect(result.coverage.totals).toEqual({
      definitions: 3,
      placeable: 2,
      nonPlaceable: 1,
      unknownPlaceability: 0,
      geometryComplete: 0,
      elements: 3,
    });
  });

  it('emits footprint cells, orientations, and ports in contract field names', () => {
    const unit = result.document.definitions.find(
      (record) => record.id === 'ItemFixtureAtmosphericsUnit',
    )!;
    expect(unit.grid).toBe('large');
    expect(unit.footprint).toEqual([
      { local: { x: 0, y: 0, z: 0 }, solid: true },
      { local: { x: 1, y: 0, z: 0 }, solid: true },
    ]);
    expect(unit.footprintOriginNote).toMatch(/placement preview/);
    expect(unit.allowedOrientations).toEqual([
      { surface: 'floor', yaw: 0 },
      { surface: 'floor', yaw: 1 },
    ]);
    expect(unit.refusedOrientations).toEqual([{ surface: 'ceiling', yaw: 0 }]);
    expect(unit.internalVolumeM3).toBe(20);
    expect(unit.sealing).toEqual({
      isSealingStructure: true,
      behaviour: 'held pressure in the fixture test',
    });
    expect(unit.ports?.map((port) => port.id)).toEqual(['gas-in', 'power-in']);
    const gasIn = unit.ports!.find((port) => port.id === 'gas-in')!;
    expect(gasIn.medium).toBe('gas-pipe');
    expect(gasIn.localPosition).toEqual({ x: 0, y: 0, z: -1 });
    expect(gasIn.direction).toEqual({ x: 0, y: 0, z: -1 });
    expect(gasIn.mediation).toBe('device');
    expect(gasIn.categories).toEqual([]);
    expect(gasIn.sourceQuality).toBe('extracted-unverified');
    expect(gasIn.unknownFields).toEqual([]);
  });

  it('carries per-field provenance at extracted-unverified only', () => {
    const unit = result.document.definitions.find(
      (record) => record.id === 'ItemFixtureAtmosphericsUnit',
    )!;
    const footprint = unit.provenance.find((entry) => entry.field === 'footprint');
    expect(footprint).toEqual({
      field: 'footprint',
      sourceQuality: 'extracted-unverified',
      confidence: 'observed',
      method: 'boxed in with walls on every face',
      sourcePath: 'definitions[ItemFixtureAtmosphericsUnit].footprint.cells',
    });
    const mediation = unit.ports![0]!.provenance.find((entry) => entry.field === 'mediation');
    expect(mediation?.confidence).toBe('inferred');
    const qualities = new Set(
      result.document.definitions.flatMap((record) =>
        record.provenance.map((entry) => entry.sourceQuality),
      ),
    );
    expect([...qualities]).toEqual(['extracted-unverified']);
  });

  it('reports incomplete connectors instead of inventing their geometry', () => {
    const unit = result.document.definitions.find(
      (record) => record.id === 'ItemFixtureAtmosphericsUnit',
    )!;
    const powerIn = unit.ports!.find((port) => port.id === 'power-in')!;
    expect(powerIn.direction).toBeNull();
    expect(powerIn.sourceQuality).toBe('missing');
    expect(powerIn.unknownFields).toEqual(['direction', 'categories', 'capabilities']);
    expect(result.coverage.unknownPorts).toEqual([
      {
        definitionId: 'ItemFixtureAtmosphericsUnit',
        portId: 'power-in',
        missing: ['capabilities', 'categories', 'direction'],
      },
    ]);
    expect(unit.geometryComplete).toBe(false);
    expect(codesOf(result)).toContain('GEOM-PORT-INCOMPLETE');
  });

  it('keeps untested solidity unknown and flags it as a blocker', () => {
    const wall = result.document.definitions.find((record) => record.id === 'ItemFixtureWall')!;
    expect(wall.footprint).toEqual([{ local: { x: 0, y: 0, z: 0 }, solid: null }]);
    const solidityGap = wall.gaps.find((gap) => gap.field === 'footprint[0].solid');
    expect(solidityGap?.blocksBuildability).toBe(true);
    expect(solidityGap?.reason).toMatch(/assumed true/);
    expect(wall.ports).toEqual([]);
    expect(result.coverage.fields.footprint).toEqual({
      observed: 1,
      observedEmpty: 0,
      incomplete: 1,
      unknown: 0,
    });
    expect(result.coverage.fields.ports).toEqual({
      observed: 0,
      observedEmpty: 1,
      incomplete: 1,
      unknown: 0,
    });
    const codes = codesOf(result);
    expect(codes).toContain('GEOM-FOOTPRINT-SOLIDITY-UNKNOWN');
    expect(codes).not.toContain('GEOM-FOOTPRINT-UNKNOWN');
    expect(codes).not.toContain('GEOM-PORTS-UNKNOWN');
  });

  it('records grid facts and cross-checks the ratio against the sizes', () => {
    expect(result.document.grid.largeCellSizeM).toBe(1.5);
    expect(result.document.grid.smallCellSizeM).toBe(0.5);
    expect(result.document.grid.ratio).toBe(3);
    expect(result.coverage.grid.measured).toEqual([
      'largeCellSizeM',
      'smallCellSizeM',
      'ratio',
      'measurementMethod',
    ]);
    expect(result.coverage.grid.unknown).toEqual([]);
    expect(result.coverage.grid.inconsistent).toBeNull();
    const codes = codesOf(result);
    expect(codes).not.toContain('GEOM-GRID-UNKNOWN');
    expect(codes).not.toContain('GEOM-BUILD-UNKNOWN');
    expect(codes).not.toContain('GEOM-INSTALL-UNCONFIRMED');
  });

  it('carries element volumes through and keeps raw readings raw', () => {
    const straight = result.document.elements.find(
      (element) => element.definitionId === 'ItemFixturePipeStraight',
    )!;
    expect(straight.kind).toBe('pipe-segment');
    expect(straight.volume).toBe(0.5);
    expect(straight.sourceQuality).toBe('extracted-unverified');
    expect(straight.provenance.map((entry) => entry.field).sort()).toEqual([
      'kind',
      'measurement.method',
      'volume',
    ]);

    const bend = result.document.elements.find(
      (element) => element.definitionId === 'ItemFixturePipeBend',
    )!;
    expect(bend.volume).toBeNull();
    expect(bend.measurement.readings).toEqual([
      { quantity: 'pressure run 1', valueText: '101.3', unitText: 'kPa' },
      { quantity: 'temperature run 1', valueText: '293', unitText: 'K' },
    ]);
    expect(bend.gaps.find((gap) => gap.field === 'volume')?.reason).toMatch(/engine step/);

    const cross = result.document.elements.find(
      (element) => element.definitionId === 'ItemFixturePipeCross',
    )!;
    expect(cross.kind).toBeNull();
    expect(cross.gaps.find((gap) => gap.field === 'kind')?.blocksBuildability).toBe(true);
    expect(result.coverage.elements).toEqual({
      withVolume: 1,
      rawReadingsOnly: 1,
      unknown: 1,
      unclassified: 1,
    });
    const codes = codesOf(result);
    expect(codes).toContain('GEOM-ELEMENT-VOLUME-UNKNOWN');
    expect(codes).toContain('GEOM-VOLUME-RAW-ONLY');
    expect(codes).toContain('GEOM-ELEMENT-KIND-UNKNOWN');
  });

  it('produces a document that validates against the output schema', () => {
    expect(JSON.parse(result.geometryJson).kind).toBe('stationeers-geometry');
    expect(JSON.parse(result.coverageJson).documentVersion).toBe(1);
    expect(result.summary).toMatch(/0 geometry-complete/);
  });
});

describe('incomplete documents', () => {
  it('imports an untouched worksheet with every value unknown', () => {
    const worksheet = buildWorksheet(seedFromPrefabIds(['ItemFixtureGadget']));
    const result = importObservations(worksheetJson(worksheet));
    const record = result.document.definitions[0]!;

    expect(record.placeable).toBeNull();
    expect(record.grid).toBeNull();
    expect(record.footprint).toBeNull();
    expect(record.allowedOrientations).toBeNull();
    expect(record.ports).toBeNull();
    expect(record.internalVolumeM3).toBeNull();
    expect(record.sealing.isSealingStructure).toBeNull();
    expect(record.geometryComplete).toBe(false);
    expect(record.sourceQuality).toBe('missing');
    expect(record.provenance).toEqual([]);
    expect(record.gaps.map((gap) => gap.field)).toEqual(
      expect.arrayContaining([
        'grid',
        'allowedOrientations',
        'footprint',
        'ports',
        'internalVolumeM3',
        'sealing.isSealingStructure',
      ]),
    );

    expect(result.document.grid.largeCellSizeM).toBeNull();
    expect(result.document.grid.ratio).toBeNull();
    expect(result.document.install.vanilla).toBeNull();
    expect(codesOf(result)).toEqual(
      expect.arrayContaining([
        'GEOM-INSTALL-UNCONFIRMED',
        'GEOM-BUILD-UNKNOWN',
        'GEOM-GRID-UNKNOWN',
        'GEOM-PLACEABILITY-UNKNOWN',
        'GEOM-FOOTPRINT-UNKNOWN',
        'GEOM-ORIENTATIONS-UNKNOWN',
        'GEOM-PORTS-UNKNOWN',
      ]),
    );
  });

  it('reports gaps for a row that was only triaged', () => {
    const document = fixtureObject();
    definitionsOf(document)[0] = {
      prefabId: 'ItemFixtureAtmosphericsUnit',
      placeable: { value: true, confidence: 'observed' },
    };
    const result = importObservations(JSON.stringify(document));
    const record = result.document.definitions.find(
      (candidate) => candidate.id === 'ItemFixtureAtmosphericsUnit',
    )!;
    expect(record.placeable).toBe(true);
    expect(record.gaps.length).toBeGreaterThan(3);
    expect(record.gaps.map((gap) => gap.field)).toContain('footprint');
    expect(result.coverage.totals.geometryComplete).toBe(0);
  });

  it('imports a document with no definitions at all', () => {
    const document = fixtureObject();
    document['definitions'] = [];
    document['elements'] = [];
    const result = importObservations(JSON.stringify(document));
    expect(result.document.definitions).toEqual([]);
    expect(codesOf(result)).toContain('GEOM-NO-DEFINITIONS');
  });
});

describe('import refusals', () => {
  it('refuses a confidence of "verified" and names the path', () => {
    const document = fixtureObject();
    definitionsOf(document)[0]!['gridKind'] = {
      value: 'large',
      confidence: 'verified',
    };
    try {
      importObservations(JSON.stringify(document));
      expect.unreachable('a verified claim must be refused');
    } catch (error) {
      expect(error).toBeInstanceOf(GeometryImportError);
      const refusal = error as GeometryImportError;
      expect(refusal.code).toBe('claims-verification');
      expect(refusal.message).toMatch(/claims verified data/);
      expect(refusal.issues).toContain('definitions[0].gridKind.confidence: "verified"');
    }
  });

  it('refuses an extracted-and-validated quality claim', () => {
    const document = fixtureObject();
    document['sourceQuality'] = 'extracted-and-validated';
    expect(() => importObservations(JSON.stringify(document))).toThrow(
      /claims verified data/,
    );
  });

  it('refuses duplicate prefab rows with an actionable message', () => {
    const document = fixtureObject();
    definitionsOf(document).push(definitionsOf(document)[0]!);
    try {
      importObservations(JSON.stringify(document));
      expect.unreachable('duplicate rows must be refused');
    } catch (error) {
      expect(error).toBeInstanceOf(GeometryImportError);
      const refusal = error as GeometryImportError;
      expect(refusal.code).toBe('duplicate-id');
      expect(refusal.message).toMatch(/merge the rows/);
    }
  });

  it('refuses a future document version rather than coercing it', () => {
    const document = fixtureObject();
    document['documentVersion'] = 2;
    expect(() => importObservations(JSON.stringify(document))).toThrow(
      /newer than this build supports/,
    );
  });

  it('refuses a document that is not an observation worksheet', () => {
    expect(() => importObservations(JSON.stringify({ kind: 'stationeers-pack' }))).toThrow(
      /expected "stationeers-geometry-observations"/,
    );
    expect(() => importObservations('not json')).toThrow(/not valid JSON/);
  });
});

describe('grid cross-checks', () => {
  it('flags a ratio that contradicts the measured sizes', () => {
    const document = fixtureObject();
    (document['grid'] as Record<string, Record<string, unknown>>)['ratio'] = {
      value: 4,
      confidence: 'observed',
    };
    const result = importObservations(JSON.stringify(document));
    expect(result.coverage.grid.inconsistent).toMatch(/= 3\.0000 small cells per large cell, but ratio was recorded as 4/);
    expect(codesOf(result)).toContain('GEOM-GRID-RATIO-INCONSISTENT');
  });

  it('blocks a capture that is not from a clean vanilla install', () => {
    const document = fixtureObject();
    (document['install'] as Record<string, unknown>)['vanilla'] = {
      value: false,
      confidence: 'observed',
    };
    const result = importObservations(JSON.stringify(document));
    expect(result.document.install.vanilla).toBe(false);
    expect(codesOf(result)).toContain('GEOM-NOT-VANILLA');
    expect(codesOf(result)).not.toContain('GEOM-INSTALL-UNCONFIRMED');
  });
});

describe('row-order independence', () => {
  it('normalizes the same records regardless of worksheet row order', () => {
    const observations = parseObservationDocument(fixtureText());
    const reversed: ObservationDocument = {
      ...observations,
      definitions: [...observations.definitions].reverse(),
      elements: [...observations.elements].reverse(),
    };
    const first = normalizeObservations(observations);
    const second = normalizeObservations(reversed);
    expect(canonicalJson(second.document.definitions)).toBe(
      canonicalJson(first.document.definitions),
    );
    expect(canonicalJson(second.document.elements)).toBe(
      canonicalJson(first.document.elements),
    );
    const withoutDigest = (coverage: typeof first.coverage) => ({
      ...coverage,
      generatedFrom: null,
    });
    expect(canonicalJson(withoutDigest(second.coverage))).toBe(
      canonicalJson(withoutDigest(first.coverage)),
    );
  });
});
