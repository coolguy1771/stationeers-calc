/**
 * Pack builder (spec 6.2, 6.4, 6.5): extractor IR + install metadata -> one
 * validated, versioned pack.
 *
 * The builder is the single place where quality levels are decided, and its
 * rules are deliberately narrow:
 *
 * 1. **Nothing is validated by default.** Every extracted property enters the
 *    pack as `extracted-unverified` (or as the extractor reported it: `missing`,
 *    `conflicting`, `inferred`). Even if the extractor claims
 *    `extracted-and-validated`, the builder downgrades it and records why —
 *    only the explicit promotion input can validate a property.
 * 2. **Promotions are audited.** Each promotion names one property, who
 *    approved it, when, and the evidence; the record is stored in the pack. A
 *    promotion of a value the source does not supply, of one side of a
 *    conflicting record, or of a quantity with no verified unit is rejected.
 * 3. **Nothing is fabricated.** An absent `<Output>` amount stays absent (with
 *    a `missing` property entry), absent display names stay empty while the
 *    `display-name` join is reported `missing`, and joins the XML cannot supply
 *    (material->prefab, family->machine) are named in coverage.
 * 4. **Output is reproducible.** Payload entities are sorted by id and the
 *    content hash is taken over canonical JSON, so the same IR plus the same
 *    metadata yields byte-identical output.
 */
import { sanitizeDisplayString, type DataQuality } from '@stationeers/domain';
import { contentHashOf } from './canonical';
import { PackError, PackErrorCode } from './errors';
import { deepFreeze } from './immutable';
import {
  CoverageInputSchema,
  DisplayNamesInputSchema,
  IrInputSchema,
  ManifestFragmentInputSchema,
  PackBuildMetadataSchema,
  SUPPORTED_IR_VERSION,
  type CoverageInput,
  type DisplayNamesInput,
  type IrInput,
  type IrItemInput,
  type IrRecipeInput,
  type ManifestFragmentInput,
  type PackBuildMetadata,
} from './input';
import {
  PackSchema,
  PACK_SCHEMA_VERSION,
  type DiagnosticTally,
  type JoinStatus,
  type Pack,
  type PackCoverage,
  type PackedDevice,
  type PackedItem,
  type PackedNumber,
  type PackedRecipe,
  type PropertyQuality,
} from './schema';
import {
  PromotionInputSchema,
  resolveEntityProperty,
  type PackEntityType,
  type PackedEntity,
  type PromotionInput,
} from './quality';
import {
  MAX_COVERAGE_DIAGNOSTIC_ENTRIES,
  MAX_COVERAGE_MISSING_FIELD_ENTRIES,
} from './limits';

/** Everything `buildPack` needs; each part is validated before it is read. */
export interface PackBuildInput {
  /** Extractor IR (`ir.json`). */
  ir: unknown;
  /** Extractor coverage report (`coverage.json`). */
  coverage: unknown;
  /** Extractor manifest fragment (`manifest.json`). */
  manifest: unknown;
  /** Install-supplied provenance: build number, branch, channel, dates, tools. */
  metadata: unknown;
  /** Explicit promotion input (spec 6.5). Omitted = nothing is validated. */
  promotions?: unknown;
  /** Adapter B display names keyed by entity id. Omitted = names stay missing. */
  displayNames?: unknown;
}

const IR_VERSION_LABEL = `IR v${SUPPORTED_IR_VERSION}`;

function issuesOf(error: { issues: { path: PropertyKey[]; message: string }[] }): string[] {
  return error.issues.map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`);
}

function parseOrThrow<T>(
  schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } },
  value: unknown,
  label: string,
  code: PackErrorCode = PackErrorCode.BuildInputInvalid,
): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new PackError(code, `${label} failed validation`, issuesOf(result.error));
}

function compareIds(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Copy a source number without inventing or converting anything. */
function packNumber(number: { text: string; value: number; unitStatus: 'unverified' | 'verified'; unit?: string }): PackedNumber {
  return {
    text: number.text,
    value: number.value,
    unitStatus: number.unitStatus,
    ...(number.unit === undefined ? {} : { unit: number.unit }),
  };
}

/** Record-level provenance of an IR record. */
interface IrRecordProvenance {
  sourceFile: string;
  sourcePath: string;
  qualityLevel: DataQuality;
  notes?: string;
}

type FieldOverride = {
  qualityLevel: DataQuality;
  notes?: string;
  sourcePath?: string;
};

/**
 * Carry one extracted value's quality into the pack, enforcing rule 1: an
 * extraction can never arrive validated, and a conflicted record poisons the
 * values it carries (only "this field is absent" survives, since absence is not
 * a conflict of values).
 */
function carryProperty(
  provenance: IrRecordProvenance,
  override: FieldOverride | undefined,
  fieldNotes?: string,
): PropertyQuality {
  const reported = override?.qualityLevel ?? provenance.qualityLevel;
  const notes: string[] = [];

  let quality: DataQuality = reported;
  if (quality === 'extracted-and-validated') {
    quality = 'extracted-unverified';
    notes.push('the extractor reported this value as validated; a pack starts unverified and only an explicit promotion may validate it (spec 6.5)');
  }
  if (provenance.qualityLevel === 'conflicting' && quality !== 'missing') {
    quality = 'conflicting';
    notes.push('the source records for this entity conflict; the value is not usable until resolved');
  }
  if (fieldNotes !== undefined) notes.push(fieldNotes);
  if (override?.notes !== undefined) notes.push(override.notes);

  return {
    quality,
    sourceFile: provenance.sourceFile,
    sourcePath: override?.sourcePath ?? provenance.sourcePath,
    ...(notes.length === 0 ? {} : { notes: notes.join('; ') }),
  };
}

/** A value the source does not supply: `missing`, with the reason recorded. */
function missingProperty(reason: string): PropertyQuality {
  return { quality: 'missing', notes: reason };
}

const NO_XML_DISPLAY_NAME = 'the game XML carries no display name; Adapter B (Stationpedia) supplies it';
const NO_OUTPUT_AMOUNT = 'the source declares no output amount; the amount is unknown, not 1';

function displayNameProperty(
  entityId: string,
  displayNames: DisplayNamesInput,
): PropertyQuality {
  const supplied = displayNames[entityId];
  if (supplied === undefined) return missingProperty(NO_XML_DISPLAY_NAME);
  return {
    quality: 'extracted-unverified',
    sourceFile: 'adapter-b',
    sourcePath: `stationpedia/${entityId}`,
    notes: 'supplied by Adapter B from the runtime Stationpedia; extracted but not validated',
  };
}

function fieldProvenance(recipe: IrRecipeInput | IrItemInput, key: string): FieldOverride | undefined {
  return recipe.fieldProvenance?.[key];
}

function packRecipe(recipe: IrRecipeInput, displayNames: DisplayNamesInput): PackedRecipe {
  const properties: Record<string, PropertyQuality> = {};
  const carry = (key: string, notes?: string) => carryProperty(recipe.provenance, fieldProvenance(recipe, key), notes);

  properties['displayName'] = displayNameProperty(recipe.id, displayNames);
  properties['output.prefabId'] = carry('output.prefabId');
  properties['output.quantity'] =
    recipe.output.quantity === undefined
      ? { ...missingProperty(NO_OUTPUT_AMOUNT), sourceFile: recipe.provenance.sourceFile }
      : carry('output.quantity');

  const inputs = recipe.inputs.map((input, index) => {
    properties[`inputs[${index}].quantity`] = carry(`inputs[${index}].quantity`);
    return { materialName: input.materialName, quantity: packNumber(input.quantity) };
  });

  if (recipe.time !== undefined) properties['time'] = carry('time');
  if (recipe.energy !== undefined) properties['energy'] = carry('energy');
  if (recipe.temperature?.start !== undefined) properties['temperature.start'] = carry('temperature.start');
  if (recipe.temperature?.stop !== undefined) properties['temperature.stop'] = carry('temperature.stop');
  if (recipe.pressure?.start !== undefined) properties['pressure.start'] = carry('pressure.start');
  if (recipe.pressure?.stop !== undefined) properties['pressure.stop'] = carry('pressure.stop');
  if (recipe.tier !== undefined) properties['tier'] = carry('tier');

  const suppliedName = displayNames[recipe.id];

  const packed: PackedRecipe = {
    id: recipe.id,
    family: recipe.family,
    displayName: suppliedName === undefined ? '' : sanitizeDisplayString(suppliedName),
    output: {
      prefabId: recipe.output.prefabId,
      ...(recipe.output.quantity === undefined ? {} : { quantity: packNumber(recipe.output.quantity) }),
    },
    inputs,
    ...(recipe.time === undefined ? {} : { time: packNumber(recipe.time) }),
    ...(recipe.energy === undefined ? {} : { energy: packNumber(recipe.energy) }),
    ...(recipe.temperature === undefined
      ? {}
      : {
          temperature: {
            ...(recipe.temperature.start === undefined ? {} : { start: packNumber(recipe.temperature.start) }),
            ...(recipe.temperature.stop === undefined ? {} : { stop: packNumber(recipe.temperature.stop) }),
          },
        }),
    ...(recipe.pressure === undefined
      ? {}
      : {
          pressure: {
            ...(recipe.pressure.start === undefined ? {} : { start: packNumber(recipe.pressure.start) }),
            ...(recipe.pressure.stop === undefined ? {} : { stop: packNumber(recipe.pressure.stop) }),
          },
        }),
    ...(recipe.tier === undefined ? {} : { tier: recipe.tier }),
    provenance: {
      sourceFile: recipe.provenance.sourceFile,
      sourcePath: recipe.provenance.sourcePath,
      quality: recipe.provenance.qualityLevel === 'extracted-and-validated'
        ? 'extracted-unverified'
        : recipe.provenance.qualityLevel,
      ...(recipe.provenance.notes === undefined ? {} : { notes: recipe.provenance.notes }),
    },
    properties,
  };

  return packed;
}

function packItem(item: IrItemInput, displayNames: DisplayNamesInput): PackedItem {
  const properties: Record<string, PropertyQuality> = {};
  const carry = (key: string) => carryProperty(item.provenance, fieldProvenance(item, key));

  properties['displayName'] = displayNameProperty(item.id, displayNames);
  if (item.category !== undefined) properties['category'] = carry('category');

  const suppliedName = displayNames[item.id];

  return {
    id: item.id,
    displayName: suppliedName === undefined ? '' : sanitizeDisplayString(suppliedName),
    ...(item.category === undefined ? {} : { category: item.category }),
    provenance: {
      sourceFile: item.provenance.sourceFile,
      sourcePath: item.provenance.sourcePath,
      quality: item.provenance.qualityLevel === 'extracted-and-validated'
        ? 'extracted-unverified'
        : item.provenance.qualityLevel,
      ...(item.provenance.notes === undefined ? {} : { notes: item.provenance.notes }),
    },
    properties,
  };
}

type MutableEntity = { id: string; properties: Record<string, PropertyQuality> };

function mutableEntity(
  payload: { recipes: PackedRecipe[]; items: PackedItem[]; devices: PackedDevice[] },
  entityType: PackEntityType,
  entityId: string,
): MutableEntity | undefined {
  const collection =
    entityType === 'recipe' ? payload.recipes : entityType === 'item' ? payload.items : payload.devices;
  return (collection as MutableEntity[]).find((entity) => entity.id === entityId);
}

/**
 * Apply the explicit promotion input, one named property at a time (spec 6.5).
 * Rejects every promotion that would validate something the pack cannot stand
 * behind, instead of quietly skipping it.
 */
function applyPromotions(
  payload: { recipes: PackedRecipe[]; items: PackedItem[]; devices: PackedDevice[] },
  promotions: PromotionInput,
): void {
  const seen = new Set<string>();
  for (const promotion of promotions.promotions) {
    const key = `${promotion.entityType}:${promotion.entityId}:${promotion.property}`;
    if (seen.has(key)) {
      throw new PackError(
        PackErrorCode.PromotionDuplicate,
        `property ${promotion.property} of ${promotion.entityType} "${promotion.entityId}" is promoted more than once`,
      );
    }
    seen.add(key);

    const entity = mutableEntity(payload, promotion.entityType, promotion.entityId);
    if (entity === undefined) {
      throw new PackError(
        PackErrorCode.PromotionUnknownEntity,
        `promotion names ${promotion.entityType} "${promotion.entityId}", which the pack does not contain`,
      );
    }

    const existing = entity.properties[promotion.property];
    if (existing === undefined) {
      throw new PackError(
        PackErrorCode.PromotionUnknownProperty,
        `promotion names property "${promotion.property}" of ${promotion.entityType} "${promotion.entityId}", which the pack does not carry`,
        [`carried properties: ${Object.keys(entity.properties).sort().join(', ')}`],
      );
    }

    const resolved = resolveEntityProperty(promotion.entityType, entity as PackedEntity, promotion.property);
    if (existing.quality === 'missing' || resolved?.kind === 'absent') {
      throw new PackError(
        PackErrorCode.PromotionMissingProperty,
        `property "${promotion.property}" of ${promotion.entityType} "${promotion.entityId}" is missing in the source and cannot be validated`,
      );
    }
    if (existing.quality === 'conflicting') {
      throw new PackError(
        PackErrorCode.PromotionConflicting,
        `property "${promotion.property}" of ${promotion.entityType} "${promotion.entityId}" conflicts between sources; resolve the conflict before validating one value`,
      );
    }

    const unitNotes: string[] = [];
    if (resolved !== undefined && resolved.kind === 'number') {
      const known = resolved.number.unitStatus === 'verified' ? resolved.number.unit : undefined;
      if (known !== undefined && promotion.unit !== undefined && known !== promotion.unit) {
        throw new PackError(
          PackErrorCode.PromotionUnitMismatch,
          `promotion of "${promotion.property}" of ${promotion.entityType} "${promotion.entityId}" declares unit "${promotion.unit}" but the value is already verified as "${known}"`,
        );
      }
      const unit = promotion.unit ?? known;
      if (unit === undefined) {
        throw new PackError(
          PackErrorCode.PromotionUnitRequired,
          `quantity "${promotion.property}" of ${promotion.entityType} "${promotion.entityId}" has no unit semantics; the promotion must name the unit it establishes (spec 6.5)`,
          [`source text "${resolved.number.text}", unitStatus "${resolved.number.unitStatus}"`],
        );
      }
      if (known === undefined) {
        // The approval establishes the unit semantics Adapter A cannot: record it
        // on the value itself, so every consumer sees a verified unit.
        resolved.set({ ...resolved.number, unitStatus: 'verified', unit });
        unitNotes.push(`unit "${unit}" established by this approval`);
      }
    } else if (promotion.unit !== undefined) {
      throw new PackError(
        PackErrorCode.PromotionUnitNotApplicable,
        `promotion of "${promotion.property}" of ${promotion.entityType} "${promotion.entityId}" declares unit "${promotion.unit}", but that property is not a quantity`,
      );
    }

    const notes = [...(existing.notes === undefined ? [] : [existing.notes]), ...unitNotes];
    entity.properties[promotion.property] = {
      quality: 'extracted-and-validated',
      ...(existing.sourceFile === undefined ? {} : { sourceFile: existing.sourceFile }),
      ...(existing.sourcePath === undefined ? {} : { sourcePath: existing.sourcePath }),
      ...(notes.length === 0 ? {} : { notes: notes.join('; ') }),
      approval: {
        approvedBy: promotion.approvedBy,
        approvedAt: promotion.approvedAt,
        reference: promotion.reference,
        ...(promotion.unit === undefined ? {} : { unit: promotion.unit }),
      },
    };
  }
}

/** Tally every property entry by §6.5 level (all five levels present, zeros included). */
function tallyPropertyQuality(entities: { properties: Record<string, PropertyQuality> }[]): Record<DataQuality, number> {
  const counts: Record<DataQuality, number> = {
    'extracted-and-validated': 0,
    'extracted-unverified': 0,
    missing: 0,
    conflicting: 0,
    inferred: 0,
  };
  for (const entity of entities) {
    for (const property of Object.values(entity.properties)) {
      counts[property.quality] += 1;
    }
  }
  return counts;
}

/**
 * The joins the game data cannot supply (spec 6.2, 6.3). Two of them have no
 * input yet at all; display names come from Adapter B when a caller supplies
 * them, and stay `missing` otherwise.
 */
function joinStatuses(displayNames: DisplayNamesInput): JoinStatus[] {
  const nameCount = Object.keys(displayNames).length;
  const joins: JoinStatus[] = [
    {
      join: 'material-to-prefab',
      status: 'missing',
      suppliedBy: 'Adapter B (EXT-02)',
      detail:
        'ingredients are named by material name; the game XML states no material-to-prefab mapping, so no recipe ingredient can be resolved to an item id',
    },
    {
      join: 'family-to-machine-prefab',
      status: 'missing',
      suppliedBy: 'Adapter B (EXT-02)',
      detail:
        'a recipe family wrapper names a machine family, not a machine prefab; nothing in the XML binds the two',
    },
    nameCount === 0
      ? {
          join: 'display-name',
          status: 'missing',
          suppliedBy: 'Adapter B (EXT-02)',
          detail: 'display names are not in the game XML; none were supplied, so every name is an empty string with a missing property entry',
        }
      : {
          join: 'display-name',
          status: 'supplied',
          suppliedBy: 'Adapter B display names (caller-supplied)',
          detail: `display names supplied for ${nameCount} entities; they are extracted-unverified, not validated`,
        },
  ];
  return joins;
}

function summarizeCoverage(options: {
  coverage: CoverageInput;
  recipes: PackedRecipe[];
  items: PackedItem[];
  devices: PackedDevice[];
  worldRefCount: number;
  displayNames: DisplayNamesInput;
}): PackCoverage {
  const { coverage } = options;

  const byFamily: Record<string, number> = {};
  for (const recipe of options.recipes) {
    byFamily[recipe.family] = (byFamily[recipe.family] ?? 0) + 1;
  }

  const families = [...coverage.families]
    .sort((a, b) => compareStrings(a.family, b.family))
    .map((family) => ({
      family: family.family,
      status: family.status,
      files: [...family.files].sort(compareStrings),
      recipes: family.recipes,
      ...(family.reason === undefined ? {} : { reason: family.reason }),
    }));

  const controls = [...coverage.controls].sort((a, b) =>
    compareStrings(a.element, b.element) || compareStrings(a.mapping, b.mapping),
  );

  const tallies = new Map<string, DiagnosticTally>();
  for (const diagnostic of coverage.diagnostics) {
    const key = `${diagnostic.code}|${diagnostic.severity}`;
    const tally = tallies.get(key);
    if (tally === undefined) {
      tallies.set(key, { code: diagnostic.code, severity: diagnostic.severity, count: 1 });
    } else {
      tally.count += 1;
    }
  }
  const byCode = [...tallies.values()].sort(
    (a, b) => compareStrings(a.code, b.code) || compareStrings(a.severity, b.severity),
  );

  return {
    inputDir: coverage.inputDir,
    counts: {
      recipes: options.recipes.length,
      items: options.items.length,
      devices: 0,
      sourceWorldRefs: options.worldRefCount,
      byPropertyQuality: tallyPropertyQuality([...options.recipes, ...options.items, ...options.devices]),
      byFamily,
    },
    families,
    controls,
    missingFields: {
      total: coverage.missingFields.length,
      entries: coverage.missingFields.slice(0, MAX_COVERAGE_MISSING_FIELD_ENTRIES),
    },
    diagnostics: {
      total: coverage.diagnostics.length,
      byCode: byCode.slice(0, MAX_COVERAGE_DIAGNOSTIC_ENTRIES),
    },
    skippedFiles: [...coverage.skippedFiles].sort(compareStrings),
    joins: joinStatuses(options.displayNames),
    unpacked:
      options.worldRefCount === 0
        ? []
        : [
            {
              entityType: 'worldref',
              count: options.worldRefCount,
              reason:
                'world references have no pack representation yet; they are counted here so nothing is dropped silently',
            },
          ],
  };
}

/** Pack id derived from the build it describes; never caller-chosen. */
export function packIdFor(metadata: { gameBranch: string; gameBuild: string }): string {
  return `stationeers-${metadata.gameBranch}-${metadata.gameBuild}`;
}

/**
 * Build one validated pack from extractor output plus install metadata.
 *
 * Throws `PackError` (stable code) when an input is invalid, an IR/schema
 * version is unsupported, the manifest contradicts the IR, or a promotion is
 * not defensible. Returns a frozen, schema-valid pack.
 */
export async function buildPack(input: PackBuildInput): Promise<Pack> {
  const metadata: PackBuildMetadata = parseOrThrow(PackBuildMetadataSchema, input.metadata, 'pack metadata');

  // Only stable-branch builds are published as supported (spec 6.4). The pack
  // schema enforces this too; the builder says it with its own code.
  if (metadata.channel === 'published' && metadata.gameBranch !== 'stable') {
    throw new PackError(
      PackErrorCode.PublishedOnBetaBranch,
      `a published pack must come from a stable-branch build; this one is "${metadata.gameBranch}"`,
    );
  }

  const ir: IrInput = parseOrThrow(IrInputSchema, input.ir, 'extractor IR');

  if (ir.irVersion !== SUPPORTED_IR_VERSION) {
    throw new PackError(
      PackErrorCode.IrVersionUnsupported,
      `this pack schema packs ${IR_VERSION_LABEL}; the input is IR v${ir.irVersion}`,
    );
  }
  if (metadata.toolVersions.ir !== ir.irVersion) {
    throw new PackError(
      PackErrorCode.IrVersionMismatch,
      `metadata declares IR v${metadata.toolVersions.ir} but the IR document is v${ir.irVersion}`,
    );
  }

  const coverage: CoverageInput = parseOrThrow(CoverageInputSchema, input.coverage, 'coverage report');
  const manifest: ManifestFragmentInput = parseOrThrow(
    ManifestFragmentInputSchema,
    input.manifest,
    'extractor manifest',
  );
  const fileNames = Object.keys(manifest.files);
  if (manifest.fileCount !== fileNames.length) {
    throw new PackError(
      PackErrorCode.ManifestInconsistent,
      `the extractor manifest declares ${manifest.fileCount} files but lists ${fileNames.length}`,
    );
  }
  if (manifest.irVersion !== ir.irVersion) {
    throw new PackError(
      PackErrorCode.IrVersionMismatch,
      `the extractor manifest records IR v${manifest.irVersion} but the IR document is v${ir.irVersion}`,
    );
  }

  const promotions: PromotionInput | undefined =
    input.promotions === undefined
      ? undefined
      : parseOrThrow(PromotionInputSchema, input.promotions, 'promotion input');

  const displayNames: DisplayNamesInput =
    input.displayNames === undefined
      ? {}
      : parseOrThrow(DisplayNamesInputSchema, input.displayNames, 'Adapter B display names');

  const recipes: PackedRecipe[] = ir.recipes.map((recipe) => packRecipe(recipe, displayNames)).sort(compareIds);
  const items: PackedItem[] = ir.items.map((item) => packItem(item, displayNames)).sort(compareIds);
  const devices: PackedDevice[] = [];

  if (promotions !== undefined) applyPromotions({ recipes, items, devices }, promotions);

  const coverageSummary = summarizeCoverage({
    coverage,
    recipes,
    items,
    devices,
    worldRefCount: ir.worldRefs.length,
    displayNames,
  });

  const withoutHash: Omit<Pack, 'contentHash'> = {
    packSchemaVersion: PACK_SCHEMA_VERSION,
    packId: packIdFor(metadata),
    gameBuild: metadata.gameBuild,
    gameBranch: metadata.gameBranch,
    channel: metadata.channel,
    toolVersions: metadata.toolVersions,
    normalizationVersion: metadata.normalizationVersion,
    sourceDigests: {
      files: manifest.files,
      ir: manifest.ir,
      coverage: manifest.coverage,
    },
    extractionDate: metadata.extractionDate,
    entityCounts: { recipes: recipes.length, items: items.length, devices: devices.length },
    behaviorModelCompatibility: metadata.behaviorModelCompatibility ?? {
      status: 'not-declared' as const,
      notes: 'no behavior-model compatibility input was supplied',
    },
    coverage: coverageSummary,
    payload: { recipes, items, devices },
  };

  const contentHash = await contentHashOf(withoutHash);
  const pack: Pack = { ...withoutHash, contentHash };

  // The builder's own output goes through the same schema the loader uses, so a
  // builder bug cannot ship an invalid pack.
  const validated = parseOrThrow(PackSchema, pack, 'built pack', PackErrorCode.BuildInputInvalid) as Pack;
  return deepFreeze(validated);
}
