/**
 * Semantic pack diff — the seam for EXT-04 (spec 6.6, step 4).
 *
 * EXT-03 deliberately ships the *shape* only: the changelog types a pack diff
 * produces, and the entry point EXT-04 implements. Nothing here compares two
 * packs yet, and `diffPacks` throws a stable "not implemented" code so a caller
 * cannot mistake the seam for a working diff.
 *
 * What EXT-04 will need (all of it already in the pack format):
 *
 * - **Stable entity ids.** Recipe ids are `"<family>/<prefabId>[#n]"` so an
 *   alternate recipe is its own entity; item/device ids are game-native. The
 *   builder sorts payload arrays by id, so a positional comparison is
 *   meaningful before the diff walks ids.
 * - **Per-property quality and provenance.** A value that changed AND was
 *   `extracted-and-validated` is a different event from one that was unverified
 *   all along; the diff must report both the value change and the quality change.
 * - **Coverage.** Families that gained or lost mapping, missing-field counts,
 *   and the three named joins (material->prefab, family->machine-prefab,
 *   display-name) move independently of the payload and are exactly what a
 *   reviewer reads after a game update.
 * - **Provenance hashes.** `sourceDigests` names which files changed, which is
 *   the cheapest way to explain *why* a value moved.
 *
 * Step 6 of the update workflow is the reason the changelog carries
 * `invalidatingProperties`: the engine's behavior models declare what they
 * consume (domain `BehaviorModel.consumes`), so "which models must drop to
 * Unverified" is the intersection of that declaration and this list.
 */
import { PackError, PackErrorCode } from './errors';
import type { PackEntityType, PropertyRef } from './quality';
import type { JoinName, PropertyQuality, ReadonlyPack } from './schema';

/** What happened to one property. */
export interface PropertyChange {
  property: string;
  /** `quality-changed` means the value is identical but its §6.5 level moved. */
  kind: 'added' | 'removed' | 'changed' | 'quality-changed';
  before?: PropertyQuality;
  after?: PropertyQuality;
}

/** What happened to one entity, addressed by its stable id. */
export interface EntityChange {
  entityType: PackEntityType;
  entityId: string;
  kind: 'added' | 'removed' | 'changed';
  /** Empty for added/removed entities unless property detail was requested. */
  properties: PropertyChange[];
}

/** One named join that gained or lost its source between packs. */
export interface JoinChange {
  join: JoinName;
  before: 'missing' | 'supplied';
  after: 'missing' | 'supplied';
}

/** Coverage movement between two packs. */
export interface CoverageChange {
  familiesMapped: string[];
  familiesUnmapped: string[];
  joins: JoinChange[];
  /** `after - before`; positive means more missing fields were recorded. */
  missingFieldsDelta: number;
  /** `after - before` for every diagnostic code seen in either pack. */
  diagnosticsDelta: { code: string; delta: number }[];
  /** Source files that changed, per `sourceDigests` (spec 6.4). */
  sourceFilesAdded: string[];
  sourceFilesRemoved: string[];
  sourceFilesChanged: string[];
}

/** The changelog a pack diff produces (spec 6.6). */
export interface PackChangelog {
  prevPackId: string;
  nextPackId: string;
  prevGameBuild: string;
  nextGameBuild: string;
  prevContentHash: string;
  nextContentHash: string;
  /** True when the two packs are semantically identical (hashes may still differ). */
  identical: boolean;
  entities: EntityChange[];
  coverage: CoverageChange;
  /**
   * Property refs whose value or quality changed, for §6.6 step 6: invalidate
   * every behavior model that consumes one of them.
   */
  invalidatingProperties: PropertyRef[];
}

/** The diff entry point EXT-04 implements. */
export interface PackDiffer {
  diffPacks(prev: ReadonlyPack, next: ReadonlyPack): PackChangelog;
}

/**
 * EXT-04 seam: not implemented in EXT-03 by design. Any call fails loudly with
 * `PACK-DIFF-NOT-IMPLEMENTED` rather than returning a misleading empty changelog.
 */
export function diffPacks(prev: ReadonlyPack, next: ReadonlyPack): PackChangelog {
  throw new PackError(
    PackErrorCode.DiffNotImplemented,
    `semantic pack diff is EXT-04 work: cannot diff "${prev.packId}" against "${next.packId}" yet`,
  );
}
