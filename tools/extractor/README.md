# @stationeers/extractor

Game-data extraction tooling (spec 6): adapters A–D, normalization, and
versioned IR generation.

## Usage

```sh
bun tools/extractor/src/cli.ts <adapter> [args]

# Adapter A (EXT-01/EXT-01b): game XML recipes -> normalized IR
bun tools/extractor/src/cli.ts xml <inputDir> --out <outDir>

# Adapter C (EXT-05): geometry capture harness
bun tools/extractor/src/cli.ts geometry init <irDir|pack.json> --out <worksheet.json>
bun tools/extractor/src/cli.ts geometry import <observations.json> --out <dir>

# Packing (EXT-03): extraction outputs -> validated, versioned pack
bun tools/extractor/src/cli.ts pack <irDir> --out <pack.json> \
  --build 0.2.6428.27798 --branch stable [--channel published|user-generated] \
  [--date 2025-11-10T00:00:00Z] [--validated <promotions.json>]

# Planned (EXT-02 / SIM-01)
stationpedia    # Adapter B
behavior        # Adapter D
```

`<inputDir>` is the `Data` directory of a **clean vanilla install**:
`<SteamLibrary>/steamapps/common/Stationeers/rocketstation_Data/StreamingAssets/Data`.
The `xml` adapter writes `ir.json`, `coverage.json`, and `manifest.json` into
`outDir` — byte-identical across runs on the same input.

## What Adapter A reads (confirmed format)

The parser targets the real `<GameData>` format, verified against an install on
2025-11-09 (`docs/plan/research-2025-11-09-extraction.md`):

```xml
<GameData xmlns:xsi="…" xmlns:xsd="…">
  <AutolatheRecipes>                      <!-- wrapper = recipe family -->
    <RecipeData>
      <PrefabName>ItemSteelIngot</PrefabName>   <!-- output prefab id -->
      <Recipe>
        <Steel>.5</Steel>                       <!-- ingredient: name -> amount -->
        <Time>5</Time>                          <!-- control, not an ingredient -->
        <Temperature><Start>900</Start><Stop>1500</Stop></Temperature>
      </Recipe>
      <Output>0.25</Output>                     <!-- optional output amount -->
      <RecipeTier>TierTwo</RecipeTier>          <!-- optional printer tier -->
    </RecipeData>
  </AutolatheRecipes>
</GameData>
```

Parsing rules (`src/adapters/xml/gamedata.ts`):

1. The `GameData` root is required; the family wrapper is **discovered**, never
   hardcoded — its name varies per file (`AutolatheRecipes`,
   `HydraulicPipeBenderRecipes`, `PackagingMachineRecipes`, …) and one file may
   declare several wrappers. The wrapper name becomes the recipe's `family`.
2. Every `<RecipeData>` under any wrapper is parsed; its `<PrefabName>` becomes
   the output prefab id.
3. Ingredients are the open set: a `<Recipe>` child that is not a known control
   and whose text is a decimal number. Controls are a closed set
   (`CONTROL_ELEMENTS`): `Time`, `Energy`, `Temperature`, `Pressure` map to typed
   fields; `RequiredMix` is recognized but unmapped. A `<Recipe>` child that is
   neither — unknown name or no decimal amount — is reported as
   `XML-CONTROL-UNKNOWN` and never read as an ingredient.
4. Numbers keep their **exact source text** (`.5`) next to the parsed value, and
   `.5`/`0.50` compare equal when deciding whether two recipes are the same.
   XML comments and `<?xml?>` declarations are ignored.

## IR overview

The normalizer produces a versioned intermediate representation
(`IR_VERSION = 2`) built from raw records the adapters emit:

- `Recipe` — `id`, `displayName`, `family`, `output { prefabId, quantity? }`,
  `inputs [{ materialName, quantity }]`, optional `time`, `energy`,
  `temperature`, `pressure` (`{ start?, stop? }`), `tier`, provenance.
- `Item` — `id`, `displayName`, optional `category`, provenance. Adapter A emits
  none: the XML carries no item definitions, only prefab ids it references.
- `WorldRef` — `id`, `kind`, `values`, provenance. Defined, no adapter yet.

Every quantity is a `SourceNumber { text, value, unitStatus }`. Unit semantics
(mass vs count vs mol) are **not** established, so everything Adapter A extracts
is `unitStatus: 'unverified'`; a consumer must not do unit arithmetic on it.

**Recipe identity** is `"<family>/<prefabId>"` — the output prefab alone is not
unique, since several machine families produce the same item. When one family
declares several distinct recipes for the same output (real data does: an ingot
from ore, or from already-smelted metal), the alternates are numbered in source
order (`…#2`, `…#3`) with an `IR-RECIPE-ALTERNATE` note and an `…alternate
definitions…` provenance note. Identical definitions collapse (`IR-DUP-EXACT`);
for item and world-ref records, the same id with different content is
`conflicting` quality with the first occurrence kept and every source listed in
the notes (spec 6.3).

Every record carries `provenance { sourceFile, sourcePath, qualityLevel,
notes? }` (spec 6.5: `extracted-and-validated` | `extracted-unverified` |
`missing` | `conflicting` | `inferred`). `sourcePath` is a structural path such
as `/GameData/AutolatheRecipes/RecipeData[12]`. Per-field provenance lives in
`fieldProvenance`, keyed by field (`time`, `temperature.start`,
`inputs[0].quantity`, `output.quantity`, `tier`, `displayName`) and pointing at
the exact element that supplied each value:

```json
"fieldProvenance": {
  "time": { "qualityLevel": "extracted-unverified", "sourcePath": "…/RecipeData[1]/Recipe/Time" },
  "output.quantity": { "qualityLevel": "missing", "notes": "absent in source" }
}
```

Missing required fields are recorded as `missing` field provenance plus a
structured entry in `coverage.json` — never silently dropped or defaulted. An
absent `<Output>` leaves `output.quantity` absent (the amount is unknown, not
1), and `displayName` is `missing` for every recipe because the XML has no
display names (Adapter B, Stationpedia, is their source).

## Coverage report

`coverage.json` states what was extracted **and what was not**:

- `counts.byType` / `byQualityLevel` / `byFieldQualityLevel` / `byFamily`
- `families` — every `GameData` child in the input, with `status:
  mapped | unmapped`, the files declaring it, its observed child elements, and
  the recipe count. Non-recipe families (`Blueprint`, `ThingMods`,
  `TraderContactData`, `CelestialBodies`, …) are listed here and reported with
  `XML-FAMILY-UNMAPPED`; nothing is fabricated for them. `blueprints.xml`
  (`<Blueprint>`/`<Mesh>`/`<Edge>` geometry) is flagged as known-but-unmapped
  with a pointer to EXT-05.
- `controls` — every non-ingredient `<Recipe>` child, with how it was handled
  (`scalar` | `envelope` | `unmapped` | `unknown`) and its occurrence count.
- `missingFields`, `diagnostics` (stable codes), `skippedFiles`.

## Packing the outputs (EXT-03)

The `pack` subcommand reads `ir.json`, `coverage.json`, and `manifest.json` from
an extraction directory and writes one versioned pack (§6.4) through
`@stationeers/packs`, then validates the written file with the runtime loader.

- **Install facts come from the command line.** `--build` takes the full numeric
  build (not a marketing version) and `--branch` the game branch; neither is in
  `Data/` (research digest, 2025-11-09). `--channel` defaults to
  `user-generated`; a `published` pack is refused on a `beta` branch.
- **Nothing is validated by default.** Every property is `extracted-unverified`
  or `missing` unless `--validated <promotions.json>` names it explicitly, with
  an approver, a timestamp, an evidence reference, and (for quantities) the unit
the approval establishes. See `packages/packs/README.md`.
- **Byte-reproducible.** The same IR plus the same metadata writes the same
  bytes and the same `contentHash`. Pin `--date` to make the artifact
  reproducible; it defaults to the current time.
- **Reported, not invented.** Missing values stay absent with a `missing`
  property entry, joins the XML cannot supply
  (`material-to-prefab`, `family-to-machine-prefab`, `display-name`) are recorded
  as `missing` in `coverage.joins`, and IR entity types with no pack
  representation are counted in `coverage.unpacked`.

`version.ts` holds the `EXTRACTOR_VERSION` and `NORMALIZATION_VERSION` recorded in
every pack manifest; bump the latter whenever `normalize.ts` changes the IR it
produces.

## Adapter C — geometry capture harness (EXT-05)

Geometry is not in the game XML, and this repository has no game access, so
Adapter C ships as an *instrument*: `geometry init` writes a worksheet, a human
fills it in while playing, and `geometry import` validates and normalizes what
they recorded. The human procedure is `docs/plan/ext-05-probe.md`. Nothing the
harness writes is verified data, and no pack property is promoted by it.

### The observation document

`geometry init` writes `stationeers-geometry-observations` v1:

- `install` — full numeric build, verbatim display string, branch, and a
  clean-vanilla confirmation, each with `method`/`basis`/`evidence`.
- `grid` — `largeCellSizeM`, `smallCellSizeM`, `ratio` (small cells per large
  cell), and the measurement procedure.
- `definitions[]` — one row per recipe prefab id: `placeable` triage, `gridKind`,
  `footprint.cells` with per-cell `solid`, `orientations.allowed`/`.refused`,
  `ports[]` (`medium`, `localPosition`, `direction`, `mediation`, `categories`,
  `capabilities`), `internalVolumeM3`, `sealing`, `notes`.
- `elements[]` — pipe/cable rows with `volumeM3` when the build displays one,
  plus `measurement.loop`/`.charge`/`.readings` for a closed-loop run.
- `protocol` / `worksheet` — the questions inline with their slots, and how the
  rows were seeded.

Every measurement is a slot: `{ value, confidence, method, basis, evidence,
question }`. Three rules make the document honest:

1. `confidence` is `observed | inferred | unknown`. `verified` does not exist
   here; `geometry import` refuses a document claiming it (or
   `extracted-and-validated`) before schema validation (spec 6.5).
2. A recorded value requires `observed`/`inferred`, and either requires a value.
   A value with `unknown`, or confidence without a value, fails validation with
   the path named.
3. `value: null` means *not observed*; `value: []` means *observed, none exist*.
   An untested footprint is unknown, never 1×1, and untested solidity is `null`,
   never `true` (spec 4.2, 6.1).

Definitions are seeded from recipe outputs (sorted, de-duplicated). Element rows
are seeded from prefab ids matching pipe/cable name patterns — a prompt to go
and classify the element, not extracted geometry, and the worksheet says so per
row. `geometry init` also accepts a pack file and seeds from `payload.recipes`.

### Imported output

`geometry import` writes two canonical-JSON files (both byte-reproducible):

- `geometry.json` — `stationeers-geometry` v1: install facts, session, grid, and
  `definitions[]`/`elements[]` in `DeviceDefinition`, `PortDefinition`,
  `FootprintCell`, and `ConstructionElement` field names. Unknown values stay
  `null`; every record carries `gaps[]` (what could not be emitted and whether it
  blocks buildability) and per-field `provenance[]` with `sourceQuality:
  'extracted-unverified'`. `geometryComplete` is true only when every geometry
  field the contract requires was observed.
- `geometry-coverage.json` — totals, per-field tallies (observed /
  observed-empty / incomplete / unknown), `unknownPorts` naming the missing
  fields, element-volume tallies, and `blockers[]` as stable `GEOM-*`
  diagnostics (spec 8) that name the affected prefab ids. It is the next
  session's to-do list and the evidence for the M0 go/no-go.

Records are sorted (definitions by id, ports by id, orientations by surface then
yaw), so consecutive probes diff cleanly and repeated imports are identical. The
`generatedFrom` digest is the raw worksheet's SHA-256, so a formatting-only edit
stays visible.

An incomplete document imports with gaps; only unusable input is refused:
oversized, non-JSON, wrong kind, future version, verification claims, schema
violations, and duplicate prefab/element rows.

## Limitations

1. **Unit semantics are unresolved.** Quantities, `<Time>`, `<Energy>`, and the
   `<Temperature>`/`<Pressure>` bounds are carried verbatim as
   `extracted-unverified` with their source text. Nothing is converted, and no
   Verified calculation may consume these values yet (spec 6.5).
2. **Non-recipe families are unmapped.** Adapter A extracts recipes only. The
   remaining `Data` XML (geometry in `blueprints.xml`, minables, plants,
   celestial bodies, weather, traders, start conditions, terraforming, …) is
   reported through `families` but produces no entities. Known gaps the
   coverage report names explicitly:
   - `blueprints.xml` build-shape geometry → still unmapped. Adapter C does not
     consume it; its edges are metres of build shape, not connector data, and
     may only serve as a later cross-check. Footprints and connectors come from
     the EXT-05 capture harness (`docs/plan/ext-05-probe.md`).
   - `ReagentGrinderRecipes`, whose records are `<ProcessingData>
     (InputPrefab`/`OutputPrefab`/`Time`/`In`/`Out`), not `<RecipeData>` →
     reported as an unmapped family (warning), no invented mapping.
   - `RecycleRecipes` (`recycling.xml`) holds only commented-out records in the
     reference install → reported as an unmapped family with no children.
3. **Material names are not prefab ids.** Ingredient element names (`Steel`,
   `Fenoxitone`) are recorded as `materialName`; how a material name maps to a
   prefab id is not stated by the XML and is still unverified.
4. **The source must be a clean vanilla install.** Extraction from a modded
   install is out of scope (spec 6.3, R18). The 2025-11-09 calibration copy was
   modded and was used as a FORMAT reference only; no value from it is committed
   and all fixtures are synthetic (real structure, invented values). M0 exit
   needs a mod-free install.
5. **Adapter C is a capture harness, not an extractor.** It has no game access:
   grid sizes, footprints, orientations, connector geometry, element volumes,
   and sealing rules arrive only when a human measures them. Observations are
   `extracted-unverified` by construction, element rows are seeded by name
   pattern, raw loop readings are not converted into volumes, and a missed
   connector is indistinguishable from a device with fewer ports. Only Adapter
   B/D work (or a second observation pass) can settle those gaps.
6. Other adapters are planned: Stationpedia names/descriptions (EXT-02) and
   behavior fixtures (SIM-01). Blueprint build shapes (metre edges) remain the
   one thing Adapter C could later read without a human, but they carry no
   connectors.
7. Untrusted-input bounds (spec 9.4): 5 000 files, 10 MiB per file for Adapter
   A; 32 MiB and bounded counts for the observations document.

