/** Construction elements (3.3, 4.7). */
import { z } from './zod';
import { GridKindSchema, GridCellSchema, DefinitionIdSchema, EntityIdSchema } from './atoms';
import { MAX_CELLS_PER_CONSTRUCTION } from './limits';

export const ConstructionKindSchema = z.enum([
  'pipe-segment',
  'pipe-junction',
  'pipe-bend',
  'cable',
  'cable-junction',
  'frame',
  'wall',
  'floor',
  'other',
]);

/**
 * A build element (pipe segment, cable run, wall, …). Per-element internal volume
 * is populated only from verified extraction (4.7); absence forces Conceptual status.
 */
export const ConstructionElementSchema = z.object({
  id: EntityIdSchema,
  kind: ConstructionKindSchema,
  definitionId: DefinitionIdSchema,
  grid: GridKindSchema,
  cells: z.array(GridCellSchema).max(MAX_CELLS_PER_CONSTRUCTION),
  level: z.number().int(),
  /** Internal volume in m³ when verified; optional until extracted (4.7). */
  volume: z.number().finite().optional(),
}).strict();
