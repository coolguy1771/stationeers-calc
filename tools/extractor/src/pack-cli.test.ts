/**
 * `stationeers-extract pack` tests (EXT-03): the CLI turns an extraction output
 * directory into a pack, writes byte-identical artifacts, and validates the
 * result with the runtime loader.
 *
 * The input XML fixtures are synthetic in value (real structure) — see
 * `extractor.test.ts` and spec 6.3/6.8.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPackJson } from '@stationeers/packs';

const fixturesDir = join(__dirname, '..', 'test', 'fixtures');
const cliPath = join(__dirname, 'cli.ts');
const BUILD = '0.2.1000.1111';
const DATE = '2025-11-10T00:00:00Z';

function runCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('bun', [cliPath, ...args], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function extractFixtures(outDir: string): void {
  const result = runCli(['xml', fixturesDir, '--out', outDir]);
  if (result.status !== 0) {
    throw new Error(`xml adapter exited with ${result.status}: ${result.stderr}`);
  }
}

function withTmpDir(run: (dir: string) => Promise<void> | void): () => Promise<void> {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ext03-pack-'));
    try {
      await run(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

describe('pack CLI', () => {
  it(
    'builds a pack that loads, with every extracted property unverified',
    withTmpDir(async (dir) => {
      const irDir = join(dir, 'ir');
      const packPath = join(dir, 'pack.json');
      extractFixtures(irDir);

      const result = runCli(['pack', irDir, '--out', packPath, '--build', BUILD, '--branch', 'stable', '--date', DATE]);
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/pack stationeers-stable-0\.2\.1000\.1111/);
      expect(result.stdout).toMatch(/0 validated/);

      const pack = await loadPackJson(readFileSync(packPath, 'utf8'));
      const ir = JSON.parse(readFileSync(join(irDir, 'ir.json'), 'utf8')) as { recipes: unknown[] };
      expect(pack.packSchemaVersion).toBe(1);
      expect(pack.entityCounts.recipes).toBe(ir.recipes.length);
      expect(pack.channel).toBe('user-generated');
      expect(pack.gameBuild).toBe(BUILD);
      expect(pack.coverage.counts.byPropertyQuality['extracted-and-validated']).toBe(0);
      expect(pack.coverage.joins.map((join) => join.status)).toEqual(['missing', 'missing', 'missing']);
    }),
  );

  it(
    'writes byte-identical packs for identical inputs',
    withTmpDir(async (dir) => {
      const irDir = join(dir, 'ir');
      extractFixtures(irDir);

      const first = join(dir, 'first.json');
      const second = join(dir, 'second.json');
      for (const out of [first, second]) {
        const result = runCli(['pack', irDir, '--out', out, '--build', BUILD, '--branch', 'stable', '--date', DATE]);
        expect(result.status).toBe(0);
      }

      expect(readFileSync(first, 'utf8')).toBe(readFileSync(second, 'utf8'));
    }),
  );

  it(
    'applies an explicit validation input end to end',
    withTmpDir(async (dir) => {
      const irDir = join(dir, 'ir');
      const packPath = join(dir, 'pack.json');
      const validatedPath = join(dir, 'promotions.json');
      extractFixtures(irDir);

      writeFileSync(
        validatedPath,
        JSON.stringify({
          promotions: [
            {
              entityType: 'recipe',
              entityId: 'InventedSmithyRecipes/ItemFixtureIngotAlpha',
              property: 'time',
              approvedBy: 'fixture-review',
              approvedAt: DATE,
              reference: 'fixture plan cross-check',
              unit: 's',
            },
          ],
        }),
      );

      const result = runCli([
        'pack',
        irDir,
        '--out',
        packPath,
        '--build',
        BUILD,
        '--branch',
        'stable',
        '--date',
        DATE,
        '--validated',
        validatedPath,
      ]);
      expect(result.status).toBe(0);

      const pack = await loadPackJson(readFileSync(packPath, 'utf8'));
      expect(pack.coverage.counts.byPropertyQuality['extracted-and-validated']).toBe(1);
      const recipe = pack.payload.recipes.find((entry) => entry.id === 'InventedSmithyRecipes/ItemFixtureIngotAlpha');
      expect(recipe?.properties['time']?.approval?.approvedBy).toBe('fixture-review');
      expect(recipe?.time).toMatchObject({ value: 3, unitStatus: 'verified', unit: 's' });
    }),
  );

  it(
    'refuses to publish a beta-branch pack',
    withTmpDir((dir) => {
      const irDir = join(dir, 'ir');
      extractFixtures(irDir);

      const result = runCli([
        'pack',
        irDir,
        '--out',
        join(dir, 'pack.json'),
        '--build',
        BUILD,
        '--branch',
        'beta',
        '--channel',
        'published',
        '--date',
        DATE,
      ]);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/stable-branch/);
    }),
  );

  it(
    'requires the install facts the game data does not carry',
    withTmpDir((dir) => {
      const irDir = join(dir, 'ir');
      extractFixtures(irDir);

      const missingBuild = runCli(['pack', irDir, '--out', join(dir, 'pack.json'), '--branch', 'stable']);
      expect(missingBuild.status).toBe(1);
      expect(missingBuild.stderr).toMatch(/--build/);

      const badBranch = runCli(['pack', irDir, '--out', join(dir, 'pack.json'), '--build', BUILD, '--branch', 'nightly']);
      expect(badBranch.status).toBe(1);
      expect(badBranch.stderr).toMatch(/--branch must be/);
    }),
  );
});
