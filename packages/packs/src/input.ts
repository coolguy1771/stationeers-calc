/**
 * The extraction-input contract the pack builder accepts (spec 6.2, 6.4).
 *
 * These schemas mirror the outputs of `tools/extractor` — IR v2, the coverage
 * report, and the manifest fragment — as they are written to `ir.json`,
 * `coverage.json`, and `manifest.json`. The runtime package cannot import the
 * build-time tool (a browser bundle must not pull in an XML parser), so the
 * contract is restated here, and `SUPPORTED_IR_VERSION` pins which extractor
 * output this pack schema knows how to pack. A bump on either side requires a
 * matching change here; an unknown IR version is rejected, never coerced
 * (spec 9.2, 9.4).
 *
 * Every field is validated before the builder reads a single value: pack inputs
 * can come from a user's own install (`stationeers-extract pack`) and are
 * therefore untrusted (spec 6.7, 9.4).
 */
import { z } from 'zod';
import { DataQualitySchema, MAX_DISPLAY_NAME_LENGTH, MAX_ID_LENGTH } from '@stationeers/domain';
import {
  MAX_COVERAGE_CONTROLS,
  MAX_COVERAGE_FAMILIES,
  MAX_INPUTS_PER_RECIPE,
  MAX_IR_WORLD_REFS,
  MAX_NOTE_LENGTH,
  MAX_NUMBER_TEXT_LENGTH,
  MAX_REASON_LENGTH,
  MAX_PACK_ITEMS,
  MAX_PACK_RECIPES,
  MAX_SCHEMA_VERSION_LABEL,
  MAX_SOURCE_FILES,
  MAX_SOURCE_PATH_LENGTH,
  MAX_UNIT_LENGTH,
} from './limits';
import {
  GameBranchSchema,
  GameBuildSchema,
  IsoUtcSchema,
  Sha256HexSchema,
  ToolVersionsSchema,
} from './schema';

/** The IR version this pack schema can pack. Bump with the pack schema. */
export const SUPPORTED_IR_VERSION = 2;

/** Numbers and their unit status, as the extractor emits them. */
export const SourceNumberInputSchema = z
  .object({
    text: z.string().min(1).max(MAX_NUMBER_TEXT_LENGTH),
    value: z.number().finite(),
    unitStatus: z.enum(['unverified', 'verified']),
    unit: z.string().min(1).max(MAX_UNIT_LENGTH).optional(),
  })
  .strict();

export const EnvelopeInputSchema = z
  .object({
    start: SourceNumberInputSchema.optional(),
    stop: SourceNumberInputSchema.optional(),
  })
  .strict();

export const IrProvenanceInputSchema = z
  .object({
    sourceFile: z.string().min(1).max(MAX_SOURCE_PATH_LENGTH),
    sourcePath: z.string().min(1).max(MAX_SOURCE_PATH_LENGTH),
    qualityLevel: DataQualitySchema,
    notes: z.string().max(MAX_NOTE_LENGTH).optional(),
  })
  .strict();

export const FieldProvenanceInputSchema = z
  .object({
    qualityLevel: DataQualitySchema,
    notes: z.string().max(MAX_NOTE_LENGTH).optional(),
    sourcePath: z.string().min(1).max(MAX_SOURCE_PATH_LENGTH).optional(),
  })
  .strict();

const FieldProvenanceMapInputSchema = z
  .record(z.string().min(1).max(MAX_NOTE_LENGTH), FieldProvenanceInputSchema)
  .optional();

export const IrRecipeInputSchema = z
  .object({
    id: z.string().min(1).max(MAX_ID_LENGTH),
    displayName: z.string().max(MAX_DISPLAY_NAME_LENGTH),
    family: z.string().min(1).max(MAX_ID_LENGTH),
    output: z
      .object({
        prefabId: z.string().min(1).max(MAX_ID_LENGTH),
        quantity: SourceNumberInputSchema.optional(),
      })
      .strict(),
    inputs: z
      .array(
        z
          .object({
            materialName: z.string().min(1).max(MAX_ID_LENGTH),
            quantity: SourceNumberInputSchema,
          })
          .strict(),
      )
      .max(MAX_INPUTS_PER_RECIPE),
    time: SourceNumberInputSchema.optional(),
    energy: SourceNumberInputSchema.optional(),
    temperature: EnvelopeInputSchema.optional(),
    pressure: EnvelopeInputSchema.optional(),
    tier: z.string().min(1).max(MAX_ID_LENGTH).optional(),
    provenance: IrProvenanceInputSchema,
    fieldProvenance: FieldProvenanceMapInputSchema,
  })
  .strict();
export type IrRecipeInput = z.infer<typeof IrRecipeInputSchema>;

export const IrItemInputSchema = z
  .object({
    id: z.string().min(1).max(MAX_ID_LENGTH),
    displayName: z.string().max(MAX_DISPLAY_NAME_LENGTH),
    category: z.string().min(1).max(MAX_ID_LENGTH).optional(),
    provenance: IrProvenanceInputSchema,
    fieldProvenance: FieldProvenanceMapInputSchema,
  })
  .strict();
export type IrItemInput = z.infer<typeof IrItemInputSchema>;

export const IrWorldRefInputSchema = z
  .object({
    id: z.string().min(1).max(MAX_ID_LENGTH),
    kind: z.string().min(1).max(MAX_ID_LENGTH),
    values: z.array(z.string().max(MAX_SOURCE_PATH_LENGTH)).max(MAX_INPUTS_PER_RECIPE),
    provenance: IrProvenanceInputSchema,
    fieldProvenance: FieldProvenanceMapInputSchema,
  })
  .strict();

export const IrInputSchema = z
  .object({
    /** Checked explicitly before parsing, so the error names the version. */
    irVersion: z.number().int().positive(),
    recipes: z.array(IrRecipeInputSchema).max(MAX_PACK_RECIPES),
    items: z.array(IrItemInputSchema).max(MAX_PACK_ITEMS),
    worldRefs: z.array(IrWorldRefInputSchema).max(MAX_IR_WORLD_REFS),
  })
  .strict();
export type IrInput = z.infer<typeof IrInputSchema>;

/** A structured missing field in the extractor's coverage report. */
export const MissingFieldInputSchema = z
  .object({
    entityType: z.enum(['recipe', 'item', 'worldref']),
    entityId: z.string().min(1).max(MAX_ID_LENGTH),
    field: z.string().min(1).max(MAX_NOTE_LENGTH),
    sourceFile: z.string().min(1).max(MAX_SOURCE_PATH_LENGTH),
    sourcePath: z.string().min(1).max(MAX_SOURCE_PATH_LENGTH),
  })
  .strict();

/** A pipeline diagnostic (spec 8); only code/severity are needed for the tally. */
export const DiagnosticInputSchema = z
  .object({
    code: z.string().min(1).max(MAX_SCHEMA_VERSION_LABEL),
    severity: z.enum(['error', 'warning', 'info']),
    message: z.string().max(MAX_NOTE_LENGTH * 4),
    entityIds: z.array(z.string().max(MAX_ID_LENGTH)).max(64).optional(),
    sourceRule: z.string().max(MAX_SCHEMA_VERSION_LABEL).optional(),
    sourceFile: z.string().max(MAX_SOURCE_PATH_LENGTH).optional(),
    sourcePath: z.string().max(MAX_SOURCE_PATH_LENGTH).optional(),
    suggestedResolution: z.string().max(MAX_NOTE_LENGTH * 2).optional(),
  })
  .loose();

export const FamilyInputSchema = z
  .object({
    family: z.string().min(1).max(MAX_ID_LENGTH),
    status: z.enum(['mapped', 'unmapped']),
    files: z.array(z.string().min(1).max(MAX_SOURCE_PATH_LENGTH)).max(MAX_SOURCE_FILES),
    recordElements: z.array(z.string().min(1).max(MAX_ID_LENGTH)).max(64),
    recipes: z.number().int().min(0),
    reason: z.string().max(MAX_REASON_LENGTH).optional(),
  })
  .strict();

export const ControlInputSchema = z
  .object({
    element: z.string().min(1).max(MAX_ID_LENGTH),
    mapping: z.enum(['scalar', 'envelope', 'unmapped', 'unknown']),
    occurrences: z.number().int().min(0),
  })
  .strict();

/**
 * The extractor's coverage report (`coverage.json`). `counts` is accepted (it is
 * what the extractor measured) but the pack recomputes counts from its own
 * payload — coverage may not claim something the payload does not hold.
 */
export const CoverageInputSchema = z
  .object({
    counts: z
      .object({
        byType: z.record(z.string().max(MAX_ID_LENGTH), z.number().int().min(0)),
        byQualityLevel: z.record(z.string().max(MAX_ID_LENGTH), z.number().int().min(0)),
        byFieldQualityLevel: z.record(z.string().max(MAX_ID_LENGTH), z.number().int().min(0)),
        byFamily: z.record(z.string().max(MAX_ID_LENGTH), z.number().int().min(0)),
      })
      .loose(),
    families: z.array(FamilyInputSchema).max(MAX_COVERAGE_FAMILIES),
    controls: z.array(ControlInputSchema).max(MAX_COVERAGE_CONTROLS),
    missingFields: z.array(MissingFieldInputSchema).max(100_000),
    diagnostics: z.array(DiagnosticInputSchema).max(100_000),
    skippedFiles: z.array(z.string().max(MAX_SOURCE_PATH_LENGTH)).max(MAX_SOURCE_FILES),
    inputDir: z.string().min(1).max(MAX_SOURCE_PATH_LENGTH),
  })
  .loose();
export type CoverageInput = z.infer<typeof CoverageInputSchema>;

/**
 * The extractor's manifest fragment (`manifest.json`): per-file SHA-256s of the
 * install data plus digests of the IR and coverage documents.
 */
export const ManifestFragmentInputSchema = z
  .object({
    irVersion: z.number().int().positive(),
    generatedFrom: z.string().min(1).max(MAX_SOURCE_PATH_LENGTH),
    fileCount: z.number().int().min(0),
    files: z.record(
      z.string().min(1).max(MAX_SOURCE_PATH_LENGTH),
      z.object({ sha256: Sha256HexSchema, bytes: z.number().int().min(0) }).strict(),
    ),
    ir: z.object({ sha256: Sha256HexSchema, bytes: z.number().int().min(0) }).strict(),
    coverage: z.object({ sha256: Sha256HexSchema, bytes: z.number().int().min(0) }).strict(),
  })
  .strict();
export type ManifestFragmentInput = z.infer<typeof ManifestFragmentInputSchema>;

/**
 * Install-supplied provenance for a pack (spec 6.4). The game data itself does
 * not state the build number or branch: they are facts about the installation
 * the user extracted from, so the builder takes them as input and records them.
 */
export const PackBuildMetadataSchema = z
  .object({
    gameBuild: GameBuildSchema,
    gameBranch: GameBranchSchema,
    channel: z.enum(['published', 'user-generated']),
    extractionDate: IsoUtcSchema,
    toolVersions: ToolVersionsSchema,
    normalizationVersion: z.string().min(1).max(MAX_SCHEMA_VERSION_LABEL),
    behaviorModelCompatibility: z
      .object({
        status: z.enum(['not-declared', 'compatible', 'incompatible']),
        behaviorEngineVersion: z.string().min(1).max(MAX_SCHEMA_VERSION_LABEL).optional(),
        notes: z.string().max(MAX_NOTE_LENGTH).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type PackBuildMetadata = z.infer<typeof PackBuildMetadataSchema>;

/**
 * Display names supplied by Adapter B (Stationpedia, EXT-02), keyed by entity
 * id. Absent names stay `missing`; nothing is derived from an id.
 */
export const DisplayNamesInputSchema = z.record(
  z.string().min(1).max(MAX_ID_LENGTH),
  z.string().min(1).max(MAX_DISPLAY_NAME_LENGTH),
);
export type DisplayNamesInput = z.infer<typeof DisplayNamesInputSchema>;
