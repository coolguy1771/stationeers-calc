/*
 * `geometry import` (EXT-05): validate an observation document, then hand it to
 * `normalize.ts` and `coverage.ts`.
 *
 * Failure policy, in order:
 *
 * 1. The document is untrusted input (spec 9.4): size cap, JSON parse, then a
 *    scan that REFUSES any claim of verification (a worksheet cannot assert
 *    `verified` or `extracted-and-validated`; promotion is a later, audited
 *    step, spec 6.5).
 * 2. A document that does not match the schema fails with the offending paths
 *    named — never a silent fallback.
 * 3. An *incomplete* document succeeds and reports its gaps in the coverage
 *    report: a partly measured worksheet is the normal case, and hiding the
 *    measurements it does contain behind a parse error would be worse.
 */
import { canonicalJson } from '../canonical';
import { sha256Hex } from '../report';
import {
  MAX_OBSERVATIONS_FILE_BYTES,
  ObservationDocumentSchema,
  OBSERVATION_DOCUMENT_KIND,
  OBSERVATION_DOCUMENT_VERSION,
  type ObservationDocument,
} from './observations';
import { buildCoverage, summarizeImport } from './coverage';
import { normalizeObservations, type NormalizeOptions } from './normalize';
import type { GeometryCoverage, GeometryDocument } from './records';

/** Result of importing one observation document. */
export interface GeometryImportResult {
  observations: ObservationDocument;
  document: GeometryDocument;
  coverage: GeometryCoverage;
  /** Canonical JSON (sorted keys) with a trailing newline. */
  geometryJson: string;
  coverageJson: string;
  /** One-line human summary for the CLI. */
  summary: string;
}

/** Options for an import run (extractor version, source digest override). */
export type GeometryImportOptions = NormalizeOptions;

/** Why an observation document could not be imported. */
export type GeometryImportErrorCode =
  | 'too-large'
  | 'not-json'
  | 'not-observations'
  | 'future-version'
  | 'claims-verification'
  | 'schema'
  | 'duplicate-id';

/** A refusal with an actionable message; the CLI prints it verbatim. */
export class GeometryImportError extends Error {
  readonly code: GeometryImportErrorCode;
  readonly issues: readonly string[];

  constructor(
    code: GeometryImportErrorCode,
    message: string,
    issues: readonly string[] = [],
  ) {
    super(message);
    this.name = 'GeometryImportError';
    this.code = code;
    this.issues = issues;
  }
}

/** Object keys whose value would claim a verification level we cannot assert. */
const QUALITY_KEYS = new Set(['confidence', 'sourceQuality', 'quality', 'qualityLevel']);

/** Values that mean "this is validated/verified data". */
const VERIFICATION_CLAIMS = new Set(['verified', 'extracted-and-validated']);

/**
 * Walk the raw document for any claim of verification. The schema's enums
 * would already reject these, but the error would be buried in a union list;
 * a named refusal tells the observer exactly which rule they crossed.
 */
function collectVerificationClaims(
  value: unknown,
  at: string,
  found: string[],
  depth = 0,
): void {
  if (found.length >= 8 || depth > 64) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectVerificationClaims(item, `${at}[${index}]`, found, depth + 1),
    );
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, child] of Object.entries(value)) {
    const childAt = at === '' ? key : `${at}.${key}`;
    if (QUALITY_KEYS.has(key) && typeof child === 'string' && VERIFICATION_CLAIMS.has(child)) {
      found.push(`${childAt}: "${child}"`);
    }
    collectVerificationClaims(child, childAt, found, depth + 1);
  }
}

/** Format zod issues as `path: message` lines (bounded). */
function formatIssues(error: { issues: { path: PropertyKey[]; message: string }[] }): string[] {
  return error.issues.slice(0, 20).map((issue) => {
    const where = issue.path.map(String).join('.') || '(root)';
    return `${where}: ${issue.message}`;
  });
}

/**
 * Validate an observation document. Throws `GeometryImportError` with a clear
 * message for every refusal (size, JSON, kind, future version, verification
 * claims, schema, duplicate ids).
 */
export function parseObservationDocument(rawText: string): ObservationDocument {
  const bytes = new TextEncoder().encode(rawText).length;
  if (bytes > MAX_OBSERVATIONS_FILE_BYTES) {
    throw new GeometryImportError(
      'too-large',
      `observations document is ${bytes} bytes; the limit is ${MAX_OBSERVATIONS_FILE_BYTES} (spec 9.4)`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    throw new GeometryImportError(
      'not-json',
      `observations document is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new GeometryImportError('not-observations', 'the document is not a JSON object');
  }

  const candidate = parsed as Record<string, unknown>;
  if (candidate['kind'] !== OBSERVATION_DOCUMENT_KIND) {
    throw new GeometryImportError(
      'not-observations',
      `the document kind is ${JSON.stringify(candidate['kind'] ?? null)}, expected "${OBSERVATION_DOCUMENT_KIND}" (start from \`geometry init\`)`,
    );
  }
  const version = candidate['documentVersion'];
  if (typeof version === 'number' && version > OBSERVATION_DOCUMENT_VERSION) {
    throw new GeometryImportError(
      'future-version',
      `observation document version ${version} is newer than this build supports (${OBSERVATION_DOCUMENT_VERSION}); re-run \`geometry init\` with the matching extractor rather than coercing it (spec 9.2)`,
    );
  }

  const claims: string[] = [];
  collectVerificationClaims(candidate, '', claims);
  if (claims.length > 0) {
    throw new GeometryImportError(
      'claims-verification',
      'the document claims verified data, which a worksheet cannot establish: observations are extracted-unverified until a fixture or review promotes them (spec 6.5)',
      claims,
    );
  }

  const result = ObservationDocumentSchema.safeParse(candidate);
  if (!result.success) {
    throw new GeometryImportError(
      'schema',
      'the observation document fails schema validation',
      formatIssues(result.error),
    );
  }

  const document = result.data;
  assertUniqueIds(document);
  return document;
}

/** Duplicate ids would silently overwrite each other; refuse instead. */
function assertUniqueIds(document: ObservationDocument): void {
  const seenDefinitions = new Map<string, number>();
  document.definitions.forEach((definition, index) => {
    const first = seenDefinitions.get(definition.prefabId);
    if (first !== undefined) {
      throw new GeometryImportError(
        'duplicate-id',
        `definitions[${first}] and definitions[${index}] both describe prefab "${definition.prefabId}"; merge the rows so one prefab has one observation`,
      );
    }
    seenDefinitions.set(definition.prefabId, index);
  });
  const seenElements = new Map<string, number>();
  document.elements.forEach((element, index) => {
    const first = seenElements.get(element.definitionId);
    if (first !== undefined) {
      throw new GeometryImportError(
        'duplicate-id',
        `elements[${first}] and elements[${index}] both describe "${element.definitionId}"; merge the rows`,
      );
    }
    seenElements.set(element.definitionId, index);
  });
}


/**
 * Import an observation document: validate, normalize, report. Throws
 * `GeometryImportError` for anything that is not a usable observation document;
 * an incomplete document succeeds and reports gaps in the coverage.
 */
export function importObservations(
  rawText: string,
  options: GeometryImportOptions = {},
): GeometryImportResult {
  const observations = parseObservationDocument(rawText);
  const document = normalizeObservations(observations, {
    ...options,
    sourceDigest: {
      sha256: sha256Hex(rawText),
      bytes: new TextEncoder().encode(rawText).length,
    },
  });
  const coverage = buildCoverage(document);
  return {
    observations,
    document,
    coverage,
    geometryJson: canonicalJson(document) + '\n',
    coverageJson: canonicalJson(coverage) + '\n',
    summary: summarizeImport(document, coverage),
  };
}