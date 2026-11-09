/**
 * Applying a pack diff to behavior models (EXT-04; spec 6.6 step 6).
 *
 * Step 6 of the update workflow is: "mark Unverified every behavior model whose
 * declared inputs (5.3) changed". The two halves of that sentence live in two
 * packages — the registry and its `findModelsAffectedBy` query in
 * `@stationeers/engine`, the changed-input feed in this package's changelog — so
 * the bridge lives here, on the pack side, and does not re-implement the query:
 * the engine decides *which* models are affected, this module decides *what to
 * record for them*.
 *
 * Two rules the plan encodes:
 *
 * 1. **Affected is not the same as downgraded.** Every model whose declared
 *    inputs moved is listed, but only a model that was `verified` is marked
 *    `unverified`. An already-`unverified` model stays there, and a model at
 *    `unsupported` or `incompatible` must never be raised to `unverified` by an
 *    update — statuses only ever aggregate towards the weakest (spec 5.2.2), and
 *    `unsupported` is never a pass (spec 8).
 * 2. **Properties and constants are separate namespaces.** A model is affected by
 *    a changed *property* only if it declares that property, and by a changed
 *    *constant* only if it declares that constant; a pack property named `C_R`
 *    does not invalidate a model that consumes the constant `C_R`.
 */
import type { BehaviorModel, ModelStatus } from '@stationeers/domain';
import { findModelsAffectedBy, modelRef, type ModelRegistry } from '@stationeers/engine';
import { compareStrings } from './canonical';
import type { PackChangelog, PropertyChangeKind } from './diff';

/** Status an affected model is marked with when it can no longer stand behind its result. */
export const INVALIDATED_STATUS = 'unverified' as const satisfies ModelStatus;

/** One behavior model the update invalidates, and why. */
export interface ModelInvalidation {
  /** Canonical `id@version` reference (`modelRef`). */
  model: string;
  id: string;
  version: string;
  /** Changed property names this model declares it consumes, sorted. */
  changedProperties: string[];
  /** Changed constant names this model declares it consumes, sorted. */
  changedConstants: string[];
  /** The model's registered status. */
  statusBefore: ModelStatus;
  /**
   * The status to record after the update: `unverified` for a model that was
   * `verified`, otherwise `statusBefore` — a weaker status is never raised.
   */
  statusAfter: ModelStatus;
  /** One-line reason for a release changelog (deterministic wording). */
  reason: string;
}

/** The outcome of applying one pack diff to the model registry (spec 6.6 step 6). */
export interface ModelInvalidationPlan {
  prevPackId: string;
  nextPackId: string;
  /** Every affected model, in the registry's canonical order. */
  models: ModelInvalidation[];
  /** Refs of the models whose status actually changes (`statusBefore === 'verified'`). */
  markUnverified: string[];
}

/** Every movement kind observed for one changed name, across all entities. */
type KindsByName = Map<string, Set<PropertyChangeKind>>;

function collectKinds(changelog: PackChangelog): KindsByName {
  const kinds: KindsByName = new Map();
  for (const entity of changelog.entities) {
    for (const change of entity.properties) {
      if (!change.invalidating) continue;
      const seen = kinds.get(change.property) ?? new Set<PropertyChangeKind>();
      for (const kind of change.kinds) seen.add(kind);
      kinds.set(change.property, seen);
    }
  }
  return kinds;
}

/** `property "time" (value-changed)` — why one name is in the feed. */
function describeProperty(name: string, kinds: KindsByName): string {
  const seen = kinds.get(name);
  const movements = seen === undefined ? [] : [...seen].sort(compareStrings);
  return movements.length === 0 ? `property "${name}"` : `property "${name}" (${movements.join(', ')})`;
}

function uniqueSorted(names: readonly string[]): string[] {
  return [...new Set(names)].sort(compareStrings);
}

/**
 * Apply a pack changelog to a model registry: which models must be marked
 * Unverified, and the reason per model (spec 6.6 step 6).
 *
 * Uses the engine's `findModelsAffectedBy` on the changelog's
 * `invalidatingProperties`/`invalidatingConstants` feed, so the matching rule
 * (declared `consumes`, namespaces kept separate) has exactly one definition.
 * The registry is not modified: the caller applies the statuses.
 */
export function planModelInvalidation(
  registry: ModelRegistry,
  changelog: PackChangelog,
): ModelInvalidationPlan {
  const affected: BehaviorModel[] = findModelsAffectedBy(registry, {
    properties: changelog.invalidatingProperties,
    constants: changelog.invalidatingConstants,
  });

  const changedProperties = new Set(changelog.invalidatingProperties);
  const changedConstants = new Set(changelog.invalidatingConstants);
  const kinds = collectKinds(changelog);

  const models = affected.map((model): ModelInvalidation => {
    // Re-intersect with this model's declarations so the reason names its own
    // inputs, not the whole pack's.
    const consumedProperties = uniqueSorted(model.consumes.properties.filter((name) => changedProperties.has(name)));
    const consumedConstants = uniqueSorted(model.consumes.constants.filter((name) => changedConstants.has(name)));
    const details = [
      ...consumedProperties.map((name) => describeProperty(name, kinds)),
      ...consumedConstants.map((name) => `constant "${name}"`),
    ];

    return {
      model: modelRef(model),
      id: model.id,
      version: model.version,
      changedProperties: consumedProperties,
      changedConstants: consumedConstants,
      statusBefore: model.status,
      statusAfter: model.status === 'verified' ? INVALIDATED_STATUS : model.status,
      reason: `consumes changed pack inputs (spec 6.6): ${details.join(', ')}`,
    };
  });

  return {
    prevPackId: changelog.prevPackId,
    nextPackId: changelog.nextPackId,
    models,
    markUnverified: models.filter((entry) => entry.statusAfter !== entry.statusBefore).map((entry) => entry.model),
  };
}
