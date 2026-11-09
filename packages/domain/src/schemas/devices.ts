/** Device definition and instance schemas (4.1, 4.2, 3.3). */
import { z } from './zod';
import { displayString } from './display';
import { InventoryStateSchema } from './inventory';
import { PortDefinitionSchema, PortInstanceSchema, ConstructionRequirementSchema, FootprintCellSchema } from './ports';
import { GridKindSchema, GridCellSchema, OrientationSchema, SettingValueSchema } from './atoms';
import { DataQualitySchema, DefinitionIdSchema, EntityIdSchema } from './atoms';
import { MAX_PORT_DEFINITIONS_PER_DEVICE, MAX_PORTS_PER_DEVICE, MAX_FOOTPRINT_CELLS_PER_DEVICE, MAX_ORIENTATIONS_PER_DEVICE, MAX_CONSTRUCTION_REQUIREMENTS_PER_DEVICE, MAX_SETTING_KEYS, MAX_DISPLAY_NAME_LENGTH } from './limits';
import { boundedRecord } from './records';

/**
 * Extracted device definition from a data pack. A device appears in the catalog
 * even when some of its capabilities are unsupported (6.5).
 */
export const DeviceDefinitionSchema = z.object({
  id: DefinitionIdSchema,
  /** Display name from the pack; never used as a key (6.3). */
  displayName: displayString(MAX_DISPLAY_NAME_LENGTH),
  category: z.string(),
  grid: GridKindSchema,
  allowedOrientations: z.array(OrientationSchema).max(MAX_ORIENTATIONS_PER_DEVICE),
  footprint: z.array(FootprintCellSchema).max(MAX_FOOTPRINT_CELLS_PER_DEVICE),
  ports: z.array(PortDefinitionSchema).max(MAX_PORT_DEFINITIONS_PER_DEVICE),
  /** Boundary vs pass-through with respect to shared-volume networks (4.4). */
  networkRole: z.enum(['boundary', 'passthrough']).optional(),
  construction: z.array(ConstructionRequirementSchema).max(MAX_CONSTRUCTION_REQUIREMENTS_PER_DEVICE),
  sourceQuality: DataQualitySchema,
}).strict();

/** A placed-or-unplaced engineering component (3.3, SYNC-001). */
export const DeviceInstanceSchema = z.object({
  id: EntityIdSchema,
  definitionId: DefinitionIdSchema,
  ports: z.array(PortInstanceSchema).max(MAX_PORTS_PER_DEVICE),
  /** References PhysicalPlacement.id; absence means unplaced (3.3). */
  placementId: EntityIdSchema.optional(),
  settings: boundedRecord(z.string(), SettingValueSchema, MAX_SETTING_KEYS),
  /** Contained inventory for devices with storage state (4.5). */
  inventory: InventoryStateSchema.optional(),
}).strict();

/** Physical placement (3.2, 4.2). */
export const PhysicalPlacementSchema = z.object({
  id: EntityIdSchema,
  grid: GridKindSchema,
  cell: GridCellSchema,
  /** Floor/level index (3.2). */
  level: z.number().int(),
  orientation: OrientationSchema,
}).strict();
