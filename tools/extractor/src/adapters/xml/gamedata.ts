/**
 * Adapter A: the CONFIRMED Stationeers `<GameData>` XML format (EXT-01b).
 *
 * Confirmed structure (docs/plan/research-2025-11-09-extraction.md, section
 * "XML data format: CONFIRMED"):
 *
 *   <?xml version="1.0" encoding="utf-8"?>
 *   <GameData xmlns:xsi="…" xmlns:xsd="…">          fixed document root
 *     <SomeRecipes>                                  wrapper: names the family
 *       <RecipeData>
 *         <PrefabName>ItemSteelIngot</PrefabName>     output prefab id
 *         <Recipe>                                   ingredients + controls
 *           <Steel>.5</Steel>                        ingredient: name -> amount
 *           <Time>5</Time>                           control, not an ingredient
 *           <Temperature><Start>900</Start><Stop>1500</Stop></Temperature>
 *         </Recipe>
 *         <Output>0.25</Output>                      optional output amount
 *         <RecipeTier>TierTwo</RecipeTier>           optional, printer tier
 *       </RecipeData>
 *     </SomeRecipes>
 *   </GameData>
 *
 * Rules this module implements, and why:
 *
 * 1. The family wrapper is DISCOVERED, never hardcoded. The wrapper name varies
 *    per file (`AutolatheRecipes`, `HydraulicPipeBenderRecipes`, `Blueprint`, …),
 *    and one file may declare several wrappers, so every `GameData` child is a
 *    candidate family and its name becomes the recipe's `family`.
 * 2. Ingredients are the OPEN set: any `<Recipe>` child that is not a known
 *    control and whose text is a decimal number (`<Steel>.5</Steel>`).
 * 3. Controls are a CLOSED set (`CONTROL_ELEMENTS`). A `<Recipe>` child that is
 *    neither a known control nor a decimal-numbered ingredient cannot be read
 *    as an ingredient without inventing data (spec 6.1/4.7), so it is reported
 *    (`XML-CONTROL-UNKNOWN`) and left out of the record — never silently
 *    treated as an ingredient.
 * 4. Numbers keep their exact source text (`".5"`) next to the parsed value,
 *    because unit semantics (mass vs count vs mol) are NOT established.
 * 5. Nothing is defaulted: a missing `<Output>` leaves the output amount absent
 *    (with 'missing' field provenance downstream); a missing `<PrefabName>`
 *    rejects the record with an error diagnostic.
 *
 * Non-recipe wrappers (`Blueprint`, `ThingMods`, `TraderContactData`, …) produce
 * no entities: they are reported per file through `FamilyObservation` so the
 * coverage report can list what Adapter A does not map.
 */
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { SinkFn } from '../../diagnostics';
import type { ControlMapping, FamilyObservation } from '../../families';
import type {
  RawEnvelope,
  RawIngredient,
  RawRecipe,
  RawRecord,
  RawSourceNumber,
  RawSourceText,
} from '../../ir/raw';

/** Document root of every file in `StreamingAssets/Data` that this adapter reads. */
export const GAMEDATA_ROOT = 'GameData';
/** Record element inside a recipe family wrapper. */
export const RECIPE_RECORD_ELEMENT = 'RecipeData';

/**
 * Parse options for the confirmed format.
 *
 * - Attributes are separated with an `@_` prefix so they can never be mistaken
 *   for child elements (`<RequiredMix Rule="Pure">` has both).
 * - Tag and attribute values stay raw STRINGS: `.5` must survive verbatim, and
 *   nothing is coerced before this module validates it.
 * - The `<?xml?>` declaration and XML comments are ignored; the real files carry
 *   comments between records.
 * - Whitespace-only text nodes are trimmed away.
 */
export const GAMEDATA_PARSER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  attributesGroupName: false,
  textNodeName: '#text',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  ignoreDeclaration: true,
  ignorePiTags: true,
} as const;

const XML_PREFIX = '@_';
const TEXT_NODE = '#text';

/** Decimal text as the game writes it: `.5`, `0.25`, `10`, `7.9E-05`. */
const DECIMAL_TEXT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Typed recipe fields a scalar control element can supply. */
type ScalarControlField = 'time' | 'energy';
/** Typed recipe fields an envelope control element can supply. */
type EnvelopeControlField = 'temperature' | 'pressure';

/**
 * How one non-ingredient `<Recipe>` child element is handled.
 *
 * 'scalar'/'envelope' become typed recipe fields. 'unmapped' is a recognized
 * control element whose semantics are not established — its values are NOT
 * guessed, the element is reported instead. Anything absent from this table is
 * 'unknown' at parse time.
 */
type ControlMappingSpec =
  | { kind: 'scalar'; field: ScalarControlField }
  | { kind: 'envelope'; field: EnvelopeControlField }
  | { kind: 'unmapped'; reason: string };

export const CONTROL_ELEMENTS: Readonly<Record<string, ControlMappingSpec>> = {
  Time: { kind: 'scalar', field: 'time' },
  Energy: { kind: 'scalar', field: 'energy' },
  Temperature: { kind: 'envelope', field: 'temperature' },
  Pressure: { kind: 'envelope', field: 'pressure' },
  // Present in real data (furnace.xml): a mixing requirement with a `Rule`
  // attribute and gas→amount children. Reconciling it needs established
  // mixing semantics, so it is reported rather than guessed at.
  RequiredMix: {
    kind: 'unmapped',
    reason: 'mixing requirement (Rule attribute + gas→amount children); semantics not established',
  },
};

/** `<Recipe>` child elements that name a recipe family, e.g. `AutolatheRecipes`. */
const NAMES_RECIPE_FAMILY = /Recipe/i;

/** Envelope bound elements. */
const ENVELOPE_BOUNDS = ['Start', 'Stop'] as const;

/**
 * `GameData` children Adapter A knows about and deliberately leaves unmapped,
 * with the owner of the data. Reported so the coverage report is explicit about
 * known gaps instead of looking like a silent omission.
 */
const KNOWN_UNMAPPED_FAMILIES: Readonly<Record<string, { reason: string; suggestedResolution?: string }>> = {
  Blueprint: {
    reason:
      '3D build-shape geometry (<Mesh> path, <Edge> line segments in metres); out of Adapter A scope',
    suggestedResolution: 'EXT-05 (geometry: footprints, connectors, grid) owns this data',
  },
};

export interface GameDataParseContext {
  /** Relative path of the file within the extraction input. */
  sourceFile: string;
  /** Non-throwing sink for parse diagnostics. */
  onDiagnostics?: SinkFn;
}

export interface GameDataParseResult {
  /** Raw records in document order: `GameData` children in source order. */
  records: RawRecord[];
  /** Every `GameData` child this file declares, mapped or not. */
  families: FamilyObservation[];
  /** Tally of non-ingredient `<Recipe>` children, for the coverage report. */
  controls: { element: string; mapping: ControlMapping; occurrences: number }[];
}

/**
 * Extracted properties start unverified: nothing validates them against a
 * vanilla install yet (spec 6.5, EXT-03 promotes them).
 */
const EXTRACTED_QUALITY_LEVEL = 'extracted-unverified' as const;

interface ParseContext {
  sourceFile: string;
  sink: SinkFn;
  /** Record one non-ingredient `<Recipe>` child element. */
  control: (element: string, mapping: ControlMapping) => void;
}

type Fields = Record<string, unknown>;

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Element children of a parsed node, in document order: no attributes, no text. */
function elementEntries(value: unknown): Array<[string, unknown]> {
  if (!isFields(value)) return [];
  return Object.entries(value).filter(([key]) => !key.startsWith(XML_PREFIX) && key !== TEXT_NODE);
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

/** Text of an element value, whether it parsed to a string or `{ '#text': … }`. */
function elementText(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (isFields(value)) {
    const text = value[TEXT_NODE];
    return typeof text === 'string' ? text : undefined;
  }
  return undefined;
}

/** A decimal source number, or undefined when the text is absent/not decimal. */
function parseSourceNumber(text: string | undefined, sourcePath: string): RawSourceNumber | undefined {
  if (text === undefined) return undefined;
  const trimmed = text.trim();
  if (!DECIMAL_TEXT.test(trimmed)) return undefined;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return undefined;
  return { text: trimmed, value, sourcePath };
}

/**
 * Read a scalar element, reporting repeated siblings (the confirmed format
 * never repeats them) and keeping the first.
 */
function readScalarText(
  value: unknown,
  element: string,
  sourcePath: string,
  ctx: ParseContext,
): string | undefined {
  if (Array.isArray(value)) {
    ctx.sink({
      code: 'XML-ELEMENT-REPEATED',
      severity: 'warning',
      message: `element <${element}> appears ${value.length} times at ${sourcePath}; the first is used`,
      sourceRule: '6.3',
      sourceFile: ctx.sourceFile,
      sourcePath,
    });
    return readScalarText(value[0], element, sourcePath, ctx);
  }
  const text = elementText(value);
  return text === undefined ? undefined : text.trim();
}

/**
 * Parse one `<GameData>` file into raw records. Throws on malformed XML; every
 * grammar divergence is reported through the diagnostic sink.
 */
export function parseGameDataFile(input: string, ctx: GameDataParseContext): GameDataParseResult {
  const validation = XMLValidator.validate(input);
  if (validation !== true) {
    const err = validation.err;
    throw new Error(`malformed XML (${ctx.sourceFile}) line ${err.line}:${err.col}: ${err.msg}`);
  }

  const parser = new XMLParser(GAMEDATA_PARSER_OPTIONS);
  let parsed: unknown;
  try {
    parsed = parser.parse(input);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`malformed XML (${ctx.sourceFile}): ${message}`);
  }

  /** Tally of non-ingredient `<Recipe>` children, for the coverage report. */
  const controlTallies = new Map<string, { element: string; mapping: ControlMapping; occurrences: number }>();
  const diagnostics: ParseContext = {
    sourceFile: ctx.sourceFile,
    sink: (diagnostic) => ctx.onDiagnostics?.(diagnostic),
    control: (element, mapping) => {
      const key = `${element}\u0000${mapping}`;
      const existing = controlTallies.get(key);
      if (existing) existing.occurrences += 1;
      else controlTallies.set(key, { element, mapping, occurrences: 1 });
    },
  };

  const documentFields = isFields(parsed) ? parsed : {};
  if (!(GAMEDATA_ROOT in documentFields)) {
    const roots = Object.keys(documentFields).filter((key) => !key.startsWith(XML_PREFIX) && key !== TEXT_NODE);
    diagnostics.sink({
      code: 'XML-ROOT-UNEXPECTED',
      severity: 'warning',
      message: `expected a <${GAMEDATA_ROOT}> root in ${ctx.sourceFile}; found ${roots.length > 0 ? roots.map((r) => `<${r}>`).join(', ') : 'no root element'}`,
      sourceRule: '6.3',
      sourceFile: ctx.sourceFile,
    });
    return { records: [], families: [], controls: [] };
  }

  const familyEntries = elementEntries(documentFields[GAMEDATA_ROOT]);
  if (familyEntries.length === 0) {
    diagnostics.sink({
      code: 'XML-FILE-EMPTY',
      severity: 'info',
      message: `<${GAMEDATA_ROOT}> in ${ctx.sourceFile} has no child elements; nothing to map`,
      sourceRule: '6.3',
      sourceFile: ctx.sourceFile,
      sourcePath: `/${GAMEDATA_ROOT}`,
    });
    return { records: [], families: [], controls: [] };
  }

  const records: RawRecord[] = [];
  const families = new Map<string, FamilyObservation>();
  const recordIndices = new Map<string, number>();

  for (const [family, familyValue] of familyEntries) {
    let familyRecipes = 0;
    let sawRecordElement = false;
    const observedElements = new Set<string>();

    for (const wrapper of toArray(familyValue)) {
      const children = elementEntries(wrapper);
      for (const [name] of children) observedElements.add(name);
      const recipeDataValues: unknown[] = [];
      for (const [name, childValue] of children) {
        if (name !== RECIPE_RECORD_ELEMENT) continue;
        sawRecordElement = true;
        recipeDataValues.push(...toArray(childValue));
      }

      for (const recipeDataValue of recipeDataValues) {
        const index = (recordIndices.get(family) ?? 0) + 1;
        recordIndices.set(family, index);
        const sourcePath = `/${GAMEDATA_ROOT}/${family}/${RECIPE_RECORD_ELEMENT}[${index}]`;
        const recipe = parseRecipeData(recipeDataValue, family, sourcePath, diagnostics);
        if (!recipe) continue;
        records.push(recipe);
        familyRecipes += 1;
      }
    }

    const status: FamilyObservation['status'] = sawRecordElement ? 'mapped' : 'unmapped';
    const known = KNOWN_UNMAPPED_FAMILIES[family];
    const observed = [...observedElements].sort();
    const reason =
      status === 'mapped'
        ? undefined
        : (known?.reason ??
          `no <${RECIPE_RECORD_ELEMENT}> records; observed children: ${observed.length > 0 ? observed.map((n) => `<${n}>`).join(', ') : 'none'}`);

    const observation: FamilyObservation = {
      family,
      file: ctx.sourceFile,
      recordElements: observed,
      recipes: familyRecipes,
      status,
    };
    if (reason !== undefined) observation.reason = reason;

    const merged = families.get(family);
    if (merged) {
      merged.recipes += familyRecipes;
      merged.recordElements = [...new Set([...merged.recordElements, ...observed])].sort();
      if (status === 'mapped') {
        merged.status = 'mapped';
        delete merged.reason;
      }
    } else {
      families.set(family, observation);
    }

    if (status === 'unmapped') {
      diagnostics.sink({
        // A wrapper that names recipes but yields none is a parser gap worth a
        // warning; any other GameData child is a family Adapter A never mapped.
        code: 'XML-FAMILY-UNMAPPED',
        severity: NAMES_RECIPE_FAMILY.test(family) ? 'warning' : 'info',
        message: `family <${family}> in ${ctx.sourceFile} is not mapped by Adapter A: ${reason}`,
        sourceRule: '6.3',
        sourceFile: ctx.sourceFile,
        sourcePath: `/${GAMEDATA_ROOT}/${family}`,
        ...(known?.suggestedResolution === undefined
          ? {}
          : { suggestedResolution: known.suggestedResolution }),
      });
    }
  }

  return { records, families: [...families.values()], controls: [...controlTallies.values()] };
}

/**
 * Parse one `<RecipeData>` element. Returns undefined when the record has no
 * usable identity (missing `<PrefabName>`).
 */
function parseRecipeData(
  value: unknown,
  family: string,
  sourcePath: string,
  ctx: ParseContext,
): RawRecipe | undefined {
  let prefabId: string | undefined;
  let recipeValue: unknown;
  let sawRecipeElement = false;
  let outputText: string | undefined;
  let tierText: string | undefined;

  for (const [name, childValue] of elementEntries(value)) {
    switch (name) {
      case 'PrefabName':
        prefabId = readScalarText(childValue, name, `${sourcePath}/${name}`, ctx);
        break;
      case 'Recipe':
        sawRecipeElement = true;
        recipeValue = childValue;
        break;
      case 'Output':
        outputText = readScalarText(childValue, name, `${sourcePath}/${name}`, ctx);
        break;
      case 'RecipeTier':
        tierText = readScalarText(childValue, name, `${sourcePath}/${name}`, ctx);
        break;
      default:
        ctx.sink({
          code: 'XML-RECORD-UNKNOWN-ELEMENT',
          severity: 'warning',
          message: `unexpected <${name}> in <${RECIPE_RECORD_ELEMENT}> at ${sourcePath}; ignored (no established mapping)`,
          sourceRule: '6.3',
          sourceFile: ctx.sourceFile,
          sourcePath,
        });
    }
  }

  if (prefabId === undefined || prefabId === '') {
    ctx.sink({
      code: 'XML-REC-MISSING-PREFAB',
      severity: 'error',
      message: `<${RECIPE_RECORD_ELEMENT}> at ${sourcePath} has no <PrefabName>; record skipped`,
      sourceRule: '6.3',
      sourceFile: ctx.sourceFile,
      sourcePath,
    });
    return undefined;
  }

  const recipe: RawRecipe = {
    type: 'recipe',
    family,
    prefabId,
    inputs: [],
    provenance: {
      sourceFile: ctx.sourceFile,
      sourcePath,
      qualityLevel: EXTRACTED_QUALITY_LEVEL,
    },
  };

  if (!sawRecipeElement) {
    ctx.sink({
      code: 'XML-RECIPE-MISSING',
      severity: 'warning',
      message: `<${RECIPE_RECORD_ELEMENT}> for prefab "${prefabId}" at ${sourcePath} has no <Recipe>; record kept with no ingredients`,
      sourceRule: '6.3',
      sourceFile: ctx.sourceFile,
      sourcePath,
      entityIds: [prefabId],
    });
  } else {
    parseRecipeElement(recipeValue, `${sourcePath}/Recipe`, prefabId, recipe, ctx);
  }

  if (outputText !== undefined) {
    const declared = parseSourceNumber(outputText, `${sourcePath}/Output`);
    if (declared === undefined) {
      ctx.sink({
        code: 'XML-OUTPUT-BAD-QUANTITY',
        severity: 'error',
        message: `<Output> of prefab "${prefabId}" at ${sourcePath} is not a decimal number ("${outputText}"); output amount left missing`,
        sourceRule: '6.3',
        sourceFile: ctx.sourceFile,
        sourcePath: `${sourcePath}/Output`,
        entityIds: [prefabId],
      });
    } else {
      recipe.outputQuantity = declared;
    }
  }

  if (tierText !== undefined && tierText !== '') {
    const tier: RawSourceText = { text: tierText, sourcePath: `${sourcePath}/RecipeTier` };
    recipe.tier = tier;
  }

  return recipe;
}

/**
 * Parse the `<Recipe>` element of one record: ingredients in document order
 * plus the typed control fields. Every child is classified; see the module
 * comment for the ingredient-vs-control rule.
 */
function parseRecipeElement(
  value: unknown,
  sourcePath: string,
  prefabId: string,
  recipe: RawRecipe,
  ctx: ParseContext,
): void {
  const fields = isFields(value) ? value : {};
  if (elementEntries(fields).length === 0) {
    ctx.sink({
      code: 'XML-RECIPE-MISSING',
      severity: 'warning',
      message: `<Recipe> of prefab "${prefabId}" at ${sourcePath} has no child elements; record kept with no ingredients`,
      sourceRule: '6.3',
      sourceFile: ctx.sourceFile,
      sourcePath,
      entityIds: [prefabId],
    });
    return;
  }

  for (const [name, childValue] of elementEntries(fields)) {
    const elementPath = `${sourcePath}/${name}`;
    const control = CONTROL_ELEMENTS[name];
    if (control) {
      applyControl(control, name, childValue, elementPath, prefabId, recipe, ctx);
      continue;
    }
    readIngredient(name, childValue, elementPath, prefabId, recipe, ctx);
  }
}

/**
 * A `<Recipe>` child that is not a known control is an ingredient only when it
 * carries a decimal number; the confirmed ingredient contract is
 * element-name→number. Anything else is an unknown control element: reported,
 * never read as an ingredient (spec 6.1/4.7: no invented data).
 */
function readIngredient(
  name: string,
  value: unknown,
  sourcePath: string,
  prefabId: string,
  recipe: RawRecipe,
  ctx: ParseContext,
): void {
  const members = toArray(value);
  if (members.length > 1) {
    ctx.sink({
      code: 'XML-ELEMENT-REPEATED',
      severity: 'warning',
      message: `ingredient <${name}> appears ${members.length} times in the recipe of "${prefabId}" at ${sourcePath}; every occurrence is kept`,
      sourceRule: '6.3',
      sourceFile: ctx.sourceFile,
      sourcePath,
      entityIds: [prefabId],
    });
  }

  let read = 0;
  for (const member of members) {
    const text = elementText(member);
    const quantity = parseSourceNumber(text, sourcePath);
    if (quantity === undefined) continue;
    const ingredient: RawIngredient = { materialName: name, quantity };
    recipe.inputs.push(ingredient);
    read += 1;
  }
  if (read > 0) return;

  ctx.sink({
    code: 'XML-CONTROL-UNKNOWN',
    severity: 'warning',
    message: `<Recipe> child <${name}> of prefab "${prefabId}" at ${sourcePath} is not a recognized control element and does not hold a decimal amount; reported as an unknown control instead of being read as an ingredient`,
    sourceRule: '6.3',
    sourceFile: ctx.sourceFile,
    sourcePath,
    entityIds: [prefabId],
    suggestedResolution:
      'add the element to CONTROL_ELEMENTS in tools/extractor/src/adapters/xml/gamedata.ts when its semantics are established',
  });
  ctx.control(name, 'unknown');
}

/** Apply a control element to its typed recipe field. */
function applyControl(
  control: ControlMappingSpec,
  name: string,
  value: unknown,
  sourcePath: string,
  prefabId: string,
  recipe: RawRecipe,
  ctx: ParseContext,
): void {
  switch (control.kind) {
    case 'scalar': {
      const text = readScalarText(value, name, sourcePath, ctx);
      const parsed = parseSourceNumber(text, sourcePath);
      ctx.control(name, 'scalar');
      if (parsed === undefined) {
        ctx.sink({
          code: 'XML-CONTROL-BAD-VALUE',
          severity: 'error',
          message: `<${name}> of prefab "${prefabId}" at ${sourcePath} is not a decimal number ("${text ?? ''}"); field left missing`,
          sourceRule: '6.3',
          sourceFile: ctx.sourceFile,
          sourcePath,
          entityIds: [prefabId],
        });
        return;
      }
      recipe[control.field] = parsed;
      return;
    }
    case 'envelope': {
      ctx.control(name, 'envelope');
      const envelope: RawEnvelope = {};
      const fields = isFields(value) ? value : {};
      for (const bound of ENVELOPE_BOUNDS) {
        const boundPath = `${sourcePath}/${bound}`;
        if (!(bound in fields)) continue;
        const text = readScalarText(fields[bound], bound, boundPath, ctx);
        const parsed = parseSourceNumber(text, boundPath);
        if (parsed === undefined) {
          ctx.sink({
            code: 'XML-CONTROL-BAD-VALUE',
            severity: 'error',
            message: `<${name}>/${bound} of prefab "${prefabId}" at ${boundPath} is not a decimal number ("${text ?? ''}"); bound left missing`,
            sourceRule: '6.3',
            sourceFile: ctx.sourceFile,
            sourcePath: boundPath,
            entityIds: [prefabId],
          });
          continue;
        }
        if (bound === 'Start') envelope.start = parsed;
        else envelope.stop = parsed;
      }
      for (const [extraName] of elementEntries(fields)) {
        if ((ENVELOPE_BOUNDS as readonly string[]).includes(extraName)) continue;
        ctx.sink({
          code: 'XML-CONTROL-UNKNOWN',
          severity: 'warning',
          message: `<${name}> of prefab "${prefabId}" has unknown child <${extraName}> at ${sourcePath}/${extraName}; ignored`,
          sourceRule: '6.3',
          sourceFile: ctx.sourceFile,
          sourcePath: `${sourcePath}/${extraName}`,
          entityIds: [prefabId],
        });
        ctx.control(extraName, 'unknown');
      }
      if (envelope.start === undefined || envelope.stop === undefined) {
        ctx.sink({
          code: 'XML-CONTROL-INCOMPLETE',
          severity: 'warning',
          message: `<${name}> of prefab "${prefabId}" at ${sourcePath} is missing ${envelope.start === undefined ? '<Start>' : '<Stop>'}; envelope kept incomplete`,
          sourceRule: '6.3',
          sourceFile: ctx.sourceFile,
          sourcePath,
          entityIds: [prefabId],
        });
      }
      recipe[control.field] = envelope;
      return;
    }
    case 'unmapped': {
      ctx.control(name, 'unmapped');
      ctx.sink({
        code: 'XML-CONTROL-UNMAPPED',
        severity: 'info',
        message: `recognized control <${name}> of prefab "${prefabId}" at ${sourcePath} has no Adapter A mapping: ${control.reason}`,
        sourceRule: '6.3',
        sourceFile: ctx.sourceFile,
        sourcePath,
        entityIds: [prefabId],
      });
      return;
    }
  }
}
