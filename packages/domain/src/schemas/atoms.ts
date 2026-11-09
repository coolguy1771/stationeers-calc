/**
 * Atomic schemas shared by every entity schema (4.1, 4.2, 4.3, 5.2, 8).
 * Every entity in `src/entities.ts` has a matching schema here; the two must
 * not drift (contract test: `schemas/contract.test.ts`).
 */
import { z } from './zod';
import { MAX_ID_LENGTH, MAX_COORDINATE } from './limits';

/** Stable identifier of a stored entity, unique within a project. */
export const EntityIdSchema = z.string().min(1).max(MAX_ID_LENGTH);

/** Game-native identifier of a definition inside a data pack (6.3). */
export const DefinitionIdSchema = z.string().min(1).max(MAX_ID_LENGTH);

/** Identifier of a versioned data pack (6.4). */
export const PackIdSchema = z.string().min(1).max(MAX_ID_LENGTH);

/** Distribution channel of a pack (6.7). */
export const PackChannelSchema = z.enum(['published', 'user-generated']);

/** Data-quality level of an extracted property (6.5). */
export const DataQualitySchema = z.enum([
  'extracted-and-validated',
  'extracted-unverified',
  'missing',
  'conflicting',
  'inferred',
]);

/** Connection domains a port may belong to (4.3). Gas and liquid networks are distinct media. */
export const ConnectionMediumSchema = z.enum([
  'gas-pipe',
  'liquid-pipe',
  'electrical',
  'data',
  'chute',
  'room',
  'thermal',
]);

/** Which game grid an element snaps to (4.2). */
export const GridKindSchema = z.enum(['large', 'small']);

/** Mounting surfaces an orientation set may contain (4.2). */
export const MountSurfaceSchema = z.enum(['floor', 'wall', 'ceiling', 'freestanding']);

/** Yaw in 90° steps around the mount normal; meaning is per definition (4.2). */
export const YawSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

/** Integer cell on the element's grid (4.2). */
export const GridCellSchema = z.object({
  x: z.number().int().min(-MAX_COORDINATE).max(MAX_COORDINATE),
  y: z.number().int().min(-MAX_COORDINATE).max(MAX_COORDINATE),
  z: z.number().int().min(-MAX_COORDINATE).max(MAX_COORDINATE),
}).strict();

/**
 * Enumerated orientation (4.2). Each DeviceDefinition declares the exact set it allows,
 * sourced from extraction; instances must use a member of that set.
 */
export const OrientationSchema = z.object({
  surface: MountSurfaceSchema,
  yaw: YawSchema,
}).strict();

/** Local position/direction within a device footprint, transformed by orientation (4.2, 4.3). */
export const LocalVectorSchema = z.object({
  x: z.number().finite().min(-MAX_COORDINATE).max(MAX_COORDINATE),
  y: z.number().finite().min(-MAX_COORDINATE).max(MAX_COORDINATE),
  z: z.number().finite().min(-MAX_COORDINATE).max(MAX_COORDINATE),
}).strict();

export const PhaseSchema = z.enum(['gas', 'liquid', 'solid']);

/** User-settable device value (extracted definitions declare the schema per setting). */
export const SettingValueSchema = z.union([z.number().finite(), z.string(), z.boolean()]);

/** Model status vocabulary (5.2); weakest status wins in propagation (5.2.2). */
export const ModelStatusSchema = z.enum(['verified', 'unverified', 'unsupported', 'incompatible']);

/** Topology status vocabulary (3.5). */
export const TopologyStatusSchema = z.enum(['buildable', 'conceptual']);

/** Diagnostic severity (8). */
export const SeveritySchema = z.enum(['error', 'warning', 'info']);