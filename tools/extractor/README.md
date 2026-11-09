# @stationeers/extractor

Game-data extraction tooling (spec 6): adapters A–D, normalization, and
versioned IR generation.

## Usage

```sh
bun tools/extractor/src/cli.ts <adapter> [args]

# Adapter A (EXT-01/EXT-01b): game XML recipes -> normalized IR
bun tools/extractor/src/cli.ts xml <inputDir> --out <outDir>

# Planned (EXT-02 / EXT-05 / SIM-01)
stationpedia    # Adapter B
geometry        # Adapter C
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
   - `blueprints.xml` build-shape geometry → EXT-05 (Adapter C).
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
5. Other adapters are planned: Stationpedia names/descriptions (EXT-02),
   geometry (EXT-05), behavior fixtures (SIM-01).
6. Untrusted-input bounds (spec 9.4): 5 000 files, 10 MiB per file.

