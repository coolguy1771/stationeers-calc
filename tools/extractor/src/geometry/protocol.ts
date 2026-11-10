/*
 * EXT-05 protocol text (spec 6.1 Adapter C): the questions the worksheet puts
 * next to every empty slot, and the ordered procedure they come from.
 *
 * The procedure itself is `docs/plan/ext-05-probe.md`; the constants here are
 * the short form shown in the document so a person at the keyboard never has to
 * cross-reference a markdown file mid-measurement. Step ids match the headings
 * of that document (`P0`–`P9`).
 */

/** Repository path of the human procedure the questions cite. */
export const PROTOCOL_DOCUMENT = 'docs/plan/ext-05-probe.md';

/** Version of the procedure; bump when a step or question changes meaning. */
export const PROTOCOL_VERSION = 1;

/** Ordered steps, embedded in the worksheet so the document is self-describing. */
export const PROTOCOL_STEPS = [
  { id: 'P0', title: 'Prerequisites: clean vanilla install, build recorded verbatim' },
  { id: 'P1', title: 'Session setup: one document per build and observer' },
  { id: 'P2', title: 'Grid sizes and the large-to-small ratio' },
  { id: 'P3', title: 'Triage every prefab: placeable device or item' },
  { id: 'P4', title: 'Footprint cells and which cells are solid' },
  { id: 'P5', title: 'Allowed orientations: surfaces and yaws the game accepts' },
  { id: 'P6', title: 'Connector positions and outward directions' },
  { id: 'P7', title: 'Element volumes from raw pressure/temperature readouts' },
  { id: 'P8', title: 'Sealing rules for rooms' },
  { id: 'P9', title: 'Repetition, evidence, and the go/no-go summary' },
] as const;

/**
 * Worksheet questions, keyed by slot. Wording rules: name the protocol step,
 * ask for one measurement, and say what "unknown" means — never suggest a
 * value. A question that offers an example value is a fabrication risk.
 */
export const QUESTIONS = {
  sessionObserver: 'P1: who is capturing this document (name or handle).',
  sessionRecordedAt: 'P1: ISO-8601 timestamp of this session.',
  sessionEvidence:
    'P9: directory that will hold the screenshots and free-text notes for this session (relative paths are fine).',
  gameBuild:
    'P0: copy the full numeric build (four dot-separated numbers) exactly as the game reports it. Do not shorten it to a marketing version; if you cannot find the full number, leave empty and say where you looked in install.notes.',
  buildDisplay:
    'P0: copy the version string exactly as displayed, verbatim, including any prefix or suffix.',
  vanilla:
    'P0: confirm every workshop mod is removed or disabled AND these readings come from a world created after that. Put how you verified it in method (fresh world, subscription list, file check).',
  gridLargeCell:
    'P2: measure the large-grid cell edge in metres. Use the method ladder in the protocol; record the raw readout you used in basis or evidence, and leave empty if the build gives you nothing to measure against.',
  gridSmallCell:
    'P2: measure the small-grid cell edge in metres the same way.',
  gridRatio:
    'P2: count how many small-grid steps span one large-grid cell (small cells per large cell) by placing small elements across a large frame.',
  gridMethod:
    'P2: describe the procedure that produced the grid numbers in one or two sentences, so a second observer can repeat it.',
  placeable:
    'P3: is this prefab a placeable device (it occupies cells in the world) or an item/consumable? Set false for anything the build does not let you place, and stop measuring that row.',
  gridKind:
    'P4: which grid does the device snap to — large or small? Record the grid it actually placed on, not the one the build menu grouped it under.',
  footprintCells:
    'P4: list every cell the device occupies as local offsets from the origin cell (the cell the device was first placed in). Box it in with walls or pipes and count the cells it truly fills; do not pad the list to a rectangle.',
  footprintOrigin:
    'P4: which cell did you treat as the origin (0,0,0), and how did you know where the device anchors? This convention must be reproducible.',
  orientationsAllowed:
    'P5: try every mounting surface (floor, wall, ceiling, freestanding) and each 90° yaw. Record only the combinations the game accepted — one entry per accepted surface and yaw.',
  orientationsRefused:
    'P5: record the combinations the game refused. Refusals are evidence too: they keep the next observer from re-testing them.',
  ports:
    'P6: for each connector, attach a matching pipe, cable, or chute to it and record the adjacent cell plus the direction the connector faces. Record every port the device has; leave the position empty if you could not determine it.',
  portPosition:
    'P6: local cell offset of the connector on the device grid, as observed by which adjacent cell the attached element occupies.',
  portDirection:
    'P6: which way the connector faces, as a local vector (unit length, on the device grid).',
  portMediation:
    'P6: does the port join networks passively (a plain pipe flange) or through device logic (a pump, valve, or machine inlet)? This is usually a guess: mark it inferred.',
  portCategories:
    'P6: construction categories the port accepts, only if the build states them; otherwise leave empty (unknown, not "none").',
  portCapabilities:
    'P6: port capabilities the build states (heat-exchange, power-input, …), only if observed; otherwise leave empty.',
  deviceVolume:
    'P7: internal volume in m³, only if the build displays or directly implies it for this device. If you only have raw readouts, record those instead of computing a volume.',
  sealing:
    'P8: does this prefab seal a room? Test with a pressure difference across a barrier containing it and record what happened in behaviour.',
  sealingBehaviour:
    'P8: describe what you saw when you put a pressure difference across a barrier that includes this prefab: did the room hold pressure, leak, or not participate?',
  elementKind:
    'P7: classify the element (pipe-segment, pipe-junction, pipe-bend, cable, cable-junction, …). Leave empty if you cannot place it yet.',
  elementVolume:
    'P7: volume in m³, only if the build displays it. If you measured a closed loop, leave this empty and record the raw charge plus pressure/temperature readouts instead.',
  elementMethod:
    'P7: which measurement did you run (see the protocol method ladder for closed loops)?',
  elementLoop:
    'P7: describe the closed loop: which elements, how many of each, and how it was closed. The engine derives the volume from this later.',
  elementCharge:
    'P7: what you put into the loop, verbatim as displayed (species and amount, including the unit text).',
  elementReadings:
    'P7: copy each gauge reading verbatim (value text and unit text) for every repeat run. Do not convert, average, or compute a volume here.',
} as const;

export type QuestionKey = keyof typeof QUESTIONS;
