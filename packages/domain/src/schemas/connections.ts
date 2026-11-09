/** Physical connections and ConnectionIntents (3.3, 9.1). */
import { z } from './zod';
import { ConnectionMediumSchema, EntityIdSchema } from './atoms';
import { displayString } from './display';
import { PortRefSchema } from './ports';
import { MAX_ELEMENTS_PER_CONNECTION, MAX_LABEL_LENGTH } from './limits';

/**
 * A physical connection composed of actual build elements (3.3).
 * Elements are ConstructionElement ids; empty means directly adjacent ports.
 */
export const PhysicalConnectionSchema = z.object({
  id: EntityIdSchema,
  medium: ConnectionMediumSchema,
  elements: z.array(EntityIdSchema).max(MAX_ELEMENTS_PER_CONNECTION),
  endpoints: z.tuple([PortRefSchema, PortRefSchema]),
}).strict();

/**
 * A user-declared logical connection, not yet (or no longer) realized physically (3.3).
 * Canonical stored entity; its topology status is derived, never stored (9.1).
 */
export const ConnectionIntentSchema = z.object({
  id: EntityIdSchema,
  medium: ConnectionMediumSchema,
  from: PortRefSchema,
  to: PortRefSchema,
  label: displayString(MAX_LABEL_LENGTH).optional(),
}).strict();
