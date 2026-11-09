/**
 * Provenance coverage report (EXT-04; spec 6.4, 6.5, 6.6 step 8).
 *
 * The report must agree with the pack's own coverage tallies (the builder counts
 * the same property entries) and must never claim a gate the data does not meet.
 */
import { describe, expect, it } from 'vitest';
import { diffPacks } from './diff';
import { PackError, PackErrorCode } from './errors';
import type { CoverageInput, IrInput, PackBuildMetadata } from './input';
import { PublishBlockerCode, provenanceCoverageReport } from './provenance-coverage';
import type { Pack } from './schema';
import { buildSyntheticPack, SYNTHETIC_DATE, syntheticExtraction, syntheticMetadata } from './test-fixtures';

const ALPHA = 'InventedSmithyRecipes/ItemFixtureIngotAlpha';
const BETA = 'InventedSmithyRecipes/ItemFixtureIngotBeta';

const PROMOTE_TIER = {
  promotions: [
    {
      entityType: 'recipe',
      entityId: ALPHA,
      property: 'tier',
      approvedBy: 'alice',
      approvedAt: SYNTHETIC_DATE,
      reference: 'fixture smelter-tier/v1',
    },
  ],
};

interface PackVariation {
  ir?: (ir: IrInput) => void;
  coverage?: (coverage: CoverageInput) => void;
  metadata?: Partial<PackBuildMetadata>;
  promotions?: unknown;
  displayNames?: unknown;
}

/** Build the synthetic pack with exactly one dimension varied. */
async function buildPackWith(variation: PackVariation = {}): Promise<Pack> {
  const extraction = syntheticExtraction();
  variation.ir?.(extraction.ir);
  variation.coverage?.(extraction.coverage);
  return buildSyntheticPack({
    ir: extraction.ir,
    coverage: extraction.coverage,
    manifest: extraction.manifest,
    metadata: syntheticMetadata(variation.metadata),
    ...(variation.promotions === undefined ? {} : { promotions: variation.promotions }),
    ...(variation.displayNames === undefined ? {} : { displayNames: variation.displayNames }),
  });
}

describe('provenanceCoverageReport', () => {
  it('counts property entries per §6.5 level, per entity type, agreeing with the pack', async () => {
    const pack = await buildSyntheticPack();
    const report = provenanceCoverageReport(pack);

    expect(report.packId).toBe(pack.packId);
    expect(report.entities.map((entry) => entry.entityType)).toEqual(['recipe', 'item', 'device']);
    expect(report.totals).toEqual(pack.coverage.counts.byPropertyQuality);
    for (const entry of report.entities) {
      const levelTotal = Object.values(entry.byQuality).reduce((sum, count) => sum + count, 0);
      expect(entry.properties).toBe(levelTotal);
    }
    // The synthetic pack: 0 validated, everything extracted or missing.
    expect(report.totals['extracted-and-validated']).toBe(0);
    expect(report.totals['extracted-unverified']).toBeGreaterThan(0);
    expect(report.totals.missing).toBeGreaterThan(0);
    expect(report.entities[2]?.entities).toBe(0);
  });

  it('names every missing join and every gate that stands between the pack and a release', async () => {
    const pack = await buildSyntheticPack();
    const report = provenanceCoverageReport(pack);

    expect(report.suppliedJoins).toEqual([]);
    expect(report.missingJoins.map((join) => join.join)).toEqual([
      'material-to-prefab',
      'family-to-machine-prefab',
      'display-name',
    ]);
    expect(report.missingJoins.every((join) => join.detail.length > 0)).toBe(true);

    const codes = report.blockers.map((blocker) => blocker.code);
    expect(codes).toContain(PublishBlockerCode.NothingValidated);
    expect(codes.filter((code) => code === PublishBlockerCode.JoinMissing)).toHaveLength(3);
    expect(codes).toContain(PublishBlockerCode.NoDevices);
    expect(codes).toContain(PublishBlockerCode.MissingFields);
    expect(codes).toContain(PublishBlockerCode.FamilyUnmapped);
    expect(report.blockers.find((blocker) => blocker.code === PublishBlockerCode.FamilyUnmapped)?.detail).toContain(
      'Blueprint',
    );
  });

  it('drops the nothing-validated gate once a property is validated', async () => {
    const pack = await buildSyntheticPack({ promotions: PROMOTE_TIER });
    const report = provenanceCoverageReport(pack);

    expect(report.totals['extracted-and-validated']).toBe(1);
    expect(report.blockers.map((blocker) => blocker.code)).not.toContain(PublishBlockerCode.NothingValidated);
  });

  it('moves a join from missing to supplied when display names are supplied', async () => {
    const pack = await buildSyntheticPack({ displayNames: { [ALPHA]: 'Fixture Ingot Alpha' } });
    const report = provenanceCoverageReport(pack);

    expect(report.suppliedJoins).toEqual(['display-name']);
    expect(report.missingJoins.map((join) => join.join)).toEqual([
      'material-to-prefab',
      'family-to-machine-prefab',
    ]);
  });

  it('reports how much of each entity type moved in the diff that produced it', async () => {
    const before = await buildPackWith();
    const after = await buildPackWith({
      promotions: PROMOTE_TIER,
      displayNames: { [ALPHA]: 'Fixture Ingot Alpha' },
      ir: (ir) => {
        ir.recipes = ir.recipes.filter((candidate) => candidate.id !== BETA);
      },
    });
    const changelog = diffPacks(before, after);
    const report = provenanceCoverageReport(after, changelog);
    const recipes = report.entities[0];

    expect(recipes?.entityType).toBe('recipe');
    expect(recipes?.changed).toBe(1);
    expect(recipes?.removed).toBe(1);
    expect(recipes?.added).toBe(0);
    expect(recipes?.changedProperties).toBe(
      changelog.entities
        .filter((entity) => entity.entityType === 'recipe')
        .reduce((sum, entity) => sum + entity.properties.length, 0),
    );
    expect(recipes?.invalidatingProperties).toBeLessThanOrEqual(recipes?.changedProperties ?? 0);
    expect(report.entities[1]?.changed).toBe(0);
  });

  it('refuses a changelog that describes a different pack', async () => {
    const first = await buildPackWith();
    const second = await buildPackWith({ metadata: { gameBuild: '0.2.3000.3333' } });
    const changelog = diffPacks(second, first); // describes `first`

    expect(() => provenanceCoverageReport(second, changelog)).toThrowError(PackError);
    try {
      provenanceCoverageReport(second, changelog);
    } catch (error) {
      expect((error as PackError).code).toBe(PackErrorCode.DiffPackMismatch);
    }
  });

  it('flags a beta-branch pack and an error-severity diagnostic', async () => {
    const pack = await buildPackWith({
      metadata: { gameBranch: 'beta' },
      coverage: (coverage) => {
        coverage.diagnostics.push({
          code: 'XML-UNKNOWN-CONTROL',
          severity: 'error',
          message: 'a control element has no mapping',
        });
      },
    });
    const report = provenanceCoverageReport(pack);
    const codes = report.blockers.map((blocker) => blocker.code);

    expect(codes).toContain(PublishBlockerCode.BranchNotStable);
    expect(codes).toContain(PublishBlockerCode.DiagnosticError);
  });
});
