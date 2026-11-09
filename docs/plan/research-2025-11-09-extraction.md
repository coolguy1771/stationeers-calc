# Extraction research digest — 2025-11-09

Findings from background research feeding EXT-02/EXT-05 (full source links inline). Confidence marked per fact.

## Decision: build our own Adapter B extractor

Both candidate community extractors ship **without any license**:

- [WikiExtractorMod](https://github.com/Stationeers-ic/WikiExtractorMod) — no declared license; last commit 2025-09 (`2.0.10`); README grants no reuse rights and warns about the Stationeers EULA.
- [stationeers-pedia](https://github.com/NotFastJustLoud92/stationeers-pedia) — no declared license; actively receives commits, but its dataset mixes vanilla content with the author's Workshop mods (provenance hazard).

**Decision (per spec R20/6.1):** treat both as research references only. We implement an independent project-maintained Adapter B extractor against a clean vanilla install. The human actions that remain: EULA/modding-terms review recorded in-repo before publishing any pack (6.8), and no third-party images/prose ever ship in packs.

## Confirmed Stationpedia capabilities (runtime extraction)

Strongly confirmed extractable fields (per both repos' output): Stationpedia key, display name, description, prefab name + hash, build requirements, recipes, slots/types/indices, logic slots and values, connection types (e.g. `Pipe Input`, `Power Input`), power draw/storage, gas thermodynamic fields (`Specific Heat`, `Latent Heat`, `Moles Per Litre`, `Freeze/Boiling Temperature`, `Min Liquid Pressure`), combustion combos, IC10 `LogicType` glossary and opcodes.

Runtime caveats: text/spec data works headless on the dedicated server; icons need a GPU client; per-device logic types may require a placed instance in the world; categories are classifier-derived, not authoritative.

## Geometry is NOT a Stationpedia field (EXT-05 scope confirmed)

No evidence that footprints, world-space connector positions, orientation frames, pipe internal volumes, or snap transforms are exposed by Stationpedia. They live in prefabs/compiled code. Adapter C must use runtime inspection + controlled placement fixtures (spec 6.1), and report `unknown` rather than approximating. This is the core EXT-05 go/no-go question.

## XML data format: CONFIRMED against a real install (2025-11-09)

Update superseding the section below: a copy of `rocketstation_Data/StreamingAssets/Data` (43 XML files, 1.6 MB) is now available in the repo working tree at `Data/` (gitignored, never committed). **Provenance warning: the source install is MODDED (per user, 2025-11-09).** Consequences:

- This copy is a **format reference only** — file/element/attribute structure is valid to build the parser against, but no VALUE from it may enter a published pack (spec 6.3: extraction only from clean vanilla installs; R18: modded installs contaminate vanilla packs).
- Pack generation needs a clean vanilla source: a mod-free install (Steam: disable/uninstall mods and verify integrity, or a separate install) — flagged as a human prerequisite for M0 exit.

Confirmed structure:

- Every file: root `<GameData>` (with `xsi`/`xsd` namespaces), one recipe family per file — `ChemistryRecipes`, `AdvancedFurnaceRecipes`, `ElectronicsPrinterRecipes`, `AutolatheRecipes`-style wrappers.
- Recipe unit of record: `<RecipeData>` → `<PrefabName>` (output prefab ID, e.g. `ItemAstroloyIngot`), `<Recipe>` with ingredient child elements (`<Steel>.5`, `<Copper>.25`) plus `<Time>`, `<Energy>`, and optional `<Temperature>`/`<Pressure>` envelopes (`Start`/`Stop`), and optional `<Output>` quantity.
- Ingredient quantities are element-name→number; unit semantics (mass vs count vs mol) are unverified — record as `extracted-unverified` until cross-checked.
- `blueprints.xml` (750 KB): `<Blueprint Id="BlueprintItem...">` with `<Mesh Path=...>` and `<Edge x1 y1 z1 x2 y2 z2>` line segments in meters — real 3D geometry per prefab. Bounding boxes derivable from edges; footprint/grid-snapping rules still live in code (EXT-05 runtime probe still needed for connector placement), but build-shape data is extractable.
- XML comments exist in files; parser must ignore them. Numbers appear without leading zero (`".5"`).

## Earlier assessment (pre-inventory): XML data format: mostly unconfirmed

Only `<Spawn>` world/tutorial spawning structure is community-documented ([StationeersXMLStructureConverter](https://github.com/Geneticus/StationeersXMLStructureConverter)). Filenames, root elements, and schemas for recipes/items/gas definitions in `StreamingAssets/Data` and `Worlds` are **unconfirmed**; some data may be compiled-side only.

**Pipeline consequence:** before assigning semantics, the extractor runs a version-pinned inventory pass (every filename, root tag, child tag, attribute) over a real install; XML is treated as build-specific and unstable. EXT-01's provisional format stays provisional until then.

## Grid facts (provisional)

Community-accepted values, not build-verified: large grid ≈ 1 m, small grid ≈ 0.5 m, ratio 2:1; small-grid pipes/cables snap to half-large-cell offsets; large↔small transitions need compatible connectors. No single universal "floor height" value confirmed. Official news confirms distinct `SmallGrid`/`SmallCell`/`WorldToLargeGridCenter` systems and that grid alignment changes between builds.

**Policy:** grid constants live in the pack (versioned, with source-confidence flags), never hard-coded — matching spec 4.2.

## Current build (for pack manifests)

Latest stable hotfix: **v0.2.6428.27798** (August); branch model: normal public vs `beta` (confirmed user-facing name; internal Steam branch key to verify locally). Manifests must record the full build number + channel + source digests, not just a marketing version (spec 6.4). Game remains Early Access.
