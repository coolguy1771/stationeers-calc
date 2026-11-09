/**
 * IR record schemas (EXT-01/EXT-01b): the intermediate representation that the
 * normalizer produces from raw records. Every record carries provenance;
 * fields whose provenance or source location diverges from the record-level
 * provenance (missing-in-source, unverified unit, converted value) are recorded
 * in `fieldProvenance`.
 */
import { z } from 'zod';
import { ProvenanceSchema, FieldProvenanceOverrideSchema } from './provenance';

/**
 * Unit status of a source number (spec 6.5). Adapter A cannot establish
 * whether a recipe amount is mass, count, or moles, so every quantity it
 * emits is 'unverified' and keeps the exact source text. 'verified' (with a
 * `unit` symbol) is what a later validation step may promote an amount to.
 */
export const UNIT_STATUSES = ['unverified', 'verified'] as const;
export const UnitStatusSchema = z.enum(UNIT_STATUSES);
export type UnitStatus = z.infer<typeof UnitStatusSchema>;

/**
 * A number from the source: exact text, parsed value, and how well its unit is
 * understood. Consumers must gate on `unitStatus` before doing arithmetic that
 * assumes a unit (spec 6.5: a verified calculation may consume only validated
 * properties).
 */
export const SourceNumberSchema = z.object({
  /** Exact decimal text as it appears in the source, e.g. ".5". */
  text: z.string(),
  /** Parsed value of `text`; the same number the game reads. */
  value: z.number(),
  unitStatus: UnitStatusSchema,
  /** Unit symbol, present only once its semantics are verified. */
  unit: z.string().optional(),
});
export type SourceNumber = z.infer<typeof SourceNumberSchema>;

/** A two-bound condition envelope (`<Start>`/`<Stop>`), each bound optional. */
export const EnvelopeSchema = z.object({
  start: SourceNumberSchema.optional(),
  stop: SourceNumberSchema.optional(),
});
export type Envelope = z.infer<typeof EnvelopeSchema>;

/**
 * Recipe input: a material name and its declared amount. `materialName` is the
 * ingredient element name (`<Steel>`, `<Fenoxitone>`), not a prefab id — the
 * XML does not state how a material name maps to a prefab id.
 */
export const RecipeInputSchema = z.object({
  materialName: z.string(),
  quantity: SourceNumberSchema,
});
export type RecipeInput = z.infer<typeof RecipeInputSchema>;

/**
 * Recipe output: the `<PrefabName>` this recipe produces, plus the amount when
 * the source declares one (`<Output>`). Absent `quantity` means the source does
 * not declare an amount — never 1, and never a guess.
 */
export const RecipeOutputSchema = z.object({
  prefabId: z.string(),
  quantity: SourceNumberSchema.optional(),
});
export type RecipeOutput = z.infer<typeof RecipeOutputSchema>;

/**
 * Recipe identity is `"<family>/<prefabId>"`; when one family declares several
 * distinct recipes for the same output (real data does this), the alternates
 * are numbered in source order: `"<family>/<prefabId>#2"`, `"#3"`, …
 */
export const RecipeSchema = z.object({
  id: z.string(),
  /** Display name is not in the XML; the normalizer marks it 'missing'. */
  displayName: z.string(),
  /** Wrapper element name that declares this recipe's family, e.g. "AutolatheRecipes". */
  family: z.string(),
  output: RecipeOutputSchema,
  inputs: z.array(RecipeInputSchema),
  time: SourceNumberSchema.optional(),
  energy: SourceNumberSchema.optional(),
  temperature: EnvelopeSchema.optional(),
  pressure: EnvelopeSchema.optional(),
  /** `<RecipeTier>` (e.g. "TierTwo"): printer tier, semantics unverified. */
  tier: z.string().optional(),
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

/**
 * Version of the intermediate representation; bump on a breaking change.
 * 2 (EXT-01b): recipe identity is family-scoped, quantities carry source text
 * and a unit status, recipes carry typed control fields, `station` was replaced
 * by the source's `family`.
 */
export const IR_VERSION = 2;

export const IrDataSchema = z.object({
  irVersion: z.literal(IR_VERSION),
  recipes: z.array(RecipeSchema),
  items: z.array(ItemSchema),
  worldRefs: z.array(WorldRefSchema),
});
export type IrData = z.infer<typeof IrDataSchema>;
