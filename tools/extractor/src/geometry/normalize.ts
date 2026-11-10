/*
 * Geometry normalization (EXT-05): observation document -> entity-contract
 * geometry records.
 *
 * Everything here is a pure function of the observations: no I/O, no clock, no
 * environment. Records are sorted so row order in the worksheet never moves the
 * output, and every unobserved value stays `null` with a `gaps[]` entry instead
 * of a default (spec 4.2, 6.1).
 *
 * Coverage and diagnostics live in `coverage.ts`, which reads the finished
 * document rather than the raw observations — the artifact is the contract.
 */
import { canonicalJson } from '../canonical';
import { sha256Hex } from '../report';
import { EXTRACTOR_VERSION } from '../version';
import {
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
  GeometryDocumentSchema,
  type GeometryDefinitionRecord,
  type GeometryDocument,
  type GeometryElementRecord,
  type GeometryFieldProvenance,
  type GeometryFootprintCell,
  type GeometryGap,
  type GeometryGrid,
  type GeometryPortRecord,
} from './records';

/** Options for normalizing one observation document. */
export interface NormalizeOptions {
  /** Extractor version recorded in the output; defaults to this build's. */
  extractorVersion?: string;
  /**
   * Digest of the exact source artifact. `importObservations` supplies the raw
   * file digest; direct callers fall back to the canonical JSON of the parsed
   * document.
   */
  sourceDigest?: { sha256: string; bytes: number };
}

/** Compare two strings without locale dependence (deterministic ordering). */
export function compareStrings(a: string, b: string): number {
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

/** Grid facts exactly as observed; cross-checks are diagnostics (coverage). */
function buildGrid(observations: GridObservation): GeometryGrid {
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

  return {
    largeCellSizeM: large.value,
    smallCellSizeM: small.value,
    ratio: ratio.value,
    measurementMethod: method.value,
    provenance,
    gaps,
  };
}

/**
 * Normalize a validated observation document into geometry records.
 * Deterministic: definitions, elements, ports, and orientations are sorted.
 */
export function normalizeObservations(
  observations: ObservationDocument,
  options: NormalizeOptions = {},
): GeometryDocument {
  const extractorVersion = options.extractorVersion ?? EXTRACTOR_VERSION;
  const grid = buildGrid(observations.grid);

  const definitions = observations.definitions
    .map((definition) => buildDefinition(definition))
    .sort((a, b) => compareStrings(a.id, b.id));
  const elements = observations.elements
    .map((element) => buildElement(element))
    .sort((a, b) => compareStrings(a.definitionId, b.definitionId));

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

  // The document is parsed again before it leaves: a record shape regression
  // fails here instead of in a consumer (spec 10.2, "schema changes fail
  // explicitly").
  GeometryDocumentSchema.parse(document);

  return document;
}
