/**
 * Normalizer (EXT-01): raw records -> IR (spec 6.2).
 *
 * Deterministic pipeline: normalize each raw record (unit conversion, missing
 * field provenance), then resolve duplicate identities by first occurrence in
 * scan order. Exact duplicates collapse deterministically; same id with
 * different content is 'conflicting' quality with the first occurrence kept
 * and all sources listed in the notes (spec 6.3). Missing required fields are
 * recorded as 'missing' field provenance and surfaced as structured entries
 * in the coverage report (see src/report.ts) - never silently dropped or
 * defaulted (spec 4.7, 7.6).
 */
import type { Diagnostic } from './diagnostics';
import { canonicalJson } from './canonical';
import {
  type FieldProvenanceOverride,
  type Ingredient,
  type IrData,
  type Item,
  type Provenance,
  type Recipe,
  type RawIngredient,
  type RawItem,
  type RawRecipe,
  type RawRecord,
  type RawWorldRef,
  type WorldRef,
  IR_VERSION,
} from './ir';
import { conversionNote, convertQuantity } from './units';

/** A raw record normalized into its IR value, tagged with its entity type. */
type NormalizedRecord =
  | { type: 'recipe'; value: Recipe }
  | { type: 'item'; value: Item }
  | { type: 'worldref'; value: WorldRef };

/** Structured entry for a required field that is absent in the source. */
export interface MissingFieldEntry {
  entityType: 'recipe' | 'item' | 'worldref';
  entityId: string;
  field: string;
  sourceFile: string;
  sourcePath: string;
}

export interface NormalizeResult {
  irData: IrData;
  diagnostics: Diagnostic[];
  missingFields: MissingFieldEntry[];
}

/**
 * Content comparison for duplicate identities: canonical JSON of the record
 * value with provenance and field provenance excluded. Records that differ
 * only in source units but normalize to the same canonical quantity are
 * exact duplicates; records differing anywhere else are conflicts.
 */
function contentKey(value: Recipe | Item | WorldRef): string {
  const copy: Record<string, unknown> = { ...value };
  delete copy.provenance;
  delete copy.fieldProvenance;
  return canonicalJson(copy);
}

/**
 * Normalize one recipe: unit conversion (g -> kg) with 'inferred' field
 * provenance naming the calculation; missing displayName becomes 'missing'
 * field provenance plus a structured entry for the coverage report.
 */
function normalizeRecipe(record: RawRecipe): { recipe: Recipe; missing: MissingFieldEntry[] } {
  const missing: MissingFieldEntry[] = [];
  const fieldProvenance: Record<string, FieldProvenanceOverride> = {};

  if (record.displayName === undefined) {
    fieldProvenance.displayName = { qualityLevel: 'missing', notes: 'missing in source' };
    missing.push({
      entityType: 'recipe',
      entityId: record.id,
      field: 'displayName',
      sourceFile: record.provenance.sourceFile,
      sourcePath: record.provenance.sourcePath,
    });
  }

  const convertIngredient = (ing: RawIngredient, key: string): Ingredient => {
    const converted = convertQuantity(ing.quantity, ing.unit);
    if (converted === null) {
      // Unknown unit: keep verbatim, no conversion - the quality stays with
      // the record level ('extracted-unverified'), not a fabricated value.
      return ing;
    }
    if (converted.quantity !== ing.quantity || converted.unit !== ing.unit) {
      fieldProvenance[key] = {
        qualityLevel: 'inferred',
        notes: conversionNote(ing.unit, converted.unit),
      };
    }
    return { itemId: ing.itemId, quantity: converted.quantity, unit: converted.unit };
  };

  const recipe: Recipe = {
    id: record.id,
    displayName: record.displayName ?? '',
    inputs: record.inputs.map((ing, i) => convertIngredient(ing, `inputs[${i}]`)),
    outputs: record.outputs.map((ing, i) => convertIngredient(ing, `outputs[${i}]`)),
    provenance: record.provenance,
  };
  if (record.station !== undefined) {
    recipe.station = record.station;
  }
  if (Object.keys(fieldProvenance).length > 0) {
    recipe.fieldProvenance = fieldProvenance;
  }

  return { recipe, missing };
}

/**
 * Normalize one item: missing displayName becomes 'missing' field provenance
 * plus a structured entry for the coverage report.
 */
function normalizeItem(record: RawItem): { item: Item; missing: MissingFieldEntry[] } {
  const missing: MissingFieldEntry[] = [];
  const fieldProvenance: Record<string, FieldProvenanceOverride> = {};

  if (record.displayName === undefined) {
    fieldProvenance.displayName = { qualityLevel: 'missing', notes: 'missing in source' };
    missing.push({
      entityType: 'item',
      entityId: record.id,
      field: 'displayName',
      sourceFile: record.provenance.sourceFile,
      sourcePath: record.provenance.sourcePath,
    });
  }

  const item: Item = {
    id: record.id,
    displayName: record.displayName ?? '',
    provenance: record.provenance,
  };
  if (record.category !== undefined) {
    item.category = record.category;
  }
  if (Object.keys(fieldProvenance).length > 0) {
    item.fieldProvenance = fieldProvenance;
  }

  return { item, missing };
}

/** Normalize one raw record into its tagged IR value. */
function normalizeRecord(record: RawRecord): { normalized: NormalizedRecord; missing: MissingFieldEntry[] } {
  switch (record.type) {
    case 'recipe': {
      const { recipe, missing } = normalizeRecipe(record);
      return { normalized: { type: 'recipe', value: recipe }, missing };
    }
    case 'item': {
      const { item, missing } = normalizeItem(record);
      return { normalized: { type: 'item', value: item }, missing };
    }
    case 'worldref': {
      const { type: _rawType, ...worldRef } = record as RawWorldRef;
      void _rawType;
      return { normalized: { type: 'worldref', value: worldRef }, missing: [] };
    }
  }
}

/**
 * Resolve one identity group: exact duplicates collapse deterministically
 * (first occurrence wins, scan order); same id with different content is
 * 'conflicting' quality with the first occurrence kept and all sources listed
 * in the provenance notes (spec 6.3).
 */
function resolveGroup(records: NormalizedRecord[], diagnostics: Diagnostic[]): NormalizedRecord {
  const first = records[0] as NormalizedRecord;
  const firstKey = contentKey(first.value);

  let allExact = true;
  for (const other of records.slice(1)) {
    if (contentKey(other.value) !== firstKey) {
      allExact = false;
      break;
    }
  }

  if (allExact) {
    if (records.length > 1) {
      diagnostics.push({
        code: 'IR-DUP-EXACT',
        severity: 'info',
        message: `identity ${first.type} "${first.value.id}" occurs ${records.length} times with identical content; first occurrence kept`,
        sourceRule: '6.3',
        sourceFile: first.value.provenance.sourceFile,
        sourcePath: first.value.provenance.sourcePath,
        entityIds: [first.value.id],
      });
    }
    return first;
  }

  // Same id, different content: 'conflicting'. First occurrence wins,
  // deterministic by scan order; all sources listed in the notes.
  const sources = records.map((r) => `${r.value.provenance.sourceFile}${r.value.provenance.sourcePath}`);
  const conflictingProvenance: Provenance = {
    ...first.value.provenance,
    qualityLevel: 'conflicting',
    notes: `conflicting records with id "${first.value.id}"; all sources: ${sources.join(', ')}`,
  };
  diagnostics.push({
    code: 'IR-DUP-CONFLICT',
    severity: 'warning',
    message: `identity ${first.type} "${first.value.id}" occurs ${records.length} times with different content; first occurrence kept, record quality 'conflicting'`,
    sourceRule: '6.3',
    sourceFile: first.value.provenance.sourceFile,
    sourcePath: first.value.provenance.sourcePath,
    entityIds: [first.value.id],
  });
  switch (first.type) {
    case 'recipe':
      return { type: 'recipe', value: { ...first.value, provenance: conflictingProvenance } };
    case 'item':
      return { type: 'item', value: { ...first.value, provenance: conflictingProvenance } };
    case 'worldref':
      return { type: 'worldref', value: { ...first.value, provenance: conflictingProvenance } };
  }
}

/**
 * Normalize raw records into IR data (spec 6.2). Deterministic: records are
 * processed in scan order, duplicates resolved by first occurrence.
 */
export function normalize(rawRecords: RawRecord[]): NormalizeResult {
  const diagnostics: Diagnostic[] = [];
  const missingFields: MissingFieldEntry[] = [];

  // 1. Normalize each raw record (unit conversion, missing-field provenance).
  const normalized: NormalizedRecord[] = [];
  for (const record of rawRecords) {
    const { normalized: one, missing } = normalizeRecord(record);
    normalized.push(one);
    missingFields.push(...missing);
  }

  // 2. Group by identity (type + id), preserving scan order.
  const groups = new Map<string, NormalizedRecord[]>();
  for (const record of normalized) {
    const key = `${record.type}:${record.value.id}`;
    const group = groups.get(key);
    if (group) group.push(record);
    else groups.set(key, [record]);
  }

  // 3. Resolve duplicates deterministically.
  const recipes: Recipe[] = [];
  const items: Item[] = [];
  const worldRefs: WorldRef[] = [];
  for (const group of groups.values()) {
    const resolved = resolveGroup(group, diagnostics);
    if (resolved.type === 'recipe') recipes.push(resolved.value);
    else if (resolved.type === 'item') items.push(resolved.value);
    else worldRefs.push(resolved.value);
  }

  return { irData: { irVersion: IR_VERSION, recipes, items, worldRefs }, diagnostics, missingFields };
}
