/*
 * Geometry coverage report (EXT-05): what the observations establish, what is
 * still unknown, and what blocks buildability today.
 *
 * The report is computed from the normalized document alone, so it can be
 * regenerated from an artifact without re-reading the worksheet, and it cannot
 * disagree with the records it describes.
 *
 * `blockers[]` are §8 diagnostics with stable `GEOM-*` codes: errors stop a
 * placement or route being buildable, warnings are observations that
 * contradict each other, and info entries are work still to do.
 */
import { canonicalJson } from '../canonical';
import {
  GEOMETRY_DOCUMENT_VERSION,
  GeometryCoverageSchema,
  type FieldCoverage,
  type GeometryBlocker,
  type GeometryCoverage,
  type GeometryDefinitionRecord,
  type GeometryDocument,
  type GeometryGrid,
  type UnknownPort,
} from './records';
import { compareStrings } from './normalize';

/** Derived check: do the recorded sizes and the recorded ratio agree? */
export function gridRatioInconsistency(grid: GeometryGrid): string | null {
  const { largeCellSizeM: large, smallCellSizeM: small, ratio } = grid;
  if (large === null || small === null || ratio === null) return null;
  const implied = large / small;
  const relative = Math.abs(implied - ratio) / ratio;
  if (relative <= 0.02) return null;
  return `largeCellSizeM ${large} / smallCellSizeM ${small} = ${implied.toFixed(4)} small cells per large cell, but ratio was recorded as ${ratio}`;
}

/** Every connector whose geometry or semantics is still partly unknown. */
function collectUnknownPorts(candidates: GeometryDefinitionRecord[]): UnknownPort[] {
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
  return unknownPorts;
}

/**
 * Build the coverage report for a normalized geometry document. Deterministic:
 * every list it emits is sorted, and the report derives only from the records it
 * describes.
 */
export function buildCoverage(document: GeometryDocument): GeometryCoverage {
  const candidates = deviceCandidates(document.definitions);
  const unknownPorts = collectUnknownPorts(candidates);
  const inconsistent = gridRatioInconsistency(document.grid);
  const blockers = buildBlockers({ document, candidates, unknownPorts, inconsistent });
  const { definitions, elements, grid } = document;

  const coverage: GeometryCoverage = {
    documentVersion: GEOMETRY_DOCUMENT_VERSION,
    generatedFrom: document.generatedFrom,
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

  // Parsed again before it leaves: a shape regression fails here, not in a
  // consumer (spec 10.2, "schema changes fail explicitly").
  GeometryCoverageSchema.parse(coverage);

  return coverage;
}

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


interface BlockerInput {
  document: GeometryDocument;
  candidates: GeometryDefinitionRecord[];
  unknownPorts: UnknownPort[];
  inconsistent: string | null;
}

/** Every reason buildability (§3.5) is still blocked, as stable diagnostics. */
function buildBlockers(input: BlockerInput): GeometryBlocker[] {
  const { document, candidates, unknownPorts, inconsistent } = input;
  const { definitions, elements, grid } = document;
  const blockers: GeometryBlocker[] = [];

  const vanilla = document.install.vanilla;
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
  if (document.install.gameBuild === null) {
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
