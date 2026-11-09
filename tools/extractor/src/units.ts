/**
 * Unit conversion for the provisional format (EXT-01).
 *
 * The provisional grammar uses mass units g and kg (and count units). The
 * canonical mass unit in the IR is kg; the normalizer converts g to kg and
 * records the conversion as a 'inferred' fieldProvenance with the
 * calculation named (spec 6.5: inferred must name its calculation).
 */

/** Canonical mass unit in the IR. */
export const CANONICAL_MASS_UNIT = 'kg';

/** Conversion factor from grams to kilograms. */
const G_TO_KG = 1e-3;

/**
 * Convert a quantity to the canonical unit for its unit family.
 * Returns the canonical quantity and unit, or null when the unit is
 * unknown (the normalizer then keeps the unit verbatim and reports it).
 */
export function convertQuantity(
  quantity: number,
  unit: string,
): { quantity: number; unit: string } | null {
  switch (unit) {
    case 'g':
      return { quantity: quantity * G_TO_KG, unit: CANONICAL_MASS_UNIT };
    case CANONICAL_MASS_UNIT:
      return { quantity, unit };
    default:
      return null;
  }
}

/**
 * Human-readable name of the conversion calculation, for the
 * 'inferred' fieldProvenance notes (spec 6.5).
 */
export function conversionNote(fromUnit: string, toUnit: string): string {
  return `unit conversion ${fromUnit} -> ${toUnit}`;
}
