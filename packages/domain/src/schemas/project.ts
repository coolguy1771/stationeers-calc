/**
 * The canonical project bundle (spec 9.1) and its boundary helpers.
 *
 * Derived entities (resolved networks, rooms, intent topology status) are
 * absent by design; they are recomputed on load (9.1). Unknown future
 * schema versions are rejected explicitly, never silently coerced (9.2).
 */
import { z } from './zod';
import type { Z } from './zod';
import type { Project } from '../entities';
import { displayString } from './display';
import { EntityIdSchema, PackChannelSchema, PackIdSchema } from './atoms';
import { DeviceInstanceSchema, PhysicalPlacementSchema } from './devices';
import { ConstructionElementSchema } from './construction';
import { PhysicalConnectionSchema, ConnectionIntentSchema } from './connections';
import { ScenarioSchema } from './scenario';
import { boundedRecord } from './records';
import { MAX_DEVICES, MAX_PLACEMENTS, MAX_CONSTRUCTION, MAX_CONNECTIONS, MAX_INTENTS, MAX_SCENARIOS, MAX_NODE_POSITIONS, MAX_DISPLAY_NAME_LENGTH } from './limits';

/** Current project schema version. Bump and add a migration when the bundle shape changes (9.2). */
export const PROJECT_SCHEMA_VERSION = 1;

/**
 * Stable codes for bundle parse failures (spec 8). `PROJECT-SCHEMA-FUTURE` is
 * the explicit rejection of unknown future schema versions (9.2).
 */
export const ProjectBundleErrorCode = {
  /** The payload is not a project bundle object at all. */
  Malformed: 'PROJECT-SCHEMA-MALFORMED',
  /** The payload is a future schema version; do not silently coerce. */
  Future: 'PROJECT-SCHEMA-FUTURE',
  /** The payload fails schema validation for the current version. */
  Invalid: 'PROJECT-SCHEMA-INVALID',
} as const;

export type ProjectBundleErrorCode = (typeof ProjectBundleErrorCode)[keyof typeof ProjectBundleErrorCode];

/** Boundary parse failure carrying a stable code, a human message, and the raw issue list. */
export class ProjectBundleError extends Error {
  readonly code: ProjectBundleErrorCode;
  readonly issues: string[];

  constructor(code: ProjectBundleErrorCode, message: string, issues: string[] = []) {
    super(message);
    this.name = 'ProjectBundleError';
    this.code = code;
    this.issues = issues;
  }
}

export const ProjectMetaSchema = z.object({
  schemaVersion: z.number().int().min(1),
  id: EntityIdSchema,
  name: displayString(MAX_DISPLAY_NAME_LENGTH),
  /** ISO 8601 timestamps. */
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  packId: PackIdSchema,
  packHash: z.string().min(1),
  gameBuild: z.string().min(1),
  channel: PackChannelSchema,
}).strict();

export const ProjectSettingsSchema = z.object({
  autoSave: z.boolean(),
  /** Opt-in for experimental (Unverified) output (5.2). */
  showExperimental: z.boolean(),
}).strict();

/** Presentation-only schematic layout metadata (9.1). */
export const SchematicLayoutSchema = z
  .object({
    nodePositions: boundedRecord(EntityIdSchema, z.object({ x: z.number().finite(), y: z.number().finite() }).strict(), MAX_NODE_POSITIONS),
  })
  .strict();

/**
 * The portable project bundle, version 1 (9.1). Derived entities are absent
 * by design; they are recomputed on load.
 */
export const ProjectBundleSchema = z
  .object({
    schemaVersion: z.number().int().min(1).max(PROJECT_SCHEMA_VERSION),
    meta: ProjectMetaSchema,
    devices: z.array(DeviceInstanceSchema).max(MAX_DEVICES),
    placements: z.array(PhysicalPlacementSchema).max(MAX_PLACEMENTS),
    construction: z.array(ConstructionElementSchema).max(MAX_CONSTRUCTION),
    connections: z.array(PhysicalConnectionSchema).max(MAX_CONNECTIONS),
    /** ConnectionIntents serialized separately from physical connections (9.1). */
    intents: z.array(ConnectionIntentSchema).max(MAX_INTENTS),
    scenarios: z.array(ScenarioSchema).max(MAX_SCENARIOS),
    settings: ProjectSettingsSchema,
    schematicLayout: SchematicLayoutSchema,
  })
  .strict()
  .superRefine((bundle, ctx) => {
    // The bundle schema version and the meta version must agree.
    if (bundle.meta.schemaVersion !== bundle.schemaVersion) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['meta', 'schemaVersion'],
        message: `meta.schemaVersion (${bundle.meta.schemaVersion}) must equal the bundle schemaVersion (${bundle.schemaVersion})`,
      });
    }
  });

export type ProjectBundle = Z.infer<typeof ProjectBundleSchema>;

const ProjectBundleEnvelopeSchema = z.object({ schemaVersion: z.number().int() }).passthrough();

/**
 * Parse a project bundle at a boundary (spec 9.1, 9.2, 9.4). Unknown future
 * schema versions are rejected explicitly, never silently coerced (9.2);
 * unknown fields are rejected (9.4).
 */
export function parseProjectBundle(raw: unknown): Project {
  const envelope = ProjectBundleEnvelopeSchema.safeParse(raw);
  if (!envelope.success) {
    throw new ProjectBundleError(
      ProjectBundleErrorCode.Malformed,
      'Not a project bundle: expected an object with an integer schemaVersion field.',
    );
  }
  const version = envelope.data.schemaVersion;
  if (version > PROJECT_SCHEMA_VERSION) {
    throw new ProjectBundleError(
      ProjectBundleErrorCode.Future,
      `Unknown project schema version ${version}; this build supports version ${PROJECT_SCHEMA_VERSION}.`,
    );
  }
  if (version < 1) {
    throw new ProjectBundleError(
      ProjectBundleErrorCode.Invalid,
      `Invalid project schema version ${version}; expected a positive integer.`,
    );
  }
  const parsed = ProjectBundleSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ProjectBundleError(
      ProjectBundleErrorCode.Invalid,
      `Project bundle does not match schema version ${PROJECT_SCHEMA_VERSION}.`,
      parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  }
  return bundleToProject(parsed.data);
}

/**
 * Serialize a project for persistence (9.1). Validates against the current
 * bundle schema, so the canonical model is contract-valid at every boundary.
 */
export function serializeProject(project: Project): ProjectBundle {
  const bundle = ProjectBundleSchema.safeParse({ ...project, schemaVersion: PROJECT_SCHEMA_VERSION });
  if (!bundle.success) {
    throw new ProjectBundleError(
      ProjectBundleErrorCode.Invalid,
      `Project does not match schema version ${PROJECT_SCHEMA_VERSION}.`,
      bundle.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  }
  return bundle.data;
}

/** Strip the bundle-level schemaVersion to recover the canonical project document. */
export function bundleToProject(bundle: ProjectBundle): Project {
  const { schemaVersion: _schemaVersion, ...rest } = bundle;
  void _schemaVersion;
  return rest;
}
