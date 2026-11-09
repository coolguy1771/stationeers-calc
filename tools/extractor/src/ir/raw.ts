/**
 * Raw record contract (EXT-01): the shape adapters emit for the normalizer.
 * Adapter A produces the recipe subset from the confirmed `<GameData>` format;
 * the item and WorldRef members are defined here so other adapters slot in
 * without changing the normalizer.
 *
 * Raw records carry source TEXT plus the parsed number, never a unit: the
 * adapters know the source spelling but not the unit semantics (spec 6.5), so
 * the normalizer is the layer that attaches a unit status. Optional fields are
 * absent (undefined) when the source does not have them; the normalizer never
 * receives a fabricated default (spec 6.3, 4.7).
 */
import { z } from 'zod';
import { ProvenanceSchema } from './provenance';

/**
 * A number exactly as the source spells it, with the element it came from.
 * `.5` and `0.50` stay distinct texts with equal values; the text is what makes
 * an unverified unit reviewable (spec 6.5).
 */
export const RawSourceNumberSchema = z.object({
  text: z.string(),
  value: z.number(),
  sourcePath: z.string(),
});
export type RawSourceNumber = z.infer<typeof RawSourceNumberSchema>;

/** A source text value that is not a number, e.g. `<RecipeTier>TierTwo</RecipeTier>`. */
export const RawSourceTextSchema = z.object({
  text: z.string(),
  sourcePath: z.string(),
});
export type RawSourceText = z.infer<typeof RawSourceTextSchema>;

/** A two-bound condition envelope (`<Start>`/`<Stop>`), each bound optional. */
export const RawEnvelopeSchema = z.object({
  start: RawSourceNumberSchema.optional(),
  stop: RawSourceNumberSchema.optional(),
});
export type RawEnvelope = z.infer<typeof RawEnvelopeSchema>;

/** Ingredient as parsed by an adapter: material name plus its declared amount. */
export const RawIngredientSchema = z.object({
  materialName: z.string(),
  quantity: RawSourceNumberSchema,
});
export type RawIngredient = z.infer<typeof RawIngredientSchema>;

export const RawRecipeSchema = z.object({
  type: z.literal('recipe'),
  /** Wrapper element name that declares the recipe family, e.g. "AutolatheRecipes". */
  family: z.string(),
  /** Output prefab id from `<PrefabName>`, e.g. "ItemSteelIngot". */
  prefabId: z.string(),
  inputs: z.array(RawIngredientSchema),
  /** Declared `<Output>` amount; absent when the source omits the element. */
  outputQuantity: RawSourceNumberSchema.optional(),
  time: RawSourceNumberSchema.optional(),
  energy: RawSourceNumberSchema.optional(),
  temperature: RawEnvelopeSchema.optional(),
  pressure: RawEnvelopeSchema.optional(),
  /** `<RecipeTier>` value (e.g. "TierTwo"); semantics unverified. */
  tier: RawSourceTextSchema.optional(),
  provenance: ProvenanceSchema,
});
export type RawRecipe = z.infer<typeof RawRecipeSchema>;

export const RawItemSchema = z.object({
  type: z.literal('item'),
  id: z.string(),
  displayName: z.string().optional(),
  category: z.string().optional(),
  provenance: ProvenanceSchema,
});
export type RawItem = z.infer<typeof RawItemSchema>;

export const RawWorldRefSchema = z.object({
  type: z.literal('worldref'),
  id: z.string(),
  kind: z.string(),
  values: z.array(z.string()),
  provenance: ProvenanceSchema,
});
export type RawWorldRef = z.infer<typeof RawWorldRefSchema>;

export const RawRecordSchema = z.discriminatedUnion('type', [
  RawRecipeSchema,
  RawItemSchema,
  RawWorldRefSchema,
]);
export type RawRecord = z.infer<typeof RawRecordSchema>;
