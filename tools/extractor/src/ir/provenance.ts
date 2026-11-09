/**
 * Provenance and data-quality levels for the extraction IR (spec 6.5).
 *
 * The quality-level union is the single source of truth in `@stationeers/domain`;
 * it is re-exported here as a type-only import so the extractor cannot drift
 * from the domain model.
 */
import type { DataQuality } from '@stationeers/domain';
import { z } from 'zod';

/** Ordered tuple of the 6.5 quality levels; doubles as the zod enum source. */
export const QUALITY_LEVELS = [
  'extracted-and-validated',
  'extracted-unverified',
  'missing',
  'conflicting',
  'inferred',
] as const;

export const QualityLevelSchema = z.enum(QUALITY_LEVELS);
export type QualityLevel = z.infer<typeof QualityLevelSchema>;

// Compile-time guard: fails to compile when the runtime enum above is missing
// any DataQuality member, i.e. the extractor cannot drift from the domain union.
type _MissingLevels = Exclude<DataQuality, (typeof QUALITY_LEVELS)[number]>;
const _missingLevels: never = undefined as (_MissingLevels extends never ? never : undefined);

/** Provenance of a record (6.5): where it came from and how trustworthy it is. */
export const ProvenanceSchema = z.object({
  sourceFile: z.string(),
  sourcePath: z.string(),
  qualityLevel: QualityLevelSchema,
  notes: z.string().optional(),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

/**
 * Per-field provenance override. Attaches to a record when one field's
 * quality diverges from the record-level provenance — e.g. a unit-converted
 * quantity is 'inferred' with the calculation named in `notes`.
 */
export const FieldProvenanceOverrideSchema = z.object({
  qualityLevel: QualityLevelSchema,
  notes: z.string().optional(),
});
export type FieldProvenanceOverride = z.infer<typeof FieldProvenanceOverrideSchema>;

/**
 * Combine a record-level provenance and a field override into a full
 * Provenance, for consumers that need to ask about a single field.
 */
export function resolveFieldProvenance(
  base: Provenance,
  override?: FieldProvenanceOverride,
): Provenance {
  if (!override) return base;
  return { ...base, qualityLevel: override.qualityLevel, notes: override.notes };
}
