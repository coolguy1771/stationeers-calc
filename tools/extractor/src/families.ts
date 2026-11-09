/**
 * Family and control-element observations (EXT-01b): what a scan saw, including
 * the parts Adapter A does not map.
 *
 * The confirmed format gives every file one root `<GameData>` whose children
 * are wrapper elements. A wrapper named `*Recipes` that holds `<RecipeData>`
 * children is a recipe family; anything else is a GameData child Adapter A
 * leaves unmapped. Recording both, per file and per element, is how the
 * coverage report can say what was NOT extracted instead of silently ignoring
 * it (spec 4.7, 7.6).
 */

/** One `<GameData>` child element as seen in one file. */
export interface FamilyObservation {
  /** Element name of the `GameData` child, e.g. "AutolatheRecipes" or "Blueprint". */
  family: string;
  /** Basename of the file declaring it. */
  file: string;
  /** Distinct child element names observed under the family element, sorted. */
  recordElements: string[];
  /** `<RecipeData>` records this file contributed to the raw record stream. */
  recipes: number;
  /** 'mapped' when the file's `<RecipeData>` records were parsed into recipes. */
  status: 'mapped' | 'unmapped';
  /** One line on why the family is unmapped (unmapped only). */
  reason?: string;
}

/** How the adapter handled a non-ingredient `<Recipe>` child element. */
export type ControlMapping = 'scalar' | 'envelope' | 'unmapped' | 'unknown';

/** Tally of one `<Recipe>` child element name across a scan. */
export interface ControlObservation {
  /** Element name, e.g. "Time" or "RequiredMix". */
  element: string;
  /**
   * 'scalar'/'envelope': carried into a typed recipe field.
   * 'unmapped': a recognized control element with no established semantics.
   * 'unknown': not recognized at all — reported, never read as an ingredient.
   */
  mapping: ControlMapping;
  /** Occurrences in the scanned input. */
  occurrences: number;
}
