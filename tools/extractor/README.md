# @stationeers/extractor

Game-data extraction tooling (spec 6): adapters A–D, normalization, and
versioned IR generation.

## Usage

```sh
bun tools/extractor/src/cli.ts <adapter> [args]

# Adapter A (EXT-01): XML config/recipes -> normalized IR
bun tools/extractor/src/cli.ts xml <inputDir> --out <outDir>

# Planned (EXT-02 / EXT-05 / SIM-01)
stationpedia    # Adapter B
geometry        # Adapter C
behavior        # Adapter D
```

The `xml` adapter writes `ir.json`, `coverage.json`, and `manifest.json` into
`outDir` — byte-identical across runs on the same input.

## IR overview

The normalizer produces a versioned intermediate representation (`IR_VERSION
= 1`) built from raw records the adapters emit:

- `Recipe` — `id`, `displayName`, `inputs`/`outputs` (`Ingredient { itemId,
  quantity, unit }`), optional `station`, provenance.
- `Item` — `id`, `displayName`, optional `category`, provenance.
- `WorldRef` — `id`, `kind`, `values`, provenance.

Every record carries `provenance { sourceFile, sourcePath, qualityLevel,
notes? }` (spec 6.5: `extracted-and-validated` | `extracted-unverified` |
`missing` | `conflicting` | `inferred`); per-field provenance overrides
(e.g. `inferred` unit conversions with the calculation named) live in
`fieldProvenance`. Identities are game-native IDs (spec 6.3): exact
duplicate records collapse deterministically, same-id-with-different-content
is recorded as `conflicting` with the first occurrence kept and all sources
listed in the notes. Missing required fields are reported as structured
entries in the coverage report — never silently dropped or defaulted.

## Limitations

1. **Format not yet confirmed against a real install.** The current XML
   grammar (`<recipes>`/`<items>` with `id`/`displayName` attributes) is
   PROVISIONAL — synthetic, not game data. A separate research effort is
   reconciling the real Stationeers vocabulary; the XML→raw parsing module
   (`src/adapters/xml/provisional.ts`) is deliberately small and swappable
   so the confirmed format can replace it without touching the normalizer,
   IR, or reporting layers. The real install path is
   `<SteamLibrary>/steamapps/common/Stationeers/rocketstation_Data/StreamingAssets/Data`.
2. Adapter A handles only configuration and recipes. Stationpedia (EXT-02),
   geometry (EXT-05), and behavior fixtures (SIM-01) are planned adapters.
3. Extracted properties are `extracted-unverified` until the data-quality
   validation pipeline (EXT-03) promotes them; nothing in the extractor
   claims `extracted-and-validated` yet.
4. The `WorldRef` IR record is defined but no adapter emits it yet.
5. Untrusted-input bounds (spec 9.4): 5 000 files, 10 MiB per file.
