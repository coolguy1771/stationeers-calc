/**
 * Semantic pack diff (EXT-04; spec 6.6 steps 4–6).
 *
 * `diffPacks(previous, next)` answers, for two loaded packs: what changed in the
 * game data, in the quality/provenance of every property, and in the coverage
 * report — and which changed inputs force a behavior model to stop being
 * Verified.
 *
 * Design rules this module keeps:
 *
 * 1. **Ids are the keys, order is derived.** Entities are matched by their
 *    stable id (`<family>/<prefab>[#n]` for recipes, game-native otherwise);
 *    everything the changelog lists is sorted by code unit, so the same two
 *    packs produce the same changelog regardless of payload order, property-map
 *    insertion order, or JSON key order.
 * 2. **A change is a value change, a quality change, or a provenance change.**
 *    They are reported separately because they mean different things: a moved
 *    value is new data, a moved §6.5 level is a change in how far the data is
 *    trusted, and a moved source (same value, same level) is a note about where
 *    it came from. Only the first two can invalidate (see rule 3).
 * 3. **Invalidation is what can *lose* trust, not what can gain it.** A property
 *    feeds §6.6 step 6 when its value moved or its level moved *down*: a model
 *    could no longer stand behind a Verified result. A quality *improvement*
 *    (missing → unverified, unverified → validated) is reported but invalidates
 *    nothing — it can only make a result stronger, and nothing already reported
 *    became wrong. A pure provenance change invalidates nothing either: the
 *    input the model reads is identical.
 * 4. **The feed is name-granular, so it errs towards invalidating.** Behavior
 *    models declare the property/constant *names* they consume (spec 5.3), not
 *    entity references, so `invalidatingProperties` is the set of names whose
 *    values moved anywhere in the pack — including on entities added or removed
 *    by the update. That can invalidate a model that reads the same name on a
 *    different entity; that is the safe direction (a needless re-verification),
 *    never a silently stale Verified result. The per-entity detail is in
 *    `entities` for anyone who needs to narrow it.
 * 5. **Nothing is invented.** A value the pack does not carry is `absent`, a
 *    join the pack does not list is `missing`, and a pack dimension with no
 *    representation in the format is reported as a gap instead of a guess (see
 *    `invalidatingConstants`).
 *
 * `provenanceCoverageReport` (provenance-coverage.ts) turns one pack — plus,
 * optionally, this changelog — into the coverage/publish-gate view, and
 * `planModelInvalidation` (invalidation.ts) applies §6.6 step 6 to a registry.
 */
import type { DataQuality, PackChannel } from '@stationeers/domain';
import { canonicalJson, compareStrings } from './canonical';
import {
  QUALITY_LEVELS,
  qualityMovement,
  resolveEntityProperty,
  type PackEntityType,
  type PackedEntity,
  type QualityMovement,
  type ResolvedProperty,
} from './quality';
import {
  JOIN_NAMES,
  type BehaviorModelCompatibility,
  type ControlCoverage,
  type GameBranch,
  type JoinName,
  type JoinStatus,
  type PackedDevice,
  type PackedItem,
  type PackedRecipe,
  type PropertyQuality,
  type ReadonlyPack,
  type ToolVersions,
} from './schema';

/** Entity collections in the order the changelog lists them. */
const ENTITY_COLLECTIONS: readonly { entityType: PackEntityType; collection: 'recipes' | 'items' | 'devices' }[] = [
  { entityType: 'recipe', collection: 'recipes' },
  { entityType: 'item', collection: 'items' },
  { entityType: 'device', collection: 'devices' },
];

/** A named join's state, reusing the pack schema's vocabulary. */
export type JoinState = JoinStatus['status'];

/** A control element's mapping, reusing the pack schema's vocabulary. */
export type ControlMapping = ControlCoverage['mapping'];

/**
 * A property value as the changelog reports it: the data a model reads, with no
 * writer handle and no pack-format internals.
 */
export type PropertyValue =
  | { kind: 'absent' }
  | { kind: 'text'; text: string }
  | {
      kind: 'number';
      /** Exact source text, e.g. ".5". */
      text: string;
      value: number;
      unitStatus: 'unverified' | 'verified';
      unit?: string;
    };

/** One kind of movement a single property can show (several may apply at once). */
export type PropertyChangeKind =
  | 'added'
  | 'removed'
  | 'value-changed'
  | 'quality-changed'
  | 'provenance-changed';

/**
 * What happened to one property of one entity.
 *
 * `before`/`after` are the pack's own property entries (level + provenance +
 * approval); `beforeValue`/`afterValue` are the values those entries describe.
 */
export interface PropertyChange {
  /** Property path, e.g. `time` or `inputs[0].quantity`. */
  property: string;
  /**
   * Every movement observed, in a fixed order. `added`/`removed` mean the
   * property entry itself appeared or disappeared; `value-changed` means the
   * value moved while the entry stayed; `quality-changed` means the §6.5 level
   * moved; `provenance-changed` means the entry moved while the value *and* the
   * level did not (the same value, from a different source).
   */
  kinds: PropertyChangeKind[];
  before?: PropertyQuality;
  after?: PropertyQuality;
  beforeValue: PropertyValue;
  afterValue: PropertyValue;
  /** Present only when the §6.5 level moved. */
  qualityChange?: { from: DataQuality; to: DataQuality; direction: QualityMovement };
  /**
   * §6.6 step 6: whether this change forces a consuming model out of Verified —
   * a moved value, an appearing/disappearing value, or a downgraded level. An
   * improvement or a pure provenance change is `false`.
   */
  invalidating: boolean;
}

/**
 * One piece of entity data the §6.5 property map does not address (ingredient
 * identity, a recipe family, a device's footprint/ports, record-level
 * provenance). Values are canonical JSON so structural changes are comparable
 * and printable without inventing a second data model.
 *
 * Reported for review: the name-granular §6.6 feed cannot express them, because
 * behavior models declare property names, not structural paths.
 */
export interface FieldChange {
  /** e.g. `inputs.materialNames`, `family`, `provenance`, `definition.ports`. */
  field: string;
  /** Canonical JSON of the value; absent when the field does not exist. */
  before?: string;
  after?: string;
}

/** What happened to one entity, addressed by its stable id. */
export interface EntityChange {
  entityType: PackEntityType;
  entityId: string;
  /** `changed` means the entity exists in both packs but its data moved. */
  kind: 'added' | 'removed' | 'changed';
  /** One entry per added/removed/changed property, sorted by property path. */
  properties: PropertyChange[];
  /** One entry per changed structural field, sorted by field name. */
  fields: FieldChange[];
}

/** One named join that gained or lost its source between packs. */
export interface JoinChange {
  join: JoinName;
  before: JoinState;
  after: JoinState;
}

/** One control element the extractor maps differently (or newly) handled. */
export interface ControlChange {
  element: string;
  before?: { mapping: ControlMapping; occurrences: number };
  after?: { mapping: ControlMapping; occurrences: number };
}

/** One counter that moved, named by its path in the manifest. */
export interface CountChange {
  /**
   * `recipes`, `items`, `devices`, `sourceWorldRefs`,
   * `byPropertyQuality.<level>`, or `byFamily.<family>`.
   */
  counter: string;
  before: number;
  after: number;
  /** `after - before`; positive means the counter grew. */
  delta: number;
}

/** Coverage movement between two packs. */
export interface CoverageChange {
  /** Families that became `mapped` (a win) — sorted. */
  familiesMapped: string[];
  /** Families that became `unmapped` (a regression) — sorted. */
  familiesUnmapped: string[];
  /** Families present in only one pack — sorted. */
  familiesAdded: string[];
  familiesRemoved: string[];
  /** Named joins whose status moved, in the schema's canonical join order. */
  joins: JoinChange[];
  /** Control elements whose mapping or occurrence count moved — sorted. */
  controls: ControlChange[];
  /** `after - before` for `missingFields.total`; positive means more gaps recorded. */
  missingFieldsDelta: number;
  /** Non-zero per-code diagnostic deltas — sorted by code. */
  diagnosticsDelta: { code: string; delta: number }[];
  /** Counters that moved (entity counts, world refs, per-level and per-family tallies). */
  counts: CountChange[];
  /** Source files that appeared, disappeared, or changed content (`sourceDigests`). */
  sourceFilesAdded: string[];
  sourceFilesRemoved: string[];
  sourceFilesChanged: string[];
}

/** Manifest movement between two packs; each field is present only when it moved. */
export interface ManifestChange {
  gameBuild?: { before: string; after: string };
  gameBranch?: { before: GameBranch; after: GameBranch };
  channel?: { before: PackChannel; after: PackChannel };
  /** Extractor release and IR version (spec 6.4). */
  toolVersions?: { before: ToolVersions; after: ToolVersions };
  normalizationVersion?: { before: string; after: string };
  behaviorModelCompatibility?: { before: BehaviorModelCompatibility; after: BehaviorModelCompatibility };
  /**
   * Extraction timestamp. Reported, but it does not make a pack semantically
   * different: the same data rebuilt on another day is the same pack content.
   */
  extractionDate?: { before: string; after: string };
  /** Entity counts that moved, in canonical collection order. */
  entityCounts: CountChange[];
}

/** The changelog a pack diff produces (spec 6.6 steps 4–6). */
export interface PackChangelog {
  prevPackId: string;
  nextPackId: string;
  prevGameBuild: string;
  nextGameBuild: string;
  prevContentHash: string;
  nextContentHash: string;
  /**
   * True when the two packs carry the same game data: no entity, coverage, or
   * manifest movement apart from `extractionDate` (a rebuild timestamp) and the
   * source digests (which describe the input bytes, not the packed values).
   * Both are still reported below — `identical` is about the data, not about
   * provenance.
   */
  identical: boolean;
  manifest: ManifestChange;
  entities: EntityChange[];
  coverage: CoverageChange;
  /**
   * Property NAMES whose value or §6.5 level moved in a way that forces a
   * consuming behavior model out of Verified — sorted and de-duplicated. This is
   * the §6.6 step 6 feed for `findModelsAffectedBy` (engine), together with
   * `invalidatingConstants`.
   */
  invalidatingProperties: string[];
  /**
   * Constant NAMES, in the namespace behavior models declare `consumes.constants`
   * in. Always empty today: the pack format carries no pack-level constants
   * (`docs/plan/BACKLOG.md`), so no update can change one yet. It is part of the
   * changelog so the step 6 feed is complete the day constants are extracted —
   * and so no consumer has to guess whether a constant moved.
   */
  invalidatingConstants: string[];
}

/** The entity shape a `ReadonlyPack` exposes. */
type PackEntity = PackedRecipe | PackedItem | PackedDevice;

/**
 * Read-only pack entities are narrowed to the mutable type the property resolver
 * takes. The diff only ever reads: the resolver's writer is never called.
 */
function resolverInput(entity: PackEntity): PackedEntity {
  return entity as PackedEntity;
}

function sortedUnion(left: Iterable<string>, right: Iterable<string>): string[] {
  const union = new Set<string>();
  for (const value of left) union.add(value);
  for (const value of right) union.add(value);
  return [...union].sort(compareStrings);
}

function byId(entities: readonly { id: string }[]): Map<string, PackEntity> {
  const map = new Map<string, PackEntity>();
  for (const entity of entities) map.set(entity.id, entity as PackEntity);
  return map;
}

/** A resolved property value as the changelog carries it. */
function snapshotOf(resolved: ResolvedProperty | undefined): PropertyValue {
  if (resolved === undefined || resolved.kind === 'absent') return { kind: 'absent' };
  if (resolved.kind === 'text') return { kind: 'text', text: resolved.text };
  const { text, value, unitStatus, unit } = resolved.number;
  return { kind: 'number', text, value, unitStatus, ...(unit === undefined ? {} : { unit }) };
}

function valueOf(
  entityType: PackEntityType,
  entity: PackEntity | undefined,
  property: string,
): PropertyValue {
  if (entity === undefined) return { kind: 'absent' };
  return snapshotOf(resolveEntityProperty(entityType, resolverInput(entity), property));
}

function qualityChangeOf(
  before: PropertyQuality | undefined,
  after: PropertyQuality | undefined,
): PropertyChange['qualityChange'] {
  if (before === undefined || after === undefined) return undefined;
  const direction = qualityMovement(before.quality, after.quality);
  if (direction === undefined) return undefined;
  return { from: before.quality, to: after.quality, direction };
}

/**
 * Every property of one entity that moved between the two packs, sorted by path.
 *
 * The level movement is compared through `qualityMovement` (§6.5 ranking); the
 * value is compared as a whole — including a quantity's unit semantics, because
 * "3" with an unknown unit and "3 s" are not the same input to a model.
 */
function diffProperties(
  entityType: PackEntityType,
  before: PackEntity | undefined,
  after: PackEntity | undefined,
): PropertyChange[] {
  const changes: PropertyChange[] = [];
  const names = sortedUnion(
    before === undefined ? [] : Object.keys(before.properties),
    after === undefined ? [] : Object.keys(after.properties),
  );

  for (const property of names) {
    const beforeEntry = before?.properties[property];
    const afterEntry = after?.properties[property];
    const beforeValue = valueOf(entityType, before, property);
    const afterValue = valueOf(entityType, after, property);
    const valueMoved = canonicalJson(beforeValue) !== canonicalJson(afterValue);
    const qualityChange = qualityChangeOf(beforeEntry, afterEntry);

    const kinds: PropertyChangeKind[] = [];
    if (beforeEntry === undefined) kinds.push('added');
    if (afterEntry === undefined) kinds.push('removed');
    if (beforeEntry !== undefined && afterEntry !== undefined && valueMoved) kinds.push('value-changed');
    if (qualityChange !== undefined) kinds.push('quality-changed');
    if (
      beforeEntry !== undefined &&
      afterEntry !== undefined &&
      !valueMoved &&
      qualityChange === undefined &&
      canonicalJson(beforeEntry) !== canonicalJson(afterEntry)
    ) {
      kinds.push('provenance-changed');
    }

    // Rule 3: only a lost value or a lost level can cost a model its Verified status.
    const invalidating =
      beforeEntry === undefined ||
      afterEntry === undefined ||
      valueMoved ||
      qualityChange?.direction === 'downgrade';

    if (kinds.length === 0) continue;

    changes.push({
      property,
      kinds,
      ...(beforeEntry === undefined ? {} : { before: beforeEntry }),
      ...(afterEntry === undefined ? {} : { after: afterEntry }),
      beforeValue,
      afterValue,
      ...(qualityChange === undefined ? {} : { qualityChange }),
      invalidating,
    });
  }

  return changes;
}

/** Definition keys the §6.5 property map already addresses (see `resolveEntityProperty`). */
const DEVICE_DEFINITION_PROPERTIES: readonly string[] = ['displayName', 'category', 'sourceQuality'];

/**
 * Entity data the §6.5 property map does not address, per entity type.
 *
 * Recipes: the family (an id is `<family>/<prefab>`, but a pack may restate it),
 * the ingredient *identities* (the property map only covers their quantities),
 * and record-level provenance. Items carry only provenance. Devices report every
 * definition key the property map does not cover, so a new definition field is
 * picked up without editing this list.
 */
function structuralFields(entityType: PackEntityType, entity: PackEntity): Map<string, unknown> {
  if (entityType === 'recipe') {
    const recipe = entity as PackedRecipe;
    return new Map<string, unknown>([
      ['family', recipe.family],
      ['inputs.materialNames', recipe.inputs.map((input) => input.materialName)],
      ['provenance', recipe.provenance],
    ]);
  }
  if (entityType === 'item') {
    return new Map<string, unknown>([['provenance', (entity as PackedItem).provenance]]);
  }
  const definition = (entity as PackedDevice).definition as unknown as Record<string, unknown>;
  const fields = new Map<string, unknown>();
  for (const key of Object.keys(definition).sort(compareStrings)) {
    if (DEVICE_DEFINITION_PROPERTIES.includes(key)) continue;
    fields.set(`definition.${key}`, definition[key]);
  }
  return fields;
}

function diffFields(
  entityType: PackEntityType,
  before: PackEntity | undefined,
  after: PackEntity | undefined,
): FieldChange[] {
  if (before === undefined || after === undefined) return [];
  const beforeFields = structuralFields(entityType, before);
  const afterFields = structuralFields(entityType, after);
  const changes: FieldChange[] = [];

  for (const field of sortedUnion(beforeFields.keys(), afterFields.keys())) {
    const beforeValue = beforeFields.get(field);
    const afterValue = afterFields.get(field);
    const beforeJson = beforeValue === undefined ? undefined : canonicalJson(beforeValue);
    const afterJson = afterValue === undefined ? undefined : canonicalJson(afterValue);
    if (beforeJson === afterJson) continue;
    changes.push({
      field,
      ...(beforeJson === undefined ? {} : { before: beforeJson }),
      ...(afterJson === undefined ? {} : { after: afterJson }),
    });
  }

  return changes;
}

function familyStatuses(pack: ReadonlyPack): Map<string, 'mapped' | 'unmapped'> {
  const statuses = new Map<string, 'mapped' | 'unmapped'>();
  for (const family of pack.coverage.families) statuses.set(family.family, family.status);
  return statuses;
}

function joinStates(pack: ReadonlyPack): Map<JoinName, JoinState> {
  const states = new Map<JoinName, JoinState>();
  for (const join of pack.coverage.joins) states.set(join.join, join.status);
  return states;
}

function counterChanges(
  before: ReadonlyMap<string, number>,
  after: ReadonlyMap<string, number>,
): CountChange[] {
  const changes: CountChange[] = [];
  for (const counter of sortedUnion(before.keys(), after.keys())) {
    const previous = before.get(counter) ?? 0;
    const next = after.get(counter) ?? 0;
    if (previous === next) continue;
    changes.push({ counter, before: previous, after: next, delta: next - previous });
  }
  return changes;
}

function coverageCounters(pack: ReadonlyPack): Map<string, number> {
  const { counts } = pack.coverage;
  const counters = new Map<string, number>([
    ['recipes', counts.recipes],
    ['items', counts.items],
    ['devices', counts.devices],
    ['sourceWorldRefs', counts.sourceWorldRefs],
  ]);
  for (const level of QUALITY_LEVELS) {
    counters.set(`byPropertyQuality.${level}`, counts.byPropertyQuality[level] ?? 0);
  }
  for (const [family, recipes] of Object.entries(counts.byFamily)) {
    counters.set(`byFamily.${family}`, recipes);
  }
  return counters;
}

function diagnosticTallies(pack: ReadonlyPack): Map<string, number> {
  const tallies = new Map<string, number>();
  for (const tally of pack.coverage.diagnostics.byCode) {
    tallies.set(tally.code, (tallies.get(tally.code) ?? 0) + tally.count);
  }
  return tallies;
}

function diffCoverage(prev: ReadonlyPack, next: ReadonlyPack): CoverageChange {
  const beforeFamilies = familyStatuses(prev);
  const afterFamilies = familyStatuses(next);
  const familiesMapped: string[] = [];
  const familiesUnmapped: string[] = [];
  const familiesAdded: string[] = [];
  const familiesRemoved: string[] = [];

  for (const family of sortedUnion(beforeFamilies.keys(), afterFamilies.keys())) {
    const before = beforeFamilies.get(family);
    const after = afterFamilies.get(family);
    if (before === undefined) {
      familiesAdded.push(family);
    } else if (after === undefined) {
      familiesRemoved.push(family);
    } else if (before !== after) {
      if (after === 'mapped') familiesMapped.push(family);
      else familiesUnmapped.push(family);
    }
  }

  const beforeJoins = joinStates(prev);
  const afterJoins = joinStates(next);
  const joins: JoinChange[] = [];
  for (const join of JOIN_NAMES) {
    // A join the pack does not list is not supplied (fail closed).
    const before = beforeJoins.get(join) ?? 'missing';
    const after = afterJoins.get(join) ?? 'missing';
    if (before === after) continue;
    joins.push({ join, before, after });
  }

  const beforeControls = new Map(prev.coverage.controls.map((control) => [control.element, control]));
  const afterControls = new Map(next.coverage.controls.map((control) => [control.element, control]));
  const controls: ControlChange[] = [];
  for (const element of sortedUnion(beforeControls.keys(), afterControls.keys())) {
    const before = beforeControls.get(element);
    const after = afterControls.get(element);
    if (
      before !== undefined &&
      after !== undefined &&
      before.mapping === after.mapping &&
      before.occurrences === after.occurrences
    ) {
      continue;
    }
    controls.push({
      element,
      ...(before === undefined ? {} : { before: { mapping: before.mapping, occurrences: before.occurrences } }),
      ...(after === undefined ? {} : { after: { mapping: after.mapping, occurrences: after.occurrences } }),
    });
  }

  const beforeDiagnostics = diagnosticTallies(prev);
  const afterDiagnostics = diagnosticTallies(next);
  const diagnosticsDelta: { code: string; delta: number }[] = [];
  for (const code of sortedUnion(beforeDiagnostics.keys(), afterDiagnostics.keys())) {
    const delta = (afterDiagnostics.get(code) ?? 0) - (beforeDiagnostics.get(code) ?? 0);
    if (delta !== 0) diagnosticsDelta.push({ code, delta });
  }

  const beforeFiles = prev.sourceDigests.files;
  const afterFiles = next.sourceDigests.files;
  const sourceFilesAdded: string[] = [];
  const sourceFilesRemoved: string[] = [];
  const sourceFilesChanged: string[] = [];
  for (const file of sortedUnion(Object.keys(beforeFiles), Object.keys(afterFiles))) {
    const before = beforeFiles[file];
    const after = afterFiles[file];
    if (before === undefined) {
      sourceFilesAdded.push(file);
    } else if (after === undefined) {
      sourceFilesRemoved.push(file);
    } else if (canonicalJson(before) !== canonicalJson(after)) {
      sourceFilesChanged.push(file);
    }
  }

  return {
    familiesMapped,
    familiesUnmapped,
    familiesAdded,
    familiesRemoved,
    joins,
    controls,
    missingFieldsDelta: next.coverage.missingFields.total - prev.coverage.missingFields.total,
    diagnosticsDelta,
    counts: counterChanges(coverageCounters(prev), coverageCounters(next)),
    sourceFilesAdded,
    sourceFilesRemoved,
    sourceFilesChanged,
  };
}

function diffManifest(prev: ReadonlyPack, next: ReadonlyPack): ManifestChange {
  const moved = <T>(before: T, after: T): { before: T; after: T } | undefined =>
    canonicalJson(before) === canonicalJson(after) ? undefined : { before, after };

  const gameBuild = moved(prev.gameBuild, next.gameBuild);
  const gameBranch = moved(prev.gameBranch, next.gameBranch);
  const channel = moved(prev.channel, next.channel);
  const toolVersions = moved(prev.toolVersions, next.toolVersions);
  const normalizationVersion = moved(prev.normalizationVersion, next.normalizationVersion);
  const behaviorModelCompatibility = moved(prev.behaviorModelCompatibility, next.behaviorModelCompatibility);
  const extractionDate = moved(prev.extractionDate, next.extractionDate);

  const countChanges: CountChange[] = [];
  for (const { collection } of ENTITY_COLLECTIONS) {
    const before = prev.entityCounts[collection];
    const after = next.entityCounts[collection];
    if (before === after) continue;
    countChanges.push({ counter: collection, before, after, delta: after - before });
  }

  return {
    ...(gameBuild === undefined ? {} : { gameBuild }),
    ...(gameBranch === undefined ? {} : { gameBranch }),
    ...(channel === undefined ? {} : { channel }),
    ...(toolVersions === undefined ? {} : { toolVersions }),
    ...(normalizationVersion === undefined ? {} : { normalizationVersion }),
    ...(behaviorModelCompatibility === undefined ? {} : { behaviorModelCompatibility }),
    ...(extractionDate === undefined ? {} : { extractionDate }),
    entityCounts: countChanges,
  };
}

/** Whether coverage movement changed the *data* (rather than the input digests). */
function coverageDataMoved(coverage: CoverageChange): boolean {
  return (
    coverage.familiesMapped.length > 0 ||
    coverage.familiesUnmapped.length > 0 ||
    coverage.familiesAdded.length > 0 ||
    coverage.familiesRemoved.length > 0 ||
    coverage.joins.length > 0 ||
    coverage.controls.length > 0 ||
    coverage.missingFieldsDelta !== 0 ||
    coverage.diagnosticsDelta.length > 0 ||
    coverage.counts.length > 0
  );
}

/** Whether a manifest field other than `extractionDate` moved. */
function manifestDataMoved(manifest: ManifestChange): boolean {
  const { extractionDate: _extractionDate, entityCounts, ...rest } = manifest;
  return entityCounts.length > 0 || Object.values(rest).some((value) => value !== undefined);
}

/**
 * Diff two loaded packs into one changelog (spec 6.6 steps 4–5).
 *
 * Pure and deterministic: the same two packs always produce the same changelog
 * (`canonicalJson` of the result is byte-identical across runs), independent of
 * payload order, property-map key order, and JSON key order in either pack.
 *
 * Neither argument is modified.
 */
export function diffPacks(prev: ReadonlyPack, next: ReadonlyPack): PackChangelog {
  const entities: EntityChange[] = [];
  const invalidating = new Set<string>();

  for (const { entityType, collection } of ENTITY_COLLECTIONS) {
    const beforeById = byId(prev.payload[collection]);
    const afterById = byId(next.payload[collection]);

    for (const entityId of sortedUnion(beforeById.keys(), afterById.keys())) {
      const before = beforeById.get(entityId);
      const after = afterById.get(entityId);
      const properties = diffProperties(entityType, before, after);
      const fields = diffFields(entityType, before, after);

      if (before !== undefined && after !== undefined && properties.length === 0 && fields.length === 0) {
        continue;
      }
      for (const change of properties) {
        if (change.invalidating) invalidating.add(change.property);
      }

      entities.push({
        entityType,
        entityId,
        kind: before === undefined ? 'added' : after === undefined ? 'removed' : 'changed',
        properties,
        fields,
      });
    }
  }

  const coverage = diffCoverage(prev, next);
  const manifest = diffManifest(prev, next);

  return {
    prevPackId: prev.packId,
    nextPackId: next.packId,
    prevGameBuild: prev.gameBuild,
    nextGameBuild: next.gameBuild,
    prevContentHash: prev.contentHash,
    nextContentHash: next.contentHash,
    identical: entities.length === 0 && !coverageDataMoved(coverage) && !manifestDataMoved(manifest),
    manifest,
    entities,
    coverage,
    invalidatingProperties: [...invalidating].sort(compareStrings),
    // The pack format carries no pack-level constants yet (see `PackChangelog`).
    invalidatingConstants: [],
  };
}
