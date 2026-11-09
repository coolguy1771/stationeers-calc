/** Scenario (4.1, 4.7). */
import { z } from './zod';
import { SettingValueSchema } from './atoms';
import { displayString } from './display';
import { InventoryStateSchema } from './inventory';
import { EntityIdSchema } from './atoms';
import { MAX_DISPLAY_NAME_LENGTH, MAX_INVENTORIES_PER_SCENARIO, MAX_DEVICE_SETTINGS_PER_SCENARIO } from './limits';
import { boundedRecord } from './records';

/**
 * A reproducible scenario (4.1). Inventories key on a stable network reference
 * (the intent or connection id it seeds). Assumed volumes are explicit user
 * assumptions for unrouted/unplaced networks and force Conceptual status (4.7).
 */
export const ScenarioSchema = z.object({
  id: EntityIdSchema,
  name: displayString(MAX_DISPLAY_NAME_LENGTH),
  inventories: boundedRecord(EntityIdSchema, InventoryStateSchema, MAX_INVENTORIES_PER_SCENARIO),
  assumedVolumes: boundedRecord(EntityIdSchema, z.number().finite(), MAX_INVENTORIES_PER_SCENARIO),
  /** Per-device overrides applied during the run; references DeviceInstance.id. */
  deviceSettings: boundedRecord(EntityIdSchema, z.record(z.string(), SettingValueSchema), MAX_DEVICE_SETTINGS_PER_SCENARIO).optional(),
}).strict();
