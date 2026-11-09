/**
 * PROVISIONAL Adapter A: XML configuration and recipe extractor (EXT-01).
 *
 * **PROVISIONAL FORMAT — NOT GAME DATA.** This module implements only the
 * synthetic provisional grammar accepted for the first pipeline run:
 *
 *   <recipes>
 *     <recipe id="..." displayName="..." station="...">
 *       <input itemId="..." quantity="10" unit="g"/>
 *       <output itemId="..." quantity="10" unit="kg"/>
 *     </recipe>
 *   </recipes>
 *
 *   <items>
 *     <item id="..." displayName="..." category="..."/>
 *   </items>
 *
 * A file may contain either root or both as siblings. Unknown roots, tags,
 * and attributes are ignored so the provisional format can grow. Well-formed
 * XML is checked with fast-xml-parser's XMLValidator, which rejects multi-root
 * documents; that specific error is tolerated, every other validation failure
 * is thrown as a useful malformed-XML error.
 *
 * The REAL Stationeers vocabulary is different (research in progress). When
 * it is confirmed this whole file gets replaced by a new adapter writing the
 * same `RawRecord[]` contract (`src/ir/raw.ts`) — nothing outside this module
 * may reach into fast-xml-parser or these tag names.
 */
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { SinkFn } from '../../diagnostics';
import type { RawItem, RawRecipe, RawRecord } from '../../ir/raw';

/**
 * PROVISIONAL grammar parse options: attributes land as plain string keys,
 * repeated <input>/<output> children always become arrays (even when there is
 * only one), so the element walkers below never branch on 1-vs-many.
 */
export const PROVISIONAL_PARSER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '',
  attributesGroupName: false,
  textNodeName: '#text',
  isArray: (name: string) => name === 'input' || name === 'output',
  processEntities: true,
} as const;

/**
 * Extracted properties from the PROVISIONAL format are not yet validated
 * against a real install (see README limitations), so the quality level is
 * the honest one: 'extracted-unverified' (spec 6.5).
 */
const PROVISIONAL_QUALITY_LEVEL = 'extracted-unverified' as const;

/**
 * fast-xml-parser's XMLValidator rejects documents with multiple root
 * elements with this exact message. The provisional grammar deliberately
 * allows sibling roots (<recipes> plus <items> in one file), so this specific
 * validation error is tolerated - every other validation failure is thrown
 * as malformed XML.
 */
const MULTI_ROOT_ERROR_MSG = 'Multiple possible root nodes found.';

export interface ProvisionalXmlSourceContext {
  /** Relative path of the file within the extraction input. */
  sourceFile: string;
  /** Non-throwing warning sink for format evolution diagnostics. */
  onDiagnostics?: SinkFn;
}

/**
 * Parse one XML file (text) into raw records using the PROVISIONAL grammar.
 * Throws a useful error when the text is not well-formed XML; elements that
 * are well-formed but diverge from the provisional grammar (missing id,
 * non-numeric quantity, missing required ingredient attributes) are reported
 * through the diagnostic sink and skipped.
 */
export function parseProvisionalFile(
  input: string,
  ctx: ProvisionalXmlSourceContext,
): RawRecord[] {
  const validation = XMLValidator.validate(input);
  if (validation !== true) {
    const err = validation.err;
    if (err.msg !== MULTI_ROOT_ERROR_MSG) {
      throw new Error(
        `malformed XML (${ctx.sourceFile}) line ${err.line}:${err.col}: ${err.msg}`,
      );
    }
  }

  const parser = new XMLParser(PROVISIONAL_PARSER_OPTIONS);
  let parsed: unknown;
  try {
    parsed = parser.parse(input);
  } catch (e) {
    // Validator-gated text only throws on input the validator cannot see
    // (e.g. pure garbage between roots); still a useful error.
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`malformed XML (${ctx.sourceFile}): ${message}`);
  }

  const records: RawRecord[] = [];
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    ctx.onDiagnostics?.({
      code: 'XML-ROOT-UNEXPECTED',
      severity: 'warning',
      message: `expected a <recipes> or <items> root in ${ctx.sourceFile}; got ${typeof parsed}`,
      sourceRule: '6.3',
      sourceFile: ctx.sourceFile,
    });
    return records;
  }

  for (const [rootKey, rootValue] of Object.entries(parsed)) {
    if (rootKey === 'recipes') {
      records.push(...parseProvisionalRecipes(rootValue, ctx));
    } else if (rootKey === 'items') {
      records.push(...parseProvisionalItems(rootValue, ctx));
    } else {
      ctx.onDiagnostics?.({
        code: 'XML-ROOT-UNEXPECTED',
        severity: 'warning',
        message: `expected a <recipes> or <items> root in ${ctx.sourceFile}; got <${rootKey}>`,
        sourceRule: '6.3',
        sourceFile: ctx.sourceFile,
      });
    }
  }

  return records;
}

/**
 * All raw records carry the same provenance shape: 'extracted-unverified'
 * (see README limitations), relative sourceFile, and a sourcePath pointing
 * at the record's element.
 */
function provenance(sourceFile: string, sourcePath: string) {
  return {
    sourceFile,
    sourcePath,
    qualityLevel: PROVISIONAL_QUALITY_LEVEL,
  };
}

/** Array-ify a fast-xml-parser value: non-arrays (single child) become one. */
function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return [value];
}

/** Recursively extract the string value of an element or attribute. */
function asString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return String(value);
  return undefined;
}

/**
 * Parse the <recipes> root: rootValue.recipe is an array of <recipe> elements
 * (the isArray option forces arrays for <input>/<output> children; the recipe
 * element itself becomes an array of objects when there is more than one).
 */
function parseProvisionalRecipes(rootValue: unknown, ctx: ProvisionalXmlSourceContext): RawRecord[] {
  const records: RawRecord[] = [];
  if (!rootValue || typeof rootValue !== 'object' || Array.isArray(rootValue)) {
    ctx.onDiagnostics?.({
      code: 'XML-ROOT-UNEXPECTED',
      severity: 'warning',
      message: `expected a <recipes> object in ${ctx.sourceFile}; got ${typeof rootValue}`,
      sourceRule: '6.3',
      sourceFile: ctx.sourceFile,
    });
    return records;
  }

  const rootObject = rootValue as Record<string, unknown>;
  for (const recipeElement of toArray(rootObject.recipe)) {
    if (!recipeElement || typeof recipeElement !== 'object') {
      ctx.onDiagnostics?.({
        code: 'XML-ROOT-UNEXPECTED',
        severity: 'warning',
        message: `expected a <recipe> object in ${ctx.sourceFile}; got ${typeof recipeElement}`,
        sourceRule: '6.3',
        sourceFile: ctx.sourceFile,
      });
      continue;
    }

    const recipeObject = recipeElement as Record<string, unknown>;
    const id = asString(recipeObject.id);
    if (!id) {
      ctx.onDiagnostics?.({
        code: 'XML-REC-MISSING-ID',
        severity: 'error',
        message: `recipe element missing required attribute "id" in ${ctx.sourceFile}`,
        sourceRule: '6.3',
        sourceFile: ctx.sourceFile,
      });
      continue;
    }

    const displayName = asString(recipeObject.displayName);
    const station = asString(recipeObject.station);

    const record: RawRecipe = {
      type: 'recipe',
      id,
      inputs: [],
      outputs: [],
      provenance: provenance(ctx.sourceFile, `/recipes/${id}`),
    };

    if (displayName) {
      record.displayName = displayName;
    }
    if (station) {
      record.station = station;
    }

    for (const ingredient of toArray(recipeObject.input)) {
      parseProvisionalIngredient(ingredient, 'input', record, ctx);
    }

    for (const ingredient of toArray(recipeObject.output)) {
      parseProvisionalIngredient(ingredient, 'output', record, ctx);
    }

    records.push(record);
  }

  return records;
}

/**
 * Parse the <items> root: rootValue.item is an array of <item> elements.
 */
function parseProvisionalItems(rootValue: unknown, ctx: ProvisionalXmlSourceContext): RawRecord[] {
  const records: RawRecord[] = [];
  if (!rootValue || typeof rootValue !== 'object' || Array.isArray(rootValue)) {
    ctx.onDiagnostics?.({
      code: 'XML-ROOT-UNEXPECTED',
      severity: 'warning',
      message: `expected an <items> object in ${ctx.sourceFile}; got ${typeof rootValue}`,
      sourceRule: '6.3',
      sourceFile: ctx.sourceFile,
    });
    return records;
  }

  const rootObject = rootValue as Record<string, unknown>;
  for (const itemElement of toArray(rootObject.item)) {
    if (!itemElement || typeof itemElement !== 'object') {
      ctx.onDiagnostics?.({
        code: 'XML-ROOT-UNEXPECTED',
        severity: 'warning',
        message: `expected an <item> object in ${ctx.sourceFile}; got ${typeof itemElement}`,
        sourceRule: '6.3',
        sourceFile: ctx.sourceFile,
      });
      continue;
    }

    const itemObject = itemElement as Record<string, unknown>;
    const id = asString(itemObject.id);
    if (!id) {
      ctx.onDiagnostics?.({
        code: 'XML-REC-MISSING-ID',
        severity: 'error',
        message: `item element missing required attribute "id" in ${ctx.sourceFile}`,
        sourceRule: '6.3',
        sourceFile: ctx.sourceFile,
      });
      continue;
    }

    const displayName = asString(itemObject.displayName);
    const category = asString(itemObject.category);

    const record: RawItem = {
      type: 'item',
      id,
      provenance: provenance(ctx.sourceFile, `/items/${id}`),
    };

    if (displayName) {
      record.displayName = displayName;
    }
    if (category) {
      record.category = category;
    }

    records.push(record);
  }

  return records;
}

/**
 * Parse a single <input>/<output> element into recipeRecord.inputs or
 * recipeRecord.outputs. Required attributes: itemId, quantity, unit.
 * Missing or non-numeric attributes are reported as diagnostics and the
 * ingredient is skipped (spec 4.7/7.6: never defaulted).
 */
function parseProvisionalIngredient(
  ingredientValue: unknown,
  direction: 'input' | 'output',
  recipeRecord: RawRecipe,
  ctx: ProvisionalXmlSourceContext,
): void {
  if (!ingredientValue || typeof ingredientValue !== 'object') {
    ctx.onDiagnostics?.({
      code: 'XML-ROOT-UNEXPECTED',
      severity: 'warning',
      message: `expected an <${direction}> object in ${ctx.sourceFile}; got ${typeof ingredientValue}`,
      sourceRule: '6.3',
      sourceFile: ctx.sourceFile,
      sourcePath: `/recipes/${recipeRecord.id}`,
    });
    return;
  }

  const ingredient = ingredientValue as Record<string, unknown>;
  const itemId = asString(ingredient.itemId);
  const quantity = asString(ingredient.quantity);
  const unit = asString(ingredient.unit);

  const missing: string[] = [];
  if (itemId === undefined) missing.push('itemId');
  if (quantity === undefined) missing.push('quantity');
  if (unit === undefined) missing.push('unit');

  if (missing.length > 0) {
    ctx.onDiagnostics?.({
      code: 'XML-ING-MISSING',
      severity: 'error',
      message: `recipe ${recipeRecord.id} <${direction}> missing required attribute${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`,
      sourceRule: '6.3',
      sourceFile: ctx.sourceFile,
      sourcePath: `/recipes/${recipeRecord.id}`,
      entityIds: [recipeRecord.id],
    });
    return;
  }

  const quantityNumber = Number(quantity);
  if (!Number.isFinite(quantityNumber)) {
    ctx.onDiagnostics?.({
      code: 'XML-ING-BAD-QUANTITY',
      severity: 'error',
      message: `recipe ${recipeRecord.id} <${direction}> itemId="${itemId}" quantity="${quantity as string}" is not a finite number`,
      sourceRule: '6.3',
      sourceFile: ctx.sourceFile,
      sourcePath: `/recipes/${recipeRecord.id}`,
      entityIds: [recipeRecord.id],
    });
    return;
  }

  const target = direction === 'input' ? recipeRecord.inputs : recipeRecord.outputs;
  target.push({
    itemId: itemId as string,
    quantity: quantityNumber,
    unit: unit as string,
  });
}

// Re-exported so the normalizer and tests never see fast-xml-parser types.
export type { RawRecord };
