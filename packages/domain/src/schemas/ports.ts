/** Port schemas (4.3). */
import { z } from './zod';
import {
  ConnectionMediumSchema,
  DataQualitySchema,
  DefinitionIdSchema,
  EntityIdSchema,
  GridCellSchema,
  LocalVectorSchema,
} from './atoms';
import { MAX_CATEGORIES_PER_PORT, MAX_CAPABILITIES_PER_PORT } from './limits';

export const PortDefinitionSchema = z.object({
  id: DefinitionIdSchema,
  medium: ConnectionMediumSchema,
  /** Local position on the device footprint (4.3). */
  localPosition: LocalVectorSchema,
  /** Outward direction used for connector alignment validation (7.4). */
  direction: LocalVectorSchema,
  /** Compatible construction categories (4.3). */
  categories: z.array(z.string()).max(MAX_CATEGORIES_PER_PORT),
  /** Passive = direct join; device = joins networks through device logic (4.4). */
  mediation: z.enum(['passive', 'device']),
  /** Port-specific capabilities (e.g. 'heat-exchange', 'power-input'). */
  capabilities: z.array(z.string()).max(MAX_CAPABILITIES_PER_PORT),
  sourceQuality: DataQualitySchema,
}).strict();

export const PortInstanceSchema = z.object({
  id: EntityIdSchema,
  definitionId: DefinitionIdSchema,
}).strict();

/** Endpoint reference for a connection or intent. */
export const PortRefSchema = z.object({
  instanceId: EntityIdSchema,
  portId: EntityIdSchema,
}).strict();

export const ConstructionRequirementSchema = z.object({
  elementId: DefinitionIdSchema,
  quantity: z.number().int().min(0),
}).strict();

export const FootprintCellSchema = z.object({
  /** Local cell offset from the device origin, on the device's grid. */
  local: GridCellSchema,
  /** True when the cell is solid and blocks incompatible equipment (4.2). */
  solid: z.boolean(),
}).strict();
