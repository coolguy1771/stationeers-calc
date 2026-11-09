/**
 * Data quality (spec 6.5): the five levels, the property resolver consumers ask
 * through, and the Verified link.
 *
 * The link is a hard rule (also AGENTS.md #3): a Verified capability may consume
 * only properties at `extracted-and-validated`. Everything else downgrades the
 * result to Unverified, with a diagnostic naming the input. `assertCapabilityVerified`
 * is that gate — it fails closed, treating an unknown entity or property as
 * `missing`.
 */
import { z } from 'zod';
import { MAX_ID_LENGTH, type DataQuality } from '@stationeers/domain';
import { PackError, PackErrorCode } from './errors';
import {
  MAX_APPROVER_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_PROMOTIONS,
  MAX_PROPERTY_PATH_LENGTH,
  MAX_UNIT_LENGTH,
} from './limits';
import { IsoUtcSchema, type Pack, type PackedDevice, type PackedItem, type PackedNumber, type PackedRecipe, type ReadonlyPack } from './schema';

/** The only level that may back a Verified capability (spec 6.5). */
export const VALIDATED_QUALITY = 'extracted-and-validated' as const;

/** Entity collections a property can live in. */
export const PACK_ENTITY_TYPES = ['recipe', 'item', 'device'] as const;
export type PackEntityType = (typeof PACK_ENTITY_TYPES)[number];

/** Any packed entity, discriminated by its collection. */
export type PackedEntity = PackedRecipe | PackedItem | PackedDevice;

/**
 * A single property of one entity — the unit of the §6.5 link. E.g.
 * `{ entityType: 'recipe', entityId: 'AutolatheRecipes/ItemSteelIngot',
 * property: 'time' }`.
 */
export interface PropertyRef {
  entityType: PackEntityType;
  entityId: string;
  property: string;
}

/**
 * The promotion input (spec 6.5): the only way a property becomes
 * `extracted-and-validated`.
 *
 * It is deliberately a list of named properties with an approver, a timestamp,
 * and an evidence reference — never a boolean or a "trust everything" flag.
 * Each entry is recorded in the pack, so a reviewer can trace every validated
 * value back to who validated it and against what.
 */
export const PromotionSchema = z
  .object({
    entityType: z.enum(PACK_ENTITY_TYPES),
    entityId: z.string().min(1).max(MAX_ID_LENGTH),
    property: z.string().min(1).max(MAX_PROPERTY_PATH_LENGTH),
    /** Who validated it (person or process). */
    approvedBy: z.string().min(1).max(MAX_APPROVER_LENGTH),
    approvedAt: IsoUtcSchema,
    /** The evidence: fixture id, review thread, cross-check result. */
    reference: z.string().min(1).max(MAX_NOTE_LENGTH),
    /**
     * For a quantity, the unit semantics this approval establishes (e.g. `"s"`
     * for `<Time>`). Adapter A cannot establish whether a number is mass, count,
     * or moles, so a quantity can only be validated once someone names the unit —
     * and that claim is recorded with the approval. Absent for non-quantities.
     */
    unit: z.string().min(1).max(MAX_UNIT_LENGTH).optional(),
  })
  .strict();
export type Promotion = z.infer<typeof PromotionSchema>;

/**
 * The promotion file. `promotions` must be non-empty: supplying an empty list is
 * a mistake, not an instruction, and silently accepting it would make "nothing
 * validated" indistinguishable from "validation step ran and did nothing".
 */
export const PromotionInputSchema = z
  .object({
    promotions: z.array(PromotionSchema).min(1).max(MAX_PROMOTIONS),
  })
  .strict();
export type PromotionInput = z.infer<typeof PromotionInputSchema>;

/**
 * A resolved property value, for unit checks, promotion, and the diff seam.
 *
 * A number slot carries a writer, so a promotion that establishes unit
 * semantics writes the verified unit back to the one place the value lives
 * instead of keeping a second copy of the mapping.
 */
export type ResolvedProperty =
  | { kind: 'number'; number: PackedNumber; set(value: PackedNumber): void }
  | { kind: 'text'; text: string }
  | { kind: 'absent' };

const INPUT_QUANTITY_PATH = /^inputs\[(\d+)\]\.quantity$/;

function numberSlot(
  number: PackedNumber | undefined,
  write: (value: PackedNumber) => void,
): ResolvedProperty {
  return number === undefined ? { kind: 'absent' } : { kind: 'number', number, set: write };
}

/**
 * Resolve one property path to the value it names, or `undefined` when the path
 * is not part of the entity's vocabulary. Paths mirror the extractor IR's
 * `fieldProvenance` keys, so an extracted field and a packed property are
 * addressable by the same string.
 */
export function resolveEntityProperty(
  entityType: PackEntityType,
  entity: PackedEntity,
  property: string,
): ResolvedProperty | undefined {
  if (entityType === 'recipe') {
    const recipe = entity as PackedRecipe;
    switch (property) {
      case 'displayName':
        return { kind: 'text', text: recipe.displayName };
      case 'output.prefabId':
        return { kind: 'text', text: recipe.output.prefabId };
      case 'output.quantity':
        return numberSlot(recipe.output.quantity, (value) => {
          recipe.output.quantity = value;
        });
      case 'time':
        return numberSlot(recipe.time, (value) => {
          recipe.time = value;
        });
      case 'energy':
        return numberSlot(recipe.energy, (value) => {
          recipe.energy = value;
        });
      case 'temperature.start':
        return numberSlot(recipe.temperature?.start, (value) => {
          if (recipe.temperature !== undefined) recipe.temperature.start = value;
        });
      case 'temperature.stop':
        return numberSlot(recipe.temperature?.stop, (value) => {
          if (recipe.temperature !== undefined) recipe.temperature.stop = value;
        });
      case 'pressure.start':
        return numberSlot(recipe.pressure?.start, (value) => {
          if (recipe.pressure !== undefined) recipe.pressure.start = value;
        });
      case 'pressure.stop':
        return numberSlot(recipe.pressure?.stop, (value) => {
          if (recipe.pressure !== undefined) recipe.pressure.stop = value;
        });
      case 'tier':
        return recipe.tier === undefined ? { kind: 'absent' } : { kind: 'text', text: recipe.tier };
      default: {
        const match = INPUT_QUANTITY_PATH.exec(property);
        if (match === null) return undefined;
        const index = Number(match[1]);
        const input = recipe.inputs[index];
        return numberSlot(input?.quantity, (value) => {
          if (input !== undefined) input.quantity = value;
        });
      }
    }
  }

  if (entityType === 'item') {
    const item = entity as PackedItem;
    if (property === 'displayName') return { kind: 'text', text: item.displayName };
    if (property === 'category') return item.category === undefined ? { kind: 'absent' } : { kind: 'text', text: item.category };
    return undefined;
  }

  const device = entity as PackedDevice;
  switch (property) {
    case 'displayName':
      return { kind: 'text', text: device.definition.displayName };
    case 'category':
      return { kind: 'text', text: device.definition.category };
    case 'sourceQuality':
      return { kind: 'text', text: device.definition.sourceQuality };
    default:
      return undefined;
  }
}

/** Find one entity in a pack, by collection and id. */
export function findEntity(
  pack: ReadonlyPack,
  entityType: PackEntityType,
  entityId: string,
): PackedEntity | undefined {
  const collection =
    entityType === 'recipe' ? pack.payload.recipes : entityType === 'item' ? pack.payload.items : pack.payload.devices;
  return collection.find((entity) => entity.id === entityId) as PackedEntity | undefined;
}

/**
 * Quality of one property, as a consumer asks for it. Fails closed: an entity or
 * property the pack does not carry is `missing`, never validated.
 */
export function propertyQuality(pack: ReadonlyPack, ref: PropertyRef): DataQuality {
  const entity = findEntity(pack, ref.entityType, ref.entityId);
  if (entity === undefined) return 'missing';
  return entity.properties[ref.property]?.quality ?? 'missing';
}

/** Whether one property may back a Verified calculation (spec 6.5). */
export function canBackVerified(pack: ReadonlyPack, ref: PropertyRef): boolean {
  return propertyQuality(pack, ref) === VALIDATED_QUALITY;
}

/** A capability that wants to be reported Verified, and the properties it reads. */
export interface CapabilityClaim {
  /** Stable capability id, e.g. "atmospheric-static". */
  id: string;
  consumes: readonly PropertyRef[];
}

function formatRef(ref: PropertyRef): string {
  return `${ref.entityType} ${ref.entityId} property ${ref.property}`;
}

/**
 * Enforce the §6.5 link: throw when any consumed property is not
 * `extracted-and-validated`. Callers that report a Verified capability run this
 * first; on failure the result must be reported Unverified instead (never
 * "exact").
 */
export function assertCapabilityVerified(pack: ReadonlyPack, claim: CapabilityClaim): void {
  const offending = claim.consumes.filter((ref) => !canBackVerified(pack, ref));
  if (offending.length === 0) return;
  throw new PackError(
    PackErrorCode.CapabilityUnvalidatedInput,
    `capability "${claim.id}" cannot be Verified (spec 6.5): ${offending.length} of ${claim.consumes.length} consumed properties are not extracted-and-validated`,
    offending.map((ref) => `${formatRef(ref)} is ${propertyQuality(pack, ref)}`),
  );
}

/**
 * Check the invariants a validated property must satisfy, wherever a pack comes
 * from (spec 6.5, 9.4). The schema already requires an approval record; this
 * adds the semantic half:
 *
 * - a validated property must exist in the entity's vocabulary and have a value;
 * - a validated *quantity* must have a verified unit, because a number without
 *   unit semantics cannot back exact arithmetic;
 * - a device whose definition claims validated quality must say so through its
 *   property map.
 */
export function assertQualityInvariants(pack: Pack): void {
  const problems: string[] = [];

  const checkEntity = (entityType: PackEntityType, entity: PackedEntity): void => {
    for (const [property, quality] of Object.entries(entity.properties)) {
      if (quality.quality !== VALIDATED_QUALITY) continue;
      const label = `${entityType} "${entity.id}" property "${property}"`;
      const resolved = resolveEntityProperty(entityType, entity, property);
      if (resolved === undefined) {
        problems.push(`${label} is marked validated but is not part of the entity's property vocabulary`);
        continue;
      }
      if (resolved.kind === 'absent') {
        problems.push(`${label} is marked validated but carries no value`);
        continue;
      }
      if (resolved.kind === 'number') {
        const unitKnown = resolved.number.unitStatus === 'verified' && resolved.number.unit !== undefined;
        if (!unitKnown) {
          problems.push(`${label} is marked validated but its unit is unverified (source text "${resolved.number.text}")`);
        }
      }
    }
  };

  for (const recipe of pack.payload.recipes) checkEntity('recipe', recipe);
  for (const item of pack.payload.items) checkEntity('item', item);
  for (const device of pack.payload.devices) {
    checkEntity('device', device);
    if (device.definition.sourceQuality === VALIDATED_QUALITY) {
      const declared = device.properties['sourceQuality']?.quality;
      if (declared !== VALIDATED_QUALITY) {
        problems.push(
          `device "${device.id}" definition claims validated quality, but its property map does not record an approval`,
        );
      }
    }
  }

  if (problems.length > 0) {
    throw new PackError(
      PackErrorCode.QualityInvariant,
      'pack breaks a data-quality invariant (spec 6.5)',
      problems,
    );
  }
}
