/*
 * EXT-05 normalized geometry records (spec 4.1–4.3, 6.5).
 *
 * `geometry import` turns an observation document into these records. Field
 * names match the entity contract (`DeviceDefinition`, `PortDefinition`,
 * `FootprintCell`, `ConstructionElement`) so a later fixture/promotion step can
 * map them into `payload.devices` without a second vocabulary — but every
 * unobserved (or unmeasurable) value stays `null` and is listed in `gaps`.
 * `geometryComplete` is the only place that says the geometry would satisfy the
 * contract; it is false as soon as one required field is unknown.
 *
 * Nothing here is validated data. Every recorded field's provenance carries
 * `sourceQuality: 'extracted-unverified'` (spec 6.5: it is an observation until
 * a fixture or review promotes it), and the record-level `sourceQuality` is
 * `missing` for a definition where nothing at all was observed.
 */
import { z } from 'zod';
import {
  ConnectionMediumSchema,
  ConstructionKindSchema,
  GridCellSchema,
  GridKindSchema,
  LocalVectorSchema,
  MAX_ID_LENGTH,
  OrientationSchema,
} from '@stationeers/domain';
import { MAX_OBSERVED_TEXT } from './observations';

/** Kind tag of the normalized geometry document. */
export const GEOMETRY_DOCUMENT_KIND = 'stationeers-geometry';

/** Version of the normalized geometry document; bump on a breaking change. */
export const GEOMETRY_DOCUMENT_VERSION = 1;

/** Bounds for record text (the observations document is the source, 9.4). */
export const MAX_GEOMETRY_PATH = 512;
export const MAX_GEOMETRY_REASON = 1_000;

const text = () => z.string().max(MAX_OBSERVED_TEXT);
const path = () => z.string().min(1).max(MAX_GEOMETRY_PATH);

/** Lowercase hex SHA-256 digest (mirrors the pack schema). */
export const Sha256HexSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'expected a lowercase hex SHA-256 digest');

/** §6.5 level a single recorded field can carry at this stage. */
export const GeometryFieldQualitySchema = z.literal('extracted-unverified');

/** Record-level level: an unobserved definition is `missing`, not unverified. */
export const GeometryRecordQualitySchema = z.enum(['extracted-unverified', 'missing']);

/** Confidence a recorded field carries through from its observation. */
export const RecordedConfidenceSchema = z.enum(['observed', 'inferred']);

/**
 * Per-field provenance: which observation supplied a contract field, how it was
 * measured, and how sure the observer was.
 */
export const GeometryFieldProvenanceSchema = z
  .object({
    /** Contract field path, e.g. `ports[1].localPosition`. */
    field: path(),
    sourceQuality: GeometryFieldQualitySchema,
    confidence: RecordedConfidenceSchema,
    /** Measurement procedure the observer named, when one was named. */
    method: text().nullable(),
    /** Path inside the observations document that supplied the value. */
    sourcePath: path(),
  })
  .strict();
export type GeometryFieldProvenance = z.infer<typeof GeometryFieldProvenanceSchema>;

/** Something the harness could not emit, and whether it blocks buildability. */
export const GeometryGapSchema = z
  .object({
    /** Contract field path the gap leaves empty. */
    field: path(),
    reason: z.string().min(1).max(MAX_GEOMETRY_REASON),
    blocksBuildability: z.boolean(),
  })
  .strict();
export type GeometryGap = z.infer<typeof GeometryGapSchema>;

/** One footprint cell: contract field names, solidity nullable until tested. */
export const GeometryFootprintCellSchema = z
  .object({
    local: GridCellSchema,
    /** `null` = solidity not tested; never assumed true (spec 4.2, 6.1). */
    solid: z.boolean().nullable(),
  })
  .strict();
export type GeometryFootprintCell = z.infer<typeof GeometryFootprintCellSchema>;

/** A connector in contract field names, with unknown subfields left null. */
export const GeometryPortRecordSchema = z
  .object({
    id: z.string().min(1).max(MAX_ID_LENGTH),
    medium: ConnectionMediumSchema,
    localPosition: LocalVectorSchema.nullable(),
    direction: LocalVectorSchema.nullable(),
    categories: z.array(z.string().min(1).max(MAX_ID_LENGTH)).nullable(),
    mediation: z.enum(['passive', 'device']).nullable(),
    capabilities: z.array(z.string().min(1).max(MAX_ID_LENGTH)).nullable(),
    /** `missing` when any required port field is still unknown. */
    sourceQuality: GeometryRecordQualitySchema,
    unknownFields: z.array(path()),
    provenance: z.array(GeometryFieldProvenanceSchema),
    gaps: z.array(GeometryGapSchema),
  })
  .strict();
export type GeometryPortRecord = z.infer<typeof GeometryPortRecordSchema>;

/** Sealing observations in contract-adjacent form (spec 4.6). */
export const GeometrySealingSchema = z
  .object({
    isSealingStructure: z.boolean().nullable(),
    behaviour: text().nullable(),
  })
  .strict();
export type GeometrySealing = z.infer<typeof GeometrySealingSchema>;

/** One prefab's geometry, in DeviceDefinition field names. */
export const GeometryDefinitionRecordSchema = z
  .object({
    id: z.string().min(1).max(MAX_ID_LENGTH),
    /** Triage result; `null` when the prefab was never inspected. */
    placeable: z.boolean().nullable(),
    grid: GridKindSchema.nullable(),
    allowedOrientations: z.array(OrientationSchema).nullable(),
    /** Tried-and-refused orientations: evidence, not part of the contract. */
    refusedOrientations: z.array(OrientationSchema).nullable(),
    footprint: z.array(GeometryFootprintCellSchema).nullable(),
    /** How the observer fixed the origin cell; needed to read the cell list. */
    footprintOriginNote: text().nullable(),
    ports: z.array(GeometryPortRecordSchema).nullable(),
    internalVolumeM3: z.number().positive().nullable(),
    sealing: GeometrySealingSchema,
    /**
     * True only when every DeviceDefinition geometry field is observed:
     * grid, a non-empty orientation set, a footprint with all solidity flags,
     * and a fully located connector list. Display name, category, and
     * construction requirements come from elsewhere (Adapter B, EXT-01).
     */
    geometryComplete: z.boolean(),
    sourceQuality: GeometryRecordQualitySchema,
    provenance: z.array(GeometryFieldProvenanceSchema),
    gaps: z.array(GeometryGapSchema),
    notes: text().nullable(),
  })
  .strict();
export type GeometryDefinitionRecord = z.infer<typeof GeometryDefinitionRecordSchema>;

/** One verbatim game reading, carried through unchanged. */
export const GeometryReadingSchema = z
  .object({
    quantity: z.string().min(1).max(MAX_ID_LENGTH),
    valueText: z.string().min(1).max(MAX_ID_LENGTH),
    unitText: text().nullable(),
  })
  .strict();
export type GeometryReading = z.infer<typeof GeometryReadingSchema>;

/** One construction element's measurement, in ConstructionElement field names. */
export const GeometryElementRecordSchema = z
  .object({
    definitionId: z.string().min(1).max(MAX_ID_LENGTH),
    kind: ConstructionKindSchema.nullable(),
    /** Contract `ConstructionElement.volume`, when the build displayed it. */
    volume: z.number().positive().nullable(),
    sourceQuality: GeometryRecordQualitySchema,
    measurement: z
      .object({
        method: text().nullable(),
        loop: text().nullable(),
        charge: text().nullable(),
        readings: z.array(GeometryReadingSchema),
      })
      .strict(),
    provenance: z.array(GeometryFieldProvenanceSchema),
    gaps: z.array(GeometryGapSchema),
    notes: text().nullable(),
  })
  .strict();
export type GeometryElementRecord = z.infer<typeof GeometryElementRecordSchema>;

/** Provenance of the normalized document itself. */
export const GeometryGeneratedFromSchema = z
  .object({
    observationsSha256: Sha256HexSchema,
    observationsBytes: z.number().int().min(0),
    extractorVersion: z.string().min(1).max(64),
  })
  .strict();
export type GeometryGeneratedFrom = z.infer<typeof GeometryGeneratedFromSchema>;

/** Install facts carried through (spec 6.4: builds are never conflated). */
export const GeometryInstallSchema = z
  .object({
    gameBuild: z.string().nullable(),
    buildDisplay: text().nullable(),
    branch: z.enum(['stable', 'beta']).nullable(),
    vanilla: z.boolean().nullable(),
    extractorVersion: z.string().min(1).max(64),
  })
  .strict();
export type GeometryInstall = z.infer<typeof GeometryInstallSchema>;

/** Whoever captured the observations (kept for review, not for verification). */
export const GeometrySessionSchema = z
  .object({
    observer: text().nullable(),
    recordedAt: text().nullable(),
    evidenceDirectory: text().nullable(),
  })
  .strict();
export type GeometrySession = z.infer<typeof GeometrySessionSchema>;

/** Grid facts in contract-adjacent form (spec 4.2). */
export const GeometryGridSchema = z
  .object({
    largeCellSizeM: z.number().positive().nullable(),
    smallCellSizeM: z.number().positive().nullable(),
    /** Small cells per large cell. */
    ratio: z.number().positive().nullable(),
    measurementMethod: text().nullable(),
    provenance: z.array(GeometryFieldProvenanceSchema),
    gaps: z.array(GeometryGapSchema),
  })
  .strict();
export type GeometryGrid = z.infer<typeof GeometryGridSchema>;

/** The normalized geometry document. */
export const GeometryDocumentSchema = z
  .object({
    kind: z.literal(GEOMETRY_DOCUMENT_KIND),
    documentVersion: z.literal(GEOMETRY_DOCUMENT_VERSION),
    generatedFrom: GeometryGeneratedFromSchema,
    session: GeometrySessionSchema,
    install: GeometryInstallSchema,
    grid: GeometryGridSchema,
    definitions: z.array(GeometryDefinitionRecordSchema),
    elements: z.array(GeometryElementRecordSchema),
  })
  .strict();
export type GeometryDocument = z.infer<typeof GeometryDocumentSchema>;

/**
 * Per-field coverage tally among the definitions the tally applies to: device
 * candidates (placeable, or never triaged). Inspected items are excluded, so a
 * hundred ingots do not dilute what was actually measured.
 */
export const FieldCoverageSchema = z
  .object({
    /** Field present with a usable value. */
    observed: z.number().int().min(0),
    /** Field surveyed and observed to be empty (e.g. a device with no ports). */
    observedEmpty: z.number().int().min(0),
    /** Something was recorded but a contract value is still missing. */
    incomplete: z.number().int().min(0),
    /** Never inspected. */
    unknown: z.number().int().min(0),
  })
  .strict();
export type FieldCoverage = z.infer<typeof FieldCoverageSchema>;

/** One port whose geometry is still unknown. */
export const UnknownPortSchema = z
  .object({
    definitionId: z.string().min(1).max(MAX_ID_LENGTH),
    portId: z.string().min(1).max(MAX_ID_LENGTH),
    missing: z.array(path()),
  })
  .strict();
export type UnknownPort = z.infer<typeof UnknownPortSchema>;

/**
 * A buildability blocker: a structured diagnostic (spec 8) whose `entityIds`
 * convention is carried in `definitionIds`.
 */
export const GeometryBlockerSchema = z
  .object({
    code: z.string().min(1).max(64),
    severity: z.enum(['error', 'warning', 'info']),
    message: z.string().min(1).max(MAX_GEOMETRY_REASON),
    definitionIds: z.array(z.string().min(1).max(MAX_ID_LENGTH)),
    /** Spec section the blocker derives from. */
    rule: z.string().min(1).max(32),
  })
  .strict();
export type GeometryBlocker = z.infer<typeof GeometryBlockerSchema>;

/** Coverage report: what the observations cover and what still blocks. */
export const GeometryCoverageSchema = z
  .object({
    documentVersion: z.literal(GEOMETRY_DOCUMENT_VERSION),
    generatedFrom: GeometryGeneratedFromSchema,
    totals: z
      .object({
        definitions: z.number().int().min(0),
        placeable: z.number().int().min(0),
        nonPlaceable: z.number().int().min(0),
        unknownPlaceability: z.number().int().min(0),
        geometryComplete: z.number().int().min(0),
        elements: z.number().int().min(0),
      })
      .strict(),
    grid: z
      .object({
        /** Grid fields with an observed value. */
        measured: z.array(z.string()),
        /** Grid fields still unknown. */
        unknown: z.array(z.string()),
        /** Set when ratio and the two sizes contradict each other. */
        inconsistent: z.string().max(MAX_GEOMETRY_REASON).nullable(),
      })
      .strict(),
    fields: z
      .object({
        footprint: FieldCoverageSchema,
        orientations: FieldCoverageSchema,
        ports: FieldCoverageSchema,
        internalVolume: FieldCoverageSchema,
        sealing: FieldCoverageSchema,
      })
      .strict(),
    unknownPorts: z.array(UnknownPortSchema),
    elements: z
      .object({
        withVolume: z.number().int().min(0),
        /** Raw loop readings recorded; the engine derives the volume later. */
        rawReadingsOnly: z.number().int().min(0),
        unknown: z.number().int().min(0),
        unclassified: z.number().int().min(0),
      })
      .strict(),
    blockers: z.array(GeometryBlockerSchema),
  })
  .strict();
export type GeometryCoverage = z.infer<typeof GeometryCoverageSchema>;
