/** Inventory state (4.5). */
import { z } from './zod';
import { PhaseSchema } from './atoms';
import { MAX_SPECIES_PER_INVENTORY } from './limits';

export const SpeciesAmountSchema = z.object({
  speciesId: z.string().min(1),
  phase: PhaseSchema,
  moles: z.number().finite(),
}).strict();

/**
 * Canonical inventory state (4.5): moles by species and phase, plus exactly one
 * canonical thermal variable for the pinned build. Everything else (pressure,
 * partial pressures, composition) is derived on read, never stored (9.1).
 */
export const InventoryStateSchema = z.object({
  species: z.array(SpeciesAmountSchema).max(MAX_SPECIES_PER_INVENTORY),
  thermal: z
    .object({
      kind: z.enum(['temperature', 'internal-energy']),
      value: z.number().finite(),
      unit: z.string().min(1),
    })
    .strict(),
}).strict();
