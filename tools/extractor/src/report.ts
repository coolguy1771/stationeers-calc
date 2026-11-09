/**
 * Coverage report and manifest (EXT-01b): pipeline output reporting.
 *
 * The coverage report counts records per entity type, per quality level, and
 * per recipe family (spec 6.5), and it states explicitly what was NOT extracted:
 * `families` lists every `GameData` child the input declares with its mapping
 * status, and `controls` lists every non-ingredient `<Recipe>` child with how it
 * was handled. Missing-field entries (spec 4.7/7.6), pipeline diagnostics, and
 * skipped files round it out.
 *
 * The manifest is a fragment for the pack manifest (spec 6): SHA-256 content
 * hashes over canonical JSON for the IR and coverage outputs, plus raw-byte
 * hashes for the input files.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Diagnostic } from './diagnostics';
import type { ControlObservation, FamilyObservation } from './families';
import type { IrData, FieldProvenanceOverride } from './ir';
import { IR_VERSION } from './ir';
import type { MissingFieldEntry } from './normalize';

/** SHA-256 digest of a string or byte buffer, as lowercase hex. */
export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** One `GameData` family across the whole scan, mapped or not. */
export interface FamilySummary {
  /** Element name of the `GameData` child, e.g. "AutolatheRecipes" or "Blueprint". */
  family: string;
  /** 'mapped' when at least one file's `<RecipeData>` records became recipes. */
  status: 'mapped' | 'unmapped';
  /** Files (basenames) declaring the family, sorted. */
  files: string[];
  /** Distinct child element names observed under the family element, sorted. */
  recordElements: string[];
  /** IR recipes produced for this family. */
  recipes: number;
  /** One line on why the family is unmapped (unmapped only). */
  reason?: string;
}

/**
 * Coverage report (EXT-01b): counts per entity type, quality level, and family,
 * mapped families and control elements, structured missing-field entries,
 * diagnostics, and skipped files.
 */
export interface CoverageReport {
  counts: {
    byType: Record<string, number>;
    byQualityLevel: Record<string, number>;
    byFieldQualityLevel: Record<string, number>;
    byFamily: Record<string, number>;
  };
  /** Every family the input declares, mapped or not, sorted by name. */
  families: FamilySummary[];
  /** Every non-ingredient `<Recipe>` child seen, sorted by element then mapping. */
  controls: ControlObservation[];
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
 * Merge per-file family observations into one summary per family. Families are
 * sorted by name; files and record elements are sorted; recipes are summed.
 */
export function summarizeFamilies(observations: FamilyObservation[]): FamilySummary[] {
  const byFamily = new Map<string, FamilySummary>();
  for (const observation of observations) {
    const existing = byFamily.get(observation.family);
    if (existing === undefined) {
      const summary: FamilySummary = {
        family: observation.family,
        status: observation.status,
        files: [observation.file],
        recordElements: [...observation.recordElements],
        recipes: observation.recipes,
      };
      if (observation.reason !== undefined) summary.reason = observation.reason;
      byFamily.set(observation.family, summary);
      continue;
    }
    existing.recipes += observation.recipes;
    if (!existing.files.includes(observation.file)) existing.files.push(observation.file);
    existing.recordElements = [...new Set([...existing.recordElements, ...observation.recordElements])].sort();
    if (observation.status === 'mapped') {
      existing.status = 'mapped';
      delete existing.reason;
    } else if (existing.reason === undefined && observation.reason !== undefined) {
      existing.reason = observation.reason;
    }
  }

  const summaries = [...byFamily.values()].sort((a, b) => (a.family < b.family ? -1 : a.family > b.family ? 1 : 0));
  for (const summary of summaries) summary.files.sort();
  return summaries;
}

/**
 * Build the coverage report from the IR data and pipeline outputs.
 * Deterministic: counts accumulate in the IR's canonical order, families and
 * controls are sorted.
 */
export function buildCoverageReport(options: {
  irData: IrData;
  diagnostics: Diagnostic[];
  missingFields: MissingFieldEntry[];
  skippedFiles: string[];
  inputDir: string;
  families?: FamilyObservation[];
  controls?: ControlObservation[];
}): CoverageReport {
  const counts = {
    byType: {} as Record<string, number>,
    byQualityLevel: {} as Record<string, number>,
    byFieldQualityLevel: {} as Record<string, number>,
    byFamily: {} as Record<string, number>,
  };

  for (const recipe of options.irData.recipes) {
    bump(counts.byType, 'recipe');
    bump(counts.byQualityLevel, recipe.provenance.qualityLevel);
    bump(counts.byFamily, recipe.family);
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

  const controls = [...(options.controls ?? [])].sort((a, b) =>
    a.element < b.element ? -1 : a.element > b.element ? 1 : a.mapping < b.mapping ? -1 : a.mapping > b.mapping ? 1 : 0,
  );

  return {
    counts,
    families: summarizeFamilies(options.families ?? []),
    controls,
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
