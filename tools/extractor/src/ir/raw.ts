/**
 * Raw record contract (EXT-01): the shape adapters emit for the normalizer.
 * The provisional XML adapter produces the recipe/item subset; the WorldRef
 * member is defined here so future adapters slot in without changing the
 * normalizer.
 *
 * Optional fields are absent (undefined) when the source does not have them;
 * the normalizer never receives a fabricated default (spec 6.3, 4.7).
 */
import { z } from 'zod';
import { ProvenanceSchema } from './provenance';

/** Ingredient as parsed by an adapter, before unit canonicalization. */
export const RawIngredientSchema = z.object({
  itemId: z.string(),
  quantity: z.number(),
  unit: z.string(),
});
export type RawIngredient = z.infer<typeof RawIngredientSchema>;

export const RawRecipeSchema = z.object({
  type: z.literal('recipe'),
  id: z.string(),
  displayName: z.string().optional(),
  inputs: z.array(RawIngredientSchema),
  outputs: z.array(RawIngredientSchema),
  station: z.string().optional(),
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
