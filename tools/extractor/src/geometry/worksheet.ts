/*
 * `geometry init` (EXT-05): write the worksheet a human fills in while playing.
 *
 * The worksheet is an observation document (`observations.ts`) pre-filled with
 * one row per prefab id that appears as a recipe output in the extraction IR (or
 * in a pack's payload), one row per pipe/cable element *candidate*, and the
 * protocol question next to every empty slot. It is deterministic: prefab ids
 * are sorted and key order is fixed, so two runs on the same input are
 * byte-identical.
 *
 * Element candidates are seeded from prefab-id name patterns. That is a prompt
 * to go and classify the element in game — never extracted geometry — and the
 * worksheet says so. The IR carries no kind information at all (Adapter A emits
 * recipes only), so an empty candidate list is a normal outcome.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadPackJson } from '@stationeers/packs';
import { IrDataSchema } from '../ir';
import { EXTRACTOR_VERSION } from '../version';
import {
  emptySlot,
  OBSERVATION_DOCUMENT_KIND,
  OBSERVATION_DOCUMENT_VERSION,
  type ElementObservation,
  type ObservationDocument,
} from './observations';
import {
  PROTOCOL_DOCUMENT,
  PROTOCOL_STEPS,
  PROTOCOL_VERSION,
  QUESTIONS,
} from './protocol';

/** Patterns that make a prefab id an element candidate to classify in game. */
export const ELEMENT_SEED_PATTERNS = [
  { name: 'pipe', pattern: /pipe/i },
  { name: 'cable', pattern: /cable|wire/i },
] as const;

/** What the worksheet is seeded with: ids only, never measurements. */
export interface WorksheetSeed {
  prefabIds: string[];
  elementCandidates: { definitionId: string; pattern: string }[];
  source: 'ir' | 'pack';
  /** IR version the ids came from (IR input only). */
  irVersion?: number;
}

/** Compare two strings without locale dependence (deterministic ordering). */
function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Patch note the worksheet carries so the human knows how to fill it. */
export const WORKSHEET_NOTES = [
  'Every slot is empty (value null) until measured. Fill value and confidence together, or leave both empty: empty means unknown, never zero or a default (spec 4.7).',
  'Nothing you record here is verified. `verified` and `extracted-and-validated` are refused by `geometry import`; promotion is a separate fixture/review step (spec 6.5).',
  'Fill install facts and the grid first: the coverage report treats them as blocking because nothing can be pinned to a build without them.',
  'Element rows are seeded from prefab-id name patterns as a prompt to go and classify them. That is not extracted geometry; add any element the seeding missed by hand.',
  'Measure in the order P0 to P9 of docs/plan/ext-05-probe.md, and save a copy of this file per session instead of editing one across builds.',
];

/** Seed element candidates from prefab ids: pipe/cable names only. */
function seedElementCandidates(prefabIds: string[]): WorksheetSeed['elementCandidates'] {
  const candidates: WorksheetSeed['elementCandidates'] = [];
  for (const definitionId of prefabIds) {
    for (const { name, pattern } of ELEMENT_SEED_PATTERNS) {
      if (pattern.test(definitionId)) {
        candidates.push({ definitionId, pattern: name });
        break;
      }
    }
  }
  return candidates;
}

/** Seed from a plain list of prefab ids (used by both inputs and by tests). */
export function seedFromPrefabIds(
  prefabIds: string[],
  source: 'ir' | 'pack' = 'ir',
  irVersion?: number,
): WorksheetSeed {
  return {
    prefabIds,
    elementCandidates: seedElementCandidates(prefabIds),
    source,
    ...(irVersion === undefined ? {} : { irVersion }),
  };
}

/** One prefab row: every slot empty, every slot carries its question. */
function definitionRow(prefabId: string): ObservationDocument['definitions'][number] {
  return {
    prefabId,
    placeable: emptySlot(QUESTIONS.placeable),
    gridKind: emptySlot(QUESTIONS.gridKind),
    footprint: {
      cells: emptySlot(QUESTIONS.footprintCells),
      originNote: emptySlot(QUESTIONS.footprintOrigin),
    },
    orientations: {
      allowed: emptySlot(QUESTIONS.orientationsAllowed),
      refused: emptySlot(QUESTIONS.orientationsRefused),
    },
    ports: emptySlot(QUESTIONS.ports),
    internalVolumeM3: emptySlot(QUESTIONS.deviceVolume),
    sealing: {
      isSealingStructure: emptySlot(QUESTIONS.sealing),
      behaviour: emptySlot(QUESTIONS.sealingBehaviour),
    },
    notes: null,
  };
}

/** One element row: kind unclassified, volume and readings empty. */
function elementRow(
  definitionId: string,
  pattern: string,
): ObservationDocument['elements'][number] {
  const row: ElementObservation = {
    definitionId,
    kind: null,
    volumeM3: emptySlot(QUESTIONS.elementVolume),
    measurement: {
      method: emptySlot(QUESTIONS.elementMethod),
      loop: emptySlot(QUESTIONS.elementLoop),
      charge: emptySlot(QUESTIONS.elementCharge),
      readings: emptySlot(QUESTIONS.elementReadings),
    },
    notes: `Seeded because the prefab id matches the "${pattern}" name pattern. A prompt, not extracted geometry: classify the element before recording a volume.`,
  };
  return row;
}

/** Build the worksheet document from its seed (pure; no I/O). */
export function buildWorksheet(seed: WorksheetSeed): ObservationDocument {
  const prefabIds = [...new Set(seed.prefabIds)].sort(compareStrings);
  const candidates = [...seed.elementCandidates].sort((a, b) =>
    compareStrings(a.definitionId, b.definitionId),
  );

  return {
    kind: OBSERVATION_DOCUMENT_KIND,
    documentVersion: OBSERVATION_DOCUMENT_VERSION,
    session: { observer: null, recordedAt: null, evidenceDirectory: null },
    install: {
      gameBuild: null,
      buildDisplay: null,
      branch: null,
      vanilla: emptySlot(QUESTIONS.vanilla),
      extractorVersion: EXTRACTOR_VERSION,
      notes: null,
    },
    grid: {
      largeCellSizeM: emptySlot(QUESTIONS.gridLargeCell),
      smallCellSizeM: emptySlot(QUESTIONS.gridSmallCell),
      ratio: emptySlot(QUESTIONS.gridRatio),
      measurementMethod: emptySlot(QUESTIONS.gridMethod),
      evidence: null,
      notes: null,
    },
    definitions: prefabIds.map(definitionRow),
    elements: candidates.map((candidate) => elementRow(candidate.definitionId, candidate.pattern)),
    protocol: {
      document: PROTOCOL_DOCUMENT,
      version: PROTOCOL_VERSION,
      steps: PROTOCOL_STEPS.map((step) => ({ id: step.id, title: step.title })),
    },
    worksheet: {
      seededFrom: seed.source,
      ...(seed.irVersion === undefined ? {} : { irVersion: seed.irVersion }),
      prefabIds: prefabIds.length,
      elementCandidates: candidates.length,
      generatedBy: 'stationeers-extract geometry init',
      notes: [...WORKSHEET_NOTES],
    },
  };
}

/** Serialize a worksheet for a human editor: stable key order, 2-space indent. */
export function worksheetJson(worksheet: ObservationDocument): string {
  return `${JSON.stringify(worksheet, null, 2)}\n`;
}

/** Format zod issues as `path: message` lines (bounded). */
function formatIssues(error: { issues: { path: PropertyKey[]; message: string }[] }): string[] {
  return error.issues.slice(0, 20).map((issue) => {
    const where = issue.path.map(String).join('.') || '(root)';
    return `${where}: ${issue.message}`;
  });
}

/**
 * Seed from an extraction directory (the output of `xml <Data> --out <dir>`):
 * every prefab id that appears as a recipe output.
 */
export function seedFromIrDirectory(irDir: string): WorksheetSeed {
  const irPath = join(irDir, 'ir.json');
  let text: string;
  try {
    text = readFileSync(irPath, 'utf8');
  } catch (error) {
    throw new Error(
      `geometry init expects an extraction directory containing ir.json; ${irPath} could not be read (${error instanceof Error ? error.message : String(error)}). Run \`xml <Data> --out <dir>\` first, or pass a pack file.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `${irPath} is not valid JSON (${error instanceof Error ? error.message : String(error)}); re-run the xml adapter`,
    );
  }
  const result = IrDataSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`ir.json fails IR schema validation:\n${formatIssues(result.error).join('\n')}`);
  }
  const prefabIds = result.data.recipes.map((recipe) => recipe.output.prefabId);
  return seedFromPrefabIds(prefabIds, 'ir', result.data.irVersion);
}

/** Seed from a pack file (validated as untrusted input by the runtime loader). */
export async function seedFromPackFile(packPath: string): Promise<WorksheetSeed> {
  const pack = await loadPackJson(readFileSync(packPath, 'utf8'));
  const prefabIds = pack.payload.recipes.map((recipe) => recipe.output.prefabId);
  return seedFromPrefabIds(prefabIds, 'pack');
}
