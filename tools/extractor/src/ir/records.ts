/**
 * IR record schemas (EXT-01): the intermediate representation that the
 * normalizer produces from raw records. Every record carries provenance;
 * fields whose provenance diverges from the record-level provenance (e.g.
 * unit-converted quantities) are recorded in `fieldProvenance`.
 */
import { z } from 'zod';
import { ProvenanceSchema, FieldProvenanceOverrideSchema } from './provenance';

/** Recipe ingredient: quantity is in canonical units (see IR_UNIT_TABLE). */
export const IngredientSchema = z.object({
  itemId: z.string(),
  quantity: z.number(),
  unit: z.string(),
});
export type Ingredient = z.infer<typeof IngredientSchema>;

export const RecipeSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  inputs: z.array(IngredientSchema),
  outputs: z.array(IngredientSchema),
  station: z.string().optional(),
  provenance: ProvenanceSchema,
  fieldProvenance: z.record(z.string(), FieldProvenanceOverrideSchema).optional(),
});
export type Recipe = z.infer<typeof RecipeSchema>;

export const ItemSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  category: z.string().optional(),
  provenance: ProvenanceSchema,
  fieldProvenance: z.record(z.string(), FieldProvenanceOverrideSchema).optional(),
});
export type Item = z.infer<typeof ItemSchema>;

export const WorldRefSchema = z.object({
  id: z.string(),
  kind: z.string(),
  values: z.array(z.string()),
  provenance: ProvenanceSchema,
  fieldProvenance: z.record(z.string(), FieldProvenanceOverrideSchema).optional(),
});
export type WorldRef = z.infer<typeof WorldRefSchema>;

/** Version of the intermediate representation; bump on a breaking change. */
export const IR_VERSION = 1;

export const IrDataSchema = z.object({
  irVersion: z.literal(IR_VERSION),
  recipes: z.array(RecipeSchema),
  items: z.array(ItemSchema),
  worldRefs: z.array(WorldRefSchema),
});
export type IrData = z.infer<typeof IrDataSchema>;
