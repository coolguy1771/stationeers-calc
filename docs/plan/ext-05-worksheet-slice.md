# EXT-05 slice worksheet — what to fill in

A trimmed worksheet for the §17 vertical slice: 5 device kits + 3 pipe kits instead of
all 552 prefab rows. Full procedure: `docs/plan/ext-05-probe.md`. Nothing you record
here is verified; `geometry import` refuses any document claiming it.

**Files**

- `~/Downloads/stationeers-geometry-slice.json` — the file you fill in (≈9 KB, imports cleanly as-is).
- `~/Downloads/stationeers-geometry-worksheet.json` — the full 552-row worksheet, if you want breadth.

**Rules**

1. A slot takes `value` **and** `confidence` together (`observed` | `inferred` | `unknown`), or
   stays `value: null, confidence: "unknown"`. Empty means unknown — never zero, never a default.
2. Write `method` on every `observed` value ("counted cells between walls", "read the game
   pressure at the pipe meter") and `basis` on every `inferred` value.
3. `confidence: "verified"` is rejected — that is a later fixture/review step.
4. One row per device. If two rows name the same prefab the importer refuses the document.

## The eight tasks

| # | Where | What to write | Example |
|---|---|---|---|
| 1 | `install.gameBuild` / `buildDisplay` / `branch` | Full numeric build, verbatim string from the main menu, `"public"` or `"beta"` | `"0.2.6428.27798"` |
| 2 | `install.vanilla` | `{value: true, confidence: "observed", method: "…how you checked…"}` | mods off + fresh world |
| 3 | `grid.*` | `largeCellSizeM`, `smallCellSizeM` (metres), `ratio` (small cells per large cell), `measurementMethod` | `1`, `0.5`, `2` |
| 4 | a placed device's `gridKind` | `large` or `small`, as it actually snapped | `{"value":"large","confidence":"observed","method":"snapped to the large grid"}` |
| 5 | same device: `footprint.cells` | Every occupied cell as local offsets; `solid` per cell | `[{"x":0,"y":0,"z":0,"solid":true}]` |
| 6 | same device: `orientations.allowed` / `.refused` | Accepted and refused surface+yaw pairs | `[{"surface":"floor","yaw":0}]` |
| 7 | same device: `ports` | One entry per connector: `id`, `medium`, `localPosition` slot, `direction` slot, `mediation` | see skeleton below |
| 8 | `elements[]` rows | `kind` (e.g. `pipe-segment`, `pipe-bend`) and either `volumeM3` or raw `measurement.readings` — never a computed volume from readouts | `"pipe-segment"` |

Do task 7 for the **gas filter's gas port and power port only** — that single row is the
go/no-go question (can connector geometry be captured at all?).

## Adding a row for a placed structure

The worksheet seeds recipe prefabs (`ItemKit…`), but the thing you place in the world is a
structure whose prefab name Stationpedia shows. Duplicate any `definitions[]` row, change
`prefabId` to that name (it will look like `StructureSomething`), reset the slots to empty,
and set `placeable.value: true`.

A port entry looks like this (slots nested inside the list value):

```json
{
  "id": "gas-in",
  "medium": "gas-pipe",
  "localPosition": { "value": {"x": 0, "y": 0, "z": -1}, "confidence": "observed", "method": "pipe attached on this cell", "basis": null, "evidence": null },
  "direction":   { "value": {"x": 0, "y": 0, "z": -1}, "confidence": "observed", "method": "connector faces outward", "basis": null, "evidence": null },
  "mediation":   { "value": "device", "confidence": "inferred", "method": null, "basis": "looks like a machine valve", "evidence": null },
  "categories":  { "value": [], "confidence": "unknown", "method": null, "basis": null, "evidence": null },
  "capabilities":{ "value": [], "confidence": "unknown", "method": null, "basis": null, "evidence": null }
}
```

## Import and read the result

```sh
cd ~/src/stationeers-calc
bun tools/extractor/src/cli.ts geometry import ~/Downloads/stationeers-geometry-slice.json --out /tmp/geom
```

It writes `geometry.json` (DeviceDefinition-shaped records at `extracted-unverified`) and
`geometry-coverage.json` (per-field tallies + `GEOM-*` blockers naming affected prefabs).
Incomplete input is fine — it imports with `gaps[]`; only unusable input is refused.

## The decision the probe forces

DOM-01/UI-03 unblock when **all** hold: grid measured; three representative devices have
footprints with tested solidity and non-empty orientation sets; the slice device's gas and
electrical ports have position **and** direction; pipe elements have a volume or raw loop
readings.

If connector positions cannot be captured, that is the §12 re-plan — schematic-authoritative
connectivity, physical placement Conceptual, UI-04 outside MVP — decided at M0 rather than
papered over with symmetry-inferred ports.
