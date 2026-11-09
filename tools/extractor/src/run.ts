/**
 * Pipeline orchestrator (EXT-01): scan -> normalize -> report -> serialize.
 *
 * Deterministic: the same input directory produces byte-identical
 * `ir.json`, `coverage.json`, and `manifest.json` on every run.
 */
import { basename } from 'node:path';
import type { IrData } from './ir';
import { scanInputDir } from './adapters/xml/scan';
import { normalize } from './normalize';
import { canonicalJson } from './canonical';
import { buildCoverageReport, buildManifest, hashInputFiles } from './report';

export interface ExtractionResult {
  /** Raw records in scan order (before normalization). */
  scanResult: ReturnType<typeof scanInputDir>;
  normalizeResult: ReturnType<typeof normalize>;
  irData: IrData;
  coverage: ReturnType<typeof buildCoverageReport>;
  manifest: ReturnType<typeof buildManifest>;
  /** Canonical JSON of the IR data (with trailing newline). */
  irJson: string;
  /** Canonical JSON of the coverage report (with trailing newline). */
  coverageJson: string;
  /** Canonical JSON of the manifest fragment (with trailing newline). */
  manifestJson: string;
}

/**
 * Run the extraction pipeline for the PROVISIONAL XML adapter (EXT-01)
 * over an input directory. Throws when the input directory does not exist
 * or when the 9.4 bounds are exceeded.
 */
export function runExtraction(inputDir: string): ExtractionResult {
  const scan = scanInputDir({ inputDir });
  const norm = normalize(scan.records);
  const irData = norm.irData;
  const irJson = canonicalJson(irData) + '\n';

  const coverage = buildCoverageReport({
    irData,
    diagnostics: [...scan.diagnostics, ...norm.diagnostics],
    missingFields: norm.missingFields,
    skippedFiles: scan.skippedFiles,
    inputDir: basename(inputDir),
  });
  const coverageJson = canonicalJson(coverage) + '\n';

  const inputFiles = hashInputFiles(inputDir, scan.scannedFiles);
  const manifest = buildManifest({ irJson, coverageJson, inputFiles, inputDir: basename(inputDir) });
  const manifestJson = canonicalJson(manifest) + '\n';

  return { scanResult: scan, normalizeResult: norm, irData, coverage, manifest, irJson, coverageJson, manifestJson };
}
