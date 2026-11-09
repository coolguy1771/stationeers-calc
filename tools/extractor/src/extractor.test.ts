/**
 * EXT-01 tests: XML adapter, IR, normalizer, coverage report, manifest.
 * Fixtures are synthetic (PROVISIONAL format, not game data).
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseProvisionalFile } from './adapters/xml/provisional';
import { scanInputDir } from './adapters/xml/scan';
import { normalize } from './normalize';
import { buildCoverageReport } from './report';

const fixturesDir = join(__dirname, '..', 'test', 'fixtures');
const cliPath = join(__dirname, 'cli.ts');

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), 'utf8');
}

function parseFixture(name: string) {
  return parseProvisionalFile(readFixture(name), { sourceFile: name, onDiagnostics: () => {} });
}

function runCli(inputDir: string, outDir: string): void {
  // Run with bun explicitly: bun's extensionless TS resolution applies
  // (node would fail on './run'), and the shebang does not resolve reliably
  // from inside vitest workers.
  const result = spawnSync('bun', [cliPath, 'xml', inputDir, '--out', outDir], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`CLI exited with code ${result.status}: ${result.stderr}`);
  }
}

describe('EXT-01 XML adapter', () => {
  it('two-run byte-identical output (hash equality)', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'ext01-cli-'));
    try {
      const run1 = join(tmpDir, 'run1');
      const run2 = join(tmpDir, 'run2');
      runCli(fixturesDir, run1);
      runCli(fixturesDir, run2);
      const files = ['ir.json', 'coverage.json', 'manifest.json'];
      for (const fileName of files) {
        const a = readFileSync(join(run1, fileName), 'utf8');
        const b = readFileSync(join(run2, fileName), 'utf8');
        expect(a).toEqual(b);
      }
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('duplicate/conflict handling', () => {
    const records = parseFixture('duplicates.xml');
    const { irData, diagnostics } = normalize(records);

    // R_STEEL occurs twice with identical content: exact dupes collapse.
    const steel = irData.recipes.find((r) => r.id === 'R_STEEL');
    expect(steel).toBeDefined();
    expect(steel?.provenance.qualityLevel).toBe('extracted-unverified');
    const dup = irData.recipes.find((r) => r.id === 'R_DUP');
    expect(dup?.provenance.qualityLevel).toBe('conflicting');
    expect(dup?.displayName).toBe('First Version');

    const codes = diagnostics.map((d) => d.code);
    expect(codes).toContain('IR-DUP-EXACT');
    expect(codes).toContain('IR-DUP-CONFLICT');
  });

  it('missing-field appears in coverage', () => {
    const records = parseFixture('missing-fields.xml');
    const { irData, missingFields } = normalize(records);
    const coverage = buildCoverageReport({
      irData,
      diagnostics: [],
      missingFields,
      skippedFiles: [],
      inputDir: 'test',
    });
    expect(coverage.missingFields.length).toBe(2);
    expect(coverage.missingFields[0]?.entityId).toBe('R_NO_DISPLAY_NAME');
    expect(coverage.missingFields[0]?.field).toBe('displayName');
  });

  it('malformed XML fails with a useful error', () => {
    const scan = scanInputDir({ inputDir: fixturesDir });
    expect(scan.skippedFiles).toContain('malformed.xml');
    const malformed = scan.diagnostics.find((d) => d.code === 'XML-MALFORMED');
    expect(malformed).toBeDefined();
    expect(malformed?.sourceFile).toBe('malformed.xml');
    expect(malformed?.message).toMatch(/malformed XML/);
  });

  it('game IDs preserved verbatim', () => {
    const records = parseFixture('happy-path.xml');
    const { irData } = normalize(records);
    expect(irData.recipes.map((r) => r.id)).toEqual(['R_STEEL', 'R_GLASS']);
    expect(irData.items.map((i) => i.id)).toEqual(['Iron', 'Nickel', 'Steel', 'Sand', 'Glass']);
  });

  it('one unit conversion spot check', () => {
    const records = parseFixture('happy-path.xml');
    const { irData } = normalize(records);
    const steel = irData.recipes.find((r) => r.id === 'R_STEEL');
    expect(steel?.inputs[0]).toEqual({ itemId: 'Iron', quantity: 0.01, unit: 'kg' });
    expect(steel?.fieldProvenance?.['inputs[0]']).toEqual({
      qualityLevel: 'inferred',
      notes: 'unit conversion g -> kg',
    });
  });
});
