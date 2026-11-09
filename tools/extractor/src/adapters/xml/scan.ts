/**
 * Directory scanner for the PROVISIONAL XML adapter (EXT-01).
 *
 * Walks an input directory (non-recursive), reads every *.xml file in sorted
 * order, and parses each with the PROVISIONAL grammar. Enforces the 9.4
 * untrusted-input bounds: file count limit, per-file size limit. Malformed
 * XML files are reported as errors and skipped — one bad file does not abort
 * the whole scan, but the pipeline reports them in the coverage report.
 *
 * PROVISIONAL FORMAT — NOT GAME DATA. Replaced with the real install path
 * when the real format is confirmed.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Diagnostic } from '../../diagnostics';
import type { RawRecord } from '../../ir/raw';
import { parseProvisionalFile } from './provisional';

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
}

export interface ScanInputDirOptions {
  /** Absolute path of the directory to scan. */
  inputDir: string;
  /** Non-throwing sink for scan diagnostics; defaults to collecting. */
  onDiagnostics?: (diagnostic: Diagnostic) => void;
}

/**
 * Scan a directory for *.xml files and parse them with the PROVISIONAL
 * grammar. Throws when the input directory does not exist or when the
 * 9.4 bounds are exceeded.
 */
export function scanInputDir(options: ScanInputDirOptions): ScanResult {
  const { inputDir } = options;
  const diagnostics: Diagnostic[] = [];
  const skippedFiles: string[] = [];
  const records: RawRecord[] = [];
  const scannedFiles: string[] = [];

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
      diagnostics.push({
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
      diagnostics.push({
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
      diagnostics.push({
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
      const fileRecords = parseProvisionalFile(text, {
        sourceFile: fileName,
        onDiagnostics: (d) => {
          diagnostics.push(d);
          options.onDiagnostics?.(d);
        },
      });
      records.push(...fileRecords);
    } catch (e) {
      // Malformed XML: report and skip, do not abort the scan.
      const message = e instanceof Error ? e.message : String(e);
      diagnostics.push({
        code: 'XML-MALFORMED',
        severity: 'error',
        message,
        sourceRule: '9.4',
        sourceFile: fileName,
      });
      skippedFiles.push(fileName);
      options.onDiagnostics?.(diagnostics[diagnostics.length - 1] as Diagnostic);
    }
  }

  return { records, diagnostics, skippedFiles, scannedFiles };
}
