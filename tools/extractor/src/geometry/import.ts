/*
 * `geometry import` (EXT-05): validate an observation document and normalize
 * it into entity-contract-shaped geometry records plus a coverage report.
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
 *
 * Output is deterministic: definitions, elements, ports, and orientations are
 * sorted, so row order in the worksheet does not move the normalized records
 * and consecutive probes diff cleanly (EXT-04). The document's digest names
 * the exact source artifact, so a formatting-only edit is visible for what it
 * is.
 */
import { canonicalJson } from '../canonical';
import { sha256Hex } from '../report';
import { EXTRACTOR_VERSION } from '../version';
import {
  MAX_OBSERVATIONS_FILE_BYTES,
  ObservationDocumentSchema,
  OBSERVATION_DOCUMENT_KIND,
  OBSERVATION_DOCUMENT_VERSION,
  readSlot,
  type DefinitionObservation,
  type ElementObservation,
  type GridObservation,
  type ObservationDocument,
  type PortObservation,
  type ResolvedSlot,
} from './observations';
import {
  GEOMETRY_DOCUMENT_KIND,
  GEOMETRY_DOCUMENT_VERSION,
  GeometryCoverageSchema,
  GeometryDocumentSchema,
  type FieldCoverage,
  type GeometryBlocker,
  type GeometryCoverage,
  type GeometryDefinitionRecord,
  type GeometryDocument,
  type GeometryElementRecord,
  type GeometryFieldProvenance,
  type GeometryFootprintCell,
  type GeometryGap,
  type GeometryGrid,
  type GeometryPortRecord,
  type UnknownPort,
} from './records';

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

export interface GeometryImportOptions {
  /** Extractor version recorded in the output; defaults to this build's. */
  extractorVersion?: string;
  /**
   * Digest of the exact source artifact. `importObservations` supplies the raw
   * file digest; direct callers fall back to the canonical JSON of the parsed
   * document.
   */
  sourceDigest?: { sha256: string; bytes: number };
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

/** Compare two strings without locale dependence (deterministic ordering). */
function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Provenance for a recorded field; absent slots never produce one. */
function provenanceOf(
  field: string,
  slot: ResolvedSlot<unknown>,
  sourcePath: string,
): GeometryFieldProvenance {
  return {
    field,
    sourceQuality: 'extracted-unverified',
    confidence: slot.confidence === 'inferred' ? 'inferred' : 'observed',
    method: slot.method,
    sourcePath,
  };
}

/** A gap: a contract field the observations leave empty. */
function gapOf(field: string, reason: string, blocksBuildability: boolean): GeometryGap {
  return { field, reason, blocksBuildability };
}

/** Surface order used when sorting orientation sets. */
const SURFACE_ORDER: Record<string, number> = {
  floor: 0,
  wall: 1,
  ceiling: 2,
  freestanding: 3,
};

/** Deterministic, duplicate-free orientation list. */
function sortOrientations(
  orientations: { surface: string; yaw: number }[],
): { surface: 'floor' | 'wall' | 'ceiling' | 'freestanding'; yaw: 0 | 1 | 2 | 3 }[] {
  const seen = new Set<string>();
  const unique = orientations.filter((orientation) => {
    const key = `${orientation.surface}/${orientation.yaw}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  unique.sort(
    (a, b) =>
      (SURFACE_ORDER[a.surface] ?? 99) - (SURFACE_ORDER[b.surface] ?? 99) || a.yaw - b.yaw,
  );
  return unique as { surface: 'floor' | 'wall' | 'ceiling' | 'freestanding'; yaw: 0 | 1 | 2 | 3 }[];
}

/** One connector in contract field names, with every unknown named. */
function buildPort(observed: PortObservation, base: string): GeometryPortRecord {
  const at = `${base}.ports[${observed.id}]`;
  const provenance: GeometryFieldProvenance[] = [];
  const gaps: GeometryGap[] = [];
  const unknownFields: string[] = [];

  const position = readSlot(observed.localPosition);
  if (position.value === null) {
    unknownFields.push('localPosition');
    gaps.push(
      gapOf(
        'localPosition',
        'connector cell not observed: attach a matching element and record the adjacent cell (spec 4.3)',
        true,
      ),
    );
  } else {
    provenance.push(provenanceOf('localPosition', position, `${at}.localPosition`));
  }

  const direction = readSlot(observed.direction);
  if (direction.value === null) {
    unknownFields.push('direction');
    gaps.push(
      gapOf(
        'direction',
        'connector direction not observed; connector alignment validation needs it (spec 4.3, 7.4)',
        true,
      ),
    );
  } else {
    provenance.push(provenanceOf('direction', direction, `${at}.direction`));
  }

  const mediation = readSlot(observed.mediation);
  if (mediation.value === null) {
    unknownFields.push('mediation');
    gaps.push(
      gapOf(
        'mediation',
        'passive vs device-mediated not recorded; network semantics need it (spec 4.4), buildability does not',
        false,
      ),
    );
  } else {
    provenance.push(provenanceOf('mediation', mediation, `${at}.mediation`));
  }

  const categories = readSlot(observed.categories);
  if (categories.value === null) {
    unknownFields.push('categories');
    gaps.push(gapOf('categories', 'accepted construction categories not observed', false));
  } else {
    provenance.push(provenanceOf('categories', categories, `${at}.categories`));
  }

  const capabilities = readSlot(observed.capabilities);
  if (capabilities.value === null) {
    unknownFields.push('capabilities');
    gaps.push(gapOf('capabilities', 'port capabilities not observed', false));
  } else {
    provenance.push(provenanceOf('capabilities', capabilities, `${at}.capabilities`));
  }

  return {
    id: observed.id,
    medium: observed.medium,
    localPosition: position.value === null ? null : { ...position.value },
    direction: direction.value === null ? null : { ...direction.value },
    categories: categories.value === null ? null : [...categories.value].sort(compareStrings),
    mediation: mediation.value,
    capabilities:
      capabilities.value === null ? null : [...capabilities.value].sort(compareStrings),
    sourceQuality: unknownFields.length === 0 ? 'extracted-unverified' : 'missing',
    unknownFields,
    provenance,
    gaps,
  };
}

/** One prefab's geometry record. */
function buildDefinition(observations: DefinitionObservation): GeometryDefinitionRecord {
  const base = `definitions[${observations.prefabId}]`;
  const placeable = readSlot(observations.placeable);

  // Triage: an inspected item has no geometry to record, and reporting its
  // empty slots as buildability gaps would drown the real ones.
  if (placeable.value === false) {
    return {
      id: observations.prefabId,
      placeable: false,
      grid: null,
      allowedOrientations: null,
      refusedOrientations: null,
      footprint: null,
      footprintOriginNote: null,
      ports: null,
      internalVolumeM3: null,
      sealing: { isSealingStructure: null, behaviour: null },
      geometryComplete: false,
      sourceQuality: 'missing',
      provenance: [],
      gaps: [],
      notes: observations.notes ?? null,
    };
  }

  const provenance: GeometryFieldProvenance[] = [];
  const gaps: GeometryGap[] = [];

  const gridSlot = readSlot(observations.gridKind);
  if (gridSlot.value === null) {
    gaps.push(
      gapOf('grid', 'grid kind not observed: which grid the prefab snaps to is unknown (spec 4.2)', true),
    );
  } else {
    provenance.push(provenanceOf('grid', gridSlot, `${base}.gridKind`));
  }

  const allowedSlot = readSlot(observations.orientations?.allowed);
  const allowed = allowedSlot.value === null ? null : sortOrientations(allowedSlot.value);
  if (allowed === null) {
    gaps.push(
      gapOf(
        'allowedOrientations',
        'orientation set not observed: no mounting surface or yaw was tried (spec 4.2)',
        true,
      ),
    );
  } else if (allowed.length === 0) {
    gaps.push(
      gapOf(
        'allowedOrientations',
        'orientation set observed as empty: a device that accepts no mounting surface cannot be placed (spec 4.2)',
        true,
      ),
    );
  } else {
    provenance.push(provenanceOf('allowedOrientations', allowedSlot, `${base}.orientations.allowed`));
  }

  const refusedSlot = readSlot(observations.orientations?.refused);
  const refused = refusedSlot.value === null ? null : sortOrientations(refusedSlot.value);
  const originSlot = readSlot(observations.footprint?.originNote);
  if (originSlot.value !== null) {
    provenance.push(provenanceOf('footprintOriginNote', originSlot, `${base}.footprint.originNote`));
  }

  const footprintSlot = readSlot(observations.footprint?.cells);
  let footprint: GeometryFootprintCell[] | null = null;
  if (footprintSlot.value === null) {
    gaps.push(
      gapOf(
        'footprint',
        'footprint not observed: occupied cells were not counted (spec 4.2, 3.6)',
        true,
      ),
    );
  } else {
    const seen = new Set<string>();
    let duplicates = 0;
    const cells = footprintSlot.value
      .map((cell, original) => ({ cell, original }))
      .filter(({ cell }) => {
        const key = `${cell.x}/${cell.y}/${cell.z}`;
        if (seen.has(key)) {
          duplicates += 1;
          return false;
        }
        seen.add(key);
        return true;
      })
      .sort(
        (a, b) =>
          a.cell.x - b.cell.x ||
          a.cell.y - b.cell.y ||
          a.cell.z - b.cell.z ||
          a.original - b.original,
      )
      .map(({ cell }) => ({
        local: { x: cell.x, y: cell.y, z: cell.z },
        solid: cell.solid ?? null,
      }));
    footprint = cells;
    provenance.push(provenanceOf('footprint', footprintSlot, `${base}.footprint.cells`));
    if (cells.length === 0) {
      gaps.push(
        gapOf(
          'footprint',
          'footprint observed as empty: a placeable device occupies at least one cell (spec 4.2)',
          true,
        ),
      );
    }
    if (duplicates > 0) {
      gaps.push(
        gapOf(
          'footprint',
          `${duplicates} duplicate cell(s) were listed and collapsed; a cell can be occupied once`,
          false,
        ),
      );
    }
    cells.forEach((cell, cellIndex) => {
      const where = `${cell.local.x}/${cell.local.y}/${cell.local.z}`;
      if (cell.solid === null) {
        gaps.push(
          gapOf(
            `footprint[${cellIndex}].solid`,
            `solidity of cell ${where} not tested; it stays unknown rather than assumed true (spec 4.2)`,
            true,
          ),
        );
      } else {
        provenance.push({
          field: `footprint[${cellIndex}].solid`,
          sourceQuality: 'extracted-unverified',
          confidence: footprintSlot.confidence === 'inferred' ? 'inferred' : 'observed',
          method: footprintSlot.method,
          sourcePath: `${base}.footprint.cells`,
        });
      }
    });
  }

  const portsSlot = readSlot(observations.ports);
  let ports: GeometryPortRecord[] | null = null;
  if (portsSlot.value === null) {
    gaps.push(
      gapOf(
        'ports',
        'connectors not surveyed: attach an element to every connector and record the adjacent cell (spec 4.3)',
        true,
      ),
    );
  } else {
    const seenPortIds = new Set<string>();
    const built = portsSlot.value
      .map((port, original) => ({ port, original }))
      .filter(({ port }) => {
        if (seenPortIds.has(port.id)) return false;
        seenPortIds.add(port.id);
        return true;
      })
      .sort((a, b) => compareStrings(a.port.id, b.port.id) || a.original - b.original)
      .map(({ port }) => buildPort(port, base));
    ports = built;
    provenance.push(provenanceOf('ports', portsSlot, `${base}.ports`));
    const dropped = portsSlot.value.length - built.length;
    if (dropped > 0) {
      gaps.push(
        gapOf(
          'ports',
          `${dropped} duplicate port id(s) were listed and collapsed; port ids must be unique per device (spec 4.3)`,
          false,
        ),
      );
    }
  }

  const volumeSlot = readSlot(observations.internalVolumeM3);
  if (volumeSlot.value !== null) {
    provenance.push(provenanceOf('internalVolumeM3', volumeSlot, `${base}.internalVolumeM3`));
  } else {
    gaps.push(
      gapOf(
        'internalVolumeM3',
        'device internal volume not observed; §4.7 network volume needs it for pass-through devices',
        false,
      ),
    );
  }

  const sealingSlot = readSlot(observations.sealing?.isSealingStructure);
  const sealingBehaviour = readSlot(observations.sealing?.behaviour);
  if (sealingSlot.value !== null) {
    provenance.push(
      provenanceOf('sealing.isSealingStructure', sealingSlot, `${base}.sealing.isSealingStructure`),
    );
  } else {
    gaps.push(
      gapOf(
        'sealing.isSealingStructure',
        'sealing behaviour not tested; §4.6 rooms stay conceptual without it',
        false,
      ),
    );
  }

  const geometryComplete =
    placeable.value === true &&
    gridSlot.value !== null &&
    allowed !== null &&
    allowed.length > 0 &&
    footprint !== null &&
    footprint.length > 0 &&
    footprint.every((cell) => cell.solid !== null) &&
    ports !== null &&
    ports.every((port) => port.sourceQuality === 'extracted-unverified');

  return {
    id: observations.prefabId,
    placeable: placeable.value,
    grid: gridSlot.value,
    allowedOrientations: allowed,
    refusedOrientations: refused,
    footprint,
    footprintOriginNote: originSlot.value,
    ports,
    internalVolumeM3: volumeSlot.value,
    sealing: {
      isSealingStructure: sealingSlot.value,
      behaviour: sealingBehaviour.value,
    },
    geometryComplete,
    sourceQuality: provenance.length > 0 ? 'extracted-unverified' : 'missing',
    provenance,
    gaps,
    notes: observations.notes ?? null,
  };
}

/** One construction element's measurement record. */
function buildElement(observations: ElementObservation): GeometryElementRecord {
  const base = `elements[${observations.definitionId}]`;
  const provenance: GeometryFieldProvenance[] = [];
  const gaps: GeometryGap[] = [];

  const kind = observations.kind ?? null;
  if (kind === null) {
    gaps.push(
      gapOf(
        'kind',
        'element kind not classified: a construction element needs a kind before it can be routed (spec 4.3)',
        true,
      ),
    );
  } else {
    provenance.push({
      field: 'kind',
      sourceQuality: 'extracted-unverified',
      confidence: 'observed',
      method: null,
      sourcePath: `${base}.kind`,
    });
  }

  const volumeSlot = readSlot(observations.volumeM3);
  if (volumeSlot.value !== null) {
    provenance.push(provenanceOf('volume', volumeSlot, `${base}.volumeM3`));
  }

  const readingsSlot = readSlot(observations.measurement?.readings);
  const readings = (readingsSlot.value ?? []).map((reading) => ({
    quantity: reading.quantity,
    valueText: reading.valueText,
    unitText: reading.unitText ?? null,
  }));
  if (readingsSlot.value !== null) {
    provenance.push(
      provenanceOf('measurement.readings', readingsSlot, `${base}.measurement.readings`),
    );
  }

  const methodSlot = readSlot(observations.measurement?.method);
  if (methodSlot.value !== null) {
    provenance.push(provenanceOf('measurement.method', methodSlot, `${base}.measurement.method`));
  }
  const loopSlot = readSlot(observations.measurement?.loop);
  if (loopSlot.value !== null) {
    provenance.push(provenanceOf('measurement.loop', loopSlot, `${base}.measurement.loop`));
  }
  const chargeSlot = readSlot(observations.measurement?.charge);
  if (chargeSlot.value !== null) {
    provenance.push(provenanceOf('measurement.charge', chargeSlot, `${base}.measurement.charge`));
  }

  if (volumeSlot.value === null) {
    gaps.push(
      readings.length > 0
        ? gapOf(
            'volume',
            'raw readings recorded but no volume: deriving it from the readings belongs to the engine step, not the protocol (spec 4.7)',
            true,
          )
        : gapOf(
            'volume',
            'element volume not observed: §4.7 network volume cannot be summed for a route that uses it',
            true,
          ),
    );
  }

  return {
    definitionId: observations.definitionId,
    kind,
    volume: volumeSlot.value,
    sourceQuality: provenance.length > 0 ? 'extracted-unverified' : 'missing',
    measurement: {
      method: methodSlot.value,
      loop: loopSlot.value,
      charge: chargeSlot.value,
      readings,
    },
    provenance,
    gaps,
    notes: observations.notes ?? null,
  };
}

/** Grid facts, with the ratio cross-checked against the two cell sizes. */
function buildGrid(observations: GridObservation): {
  grid: GeometryGrid;
  inconsistent: string | null;
} {
  const large = readSlot(observations.largeCellSizeM);
  const small = readSlot(observations.smallCellSizeM);
  const ratio = readSlot(observations.ratio);
  const method = readSlot(observations.measurementMethod);

  const provenance: GeometryFieldProvenance[] = [];
  const gaps: GeometryGap[] = [];
  const fields: [string, ResolvedSlot<number>, string][] = [
    ['largeCellSizeM', large, 'grid.largeCellSizeM'],
    ['smallCellSizeM', small, 'grid.smallCellSizeM'],
    ['ratio', ratio, 'grid.ratio'],
  ];
  for (const [field, slot, at] of fields) {
    if (slot.value === null) {
      gaps.push(
        gapOf(
          field,
          `${field} not measured: grid sizes and the large-to-small ratio are extracted per build, never defaulted (spec 4.2)`,
          true,
        ),
      );
    } else {
      provenance.push(provenanceOf(field, slot, at));
    }
  }
  if (method.value === null) {
    gaps.push(
      gapOf(
        'measurementMethod',
        'measurement procedure not described: the grid numbers cannot be reproduced without it',
        true,
      ),
    );
  } else {
    provenance.push(provenanceOf('measurementMethod', method, 'grid.measurementMethod'));
  }

  let inconsistent: string | null = null;
  if (large.value !== null && small.value !== null && ratio.value !== null) {
    const implied = large.value / small.value;
    const relative = Math.abs(implied - ratio.value) / ratio.value;
    if (relative > 0.02) {
      inconsistent = `largeCellSizeM ${large.value} / smallCellSizeM ${small.value} = ${implied.toFixed(4)} small cells per large cell, but ratio was recorded as ${ratio.value}`;
    }
  }

  return {
    grid: {
      largeCellSizeM: large.value,
      smallCellSizeM: small.value,
      ratio: ratio.value,
      measurementMethod: method.value,
      provenance,
      gaps,
    },
    inconsistent,
  };
}

/** Field tally from already-normalized records. */
function tally<T>(items: T[], classify: (item: T) => keyof FieldCoverage): FieldCoverage {
  const coverage: FieldCoverage = { observed: 0, observedEmpty: 0, incomplete: 0, unknown: 0 };
  for (const item of items) {
    coverage[classify(item)] += 1;
  }
  return coverage;
}

/** Blocker helper: names every definition the blocker applies to. */
function blocker(
  code: string,
  severity: 'error' | 'warning' | 'info',
  message: string,
  definitionIds: string[],
  rule: string,
): GeometryBlocker {
  return { code, severity, message, definitionIds: [...definitionIds].sort(compareStrings), rule };
}

/** Definitions that are device candidates: placeable, or not yet triaged. */
function deviceCandidates(records: GeometryDefinitionRecord[]): GeometryDefinitionRecord[] {
  return records.filter((record) => record.placeable !== false);
}

/**
 * Normalize a validated observation document into geometry records and a
 * coverage report. Deterministic: records are sorted by id.
 */
export function normalizeObservations(
  observations: ObservationDocument,
  options: GeometryImportOptions = {},
): { document: GeometryDocument; coverage: GeometryCoverage } {
  const extractorVersion = options.extractorVersion ?? EXTRACTOR_VERSION;
  const { grid, inconsistent } = buildGrid(observations.grid);

  const definitions = observations.definitions
    .map((definition) => buildDefinition(definition))
    .sort((a, b) => compareStrings(a.id, b.id));
  const elements = observations.elements
    .map((element) => buildElement(element))
    .sort((a, b) => compareStrings(a.definitionId, b.definitionId));

  const candidates = deviceCandidates(definitions);
  const unknownPorts: UnknownPort[] = [];
  for (const definition of candidates) {
    for (const port of definition.ports ?? []) {
      if (port.unknownFields.length > 0) {
        unknownPorts.push({
          definitionId: definition.id,
          portId: port.id,
          missing: [...port.unknownFields].sort(compareStrings),
        });
      }
    }
  }
  unknownPorts.sort(
    (a, b) =>
      compareStrings(a.definitionId, b.definitionId) || compareStrings(a.portId, b.portId),
  );

  const generatedFrom = {
    observationsSha256:
      options.sourceDigest?.sha256 ?? sha256Hex(canonicalJson(observations)),
    observationsBytes:
      options.sourceDigest?.bytes ??
      new TextEncoder().encode(canonicalJson(observations)).length,
    extractorVersion,
  };

  const document: GeometryDocument = {
    kind: GEOMETRY_DOCUMENT_KIND,
    documentVersion: GEOMETRY_DOCUMENT_VERSION,
    generatedFrom,
    session: {
      observer: observations.session?.observer ?? null,
      recordedAt: observations.session?.recordedAt ?? null,
      evidenceDirectory: observations.session?.evidenceDirectory ?? null,
    },
    install: {
      gameBuild: observations.install.gameBuild,
      buildDisplay: observations.install.buildDisplay ?? null,
      branch: observations.install.branch,
      vanilla: readSlot(observations.install.vanilla).value,
      extractorVersion: observations.install.extractorVersion,
    },
    grid,
    definitions,
    elements,
  };

  const blockers = buildBlockers({
    observations,
    definitions,
    candidates,
    elements,
    grid,
    inconsistent,
    unknownPorts,
  });

  const coverage: GeometryCoverage = {
    documentVersion: GEOMETRY_DOCUMENT_VERSION,
    generatedFrom,
    totals: {
      definitions: definitions.length,
      placeable: definitions.filter((record) => record.placeable === true).length,
      nonPlaceable: definitions.filter((record) => record.placeable === false).length,
      unknownPlaceability: definitions.filter((record) => record.placeable === null).length,
      geometryComplete: definitions.filter((record) => record.geometryComplete).length,
      elements: elements.length,
    },
    grid: {
      measured: (['largeCellSizeM', 'smallCellSizeM', 'ratio', 'measurementMethod'] as const).filter(
        (field) => grid.provenance.some((entry) => entry.field === field),
      ),
      unknown: grid.gaps.map((entry) => entry.field),
      inconsistent,
    },
    fields: {
      footprint: tally(candidates, (record) => {
        if (record.footprint === null) return 'unknown';
        if (record.footprint.length === 0) return 'observedEmpty';
        return record.footprint.some((cell) => cell.solid === null) ? 'incomplete' : 'observed';
      }),
      orientations: tally(candidates, (record) => {
        if (record.allowedOrientations === null) return 'unknown';
        return record.allowedOrientations.length === 0 ? 'observedEmpty' : 'observed';
      }),
      ports: tally(candidates, (record) => {
        if (record.ports === null) return 'unknown';
        if (record.ports.length === 0) return 'observedEmpty';
        return record.ports.some((port) => port.sourceQuality === 'missing')
          ? 'incomplete'
          : 'observed';
      }),
      internalVolume: tally(candidates, (record) =>
        record.internalVolumeM3 === null ? 'unknown' : 'observed',
      ),
      sealing: tally(candidates, (record) =>
        record.sealing.isSealingStructure === null ? 'unknown' : 'observed',
      ),
    },
    unknownPorts,
    elements: {
      withVolume: elements.filter((element) => element.volume !== null).length,
      rawReadingsOnly: elements.filter(
        (element) => element.volume === null && element.measurement.readings.length > 0,
      ).length,
      unknown: elements.filter(
        (element) => element.volume === null && element.measurement.readings.length === 0,
      ).length,
      unclassified: elements.filter((element) => element.kind === null).length,
    },
    blockers,
  };

  // Both outputs are parsed again before they leave: a record shape regression
  // fails here instead of in a consumer (spec 10.2, "schema changes fail
  // explicitly").
  GeometryDocumentSchema.parse(document);
  GeometryCoverageSchema.parse(coverage);

  return { document, coverage };
}

interface BlockerInput {
  observations: ObservationDocument;
  definitions: GeometryDefinitionRecord[];
  candidates: GeometryDefinitionRecord[];
  elements: GeometryElementRecord[];
  grid: GeometryGrid;
  inconsistent: string | null;
  unknownPorts: UnknownPort[];
}

/** Every reason buildability (§3.5) is still blocked, as stable diagnostics. */
function buildBlockers(input: BlockerInput): GeometryBlocker[] {
  const { observations, definitions, candidates, elements, grid, inconsistent, unknownPorts } =
    input;
  const blockers: GeometryBlocker[] = [];

  const vanilla = readSlot(observations.install.vanilla).value;
  if (vanilla === null) {
    blockers.push(
      blocker(
        'GEOM-INSTALL-UNCONFIRMED',
        'error',
        'the capture does not confirm a clean vanilla install; extraction from a modded install is out of scope (spec 6.3)',
        [],
        '6.3',
      ),
    );
  } else if (vanilla === false) {
    blockers.push(
      blocker(
        'GEOM-NOT-VANILLA',
        'error',
        'the capture reports a modded install; no observation from it may enter a vanilla pack (spec 6.3)',
        [],
        '6.3',
      ),
    );
  }
  if (observations.install.gameBuild === null) {
    blockers.push(
      blocker(
        'GEOM-BUILD-UNKNOWN',
        'error',
        'the full numeric game build is not recorded, so these observations cannot be pinned to a build (spec 6.4)',
        [],
        '6.4',
      ),
    );
  }

  const gridUnknown = grid.gaps.map((entry) => entry.field);
  if (gridUnknown.length > 0) {
    blockers.push(
      blocker(
        'GEOM-GRID-UNKNOWN',
        'error',
        `grid fields still unknown (${gridUnknown.join(', ')}): placement and metric volume sums need them, and they are never defaulted (spec 4.2)`,
        [],
        '4.2',
      ),
    );
  }
  if (inconsistent !== null) {
    blockers.push(blocker('GEOM-GRID-RATIO-INCONSISTENT', 'warning', inconsistent, [], '4.2'));
  }

  const idsWhere = (predicate: (record: GeometryDefinitionRecord) => boolean): string[] =>
    candidates.filter(predicate).map((record) => record.id);

  const unknownPlaceability = idsWhere((record) => record.placeable === null);
  if (unknownPlaceability.length > 0) {
    blockers.push(
      blocker(
        'GEOM-PLACEABILITY-UNKNOWN',
        'info',
        `${unknownPlaceability.length} prefab(s) were never triaged as placeable or item, so their empty rows cannot be told apart from missing measurements`,
        unknownPlaceability,
        '4.2',
      ),
    );
  }

  const footprintUnknown = idsWhere((record) => record.footprint === null);
  if (footprintUnknown.length > 0) {
    blockers.push(
      blocker(
        'GEOM-FOOTPRINT-UNKNOWN',
        'error',
        `${footprintUnknown.length} device(s) have no observed footprint: buildability validation is blocked and their results stay Conceptual (spec 3.6, 4.2)`,
        footprintUnknown,
        '4.2',
      ),
    );
  }
  const footprintIncomplete = idsWhere(
    (record) => record.footprint !== null && record.footprint.some((cell) => cell.solid === null),
  );
  if (footprintIncomplete.length > 0) {
    blockers.push(
      blocker(
        'GEOM-FOOTPRINT-SOLIDITY-UNKNOWN',
        'error',
        `${footprintIncomplete.length} device(s) have at least one footprint cell whose solidity was not tested; it is reported unknown, never assumed true (spec 4.2, 6.1)`,
        footprintIncomplete,
        '4.2',
      ),
    );
  }

  const orientationsUnknown = idsWhere((record) => record.allowedOrientations === null);
  if (orientationsUnknown.length > 0) {
    blockers.push(
      blocker(
        'GEOM-ORIENTATIONS-UNKNOWN',
        'error',
        `${orientationsUnknown.length} device(s) have no observed orientation set: placed instances must use a member of the definition's set (spec 4.2)`,
        orientationsUnknown,
        '4.2',
      ),
    );
  }
  const orientationsEmpty = idsWhere(
    (record) => record.allowedOrientations !== null && record.allowedOrientations.length === 0,
  );
  if (orientationsEmpty.length > 0) {
    blockers.push(
      blocker(
        'GEOM-ORIENTATIONS-EMPTY',
        'warning',
        `${orientationsEmpty.length} device(s) were observed with an empty orientation set; re-check whether every mounting surface was actually tried`,
        orientationsEmpty,
        '4.2',
      ),
    );
  }

  const portsUnknown = idsWhere((record) => record.ports === null);
  if (portsUnknown.length > 0) {
    blockers.push(
      blocker(
        'GEOM-PORTS-UNKNOWN',
        'error',
        `${portsUnknown.length} device(s) were not surveyed for connectors: connectivity cannot be resolved and every route through them is Conceptual (spec 3.5, 4.3)`,
        portsUnknown,
        '4.3',
      ),
    );
  }
  if (unknownPorts.length > 0) {
    const lacksGeometry = unknownPorts.filter(
      (port) => port.missing.includes('localPosition') || port.missing.includes('direction'),
    );
    if (lacksGeometry.length > 0) {
      const definitionsWithUnknownPortGeometry = [
        ...new Set(lacksGeometry.map((port) => port.definitionId)),
      ];
      blockers.push(
        blocker(
          'GEOM-PORT-INCOMPLETE',
          'error',
          `${lacksGeometry.length} connector(s) still lack position or direction (details in coverage.unknownPorts): connector alignment cannot be validated (spec 4.3, 7.4)`,
          definitionsWithUnknownPortGeometry,
          '4.3',
        ),
      );
    }
    const lacksSemantics = unknownPorts.filter(
      (port) => !port.missing.includes('localPosition') && !port.missing.includes('direction'),
    );
    if (lacksSemantics.length > 0) {
      const definitionsWithUnknownPortSemantics = [
        ...new Set(lacksSemantics.map((port) => port.definitionId)),
      ];
      blockers.push(
        blocker(
          'GEOM-PORT-SEMANTICS-UNKNOWN',
          'info',
          `${lacksSemantics.length} connector(s) have a position and direction but no recorded mediation, categories, or capabilities; network semantics stay unverified (spec 4.3, 4.4)`,
          definitionsWithUnknownPortSemantics,
          '4.4',
        ),
      );
    }
  }

  const elementVolumeUnknown = elements
    .filter((element) => element.volume === null && element.measurement.readings.length === 0)
    .map((element) => element.definitionId);
  if (elementVolumeUnknown.length > 0) {
    blockers.push(
      blocker(
        'GEOM-ELEMENT-VOLUME-UNKNOWN',
        'error',
        `${elementVolumeUnknown.length} construction element(s) have no observed volume: §4.7 network volume cannot be summed along a route that uses them`,
        elementVolumeUnknown,
        '4.7',
      ),
    );
  }
  const elementRawOnly = elements
    .filter((element) => element.volume === null && element.measurement.readings.length > 0)
    .map((element) => element.definitionId);
  if (elementRawOnly.length > 0) {
    blockers.push(
      blocker(
        'GEOM-VOLUME-RAW-ONLY',
        'warning',
        `${elementRawOnly.length} construction element(s) have raw loop readings but no derived volume; the engine derives it later and the protocol never computes it (spec 4.7)`,
        elementRawOnly,
        '4.7',
      ),
    );
  }
  const elementUnclassified = elements
    .filter((element) => element.kind === null)
    .map((element) => element.definitionId);
  if (elementUnclassified.length > 0) {
    blockers.push(
      blocker(
        'GEOM-ELEMENT-KIND-UNKNOWN',
        'error',
        `${elementUnclassified.length} construction element(s) have no observed kind and cannot be routed (spec 4.3)`,
        elementUnclassified,
        '4.3',
      ),
    );
  }

  if (definitions.length === 0) {
    blockers.push(
      blocker(
        'GEOM-NO-DEFINITIONS',
        'info',
        'the document contains no prefab observations yet',
        [],
        '6.1',
      ),
    );
  }

  return blockers;
}

/** One-line summary of an imported document, for the CLI. */
export function summarizeImport(document: GeometryDocument, coverage: GeometryCoverage): string {
  const bytes = new TextEncoder().encode(canonicalJson(document)).length;
  const errorBlockers = coverage.blockers.filter((entry) => entry.severity === 'error').length;
  return [
    `${coverage.totals.definitions} definition(s) (${coverage.totals.placeable} placeable, ${coverage.totals.nonPlaceable} item, ${coverage.totals.unknownPlaceability} untriaged) written as ${bytes} bytes of geometry`,
    `${coverage.totals.geometryComplete} geometry-complete; grid measured: ${coverage.grid.measured.join(', ') || 'none'}`,
    `${coverage.unknownPorts.length} connector(s) still unknown; ${errorBlockers} error blocker(s), ${coverage.blockers.length - errorBlockers} other(s)`,
  ].join('\n');
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
  const { document, coverage } = normalizeObservations(observations, {
    ...options,
    sourceDigest: {
      sha256: sha256Hex(rawText),
      bytes: new TextEncoder().encode(rawText).length,
    },
  });
  return {
    observations,
    document,
    coverage,
    geometryJson: canonicalJson(document) + '\n',
    coverageJson: canonicalJson(coverage) + '\n',
    summary: summarizeImport(document, coverage),
  };
}
