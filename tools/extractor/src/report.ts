/**
 * Coverage report and manifest (EXT-01): pipeline output reporting.
 *
 * The coverage report counts records per entity type and per quality level
 * (spec 6.5) and lists missing-field entries (spec 4.7/7.6) and pipeline
 * diagnostics. The manifest is a fragment for the pack manifest (spec 6):
 * SHA-256 content hashes over canonical JSON for the IR and coverage outputs,
 * plus raw-byte hashes for the input files.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Diagnostic } from './diagnostics';
import type { IrData, FieldProvenanceOverride } from './ir';
import { IR_VERSION } from './ir';
import type { MissingFieldEntry } from './normalize';
import { canonicalJson } from './canonical';

/** SHA-256 digest of a string or byte buffer, as lowercase hex. */
export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Coverage report (EXT-01): counts per entity type and per quality level,
 * structured missing-field entries, diagnostics, and skipped files.
 */
export interface CoverageReport {
  counts: {
    byType: Record<string, number>;
    byQualityLevel: Record<string, number>;
    byFieldQualityLevel: Record<string, number>;
  };
  missingFields: MissingFieldEntry[];
  diagnostics: Diagnostic[];
  skippedFiles: string[];
  /** Basename of the extraction input directory (provenance). */
  inputDir: string;
}

/**
 * Manifest fragment (EXT-01): hashes over canonical JSON for the IR and
 * coverage outputs, plus raw-byte hashes for the input files.
 */
export interface ManifestFragment {
  irVersion: number;
  /** Basename of the extraction input directory (provenance). */
  generatedFrom: string;
  fileCount: number;
  files: Record<string, { sha256: string; bytes: number }>;
  ir: { sha256: string; bytes: number };
  coverage: { sha256: string; bytes: number };
}

function bump(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function countFieldProvenance(
  counts: { byFieldQualityLevel: Record<string, number> },
  fieldProvenance?: Record<string, FieldProvenanceOverride>,
): void {
  if (!fieldProvenance) return;
  for (const override of Object.values(fieldProvenance)) {
    bump(counts.byFieldQualityLevel, override.qualityLevel);
  }
}

/**
 * Build the coverage report from the IR data and pipeline outputs.
 * Deterministic: counts accumulate in the IR's canonical order.
 */
export function buildCoverageReport(options: {
  irData: IrData;
  diagnostics: Diagnostic[];
  missingFields: MissingFieldEntry[];
  skippedFiles: string[];
  inputDir: string;
}): CoverageReport {
  const counts = {
    byType: {} as Record<string, number>,
    byQualityLevel: {} as Record<string, number>,
    byFieldQualityLevel: {} as Record<string, number>,
  };

  for (const recipe of options.irData.recipes) {
    bump(counts.byType, 'recipe');
    bump(counts.byQualityLevel, recipe.provenance.qualityLevel);
    countFieldProvenance(counts, recipe.fieldProvenance);
  }
  for (const item of options.irData.items) {
    bump(counts.byType, 'item');
    bump(counts.byQualityLevel, item.provenance.qualityLevel);
    countFieldProvenance(counts, item.fieldProvenance);
  }
  for (const worldRef of options.irData.worldRefs) {
    bump(counts.byType, 'worldref');
    bump(counts.byQualityLevel, worldRef.provenance.qualityLevel);
    countFieldProvenance(counts, worldRef.fieldProvenance);
  }

  return {
    counts,
    missingFields: options.missingFields,
    diagnostics: options.diagnostics,
    skippedFiles: options.skippedFiles,
    inputDir: options.inputDir,
  };
}

/**
 * Hash the input files (raw bytes) for the manifest. Files that were
 * skipped (malformed, too large) are included: they are part of the input.
 */
export function hashInputFiles(
  inputDir: string,
  files: string[],
): Record<string, { sha256: string; bytes: number }> {
  const result: Record<string, { sha256: string; bytes: number }> = {};
  for (const fileName of files) {
    const bytes = readFileSync(join(inputDir, fileName));
    result[fileName] = { sha256: sha256Hex(bytes), bytes: bytes.length };
  }
  return result;
}

/**
 * Build the manifest fragment: hashes over canonical JSON for the IR and
 * coverage outputs, plus raw-byte hashes for the input files.
 */
export function buildManifest(options: {
  irJson: string;
  coverageJson: string;
  inputFiles: Record<string, { sha256: string; bytes: number }>;
  inputDir: string;
}): ManifestFragment {
  return {
    irVersion: IR_VERSION,
    generatedFrom: options.inputDir,
    fileCount: Object.keys(options.inputFiles).length,
    files: options.inputFiles,
    ir: { sha256: sha256Hex(options.irJson), bytes: Buffer.byteLength(options.irJson) },
    coverage: { sha256: sha256Hex(options.coverageJson), bytes: Buffer.byteLength(options.coverageJson) },
  };
}
