/**
 * Pack manifest schema (spec 6.4, 6.7, 9.4): one versioned, self-describing
 * data pack — manifest + payload.
 *
 * Vocabulary rules baked in here:
 *
 * - Every extracted *property* carries a §6.5 quality level in its entity's
 *   `properties` map (`missing` included), so a consumer can ask "is this one
 *   value validated?" without guessing from the entity average.
 * - `extracted-and-validated` requires an approval record. There is no other
 *   path to that level: the builder only writes it from an explicit, audited
 *   promotion input (see `build.ts`), and the loader rejects a pack that claims
 *   it without one.
 * - Identity (pack id, counts, content hash) is derived, never caller-chosen.
 */
import { z } from 'zod';
import {
  DataQualitySchema,
  DeviceDefinitionSchema,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_ID_LENGTH,
  PackChannelSchema,
  displayString,
} from '@stationeers/domain';
import {
  MAX_APPROVER_LENGTH,
  MAX_COVERAGE_CONTROLS,
  MAX_COVERAGE_DIAGNOSTIC_ENTRIES,
  MAX_COVERAGE_FAMILIES,
  MAX_COVERAGE_MISSING_FIELD_ENTRIES,
  MAX_COVERAGE_UNPACKED_ENTRIES,
  MAX_INPUTS_PER_RECIPE,
  MAX_NOTE_LENGTH,
  MAX_NUMBER_TEXT_LENGTH,
  MAX_PACK_DEVICES,
  MAX_PACK_ITEMS,
  MAX_PACK_RECIPES,
  MAX_PROPERTIES_PER_ENTITY,
  MAX_PROPERTY_PATH_LENGTH,
  MAX_REASON_LENGTH,
  MAX_SCHEMA_VERSION_LABEL,
  MAX_SOURCE_FILES,
  MAX_SOURCE_PATH_LENGTH,
  MAX_UNIT_LENGTH,
} from './limits';

/** Current pack schema version. Bump with a documented migration on any change. */
export const PACK_SCHEMA_VERSION = 1;

/**
 * Bounded record (spec 9.4: bound nesting and key counts). Mirrors the domain
 * helper; `packages/packs` cannot import it because it is not exported there.
 */
function boundedRecord<K extends z.ZodType<string>, V extends z.ZodType<unknown>>(key: K, value: V, max: number) {
  return z.record(key, value).superRefine((obj, ctx) => {
    if (Object.keys(obj).length > max) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Record exceeds ${max} keys`, path: [] });
    }
  });
}

/** Game branch a pack was extracted from (spec 6.4). */
export const GameBranchSchema = z.enum(['stable', 'beta']);
export type GameBranch = z.infer<typeof GameBranchSchema>;

/**
 * Full numeric game build, e.g. `0.2.6428.27798` — never a marketing version
 * like `v0.2` (spec 6.4).
 */
export const GameBuildSchema = z
  .string()
  .min(3)
  .max(MAX_SCHEMA_VERSION_LABEL)
  .regex(/^\d+(?:\.\d+){2,4}$/, 'gameBuild must be the full numeric build number (e.g. "0.2.6428.27798")');

/** ISO-8601 timestamp in UTC, fixed-width so packs stay comparable. */
export const IsoUtcSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/, 'expected an ISO-8601 UTC timestamp (…Z)');

/** Lowercase hex SHA-256 digest. */
export const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/, 'expected a lowercase hex SHA-256 digest');

/** A digest of a source file, the IR, or the coverage report. */
export const DigestSchema = z
  .object({
    sha256: Sha256HexSchema,
    bytes: z.number().int().min(0),
  })
  .strict();
export type Digest = z.infer<typeof DigestSchema>;

/**
 * A number carried from the source (mirrors the extractor IR's `SourceNumber`).
 * `unitStatus` is orthogonal to the §6.5 quality level: a quantity whose unit
 * semantics are unverified can never back exact arithmetic, whatever its
 * property quality says.
 */
export const PackedNumberSchema = z
  .object({
    /** Exact decimal text as it appears in the game file, e.g. ".5". */
    text: z.string().min(1).max(MAX_NUMBER_TEXT_LENGTH),
    /** Parsed value of `text`. */
    value: z.number().finite(),
    unitStatus: z.enum(['unverified', 'verified']),
    /** Unit symbol; present only once the unit semantics are verified. */
    unit: z.string().min(1).max(MAX_UNIT_LENGTH).optional(),
  })
  .strict();
export type PackedNumber = z.infer<typeof PackedNumberSchema>;

/** A two-bound condition envelope; each bound optional. */
export const PackedEnvelopeSchema = z
  .object({
    start: PackedNumberSchema.optional(),
    stop: PackedNumberSchema.optional(),
  })
  .strict();
export type PackedEnvelope = z.infer<typeof PackedEnvelopeSchema>;

/** Where an entity's values came from (spec 6.5). */
export const PackedProvenanceSchema = z
  .object({
    sourceFile: z.string().min(1).max(MAX_SOURCE_PATH_LENGTH),
    sourcePath: z.string().min(1).max(MAX_SOURCE_PATH_LENGTH),
    quality: DataQualitySchema,
    notes: z.string().max(MAX_NOTE_LENGTH).optional(),
  })
  .strict();
export type PackedProvenance = z.infer<typeof PackedProvenanceSchema>;

/**
 * Audit record of a promotion to `extracted-and-validated` (spec 6.5, 6.6).
 * Every validated property names who approved it, when, and against what
 * evidence (a fixture id, a review thread, a cross-check).
 */
export const ApprovalSchema = z
  .object({
    approvedBy: z.string().min(1).max(MAX_APPROVER_LENGTH),
    approvedAt: IsoUtcSchema,
    reference: z.string().min(1).max(MAX_NOTE_LENGTH),
    /** Unit the approval established, for properties that are quantities. */
    unit: z.string().min(1).max(MAX_UNIT_LENGTH).optional(),
  })
  .strict();
export type Approval = z.infer<typeof ApprovalSchema>;

/**
 * Quality of one property. `approval` exists exactly when the property is
 * `extracted-and-validated` — the schema enforces both directions so no pack
 * can claim validation without a record, or keep a record for a stale level.
 */
export const PropertyQualitySchema = z
  .object({
    quality: DataQualitySchema,
    sourceFile: z.string().min(1).max(MAX_SOURCE_PATH_LENGTH).optional(),
    sourcePath: z.string().min(1).max(MAX_SOURCE_PATH_LENGTH).optional(),
    notes: z.string().max(MAX_NOTE_LENGTH).optional(),
    approval: ApprovalSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.quality === 'extracted-and-validated' && value.approval === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'extracted-and-validated requires an approval record (spec 6.5)',
        path: ['approval'],
      });
    }
    if (value.quality !== 'extracted-and-validated' && value.approval !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `approval recorded for a property at quality "${value.quality}"`,
        path: ['approval'],
      });
    }
  });
export type PropertyQuality = z.infer<typeof PropertyQualitySchema>;

/** Per-property quality map; keys are the property paths `quality.ts` resolves. */
export const PropertyQualityRecordSchema = boundedRecord(
  z.string().min(1).max(MAX_PROPERTY_PATH_LENGTH),
  PropertyQualitySchema,
  MAX_PROPERTIES_PER_ENTITY,
);
export type PropertyQualityRecord = z.infer<typeof PropertyQualityRecordSchema>;

/** One recipe: the output prefab, its inputs, and the machine-settings controls. */
export const PackedRecipeSchema = z
  .object({
    id: z.string().min(1).max(MAX_ID_LENGTH),
    family: z.string().min(1).max(MAX_ID_LENGTH),
    displayName: displayString(MAX_DISPLAY_NAME_LENGTH),
    output: z
      .object({
        prefabId: z.string().min(1).max(MAX_ID_LENGTH),
        /** Absent when the source does not declare an amount — never 1. */
        quantity: PackedNumberSchema.optional(),
      })
      .strict(),
    inputs: z
      .array(
        z
          .object({
            materialName: z.string().min(1).max(MAX_ID_LENGTH),
            quantity: PackedNumberSchema,
          })
          .strict(),
      )
      .max(MAX_INPUTS_PER_RECIPE),
    time: PackedNumberSchema.optional(),
    energy: PackedNumberSchema.optional(),
    temperature: PackedEnvelopeSchema.optional(),
    pressure: PackedEnvelopeSchema.optional(),
    /** `<RecipeTier>` verbatim, e.g. "TierTwo"; semantics unverified. */
    tier: z.string().min(1).max(MAX_ID_LENGTH).optional(),
    provenance: PackedProvenanceSchema,
    properties: PropertyQualityRecordSchema,
  })
  .strict();
export type PackedRecipe = z.infer<typeof PackedRecipeSchema>;

/** One item defined by the game data (ids only in Adapter A; names from B). */
export const PackedItemSchema = z
  .object({
    id: z.string().min(1).max(MAX_ID_LENGTH),
    displayName: displayString(MAX_DISPLAY_NAME_LENGTH),
    category: z.string().min(1).max(MAX_ID_LENGTH).optional(),
    provenance: PackedProvenanceSchema,
    properties: PropertyQualityRecordSchema,
  })
  .strict();
export type PackedItem = z.infer<typeof PackedItemSchema>;

/**
 * One device definition (domain contract, spec 4.1) plus the per-property
 * quality map. Empty until Adapter B/C extract devices.
 */
export const PackedDeviceSchema = z
  .object({
    id: z.string().min(1).max(MAX_ID_LENGTH),
    definition: DeviceDefinitionSchema,
    properties: PropertyQualityRecordSchema,
  })
  .strict();
export type PackedDevice = z.infer<typeof PackedDeviceSchema>;

/** Payload: the extracted entities themselves. */
export const PackPayloadSchema = z
  .object({
    recipes: z.array(PackedRecipeSchema).max(MAX_PACK_RECIPES),
    items: z.array(PackedItemSchema).max(MAX_PACK_ITEMS),
    devices: z.array(PackedDeviceSchema).max(MAX_PACK_DEVICES),
  })
  .strict();
export type PackPayload = z.infer<typeof PackPayloadSchema>;

/** Entity counts recorded in the manifest (must match the payload). */
export const EntityCountsSchema = z
  .object({
    recipes: z.number().int().min(0),
    items: z.number().int().min(0),
    devices: z.number().int().min(0),
  })
  .strict();
export type EntityCounts = z.infer<typeof EntityCountsSchema>;

/** Tool versions that produced the pack (spec 6.4). */
export const ToolVersionsSchema = z
  .object({
    /** Extractor release, e.g. "0.0.1". */
    extractor: z.string().min(1).max(MAX_SCHEMA_VERSION_LABEL),
    /** IR version the extractor emitted, e.g. 2. */
    ir: z.number().int().positive(),
  })
  .strict();
export type ToolVersions = z.infer<typeof ToolVersionsSchema>;

/**
 * Result of the pack author's declared model compatibility (spec 6.4). Defaults
 * to `not-declared`: nothing claims compatibility that a check did not establish.
 */
export const BehaviorModelCompatibilitySchema = z
  .object({
    status: z.enum(['not-declared', 'compatible', 'incompatible']),
    behaviorEngineVersion: z.string().min(1).max(MAX_SCHEMA_VERSION_LABEL).optional(),
    notes: z.string().max(MAX_NOTE_LENGTH).optional(),
  })
  .strict();
export type BehaviorModelCompatibility = z.infer<typeof BehaviorModelCompatibilitySchema>;

/** Per-file source digests from the extractor manifest (spec 6.4). */
export const SourceDigestsSchema = z
  .object({
    files: boundedRecord(z.string().min(1).max(MAX_SOURCE_PATH_LENGTH), DigestSchema, MAX_SOURCE_FILES),
    /** Digest of the IR document the pack was built from. */
    ir: DigestSchema,
    /** Digest of the coverage report the pack was built from. */
    coverage: DigestSchema,
  })
  .strict();
export type SourceDigests = z.infer<typeof SourceDigestsSchema>;

/**
 * Joins the game data cannot supply on its own (spec 6.2, 6.3). Naming them in
 * every pack keeps the gap visible instead of letting consumers assume a
 * material name is a prefab id or a family is a machine.
 */
export const JOIN_NAMES = ['material-to-prefab', 'family-to-machine-prefab', 'display-name'] as const;
export const JoinNameSchema = z.enum(JOIN_NAMES);
export type JoinName = z.infer<typeof JoinNameSchema>;

export const JoinStatusSchema = z
  .object({
    join: JoinNameSchema,
    status: z.enum(['missing', 'supplied']),
    /** Which adapter or input is expected to supply the join. */
    suppliedBy: z.string().min(1).max(MAX_SCHEMA_VERSION_LABEL).optional(),
    /** Why the join is missing, or what supplied it. */
    detail: z.string().min(1).max(MAX_REASON_LENGTH),
  })
  .strict();
export type JoinStatus = z.infer<typeof JoinStatusSchema>;

/** One `GameData` family in the extractor's coverage report. */
export const FamilyCoverageSchema = z
  .object({
    family: z.string().min(1).max(MAX_ID_LENGTH),
    status: z.enum(['mapped', 'unmapped']),
    files: z.array(z.string().min(1).max(MAX_SOURCE_PATH_LENGTH)).max(MAX_SOURCE_FILES),
    recipes: z.number().int().min(0),
    reason: z.string().max(MAX_REASON_LENGTH).optional(),
  })
  .strict();
export type FamilyCoverage = z.infer<typeof FamilyCoverageSchema>;

/** One non-ingredient `<Recipe>` child and how the extractor handled it. */
export const ControlCoverageSchema = z
  .object({
    element: z.string().min(1).max(MAX_ID_LENGTH),
    mapping: z.enum(['scalar', 'envelope', 'unmapped', 'unknown']),
    occurrences: z.number().int().min(0),
  })
  .strict();
export type ControlCoverage = z.infer<typeof ControlCoverageSchema>;

/** A value the source does not supply, recorded instead of defaulted (4.7, 7.6). */
export const MissingFieldSchema = z
  .object({
    entityType: z.enum(['recipe', 'item', 'worldref']),
    entityId: z.string().min(1).max(MAX_ID_LENGTH),
    field: z.string().min(1).max(MAX_PROPERTY_PATH_LENGTH),
    sourceFile: z.string().min(1).max(MAX_SOURCE_PATH_LENGTH),
    sourcePath: z.string().min(1).max(MAX_SOURCE_PATH_LENGTH),
  })
  .strict();
export type MissingField = z.infer<typeof MissingFieldSchema>;

/** Tally of one diagnostic code from the extraction pipeline. */
export const DiagnosticTallySchema = z
  .object({
    code: z.string().min(1).max(MAX_SCHEMA_VERSION_LABEL),
    severity: z.enum(['error', 'warning', 'info']),
    count: z.number().int().min(1),
  })
  .strict();
export type DiagnosticTally = z.infer<typeof DiagnosticTallySchema>;

/** IR entity types the pack format has no representation for (reported, not dropped). */
export const UnpackedSchema = z
  .object({
    entityType: z.string().min(1).max(MAX_ID_LENGTH),
    count: z.number().int().min(1),
    reason: z.string().min(1).max(MAX_NOTE_LENGTH),
  })
  .strict();
export type Unpacked = z.infer<typeof UnpackedSchema>;

/**
 * Coverage report (spec 6.4, 6.5): what the pack contains, and what was not
 * extracted or could not be joined. Summarized from the extractor's report —
 * entity counts come from the packed payload, not from the extractor's claims.
 */
export const PackCoverageSchema = z
  .object({
    /** Basename of the extraction input directory (provenance of the source). */
    inputDir: z.string().min(1).max(MAX_SOURCE_PATH_LENGTH),
    counts: z
      .object({
        recipes: z.number().int().min(0),
        items: z.number().int().min(0),
        devices: z.number().int().min(0),
        /** IR records read from the source, including ones with no pack form. */
        sourceWorldRefs: z.number().int().min(0),
        /** Property entries per §6.5 level, counted over the packed payload. */
        byPropertyQuality: boundedRecord(DataQualitySchema, z.number().int().min(0), 5),
        /** Recipes per family. */
        byFamily: boundedRecord(z.string().min(1).max(MAX_ID_LENGTH), z.number().int().min(0), MAX_COVERAGE_FAMILIES),
      })
      .strict(),
    families: z.array(FamilyCoverageSchema).max(MAX_COVERAGE_FAMILIES),
    controls: z.array(ControlCoverageSchema).max(MAX_COVERAGE_CONTROLS),
    missingFields: z
      .object({
        total: z.number().int().min(0),
        entries: z.array(MissingFieldSchema).max(MAX_COVERAGE_MISSING_FIELD_ENTRIES),
      })
      .strict(),
    diagnostics: z
      .object({
        total: z.number().int().min(0),
        byCode: z.array(DiagnosticTallySchema).max(MAX_COVERAGE_DIAGNOSTIC_ENTRIES),
      })
      .strict(),
    skippedFiles: z.array(z.string().min(1).max(MAX_SOURCE_PATH_LENGTH)).max(MAX_SOURCE_FILES),
    joins: z.array(JoinStatusSchema).max(JOIN_NAMES.length),
    unpacked: z.array(UnpackedSchema).max(MAX_COVERAGE_UNPACKED_ENTRIES),
  })
  .strict();
export type PackCoverage = z.infer<typeof PackCoverageSchema>;

/**
 * A complete, versioned data pack (spec 6.4).
 *
 * Immutable by contract: `buildPack` freezes what it returns and `loadPack`
 * freezes what it parses, so a consumer cannot mutate shared pack data under
 * another consumer.
 */
export const PackSchema = z
  .object({
    packSchemaVersion: z.literal(PACK_SCHEMA_VERSION),
    packId: z.string().min(1).max(MAX_ID_LENGTH),
    /** Full game build number, not a marketing version. */
    gameBuild: GameBuildSchema,
    /** Game branch the data came from (spec 6.4: only `stable` is published). */
    gameBranch: GameBranchSchema,
    /** Distribution channel (spec 6.7). */
    channel: PackChannelSchema,
    toolVersions: ToolVersionsSchema,
    /** Version of the normalizer that produced the IR (spec 6.2, 6.4). */
    normalizationVersion: z.string().min(1).max(MAX_SCHEMA_VERSION_LABEL),
    sourceDigests: SourceDigestsSchema,
    extractionDate: IsoUtcSchema,
    entityCounts: EntityCountsSchema,
    behaviorModelCompatibility: BehaviorModelCompatibilitySchema,
    coverage: PackCoverageSchema,
    payload: PackPayloadSchema,
    /** SHA-256 over the canonical JSON of this pack with `contentHash` removed. */
    contentHash: Sha256HexSchema,
  })
  .strict()
  .superRefine((pack, ctx) => {
    // Only stable-branch builds are published as supported (spec 6.4).
    if (pack.channel === 'published' && pack.gameBranch !== 'stable') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'a published pack must come from a stable-branch build (spec 6.4)',
        path: ['channel'],
      });
    }

    // Counts and coverage describe the payload; they may not disagree with it.
    const actual = {
      recipes: pack.payload.recipes.length,
      items: pack.payload.items.length,
      devices: pack.payload.devices.length,
    };
    for (const key of ['recipes', 'items', 'devices'] as const) {
      if (pack.entityCounts[key] !== actual[key]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `entityCounts.${key} is ${pack.entityCounts[key]} but the payload holds ${actual[key]}`,
          path: ['entityCounts', key],
        });
      }
      if (pack.coverage.counts[key] !== actual[key]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `coverage.counts.${key} is ${pack.coverage.counts[key]} but the payload holds ${actual[key]}`,
          path: ['coverage', 'counts', key],
        });
      }
    }

    // Entity ids are the diff keys (EXT-04); duplicates make a pack ambiguous.
    const seen = new Map<string, string>();
    for (const collection of ['recipes', 'items', 'devices'] as const) {
      for (const [index, entity] of pack.payload[collection].entries()) {
        const key = `${collection}:${entity.id}`;
        if (seen.has(key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `duplicate ${collection} id "${entity.id}"`,
            path: ['payload', collection, index, 'id'],
          });
        }
        seen.set(key, entity.id);
      }
    }
  });

export type Pack = z.infer<typeof PackSchema>;

/** Deep readonly view of a pack, as returned by `loadPack`. */
export type DeepReadonly<T> = T extends (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

export type ReadonlyPack = DeepReadonly<Pack>;
