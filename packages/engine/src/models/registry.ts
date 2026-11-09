/**
 * Versioned behavior-model registry (spec 5.3): models are keyed by id +
 * version, and duplicate id+version registration fails explicitly.
 *
 * The registry is an immutable value: `registerModel` returns a new registry
 * and never mutates its input (spec 5.5 — no hidden mutation). Stored models
 * are treated as read-only; callers validate them with `BehaviorModelSchema`
 * at the data boundary before registration (9.4).
 */
import type { BehaviorModel } from '@stationeers/domain';
import { compareStrings } from './order';

/** Stable codes for registry failures. */
export const ModelRegistryErrorCode = {
  /** A model with the same id + version is already registered. */
  DuplicateModel: 'duplicate-model',
} as const;
export type ModelRegistryErrorCode =
  (typeof ModelRegistryErrorCode)[keyof typeof ModelRegistryErrorCode];

export class ModelRegistryError extends Error {
  readonly code: ModelRegistryErrorCode;

  constructor(code: ModelRegistryErrorCode, message: string) {
    super(message);
    this.name = 'ModelRegistryError';
    this.code = code;
  }
}

/**
 * Immutable registry state: model id → version → model.
 *
 * Maps, not records: pack-sourced ids are untrusted keys (9.4) and must never
 * collide with Object prototype properties.
 */
export interface ModelRegistry {
  readonly byId: ReadonlyMap<string, ReadonlyMap<string, BehaviorModel>>;
}

/** Canonical display reference for a versioned model, e.g. 'atmo.pressure@2'. */
export function modelRef(model: Pick<BehaviorModel, 'id' | 'version'>): string {
  return `${model.id}@${model.version}`;
}

export function createModelRegistry(): ModelRegistry {
  return { byId: new Map() };
}

/**
 * Register a model, returning a new registry that contains it. Throws
 * `ModelRegistryError` (`DuplicateModel`) when the id + version pair is taken;
 * the given registry is left untouched.
 */
export function registerModel(registry: ModelRegistry, model: BehaviorModel): ModelRegistry {
  const versions = registry.byId.get(model.id);
  if (versions !== undefined && versions.has(model.version)) {
    throw new ModelRegistryError(
      ModelRegistryErrorCode.DuplicateModel,
      `Behavior model '${modelRef(model)}' is already registered; id+version must be unique.`,
    );
  }
  const nextVersions = new Map(versions);
  nextVersions.set(model.version, model);
  const nextById = new Map(registry.byId);
  nextById.set(model.id, nextVersions);
  return { byId: nextById };
}

/** The registered model with exactly this id and version, if any. */
export function getModel(
  registry: ModelRegistry,
  id: string,
  version: string,
): BehaviorModel | undefined {
  return registry.byId.get(id)?.get(version);
}

/**
 * Versions registered for an id, in code-unit order. Versions are opaque
 * strings (spec 5.3 defines no ordering); no semver semantics are invented.
 */
export function listVersions(registry: ModelRegistry, id: string): string[] {
  const versions = registry.byId.get(id);
  if (versions === undefined) {
    return [];
  }
  return [...versions.keys()].sort(compareStrings);
}

/**
 * Every registered model, sorted by id then version (code-unit order) — a
 * canonical listing independent of registration order.
 */
export function listModels(registry: ModelRegistry): BehaviorModel[] {
  const models: BehaviorModel[] = [];
  for (const id of [...registry.byId.keys()].sort(compareStrings)) {
    const versions = registry.byId.get(id);
    if (versions === undefined) {
      continue;
    }
    for (const version of [...versions.keys()].sort(compareStrings)) {
      const model = versions.get(version);
      if (model !== undefined) {
        models.push(model);
      }
    }
  }
  return models;
}

/**
 * Changed pack inputs, as EXT-04's semantic pack diff will produce (6.6
 * steps 4–5). Properties and constants are separate namespaces from the pack.
 */
export interface ChangedPackInputs {
  properties: readonly string[];
  constants: readonly string[];
}

/**
 * Pack-diff invalidation hook (spec 6.6): given the set of changed pack
 * properties/constants, return every model whose declared `consumes` (5.3)
 * intersects the change — exactly the models that must be marked Unverified
 * on a game update (6.6 step 6).
 *
 * SEAM (EXT-04): this module knows nothing about packs or diffs; EXT-04 owns
 * producing the changed set and applying the status change. This query is the
 * only coupling point. Results come back in the canonical `listModels` order.
 */
export function findModelsAffectedBy(
  registry: ModelRegistry,
  changed: ChangedPackInputs,
): BehaviorModel[] {
  const properties = new Set(changed.properties);
  const constants = new Set(changed.constants);
  return listModels(registry).filter(
    (model) =>
      model.consumes.properties.some((property) => properties.has(property)) ||
      model.consumes.constants.some((constant) => constants.has(constant)),
  );
}
