/**
 * Normalizer (EXT-01b): raw records -> IR (spec 6.2).
 *
 * Deterministic pipeline: prepare each raw record (unit status, per-field
 * provenance, missing-field tracking), then resolve identities in scan order.
 *
 * Identity rules:
 *
 * - A recipe's identity is `"<family>/<prefabId>"` (see `ir/records.ts`): the
 *   output prefab alone is not unique — the same item is made by several
 *   machine families.
 * - One family may declare SEVERAL distinct recipes for the same output; real
 *   data does (smelting one ingot from ore, or from already-smelted metal).
 *   Those are alternates, not conflicts: each gets its own id (`…#2`, `…#3`, …)
 *   in source order and an `IR-RECIPE-ALTERNATE` note. "Distinct" compares the
 *   parsed amounts, so `.5` and `0.50` are the same recipe.
 * - Identical definitions of one identity collapse deterministically, first
 *   occurrence wins (`IR-DUP-EXACT`). For items and world refs, the same id
 *   with DIFFERENT content is `conflicting` quality with the first occurrence
 *   kept and every source listed in the notes (spec 6.3).
 * - Missing required fields are recorded as 'missing' field provenance with the
 *   element path, and surfaced as structured entries in the coverage report —
 *   never silently dropped or defaulted (spec 4.7, 7.6).
 */
import type { Diagnostic } from './diagnostics';
import { canonicalJson } from './canonical';
import {
  type Envelope,
  type FieldProvenanceOverride,
  type IrData,
  type Item,
  type Provenance,
  type Recipe,
  type RecipeOutput,
  type RawEnvelope,
  type RawItem,
  type RawRecipe,
  type RawRecord,
  type RawSourceNumber,
  type RawWorldRef,
  type SourceNumber,
  type WorldRef,
  IR_VERSION,
} from './ir';

/** Entity types the normalizer emits. */
type EntityType = 'recipe' | 'item' | 'worldref';

/** A required field the source does not supply, reported per record in coverage. */
export interface MissingFieldEntry {
  entityType: EntityType;
  entityId: string;
  field: string;
  sourceFile: string;
  sourcePath: string;
}

/** A missing field before identity resolution, which may renumber recipes. */
interface PendingMissingField {
  field: string;
  /** Element path that should have supplied the field. */
  sourcePath: string;
}

interface PreparedRecord {
  type: EntityType;
  value: Recipe | Item | WorldRef;
  missing: PendingMissingField[];
}

export interface NormalizeResult {
  irData: IrData;
  diagnostics: Diagnostic[];
  missingFields: MissingFieldEntry[];
}

/** Extracted but not validated against a vanilla install (spec 6.5). */
const EXTRACTED_QUALITY_LEVEL = 'extracted-unverified' as const;

function fromSource(sourcePath: string): FieldProvenanceOverride {
  return { qualityLevel: EXTRACTED_QUALITY_LEVEL, sourcePath };
}

function missingInSource(): FieldProvenanceOverride {
  return { qualityLevel: 'missing', notes: 'absent in source' };
}

/** Attach the unit status the adapter cannot establish (spec 6.5). */
function sourceNumber(raw: RawSourceNumber): SourceNumber {
  return { text: raw.text, value: raw.value, unitStatus: 'unverified' };
}

/** Recipe identity for one `<RecipeData>`: wrapper name + output prefab id. */
function baseRecipeId(family: string, prefabId: string): string {
  return `${family}/${prefabId}`;
}

/**
 * Normalize one recipe: typed fields out of the raw record, per-field
 * provenance pointing at the exact source element, and the fields the source
 * does not supply ('missing', with a coverage entry).
 */
function prepareRecipe(record: RawRecipe): PreparedRecord {
  const fieldProvenance: Record<string, FieldProvenanceOverride> = {};
  const missing: PendingMissingField[] = [];
  const recordPath = record.provenance.sourcePath;

  // `StreamingAssets/Data` XML carries no display names: the prefab ids are the
  // only names it has. Adapter B (Stationpedia) is the display-name source, so
  // this is reported missing rather than invented.
  fieldProvenance.displayName = {
    qualityLevel: 'missing',
    notes: 'the XML format carries no display name',
  };
  missing.push({ field: 'displayName', sourcePath: recordPath });

  fieldProvenance['output.prefabId'] = fromSource(`${recordPath}/PrefabName`);

  const output: RecipeOutput = { prefabId: record.prefabId };
  if (record.outputQuantity === undefined) {
    // 616 of 621 recipes in a real install omit <Output>. The amount is
    // unknown, not 1: leave it absent and report it.
    fieldProvenance['output.quantity'] = missingInSource();
    missing.push({ field: 'output.quantity', sourcePath: `${recordPath}/Output` });
  } else {
    output.quantity = sourceNumber(record.outputQuantity);
    fieldProvenance['output.quantity'] = fromSource(record.outputQuantity.sourcePath);
  }

  const inputs = record.inputs.map((ingredient, index) => {
    fieldProvenance[`inputs[${index}].quantity`] = fromSource(ingredient.quantity.sourcePath);
    return {
      materialName: ingredient.materialName,
      quantity: sourceNumber(ingredient.quantity),
    };
  });

  const recipe: Recipe = {
    id: baseRecipeId(record.family, record.prefabId),
    displayName: '',
    family: record.family,
    output,
    inputs,
    provenance: record.provenance,
  };

  if (record.time !== undefined) {
    recipe.time = sourceNumber(record.time);
    fieldProvenance.time = fromSource(record.time.sourcePath);
  }
  if (record.energy !== undefined) {
    recipe.energy = sourceNumber(record.energy);
    fieldProvenance.energy = fromSource(record.energy.sourcePath);
  }
  const temperature = prepareEnvelope(record.temperature, 'temperature', fieldProvenance);
  if (temperature !== undefined) recipe.temperature = temperature;
  const pressure = prepareEnvelope(record.pressure, 'pressure', fieldProvenance);
  if (pressure !== undefined) recipe.pressure = pressure;
  if (record.tier !== undefined) {
    recipe.tier = record.tier.text;
    fieldProvenance.tier = fromSource(record.tier.sourcePath);
  }

  recipe.fieldProvenance = fieldProvenance;
  return { type: 'recipe', value: recipe, missing };
}

/** Map a raw Start/Stop envelope to its IR form, recording each bound's source. */
function prepareEnvelope(
  raw: RawEnvelope | undefined,
  field: string,
  fieldProvenance: Record<string, FieldProvenanceOverride>,
): Envelope | undefined {
  if (raw === undefined) return undefined;
  const envelope: Envelope = {};
  if (raw.start !== undefined) {
    envelope.start = sourceNumber(raw.start);
    fieldProvenance[`${field}.start`] = fromSource(raw.start.sourcePath);
  }
  if (raw.stop !== undefined) {
    envelope.stop = sourceNumber(raw.stop);
    fieldProvenance[`${field}.stop`] = fromSource(raw.stop.sourcePath);
  }
  return envelope;
}

/** Normalize one item: a missing display name is 'missing' plus a coverage entry. */
function prepareItem(record: RawItem): PreparedRecord {
  const fieldProvenance: Record<string, FieldProvenanceOverride> = {};
  const missing: PendingMissingField[] = [];

  if (record.displayName === undefined) {
    fieldProvenance.displayName = missingInSource();
    missing.push({ field: 'displayName', sourcePath: record.provenance.sourcePath });
  }

  const item: Item = {
    id: record.id,
    displayName: record.displayName ?? '',
    provenance: record.provenance,
  };
  if (record.category !== undefined) item.category = record.category;
  if (Object.keys(fieldProvenance).length > 0) item.fieldProvenance = fieldProvenance;

  return { type: 'item', value: item, missing };
}

/** Prepare one raw record for identity resolution. */
function prepareRecord(record: RawRecord): PreparedRecord {
  switch (record.type) {
    case 'recipe':
      return prepareRecipe(record);
    case 'item':
      return prepareItem(record);
    case 'worldref': {
      const { type: _rawType, ...worldRef } = record as RawWorldRef;
      void _rawType;
      return { type: 'worldref', value: worldRef, missing: [] };
    }
  }
}

/** Parsed amount of a source number, or null when the field is absent. */
function amountOf(quantity: SourceNumber | undefined): number | null {
  return quantity === undefined ? null : quantity.value;
}

/** Bounds of an envelope, or nulls when absent. */
function envelopeKey(envelope: Envelope | undefined): [number | null, number | null] {
  return [amountOf(envelope?.start), amountOf(envelope?.stop)];
}

/**
 * Content of a recipe for identity comparison: parsed amounts only, because the
 * source spelling of a number (`.5` vs `0.50`) is not content.
 */
function recipeContentKey(recipe: Recipe): string {
  return canonicalJson({
    family: recipe.family,
    output: [recipe.output.prefabId, amountOf(recipe.output.quantity)],
    inputs: recipe.inputs.map((input) => [input.materialName, input.quantity.value]),
    time: amountOf(recipe.time),
    energy: amountOf(recipe.energy),
    temperature: envelopeKey(recipe.temperature),
    pressure: envelopeKey(recipe.pressure),
    tier: recipe.tier ?? null,
  });
}

/** Content of an item/world ref: the whole value minus provenance and identity. */
function contentKey(value: Item | WorldRef): string {
  const copy: Record<string, unknown> = { ...value };
  delete copy.id;
  delete copy.provenance;
  delete copy.fieldProvenance;
  return canonicalJson(copy);
}

function contentKeyOf(record: PreparedRecord): string {
  return record.type === 'recipe'
    ? recipeContentKey(record.value as Recipe)
    : contentKey(record.value as Item | WorldRef);
}

function sourcesOf(records: PreparedRecord[]): string {
  return records
    .map((record) => `${record.value.provenance.sourceFile}${record.value.provenance.sourcePath}`)
    .join(', ');
}

/**
 * Resolve one recipe identity group: collapse identical definitions and number
 * distinct ones as alternates in source order.
 */
function resolveRecipeGroup(group: PreparedRecord[], diagnostics: Diagnostic[]): PreparedRecord[] {
  const classes: { key: string; members: PreparedRecord[] }[] = [];
  for (const record of group) {
    const key = recipeContentKey(record.value as Recipe);
    const existing = classes.find((candidate) => candidate.key === key);
    if (existing) existing.members.push(record);
    else classes.push({ key, members: [record] });
  }

  for (const cls of classes) {
    if (cls.members.length > 1) {
      const first = cls.members[0] as PreparedRecord;
      diagnostics.push({
        code: 'IR-DUP-EXACT',
        severity: 'info',
        message: `recipe "${(first.value as Recipe).id}" is defined ${cls.members.length} times with identical content; first occurrence kept`,
        sourceRule: '6.3',
        sourceFile: first.value.provenance.sourceFile,
        sourcePath: first.value.provenance.sourcePath,
        entityIds: [first.value.id],
      });
    }
  }

  const firstRecord = group[0] as PreparedRecord;
  const firstRecipe = firstRecord.value as Recipe;

  if (classes.length === 1) {
    return [(classes[0] as { members: PreparedRecord[] }).members[0] as PreparedRecord];
  }

  // Several distinct definitions of one prefab inside one family: the source
  // lists alternatives (e.g. an ingot from ore, or from already-smelted metal).
  diagnostics.push({
    code: 'IR-RECIPE-ALTERNATE',
    severity: 'info',
    message: `recipe "${firstRecipe.id}" has ${classes.length} distinct definitions; emitted as alternates "${firstRecipe.id}" … "${firstRecipe.id}#${classes.length}". Sources: ${sourcesOf(group)}`,
    sourceRule: '6.3',
    sourceFile: firstRecord.value.provenance.sourceFile,
    sourcePath: firstRecord.value.provenance.sourcePath,
    entityIds: [firstRecipe.id],
  });

  const sources = sourcesOf(group);
  return classes.map((cls, index) => {
    const record = cls.members[0] as PreparedRecord;
    const recipe = record.value as Recipe;
    const id = index === 0 ? recipe.id : `${recipe.id}#${index + 1}`;
    return {
      ...record,
      value: {
        ...recipe,
        id,
        provenance: {
          ...recipe.provenance,
          notes: `${index + 1} of ${classes.length} alternate definitions for prefab "${recipe.output.prefabId}"; all sources: ${sources}`,
        },
      },
    };
  });
}

/**
 * Resolve one item/world-ref identity group: identical content collapses, and
 * the same id with different content becomes 'conflicting' (first occurrence
 * kept, every source listed in the notes).
 */
function resolveUniqueGroup(group: PreparedRecord[], diagnostics: Diagnostic[]): PreparedRecord {
  const first = group[0] as PreparedRecord;
  const firstKey = contentKeyOf(first);
  const allExact = group.slice(1).every((other) => contentKeyOf(other) === firstKey);

  if (allExact) {
    if (group.length > 1) {
      diagnostics.push({
        code: 'IR-DUP-EXACT',
        severity: 'info',
        message: `identity ${first.type} "${first.value.id}" occurs ${group.length} times with identical content; first occurrence kept`,
        sourceRule: '6.3',
        sourceFile: first.value.provenance.sourceFile,
        sourcePath: first.value.provenance.sourcePath,
        entityIds: [first.value.id],
      });
    }
    return first;
  }

  const conflictingProvenance: Provenance = {
    ...first.value.provenance,
    qualityLevel: 'conflicting',
    notes: `conflicting records with id "${first.value.id}"; all sources: ${sourcesOf(group)}`,
  };
  diagnostics.push({
    code: 'IR-DUP-CONFLICT',
    severity: 'warning',
    message: `identity ${first.type} "${first.value.id}" occurs ${group.length} times with different content; first occurrence kept, record quality 'conflicting'`,
    sourceRule: '6.3',
    sourceFile: first.value.provenance.sourceFile,
    sourcePath: first.value.provenance.sourcePath,
    entityIds: [first.value.id],
  });

  return { ...first, value: { ...first.value, provenance: conflictingProvenance } };
}

/**
 * Normalize raw records into IR data (spec 6.2). Deterministic: records are
 * processed in scan order, identities resolved by first occurrence.
 */
export function normalize(rawRecords: RawRecord[]): NormalizeResult {
  const diagnostics: Diagnostic[] = [];
  const prepared = rawRecords.map(prepareRecord);

  // Group by identity, preserving scan order of first occurrence. Recipe ids
  // are still the base identity here; alternates are numbered per group.
  const groups = new Map<string, PreparedRecord[]>();
  for (const record of prepared) {
    const key = `${record.type}:${record.value.id}`;
    const group = groups.get(key);
    if (group) group.push(record);
    else groups.set(key, [record]);
  }

  const recipes: Recipe[] = [];
  const items: Item[] = [];
  const worldRefs: WorldRef[] = [];
  const missingFields: MissingFieldEntry[] = [];

  for (const group of groups.values()) {
    const resolved = group[0]?.type === 'recipe' ? resolveRecipeGroup(group, diagnostics) : [resolveUniqueGroup(group, diagnostics)];
    for (const record of resolved) {
      if (record.type === 'recipe') recipes.push(record.value as Recipe);
      else if (record.type === 'item') items.push(record.value as Item);
      else worldRefs.push(record.value as WorldRef);

      for (const field of record.missing) {
        missingFields.push({
          entityType: record.type,
          entityId: record.value.id,
          field: field.field,
          sourceFile: record.value.provenance.sourceFile,
          sourcePath: field.sourcePath,
        });
      }
    }
  }

  return { irData: { irVersion: IR_VERSION, recipes, items, worldRefs }, diagnostics, missingFields };
}
