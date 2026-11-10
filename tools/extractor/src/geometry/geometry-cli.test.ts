/*
 * `stationeers-extract geometry` CLI tests (EXT-05): init writes a
 * deterministic worksheet, import writes geometry + coverage, and both refuse
 * bad input with an actionable message instead of a silent fallback.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GeometryCoverageSchema, GeometryDocumentSchema } from '.';

const fixturesDir = join(__dirname, '..', '..', 'test', 'fixtures');
const observationsPath = join(fixturesDir, 'geometry-observations.json');
const cliPath = join(__dirname, '..', 'cli.ts');
const BUILD = '0.2.1000.1111';
const DATE = '2025-11-10T00:00:00Z';

function runCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('bun', [cliPath, ...args], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function withTmpDir(run: (dir: string) => Promise<void> | void): () => Promise<void> {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ext05-geometry-'));
    try {
      await run(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

function extractFixtures(outDir: string): void {
  const result = runCli(['xml', fixturesDir, '--out', outDir]);
  if (result.status !== 0) {
    throw new Error(`xml adapter exited with ${result.status}: ${result.stderr}`);
  }
}

describe('geometry init', () => {
  it(
    'writes a byte-identical worksheet from an extraction directory',
    withTmpDir((dir) => {
      const irDir = join(dir, 'ir');
      extractFixtures(irDir);

      const first = join(dir, 'worksheet-1.json');
      const second = join(dir, 'worksheet-2.json');
      for (const out of [first, second]) {
        const result = runCli(['geometry', 'init', irDir, '--out', out]);
        expect(result.status).toBe(0);
        expect(result.stdout).toMatch(/prefab row\(s\)/);
      }

      const firstBytes = readFileSync(first, 'utf8');
      expect(readFileSync(second, 'utf8')).toBe(firstBytes);

      const worksheet = JSON.parse(firstBytes) as {
        kind: string;
        worksheet?: { seededFrom?: string; irVersion?: number; prefabIds?: number };
        install: { extractorVersion: string; gameBuild: string | null };
        grid: { largeCellSizeM: { value: number | null } };
        definitions: { prefabId: string; footprint: { cells: { value: null } } }[];
      };
      expect(worksheet.kind).toBe('stationeers-geometry-observations');
      expect(worksheet.worksheet?.seededFrom).toBe('ir');
      expect(worksheet.worksheet?.irVersion).toBe(2);
      expect(worksheet.install.extractorVersion).toBe('0.0.1');
      expect(worksheet.install.gameBuild).toBeNull();
      expect(worksheet.grid.largeCellSizeM.value).toBeNull();
      expect(worksheet.definitions.length).toBeGreaterThan(0);
      expect(worksheet.definitions.length).toBe(worksheet.worksheet?.prefabIds);
      const ids = worksheet.definitions.map((row) => row.prefabId);
      expect(ids).toEqual([...ids].sort());
      for (const row of worksheet.definitions) {
        expect(row.footprint.cells.value).toBeNull();
      }
    }),
  );

  it(
    'seeds from a pack file when given one',
    withTmpDir((dir) => {
      const irDir = join(dir, 'ir');
      extractFixtures(irDir);
      const packPath = join(dir, 'pack.json');
      const pack = runCli(['pack', irDir, '--out', packPath, '--build', BUILD, '--branch', 'stable', '--date', DATE]);
      expect(pack.status).toBe(0);

      const out = join(dir, 'worksheet.json');
      const result = runCli(['geometry', 'init', packPath, '--out', out]);
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/from the pack/);
      const worksheet = JSON.parse(readFileSync(out, 'utf8')) as {
        worksheet?: { seededFrom?: string; irVersion?: number };
      };
      expect(worksheet.worksheet?.seededFrom).toBe('pack');
      expect(worksheet.worksheet?.irVersion).toBeUndefined();
    }),
  );

  it(
    'refuses an input without ir.json and says what to run first',
    withTmpDir((dir) => {
      const result = runCli(['geometry', 'init', join(dir, 'missing'), '--out', join(dir, 'w.json')]);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/input path not found/);

      const emptyDir = join(dir, 'empty');
      const empty = spawnSync('mkdir', ['-p', emptyDir]);
      expect(empty.status).toBe(0);
      const second = runCli(['geometry', 'init', emptyDir, '--out', join(dir, 'w.json')]);
      expect(second.status).toBe(1);
      expect(second.stderr).toMatch(/expects an extraction directory containing ir\.json/);
    }),
  );

  it('requires a subcommand and an output path', () => {
    const noSub = runCli(['geometry']);
    expect(noSub.status).toBe(1);
    expect(noSub.stderr).toMatch(/requires a subcommand/);

    const noOut = runCli(['geometry', 'init', fixturesDir]);
    expect(noOut.status).toBe(1);
    expect(noOut.stderr).toMatch(/requires <irDir\|pack\.json> and --out/);
  });
});

describe('geometry import', () => {
  it(
    'writes geometry.json and geometry-coverage.json for a filled worksheet',
    withTmpDir((dir) => {
      const out = join(dir, 'out');
      const result = runCli(['geometry', 'import', observationsPath, '--out', out]);
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/nothing here is verified data/);
      expect(result.stdout).toMatch(/GEOM-PORT-INCOMPLETE/);

      const geometry = GeometryDocumentSchema.parse(
        JSON.parse(readFileSync(join(out, 'geometry.json'), 'utf8')),
      );
      const coverage = GeometryCoverageSchema.parse(
        JSON.parse(readFileSync(join(out, 'geometry-coverage.json'), 'utf8')),
      );
      expect(geometry.definitions).toHaveLength(3);
      expect(coverage.totals.geometryComplete).toBe(0);
      expect(coverage.unknownPorts).toHaveLength(1);
    }),
  );

  it(
    'is byte-identical across runs on the same observations',
    withTmpDir((dir) => {
      const first = join(dir, 'first');
      const second = join(dir, 'second');
      expect(runCli(['geometry', 'import', observationsPath, '--out', first]).status).toBe(0);
      expect(runCli(['geometry', 'import', observationsPath, '--out', second]).status).toBe(0);
      expect(readFileSync(join(second, 'geometry.json'), 'utf8')).toBe(
        readFileSync(join(first, 'geometry.json'), 'utf8'),
      );
      expect(readFileSync(join(second, 'geometry-coverage.json'), 'utf8')).toBe(
        readFileSync(join(first, 'geometry-coverage.json'), 'utf8'),
      );
    }),
  );

  it(
    'refuses a document claiming verified data, naming the field',
    withTmpDir((dir) => {
      const document = JSON.parse(readFileSync(observationsPath, 'utf8')) as Record<string, unknown>;
      const definitions = document['definitions'] as Record<string, unknown>[];
      definitions[0]!['gridKind'] = { value: 'large', confidence: 'verified' };
      const claimPath = join(dir, 'verified.json');
      writeFileSync(claimPath, JSON.stringify(document));

      const result = runCli(['geometry', 'import', claimPath, '--out', join(dir, 'out')]);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/refused the document: the document claims verified data/);
      expect(result.stderr).toMatch(/definitions\[0\]\.gridKind\.confidence: "verified"/);
    }),
  );
});
