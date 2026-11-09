/**
 * Directory scanner for Adapter A (EXT-01b).
 *
 * Walks an input directory (non-recursive, i.e. `StreamingAssets/Data`), reads
 * every *.xml file in sorted order, and parses each with the confirmed
 * `<GameData>` grammar (`./gamedata`). Enforces the 9.4 untrusted-input bounds:
 * file count limit, per-file size limit. Malformed XML files are reported as
 * errors and skipped — one bad file does not abort the whole scan, but the
 * pipeline reports them in the coverage report.
 *
 * The scan also returns what it SAW beyond the mapped records: one
 * `FamilyObservation` per `GameData` child per file (including non-recipe
 * families) and a tally of `<Recipe>` control elements, so the coverage report
 * can state what was not extracted instead of silently dropping it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Diagnostic } from '../../diagnostics';
import type { ControlObservation, FamilyObservation } from '../../families';
import type { RawRecord } from '../../ir/raw';
import { parseGameDataFile } from './gamedata';

/** Untrusted-input bounds (spec 9.4): generous but finite. */
export const MAX_XML_FILES = 5_000;
export const MAX_XML_BYTES = 10 * 1024 * 1024;

export interface ScanResult {
  /** Raw records in deterministic order: files sorted by name, then document order. */
  records: RawRecord[];
  /** Parse diagnostics (malformed XML, grammar divergences), in file order. */
  diagnostics: Diagnostic[];
  /** Files that were skipped entirely (malformed XML); relative paths. */
  skippedFiles: string[];
  /** All *.xml files the scanner processed, sorted by name (including skipped). */
  scannedFiles: string[];
  /** Every `GameData` child observed, per file; mapped or not. */
  families: FamilyObservation[];
  /** Tally of non-ingredient `<Recipe>` children across the scan. */
  controls: ControlObservation[];
}

export interface ScanInputDirOptions {
  /** Absolute path of the directory to scan. */
  inputDir: string;
  /** Non-throwing sink for scan diagnostics; defaults to collecting. */
  onDiagnostics?: (diagnostic: Diagnostic) => void;
}

/**
 * Scan a directory for *.xml files and parse them with the confirmed
 * `<GameData>` grammar. Throws when the input directory does not exist or when
 * the 9.4 bounds are exceeded.
 */
export function scanInputDir(options: ScanInputDirOptions): ScanResult {
  const { inputDir } = options;
  const diagnostics: Diagnostic[] = [];
  const skippedFiles: string[] = [];
  const records: RawRecord[] = [];
  const scannedFiles: string[] = [];
  const families: FamilyObservation[] = [];
  const controls = new Map<string, ControlObservation>();

  /** Single sink: collect, and forward to the caller's sink when given. */
  const sink = (diagnostic: Diagnostic): void => {
    diagnostics.push(diagnostic);
    options.onDiagnostics?.(diagnostic);
  };

  let entries: string[];
  try {
    entries = readdirSync(inputDir);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`cannot read input directory ${inputDir}: ${message}`);
  }

  // Deterministic order: sorted by name. readdirSync order is not guaranteed.
  const xmlFiles = entries.filter((name) => name.endsWith('.xml')).sort();
  if (xmlFiles.length > MAX_XML_FILES) {
    throw new Error(
      `input directory contains ${xmlFiles.length} XML files; the limit is ${MAX_XML_FILES} (spec 9.4)`,
    );
  }

  for (const fileName of xmlFiles) {
    const filePath = join(inputDir, fileName);
    scannedFiles.push(fileName);
    let stat;
    try {
      stat = statSync(filePath);
    } catch {
      sink({
        code: 'XML-FILE-UNREADABLE',
        severity: 'error',
        message: `cannot stat input file ${fileName}`,
        sourceRule: '9.4',
        sourceFile: fileName,
      });
      skippedFiles.push(fileName);
      continue;
    }
    if (!stat.isFile()) continue;
    if (stat.size > MAX_XML_BYTES) {
      sink({
        code: 'XML-FILE-TOO-LARGE',
        severity: 'error',
        message: `input file ${fileName} is ${stat.size} bytes; the limit is ${MAX_XML_BYTES} (spec 9.4)`,
        sourceRule: '9.4',
        sourceFile: fileName,
      });
      skippedFiles.push(fileName);
      continue;
    }

    let text: string;
    try {
      text = readFileSync(filePath, 'utf8');
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      sink({
        code: 'XML-FILE-UNREADABLE',
        severity: 'error',
        message: `cannot read input file ${fileName}: ${message}`,
        sourceRule: '9.4',
        sourceFile: fileName,
      });
      skippedFiles.push(fileName);
      continue;
    }

    try {
      const result = parseGameDataFile(text, { sourceFile: fileName, onDiagnostics: sink });
      records.push(...result.records);
      families.push(...result.families);
      for (const observed of result.controls) {
        const key = `${observed.element}\u0000${observed.mapping}`;
        const existing = controls.get(key);
        if (existing) existing.occurrences += observed.occurrences;
        else controls.set(key, { ...observed });
      }
    } catch (e) {
      // Malformed XML: report and skip, do not abort the scan.
      const message = e instanceof Error ? e.message : String(e);
      sink({
        code: 'XML-MALFORMED',
        severity: 'error',
        message,
        sourceRule: '9.4',
        sourceFile: fileName,
      });
      skippedFiles.push(fileName);
    }
  }

  return { records, diagnostics, skippedFiles, scannedFiles, families, controls: [...controls.values()] };
}
