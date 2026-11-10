# EXT-05 probe — geometry capture procedure

Status: **instrument ready, measurements owed.** This document is the human
procedure for Adapter C (spec §6.1: footprints, connector positions, orientation
sets, grid sizes, per-element volumes, sealing rules) against one pinned build.
No game access exists in this repository, so nothing here is measured yet, and
nothing in this file or in the harness output is verified data.

- Generate the worksheet: `bun tools/extractor/src/cli.ts geometry init <irDir> --out worksheet.json`
  (or pass a pack file instead of the IR directory).
- Fill it in while playing, following P0–P9 below.
- Normalize it: `bun tools/extractor/src/cli.ts geometry import worksheet.json --out geometry/`
  → `geometry.json` (entity-contract field names) and `geometry-coverage.json`
  (what is known, which connectors are unknown, what still blocks buildability).

The worksheet is the authoritative record. This document explains how to fill
each slot; the short question is also printed inside every slot (`question`).

## Ground rules (read once, they govern every step)

1. **Record, do not infer.** Geometry is never invented (spec §6.1). A slot you
did not measure stays empty (`value: null`, `confidence: "unknown"`). Do not fill
from memory, from a wiki, from symmetry, or from the shape of a similar device.
`geometry import` reports an empty slot as a gap; that is the intended outcome
of not knowing.
2. **Observation ≠ verification.** The only confidence values are `observed`
(value measured, you saw it) and `inferred` (a defensible guess, e.g. whether a
flange is passive). Never write `verified` or `extracted-and-validated`: the
importer refuses the whole document. Promotion is a later fixture/review step
(spec §6.5).
3. **A value and its confidence travel together.** The importer rejects a value
without a confidence and a confidence without a value. Empty is not zero.
4. **Pin the build.** Observations from two builds are not comparable (spec
§6.4). One worksheet per build, per session; start a new one after an update.
5. **Clean vanilla only** (spec §6.3, R18). A modded install contaminates
geometry the same way it contaminates recipes.
6. **Do not compute.** Raw readings go in the document; deriving a grid size or
a volume is the engine's job later, where it can be reviewed.

## What is already known, and what is only a prior

`blueprints.xml` carries per-prefab `<Edge>` line geometry in metres (research
digest, 2025-11-09). That is build-shape data, not connector data, and Adapter A
reports it as an unmapped family; it is **not** used here and may only serve as a
later cross-check against measured extents.

Community figures (large grid “about 1 m”, small grid “about 0.5 m”, ratio “2:1”)
are **unverified priors**. They are deliberately absent from the harness and
must not be copied into a worksheet. Measure them (P2); if you cannot, they stay
unknown.

## P0 — Prerequisites

1. Launch Stationeers on the intended branch (Steam → game → properties →
   betas). Record `install.branch`.
2. Remove or disable every workshop item; verify the subscription list is empty
   and that no leftover mod content loads. Do **not** rely on “I think it is
   clean” — record what you checked in `install.vanilla.method`
   (e.g. “subscriptions list empty, integrity check run, fresh world”).
3. Start a **new world after** the cleanup. Observations from a world created
   before the cleanup are not usable.
4. Copy the version string **verbatim** into `install.buildDisplay`, and the full
   numeric build into `install.gameBuild` (four dot-separated numbers). If you
   cannot find the full number, leave `gameBuild` empty and write where you
   looked in `install.notes`; do not invent or shorten it. `geometry import`
   then keeps `GEOM-BUILD-UNKNOWN` in front of you, which is correct.
5. Record the extractor version already filled in by `geometry init`.

## P1 — Session and evidence

- One worksheet per session. Fill `session.observer`, `session.recordedAt`
  (ISO-8601), and `session.evidenceDirectory`.
- Suggested evidence layout, next to the worksheet:

  ```
  worksheet-<build>-<yyyy-mm-dd>.json
  evidence/
    P2-grid-coord-1.png
    P4-<prefabId>-footprint.png
    P6-<prefabId>-gas-in.png
    notes-<yyyy-mm-dd>.md
  ```

- Name files `P<step>-<prefabId>-<n>` and reference them from the slot’s
  `evidence` field. A screenshot is not a substitute for the value: still write
  the value into the slot.
- Fill the worksheet **during** the session. Reconstructing numbers afterwards is
  how invented data enters a pack.

## P2 — Grid sizes and the large→small ratio

Measure, in this order, and stop at the first method the build actually supports:

**M1 — world coordinate readout.** If your build shows a position/coordinate
readout (player or object), record the raw strings at two positions one large
cell apart, then one small cell apart, into `grid.largeCellSizeM.basis` /
`grid.smallCellSizeM.basis` / `grid.evidence`. Convert only if the readout’s unit
is stated in the build; if the unit is not stated, leave the numeric slot empty
and keep the raw text — the unit is what we are trying to establish.

**M2 — subdivision count.** Place small-grid elements (pipes/cables) across one
large-grid frame cell and count how many small steps fit. That count is
`grid.ratio` (small cells per large cell). Record the count and where it was
observed; do not derive the ratio from assumed sizes.

**M3 — cross-checks.** If you obtain two independent numbers, fill all three
slots (`largeCellSizeM`, `smallCellSizeM`, `ratio`). The importer computes
`largeCellSizeM / smallCellSizeM` and reports `GEOM-GRID-RATIO-INCONSISTENT` when
it disagrees with the recorded ratio by more than 2%. That is a signal to
re-measure, not to edit a number to match.

- Put the sentence that lets someone else repeat the procedure in
  `grid.measurementMethod`; without it the grid counts as unknown.
- **If no method works**, leave the numbers empty and describe what you tried.
  Grid size unknown means metric placement and metric volume sums are blocked
  (`GEOM-GRID-UNKNOWN`), not that a default may be used (spec §4.2).

## P3 — Triage every prefab

The worksheet has one row per prefab id that appears as a recipe output — most
are items (ingots, ores, consumables), not devices. For each row set
`placeable`:

- `true` if the game offers a placement preview and it occupies cells in the
  world;
- `false` if it is an item/consumable (it will then stop appearing in the
  buildability blockers);
- leave empty if you did not look.

Triage is the cheapest step and it sharply reduces the work: do the devices the
vertical slice needs first (spec §17: an atmospherics device with a gas port and
a power port, a pipe segment, a bend, a junction), then everything else as time
allows.

## P4 — Footprint cells

1. Place the device on a clear floor.
2. Find its cell extents empirically: try to place walls/frames/other devices in
   the cells around it until placement is refused. A refused placement is the
   evidence that the cell is occupied (or solid); record what you tried in
   `footprint.cells.method`.
3. Record **every occupied cell** as a local offset from the origin. Multi-cell
   devices are not necessarily rectangular: list the cells that are actually
   filled, never the bounding box (a 2×2 bounding box for an L-shaped device is
   invented geometry).
4. Origin convention: state in `footprint.originNote` which cell you treated as
   `(0,0,0)` and how you knew (e.g. “the cell the placement preview highlighted
   first”). Without a stated convention the offsets cannot be read by anyone
   else — including DOM-01.
5. Solidity per cell: try to place an incompatible device into the same cell. If
   refused, `solid: true`; if the build allows a coexist layer, record that
   instead. **If you did not test it, leave `solid` out** — the importer reports
   `GEOM-FOOTPRINT-SOLIDITY-UNKNOWN` and never assumes `true`.
6. Empty footprint list (`[]`) means “observed, the device occupies no cell”,
   which is only correct for something that is not placeable. If you mean “not
   measured”, leave the slot empty instead.

## P5 — Allowed orientations

For each device, try every mounting surface the build offers — floor, wall,
ceiling, freestanding — and, for each surface that accepts the device, try all
four 90° yaws.

- Record **only** the accepted `{surface, yaw}` combinations in
  `orientations.allowed`, one entry each. Duplicates are collapsed.
- Record refusals in `orientations.refused`: they are evidence, they keep the
  next observer from re-testing, and they are not part of the definition.
- Do not generalise from one yaw: a device may accept `floor/0` and `floor/1` but
  refuse `floor/2`. If you only tried yaw 0, list only yaw 0.
- An empty allowed set is reported as `GEOM-ORIENTATIONS-EMPTY` because a device
  that accepts no mounting surface cannot be placed; re-check before leaving it
  empty.

## P6 — Connector positions and directions

For each connector of each device:

1. Attach the matching element (gas pipe, liquid pipe, cable, chute, data) to the
   port. Attaching is how the medium is identified — record `medium` accordingly.
2. Record `localPosition`: the local offset of the connector, as the cell the
   attached element occupies relative to the same origin you used in P4. If the
   element occupies an adjacent cell outside the footprint, that is the offset.
3. Record `direction`: the outward direction the connector faces, as a unit
   vector on the device grid (`{-1,0,0}`, `{0,1,0}`, …). Use one axis per port;
   if it looks diagonal, stop and re-measure rather than recording a guess.
4. Record `mediation`: `passive` for a plain join, `device` when the port joins
   through machine logic (pump, valve, machine inlet). This is normally a guess:
   set `confidence: "inferred"` and say why in `basis`.
5. `categories` / `capabilities`: only if the build states them for that port.
   Leave empty for unknown — an empty **array** means “observed, none”, so only
   use `value: []` when you actually saw none.
6. Multi-port devices: one entry per port, each with its own id label
   (`gas-in`, `gas-out`, `power-in`, …). **Do not copy a port to the opposite
   face because the device looks symmetric** — a missing port is a gap, a
   duplicated port is fabricated geometry. Duplicate port ids are collapsed and
   reported.

If a connector exists but you cannot reach or probe it, record the port with its
`medium` and leave `localPosition`/`direction` empty: the coverage report then
lists that exact port under `unknownPorts` and raises `GEOM-PORT-INCOMPLETE`,
which is what DOM-01 needs to know.

## P7 — Volumes (elements and devices)

### Device internal volume

Fill `definitions[].internalVolumeM3` only when the build displays or directly
implies the device’s internal volume. Otherwise leave it empty and record why in
`notes`. Device internal volume is what §4.7 needs to sum a network’s volume, so
an unmeasured value keeps network-volume results Unverified/Conceptual rather
than silently small.

### Element volume from a closed loop (preferred)

This is the measurement the slice needs (§4.7, §17). The protocol records **raw
readings only**; the derivation happens later, in code, where it can be reviewed.

1. Build a closed loop of the element under test — e.g. straight segments plus
   the bend/junction under test — with no other volume in the loop if possible.
2. Record the loop composition exactly in `measurement.loop`: which element ids,
   how many of each, and how it is closed (valve, tank, device).
3. Charge the loop from a canister/source and copy the amount **verbatim** into
   `measurement.charge` (species and amount as the game shows it, including the
   unit text).
4. Read the network gauge(s). Copy each reading verbatim into
   `measurement.readings` — `quantity` is your label (`pressure run 1`),
   `valueText` the number exactly as displayed, `unitText` the unit exactly as
   displayed. **Note the game’s pressure unit here**; do not convert it.
5. Repeat with a different charge (two or three runs) and record every run as
   its own reading. Two runs let the derivation separate loop volume from gauge
   offset; one run cannot.
6. If the loop contains a device with an unknown internal volume, record that in
   `measurement.loop` — otherwise its volume will be attributed to the pipes.
7. Only fill `volumeM3` when the build itself displays an element volume. If you
   measured a loop, leave `volumeM3` empty: the importer reports
   `GEOM-VOLUME-RAW-ONLY`, and the engine derives the volume from your readings.

Measure, at minimum, the pipe element set used by the vertical slice: straight
segment, bend, junction (and the equivalent cable, when electrical routing
matters). Junction and bend volumes are the ones that quietly inflate or shrink
network volume if they are missing.

## P8 — Sealing rules

Rooms are derived from sealing structures using the game’s rules (§4.6). Until
these are observed, room-based results stay Conceptual.

1. Build a small closed test room in a controlled way: four walls, floor and
   ceiling, one opening you can close. Record the composition in the probe notes
   (structure ids and counts).
2. Pressurise it (known charge) and observe whether pressure holds, bleeds, or
   collapses. Record which structures were in the barrier.
3. For each candidate structure (wall, floor, frame, door, window, vent), add it
   to the barrier and repeat: record `sealing.isSealingStructure` and describe
   what happened in `sealing.behaviour` (“held 3 minutes”, “leaked to ambient
   immediately”, …).
4. If the build shows a room/volume readout for an enclosed space, copy it
   verbatim into your notes and reference it from `evidence`.
5. Do not generalise sealing to device prefabs unless you tested a barrier that
   contains one.

## P9 — Repetition, evidence, and completion

- Repeat any measurement you are unsure of in a second session with a fresh
  world; if the two disagree, record both in the worksheet (rows are per prefab,
  so use `notes` to describe the disagreement) rather than averaging.
- Keep screenshots in `session.evidenceDirectory` and name them `P<step>-…`.
- Re-run `geometry import` after each work session. The coverage report is the
  to-do list: `blockers[].code` names exactly what is still missing, with the
  affected prefab ids.
- Blockers at a glance:

  | Code | Meaning |
  |---|---|
  | `GEOM-INSTALL-UNCONFIRMED` / `GEOM-NOT-VANILLA` | Install facts missing or modded (§6.3) |
  | `GEOM-BUILD-UNKNOWN` | Full numeric build not recorded (§6.4) |
  | `GEOM-GRID-UNKNOWN` | Grid size/ratio/method missing (§4.2) |
  | `GEOM-GRID-RATIO-INCONSISTENT` | Sizes and ratio disagree — re-measure |
  | `GEOM-PLACEABILITY-UNKNOWN` | Rows never triaged (P3) |
  | `GEOM-FOOTPRINT-UNKNOWN` | No footprint (§4.2, §3.6) |
  | `GEOM-FOOTPRINT-SOLIDITY-UNKNOWN` | A cell’s solidity was not tested |
  | `GEOM-ORIENTATIONS-UNKNOWN` / `GEOM-ORIENTATIONS-EMPTY` | Orientation set missing or empty (§4.2) |
  | `GEOM-PORTS-UNKNOWN` | Connectors not surveyed (§4.3) |
  | `GEOM-PORT-INCOMPLETE` | A port lacks position or direction (§4.3, §7.4) |
  | `GEOM-PORT-SEMANTICS-UNKNOWN` | Port located but mediation/categories missing |
  | `GEOM-ELEMENT-VOLUME-UNKNOWN` | No element volume and no raw readings (§4.7) |
  | `GEOM-VOLUME-RAW-ONLY` | Raw readings only; derivation pending (expected) |
  | `GEOM-ELEMENT-KIND-UNKNOWN` | Element never classified |
  | `GEOM-NO-DEFINITIONS` | The document has no rows yet |

## Go/no-go decision rule

M0 exits on “EXT-05 go/no-go on geometry and pipe volume” (spec §16.2). Decide
with the coverage report, not with impressions.

**Unblocks DOM-01 / UI-03 (go) when the document reports all of:**

1. `GEOM-GRID-UNKNOWN` absent — both grid sizes and the ratio measured with a
   stated method;
2. footprints with tested solidity for at least three representative devices:
   one single-cell large device, one multi-cell device, one wall- or
   ceiling-mounted device;
3. a non-empty orientation set for each of those three;
4. `GEOM-PORT-INCOMPLETE` absent for the ports of the vertical-slice device — at
   minimum one gas-pipe port and one electrical port with `localPosition` and
   `direction`;
5. `GEOM-ELEMENT-VOLUME-UNKNOWN` absent for the slice’s pipe elements (a
   straight segment, a bend, a junction) — either a displayed volume or a closed
   loop with raw readings for the engine derivation;
6. `GEOM-INSTALL-UNCONFIRMED`, `GEOM-NOT-VANILLA`, `GEOM-BUILD-UNKNOWN` absent.

**DOM-01** can then consume `geometry.json` directly: `grid`, `footprint[].local`
+ `solid`, `allowedOrientations`, and per-port `medium`/`localPosition`/
direction/`mediation`. Every value must be treated as `extracted-unverified`
(spec §6.5): typed placement, occupancy and alignment can be built against it,
but results computed from it stay Unverified/Conceptual until a fixture/review
promotes them.

**UI-03** can render dual-grid placement, footprints, occupancy, and the
orientation picker from the same records, and must show unknown geometry as
unknown (dashed/Conceptual, §3.5) rather than drawing a plausible box.

**No-go / re-plan (spec §12).** If connector geometry cannot be observed at all
(every port stays `GEOM-PORT-INCOMPLETE`, or ports cannot be enumerated), the MVP
promise “device placements with verified connector geometry” (§12) cannot be met.
That is a scope decision, not a data gap to paper over:

- stop before M2 and re-plan the MVP boundary: the schematic stays authoritative
  for connectivity, physical placement is offered as Conceptual only, and
  connector snapping/validation (UI-04) moves out of MVP scope;
- record the decision and its evidence in this file and in
  `docs/plan/BACKLOG.md`;
- do not substitute symmetry-inferred ports or default cell offsets to make the
  editor look complete.

**Partial go** is normal: footprints observable but some connectors not. DOM-01
and UI-03 proceed on footprints/orientations; connectivity resolution stays
Conceptual for the affected devices, and the coverage report keeps naming them
until observed.

## What the harness cannot decide without the game

- Any metre value: grid size, footprint metric size, loop volume.
- Whether a device accepts a given mount surface or yaw.
- Where a connector sits and which way it faces.
- Whether a device is a boundary or pass-through for shared-volume networks
  (§4.4: a verified property, not inferred).
- Whether sealing rules generalise beyond the barrier you tested (§4.6).
- Whether the port list is exhaustive: a missed connector looks exactly like a
device with fewer ports. Only a second observation pass or a runtime extraction
step (Adapter B/C code access) can settle that.
- Whether `blueprints.xml` edge geometry agrees with the measured cell extents —
that comparison needs a build-shape parser that does not exist yet.

## If you only have one hour

1. **P0** — clean vanilla, build written down verbatim (5 min).
2. **P2** — grid sizes and ratio, with the raw readout in `basis` (15 min).
3. **P3+P6** — triage, then the vertical-slice device’s gas port and power port
   positions/directions (20 min). This is the single highest-value row: it
decides go/no-go for connector geometry.
4. **P4+P5** — that device’s footprint cells and its orientation set (15 min).
5. **P7** — one closed loop over a straight + bend, two charges, readings copied
   verbatim (10 min).
6. Import, keep the coverage report next to the worksheet, and schedule the next
   session from its blockers.
