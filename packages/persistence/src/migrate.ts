/**
 * Project schema migrations (spec 9.2).
 *
 * "Every supported old schema has a deterministic migration. Migration failures
 * preserve the source data. Unknown future schemas are rejected, never silently
 * coerced." Migrations are keyed by source schema version and run in ascending
 * order; each step is a pure function from one bundle to the next.
 */
import type { ProjectBundle } from '@stationeers/domain';
import { ProjectBundleErrorCode, ProjectBundleError, PROJECT_SCHEMA_VERSION, parseProjectBundle, serializeProject } from '@stationeers/domain';

/**
 * A migration from version N to N+1. It must be deterministic and pure.
 * Returning `unknown` is deliberate: each step's output is re-validated by
 * the migration runner before the next step runs (9.2).
 */
export type MigrationStep = (bundle: ProjectBundle) => unknown;

/**
 * Migration registry keyed by source schema version. `migrations[1]` migrates
 * version 1 → 2. With only v1 defined, the registry is empty.
 */
export const migrations: Record<number, MigrationStep> = {};

/** Result of a successful migration: the current bundle and the steps applied. */
export interface MigrationResult {
  bundle: ProjectBundle;
  /** Source schema versions migrated, e.g. `[1]` for a 1 → 2 migration. */
  applied: number[];
}

/**
 * Migrate a project bundle to the current schema version (9.2).
 *
 * The input is a bundle already validated against its source schema version by
 * the caller; each migration step's output is re-parsed before the next step
 * runs, so a malformed step result is rejected rather than propagated.
 * Migration failures preserve the source data untouched.
 */
export function migrateProjectBundle(bundle: ProjectBundle): MigrationResult {
  if (bundle.schemaVersion > PROJECT_SCHEMA_VERSION) {
    throw new ProjectBundleError(
      ProjectBundleErrorCode.Future,
      `Unknown project schema version ${bundle.schemaVersion}; this build supports version ${PROJECT_SCHEMA_VERSION}.`,
    );
  }
  let current: unknown = bundle;
  const applied: number[] = [];
  for (let version = bundle.schemaVersion; version < PROJECT_SCHEMA_VERSION; version++) {
    const step = migrations[version];
    if (!step) {
      throw new ProjectBundleError(
        ProjectBundleErrorCode.Future,
        `No migration registered for project schema version ${version}.`,
      );
    }
    const migrated = step(current as ProjectBundle);
    // Re-validate the migrated bundle against the current schema before the
    // next step runs (9.2: schema validation before migration).
    parseProjectBundle(migrated);
    current = migrated;
    applied.push(version);
  }
  return { bundle: serializeProject(parseProjectBundle(current)), applied };
}
