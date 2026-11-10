/*
 * EXT-05 geometry observation document (spec 6.1 Adapter C).
 *
 * Adapter C owns footprints, connector positions, orientation sets, grid
 * sizes, per-element volumes, and sealing rules. None of that is in the game's
 * XML recipe data, and this repository has no game access, so Adapter C starts
 * as a *capture instrument*: a human plays the pinned build, measures, and
 * fills this document in. `geometry init` writes it, `geometry import`
 * normalizes it into entity-contract-shaped geometry records.
 *
 * Rules baked into this file:
 *
 * - Every observation is an OBSERVATION, never validated data. The
 *   `confidence` vocabulary is `observed | inferred | unknown`; `verified` is
 *   deliberately absent, and `geometry import` refuses a document that claims
 *   it. Promotion to §6.5 `extracted-and-validated` is a later fixture/review
 *   step (`pack --validated`), not something a worksheet can assert.
 * - `null` means *not observed*; `[]` means *observed, and there are none*. A
 *   slot that carries a value must declare `observed` or `inferred`, and a
 *   slot that declares either must carry a value — there is no third state and
 *   no default (spec 4.7, 6.1: geometry is never invented). An unmeasured
 *   footprint is unknown, never 1×1.
 * - Every field is nil-able so a partly filled worksheet is still a valid
 *   document; absent fields become gaps in the coverage report instead of
 *   parse errors hiding the measurements that were made. The worksheet writes
 *   the whole structure, so a hand-edited row only ever needs its empty
 *   containers left as they are.
 * - Strings are bounded (spec 9.4): the document is untrusted input once it
 *   comes back from disk.
 */
import { z } from 'zod';
import {
  ConnectionMediumSchema,
  ConstructionKindSchema,
  GridKindSchema,
  LocalVectorSchema,
  MAX_COORDINATE,
  MAX_ID_LENGTH,
  MAX_PORTS_PER_DEVICE,
  OrientationSchema,
} from '@stationeers/domain';

/** Kind tag of the observation document written by `geometry init`. */
export const OBSERVATION_DOCUMENT_KIND = 'stationeers-geometry-observations';

/** Version of the observation document; bump on a breaking change. */
export const OBSERVATION_DOCUMENT_VERSION = 1;

// Bounds for untrusted input (spec 9.4). Generous safety nets, not game facts:
// a 2 000-row worksheet is a few megabytes, so the cap only stops bombs.
export const MAX_OBSERVATIONS_FILE_BYTES = 32 * 1024 * 1024;
export const MAX_OBSERVED_DEFINITIONS = 5_000;
export const MAX_OBSERVED_ELEMENTS = 5_000;
export const MAX_OBSERVED_TEXT = 2_000;
export const MAX_OBSERVED_CELLS = 256;
export const MAX_OBSERVED_PORTS = MAX_PORTS_PER_DEVICE;
export const MAX_OBSERVED_ORIENTATIONS = 32;
export const MAX_OBSERVED_READINGS = 64;
export const MAX_OBSERVED_CATEGORIES = 32;

/**
 * How sure the observer is about one measured value.
 *
 * `unknown` is the only state a value-less slot may declare; `verified` does
 * not exist here on purpose (spec 6.5: promotion is a separate, audited step).
 */
export const OBSERVATION_CONFIDENCES = ['observed', 'inferred', 'unknown'] as const;
export const ObservationConfidenceSchema = z.enum(OBSERVATION_CONFIDENCES);
export type ObservationConfidence = z.infer<typeof ObservationConfidenceSchema>;

/** A bounded free-text field. */
const text = () => z.string().max(MAX_OBSERVED_TEXT);

/** Full numeric game build, e.g. `0.2.6428.27798` — never a marketing version. */
const FullBuildSchema = z
  .string()
  .regex(
    /^\d+(?:\.\d+){2,4}$/,
    'gameBuild must be the full numeric build (e.g. "0.2.6428.27798"); copy it verbatim from the game, do not shorten it',
  );

/** Metadata every observation slot shares, regardless of its value type. */
const slotContext = {
  /** `unknown` when absent; a value requires `observed` or `inferred`. */
  confidence: ObservationConfidenceSchema.optional(),
  /** How the value was measured (protocol step reference is helpful). */
  method: text().nullable().optional(),
  /** Why the value is believed (protocol step id, cross-check, reasoning). */
  basis: text().nullable().optional(),
  /** Screenshot file name or note recorded in the evidence directory. */
  evidence: text().nullable().optional(),
  /** Protocol question shown next to the slot in the worksheet. */
  question: text().optional(),
};

/** Type of a value slot as the importer sees it (all fields may be absent). */
export interface Slot<T> {
  value?: T | null;
  confidence?: ObservationConfidence;
  method?: string | null;
  basis?: string | null;
  evidence?: string | null;
  question?: string;
}

/**
 * One observation slot: a value plus how it was obtained and how sure the
 * observer is. The refinement enforces the only two legal states: a value with
 * `observed`/`inferred`, or no value with `unknown`. The slot itself is
 * optional, so a row may omit slots it never got to and `readSlot` reads them
 * as unknown.
 */
function slot<T extends z.ZodType>(value: T) {
  return z
    .object({ value: value.nullable().optional(), ...slotContext })
    .strict()
    .superRefine((observed, ctx) => {
      const hasValue = observed.value !== undefined && observed.value !== null;
      const confidence = observed.confidence ?? 'unknown';
      if (hasValue && confidence === 'unknown') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['confidence'],
          message:
            'a recorded value must declare confidence "observed" or "inferred"; "unknown" means the value was not observed (spec 6.1: geometry is never invented)',
        });
      }
      if (!hasValue && confidence !== 'unknown') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['confidence'],
          message:
            'confidence "observed"/"inferred" requires a recorded value; leave both empty when the value is unknown',
        });
      }
    })
    .optional();
}

/** Resolved form of a slot: absent slots read as unknown, never as a default. */
export interface ResolvedSlot<T> {
  /** `null` when the observer did not record a value. */
  value: T | null;
  confidence: ObservationConfidence;
  method: string | null;
  basis: string | null;
  evidence: string | null;
  /** False when the slot itself is absent from the document. */
  declared: boolean;
}

/**
 * Read a slot without inventing anything: a missing or empty slot is
 * `{ value: null, confidence: 'unknown' }`.
 */
export function readSlot<T>(observed: Slot<T> | undefined): ResolvedSlot<T> {
  if (observed === undefined) {
    return {
      value: null,
      confidence: 'unknown',
      method: null,
      basis: null,
      evidence: null,
      declared: false,
    };
  }
  return {
    value: observed.value ?? null,
    confidence: observed.confidence ?? 'unknown',
    method: observed.method ?? null,
    basis: observed.basis ?? null,
    evidence: observed.evidence ?? null,
    declared: true,
  };
}

/** Empty slot used by the worksheet generator. */
export function emptySlot<T>(question: string): Slot<T> {
  return {
    value: null,
    confidence: 'unknown',
    method: null,
    basis: null,
    evidence: null,
    question,
  };
}

/** Protocol step ids the worksheet embeds so a reviewer can follow along. */
export const ObservationProtocolSchema = z
  .object({
    /** Repository path of the human procedure. */
    document: z.string().min(1).max(MAX_OBSERVED_TEXT),
    version: z.number().int().positive(),
    steps: z
      .array(z.object({ id: z.string().min(1), title: z.string().min(1) }).strict())
      .max(64),
  })
  .strict();
export type ObservationProtocol = z.infer<typeof ObservationProtocolSchema>;

/** Who captured the document, when, and where the evidence lives. */
export const ObservationSessionSchema = z
  .object({
    observer: text().nullable().optional(),
    /** ISO-8601 timestamp of the capture session; recorded, not enforced. */
    recordedAt: text().nullable().optional(),
    /** Directory (relative to the document) holding screenshots and notes. */
    evidenceDirectory: text().nullable().optional(),
  })
  .strict();
export type ObservationSession = z.infer<typeof ObservationSessionSchema>;

/** Install facts: which build these observations describe (spec 6.4). */
export const InstallFactsSchema = z
  .object({
    /** Full numeric build; the pinned build these observations apply to. */
    gameBuild: FullBuildSchema.nullable(),
    /** Version string exactly as the game displays it (verbatim). */
    buildDisplay: text().nullable().optional(),
    branch: z.enum(['stable', 'beta']).nullable(),
    /** Clean vanilla confirmation; `method` says how it was verified. */
    vanilla: slot(z.boolean()),
    /** Extractor release that wrote the worksheet. */
    extractorVersion: z.string().min(1).max(64),
    notes: text().nullable().optional(),
  })
  .strict();
export type InstallFacts = z.infer<typeof InstallFactsSchema>;

/** Grid measurements (spec 4.2: sizes and the ratio are extracted per build). */
export const GridObservationSchema = z
  .object({
    /** Measured large-grid cell edge in metres. */
    largeCellSizeM: slot(z.number().positive()),
    /** Measured small-grid cell edge in metres. */
    smallCellSizeM: slot(z.number().positive()),
    /** Small cells per large cell (2 means one large cell spans two small). */
    ratio: slot(z.number().positive()),
    /** The procedure that produced the three numbers above. */
    measurementMethod: slot(z.string().min(1)),
    /** Raw readouts (coordinate strings, counts) and screenshot references. */
    evidence: text().nullable().optional(),
    notes: text().nullable().optional(),
  })
  .strict();
export type GridObservation = z.infer<typeof GridObservationSchema>;

/** One occupied footprint cell, as observed. */
export const FootprintCellObservationSchema = z
  .object({
    /** Local cell offset from the device origin, on the device's grid. */
    x: z.number().int().min(-MAX_COORDINATE).max(MAX_COORDINATE),
    y: z.number().int().min(-MAX_COORDINATE).max(MAX_COORDINATE),
    z: z.number().int().min(-MAX_COORDINATE).max(MAX_COORDINATE),
    /**
     * True when the cell blocks incompatible equipment. `null` = not tested;
     * it stays a gap instead of being assumed true (spec 4.2, 6.1).
     */
    solid: z.boolean().nullable().optional(),
  })
  .strict();
export type FootprintCellObservation = z.infer<typeof FootprintCellObservationSchema>;

/** One connector as observed in game (spec 4.3). */
export const PortObservationSchema = z
  .object({
    /** Stable port label, e.g. "gas-in"; becomes PortDefinition.id. */
    id: z.string().min(1).max(MAX_ID_LENGTH),
    /** Medium identified by what actually connects to it. */
    medium: ConnectionMediumSchema,
    /** Local position on the device footprint, on the device's own grid. */
    localPosition: slot(LocalVectorSchema),
    /** Outward direction of the connector. */
    direction: slot(LocalVectorSchema),
    /** Passive vs device-mediated; usually a guess ('inferred'). */
    mediation: slot(z.enum(['passive', 'device'])),
    /** Compatible construction categories, when the game shows them. */
    categories: slot(z.array(z.string().min(1).max(MAX_ID_LENGTH)).max(MAX_OBSERVED_CATEGORIES)),
    /** Port-specific capabilities (heat-exchange, power-input, …). */
    capabilities: slot(z.array(z.string().min(1).max(MAX_ID_LENGTH)).max(MAX_OBSERVED_CATEGORIES)),
    notes: text().nullable().optional(),
  })
  .strict();
export type PortObservation = z.infer<typeof PortObservationSchema>;

/** Sealing observations (spec 4.6: rooms derive from sealing structures). */
export const SealingObservationSchema = z
  .object({
    /** Does this prefab seal a room? `null` = not tested. */
    isSealingStructure: slot(z.boolean()),
    /** Free-text description of the behaviour that was observed. */
    behaviour: slot(z.string().min(1)),
  })
  .strict();
export type SealingObservation = z.infer<typeof SealingObservationSchema>;

/** One prefab's geometry observations. */
export const DefinitionObservationSchema = z
  .object({
    /** Game-native prefab id; display names are never keys (spec 6.3). */
    prefabId: z.string().min(1).max(MAX_ID_LENGTH),
    /**
     * Triage: is this a placeable device at all? `false` records an inspected
     * item (ingot, ore, consumable) so it stops blocking the coverage report.
     */
    placeable: slot(z.boolean()).optional(),
    /** Which grid the prefab snaps to. */
    gridKind: slot(GridKindSchema).optional(),
    footprint: z
      .object({
        /** Occupied cells, counted in game. `[]` = observed none. */
        cells: slot(z.array(FootprintCellObservationSchema).max(MAX_OBSERVED_CELLS)),
        /** Which cell was treated as the origin, and why. */
        originNote: slot(z.string().min(1)),
      })
      .strict()
      .optional(),
    orientations: z
      .object({
        /** Orientation members the game accepted when tried. */
        allowed: slot(z.array(OrientationSchema).max(MAX_OBSERVED_ORIENTATIONS)),
        /** Orientation members the game refused (evidence, not contract). */
        refused: slot(z.array(OrientationSchema).max(MAX_OBSERVED_ORIENTATIONS)),
      })
      .strict()
      .optional(),
    /** Connectors found on the prefab. `[]` = observed, none exist. */
    ports: slot(z.array(PortObservationSchema).max(MAX_OBSERVED_PORTS)).optional(),
    /** Internal volume in m³, only when the build displays or implies one. */
    internalVolumeM3: slot(z.number().positive()).optional(),
    sealing: SealingObservationSchema.optional(),
    notes: text().nullable().optional(),
  })
  .strict();
export type DefinitionObservation = z.infer<typeof DefinitionObservationSchema>;

/** One verbatim reading from the game's own readout. */
export const GameReadingSchema = z
  .object({
    /** What was read, as named by the observer ("pressure run 1"). */
    quantity: z.string().min(1).max(MAX_ID_LENGTH),
    /** The number exactly as displayed; never normalized or converted. */
    valueText: z.string().min(1).max(MAX_ID_LENGTH),
    /** The unit exactly as displayed (e.g. the build's pressure unit). */
    unitText: text().nullable().optional(),
  })
  .strict();
export type GameReading = z.infer<typeof GameReadingSchema>;

/** One construction element's volume measurement. */
export const ElementObservationSchema = z
  .object({
    /** Game-native prefab id of the element (pipe segment, bend, cable, …). */
    definitionId: z.string().min(1).max(MAX_ID_LENGTH),
    /** Construction kind; `null` = not classified yet. */
    kind: ConstructionKindSchema.nullable().optional(),
    /** Volume in m³, only when the build displays it directly. */
    volumeM3: slot(z.number().positive()).optional(),
    measurement: z
      .object({
        /** The procedure used (protocol P7). */
        method: slot(z.string().min(1)),
        /** How the closed loop was built (elements, counts, connections). */
        loop: slot(z.string().min(1)),
        /** What was put in, verbatim as displayed. */
        charge: slot(z.string().min(1)),
        /** Raw readouts; a volume is derived later, never in the protocol. */
        readings: slot(z.array(GameReadingSchema).max(MAX_OBSERVED_READINGS)),
      })
      .strict()
      .optional(),
    notes: text().nullable().optional(),
  })
  .strict();
export type ElementObservation = z.infer<typeof ElementObservationSchema>;

/** Worksheet metadata; ignored by the importer, kept for review. */
export const WorksheetMetadataSchema = z
  .object({
    seededFrom: z.enum(['ir', 'pack']),
    /** IR version read from the extraction directory (IR input only). */
    irVersion: z.number().int().positive().optional(),
    /** Distinct prefab ids that got a definition row. */
    prefabIds: z.number().int().min(0),
    /** Element candidates seeded from prefab-id patterns (prompts, not data). */
    elementCandidates: z.number().int().min(0),
    generatedBy: z.string().min(1).max(MAX_OBSERVED_TEXT),
    notes: z.array(text()).max(16),
  })
  .strict();
export type WorksheetMetadata = z.infer<typeof WorksheetMetadataSchema>;

/**
 * The observation document a human fills in between in-game measurements.
 *
 * `definitions` and `elements` may be empty, and every slot may be left empty:
 * an incomplete document imports with gaps rather than failing.
 */
export const ObservationDocumentSchema = z
  .object({
    kind: z.literal(OBSERVATION_DOCUMENT_KIND),
    documentVersion: z.literal(OBSERVATION_DOCUMENT_VERSION),
    session: ObservationSessionSchema.optional(),
    install: InstallFactsSchema,
    grid: GridObservationSchema,
    definitions: z.array(DefinitionObservationSchema).max(MAX_OBSERVED_DEFINITIONS),
    elements: z.array(ElementObservationSchema).max(MAX_OBSERVED_ELEMENTS),
    protocol: ObservationProtocolSchema.optional(),
    worksheet: WorksheetMetadataSchema.optional(),
  })
  .strict();
export type ObservationDocument = z.infer<typeof ObservationDocumentSchema>;
