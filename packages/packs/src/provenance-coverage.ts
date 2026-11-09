/**
 * Provenance coverage report (EXT-04; spec 6.4 coverage report, 6.5 quality
 * levels, 6.6 step 8 publishing gate).
 *
 * One pack in, one answer out: how much of it is trusted, at which §6.5 level,
 * which joins are still missing, and what must happen before it may publish.
 * Given the changelog of the update that produced it, it also says how much of
 * that trust moved — which is what a reviewer reads before signing off a build.
 *
 * The report states what the pack *is*, never what it should be: nothing here
 * promotes a level, fills a missing value, or turns an unverified value into an
 * exact result (spec 6.5, AGENTS.md #2/#3).
 */
import type { DataQuality, PackChannel } from '@stationeers/domain';
import type { PackChangelog } from './diff';
import { PackError, PackErrorCode } from './errors';
import { QUALITY_LEVELS, tallyPropertyQuality, type PackEntityType } from './quality';
import type { GameBranch, JoinName, ReadonlyPack } from './schema';

/** Stable codes for the reasons a pack may not publish yet (spec 6.6 step 8, 8). */
export const PublishBlockerCode = {
  /** No property is `extracted-and-validated`, so nothing can back a Verified result. */
  NothingValidated: 'PUBLISH-NOTHING-VALIDATED',
  /** A named join the game data cannot supply is still missing. */
  JoinMissing: 'PUBLISH-JOIN-MISSING',
  /** The payload carries no device definitions (no geometry: EXT-05). */
  NoDevices: 'PUBLISH-DEVICES-EMPTY',
  /** The source does not supply values the pack needs (recorded as missing, never defaulted). */
  MissingFields: 'PUBLISH-MISSING-FIELDS',
  /** A recipe family the extractor saw and could not map. */
  FamilyUnmapped: 'PUBLISH-FAMILY-UNMAPPED',
  /** The extraction pipeline reported an error-severity diagnostic. */
  DiagnosticError: 'PUBLISH-DIAGNOSTIC-ERROR',
  /** Only stable-branch builds may be published as supported (spec 6.4). */
  BranchNotStable: 'PUBLISH-BRANCH-NOT-STABLE',
  /** The pack declares itself incompatible with the behavior models (spec 6.4). */
  BehaviorModelsIncompatible: 'PUBLISH-BEHAVIOR-MODELS-INCOMPATIBLE',
} as const;
export type PublishBlockerCode = (typeof PublishBlockerCode)[keyof typeof PublishBlockerCode];

/** One reason this pack may not publish yet, with the detail a reviewer needs. */
export interface PublishBlocker {
  code: PublishBlockerCode;
  detail: string;
}

/** Per-entity-type coverage: how much data there is, and how far it is trusted. */
export interface EntityCoverage {
  entityType: PackEntityType;
  /** Entities of this type in the payload. */
  entities: number;
  /** Property entries of this type, the unit the §6.5 levels are counted in. */
  properties: number;
  /** Property entries per §6.5 level (all five keys present, zeros included). */
  byQuality: Record<DataQuality, number>;
  /** Entities the diff added / removed / changed (0 without a changelog). */
  added: number;
  removed: number;
  changed: number;
  /** Property entries the diff reported (0 without a changelog). */
  changedProperties: number;
  /** Of those, the ones that invalidate a consuming model (§6.6 step 6). */
  invalidatingProperties: number;
}

/** The coverage view of one pack. */
export interface ProvenanceCoverageReport {
  packId: string;
  gameBuild: string;
  gameBranch: GameBranch;
  channel: PackChannel;
  /** One entry per entity type, in canonical order: recipes, items, devices. */
  entities: EntityCoverage[];
  /** Property entries per §6.5 level across the whole pack. */
  totals: Record<DataQuality, number>;
  /** Joins the pack reports supplied, in the schema's canonical join order. */
  suppliedJoins: JoinName[];
  /** Joins the pack reports missing, with the reason it recorded. */
  missingJoins: { join: JoinName; detail: string; suppliedBy?: string }[];
  /**
   * Why this pack may not publish yet, in a fixed order. Empty means the gates
   * this report covers are clear — §6.8 legal review and the human fixture
   * capture are outside it and still apply.
   */
  blockers: PublishBlocker[];
}

const ENTITY_COLLECTIONS: readonly { entityType: PackEntityType; collection: 'recipes' | 'items' | 'devices' }[] = [
  { entityType: 'recipe', collection: 'recipes' },
  { entityType: 'item', collection: 'items' },
  { entityType: 'device', collection: 'devices' },
];

function emptyTally(): Record<DataQuality, number> {
  return tallyPropertyQuality([]);
}

function addTally(into: Record<DataQuality, number>, from: Record<DataQuality, number>): void {
  for (const level of QUALITY_LEVELS) into[level] += from[level];
}

function diffCounts(
  changelog: PackChangelog | undefined,
  entityType: PackEntityType,
): { added: number; removed: number; changed: number; changedProperties: number; invalidating: number } {
  const counts = { added: 0, removed: 0, changed: 0, changedProperties: 0, invalidating: 0 };
  if (changelog === undefined) return counts;
  for (const entity of changelog.entities) {
    if (entity.entityType !== entityType) continue;
    counts[entity.kind] += 1;
    counts.changedProperties += entity.properties.length;
    counts.invalidating += entity.properties.filter((change) => change.invalidating).length;
  }
  return counts;
}

/**
 * Summarize one pack's data quality and coverage (spec 6.4, 6.5), and — when the
 * changelog that produced it is supplied — how much trust moved since the last
 * pack.
 *
 * Throws `PackError` (`PACK-DIFF-PACK-MISMATCH`) when the changelog describes a
 * different pack, so a report can never attribute another pack's movement to
 * this one.
 */
export function provenanceCoverageReport(
  pack: ReadonlyPack,
  changelog?: PackChangelog,
): ProvenanceCoverageReport {
  if (changelog !== undefined && changelog.nextPackId !== pack.packId) {
    throw new PackError(
      PackErrorCode.DiffPackMismatch,
      `changelog ${changelog.prevPackId} -> ${changelog.nextPackId} does not describe pack "${pack.packId}"`,
      ['report the coverage of the pack the changelog produced (`nextPackId`)'],
    );
  }

  const totals = emptyTally();
  const entities: EntityCoverage[] = [];

  for (const { entityType, collection } of ENTITY_COLLECTIONS) {
    const members = pack.payload[collection];
    const byQuality = tallyPropertyQuality(members);
    addTally(totals, byQuality);
    const diff = diffCounts(changelog, entityType);
    entities.push({
      entityType,
      entities: members.length,
      properties: QUALITY_LEVELS.reduce((sum, level) => sum + byQuality[level], 0),
      byQuality,
      added: diff.added,
      removed: diff.removed,
      changed: diff.changed,
      changedProperties: diff.changedProperties,
      invalidatingProperties: diff.invalidating,
    });
  }

  const suppliedJoins: JoinName[] = [];
  const missingJoins: { join: JoinName; detail: string; suppliedBy?: string }[] = [];
  for (const join of pack.coverage.joins) {
    if (join.status === 'supplied') {
      suppliedJoins.push(join.join);
      continue;
    }
    missingJoins.push({
      join: join.join,
      detail: join.detail,
      ...(join.suppliedBy === undefined ? {} : { suppliedBy: join.suppliedBy }),
    });
  }

  return {
    packId: pack.packId,
    gameBuild: pack.gameBuild,
    gameBranch: pack.gameBranch,
    channel: pack.channel,
    entities,
    totals,
    suppliedJoins,
    missingJoins,
    blockers: blockersOf(pack, totals, missingJoins),
  };
}

function blockersOf(
  pack: ReadonlyPack,
  totals: Record<DataQuality, number>,
  missingJoins: { join: JoinName; detail: string }[],
): PublishBlocker[] {
  const blockers: PublishBlocker[] = [];

  if (pack.gameBranch !== 'stable') {
    blockers.push({
      code: PublishBlockerCode.BranchNotStable,
      detail: `this pack comes from the "${pack.gameBranch}" branch; only stable-branch builds are published as supported`,
    });
  }

  if (totals['extracted-and-validated'] === 0) {
    blockers.push({
      code: PublishBlockerCode.NothingValidated,
      detail:
        'no property is extracted-and-validated, so no capability can be reported Verified and every calculation built on this pack is Unverified',
    });
  }

  for (const join of missingJoins) {
    blockers.push({ code: PublishBlockerCode.JoinMissing, detail: `${join.join}: ${join.detail}` });
  }

  if (pack.payload.devices.length === 0) {
    blockers.push({
      code: PublishBlockerCode.NoDevices,
      detail:
        'the payload carries no device definitions, so footprints, ports, and orientations are unavailable (EXT-05)',
    });
  }

  if (pack.coverage.missingFields.total > 0) {
    blockers.push({
      code: PublishBlockerCode.MissingFields,
      detail: `${pack.coverage.missingFields.total} fields the source does not supply are recorded as missing rather than defaulted`,
    });
  }

  for (const family of pack.coverage.families) {
    if (family.status !== 'unmapped') continue;
    blockers.push({
      code: PublishBlockerCode.FamilyUnmapped,
      detail: `family "${family.family}" is unmapped${family.reason === undefined ? '' : `: ${family.reason}`}`,
    });
  }

  for (const tally of pack.coverage.diagnostics.byCode) {
    if (tally.severity !== 'error') continue;
    blockers.push({
      code: PublishBlockerCode.DiagnosticError,
      detail: `${tally.code} was reported ${tally.count} time(s) by the extraction pipeline`,
    });
  }

  if (pack.behaviorModelCompatibility.status === 'incompatible') {
    blockers.push({
      code: PublishBlockerCode.BehaviorModelsIncompatible,
      detail: `the pack declares itself incompatible with the behavior models${
        pack.behaviorModelCompatibility.notes === undefined ? '' : `: ${pack.behaviorModelCompatibility.notes}`
      }`,
    });
  }

  return blockers;
}
