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

## XML data format: mostly unconfirmed

Only `<Spawn>` world/tutorial spawning structure is community-documented ([StationeersXMLStructureConverter](https://github.com/Geneticus/StationeersXMLStructureConverter)). Filenames, root elements, and schemas for recipes/items/gas definitions in `StreamingAssets/Data` and `Worlds` are **unconfirmed**; some data may be compiled-side only.

**Pipeline consequence:** before assigning semantics, the extractor runs a version-pinned inventory pass (every filename, root tag, child tag, attribute) over a real install; XML is treated as build-specific and unstable. EXT-01's provisional format stays provisional until then.

## Grid facts (provisional)

Community-accepted values, not build-verified: large grid ≈ 1 m, small grid ≈ 0.5 m, ratio 2:1; small-grid pipes/cables snap to half-large-cell offsets; large↔small transitions need compatible connectors. No single universal "floor height" value confirmed. Official news confirms distinct `SmallGrid`/`SmallCell`/`WorldToLargeGridCenter` systems and that grid alignment changes between builds.

**Policy:** grid constants live in the pack (versioned, with source-confidence flags), never hard-coded — matching spec 4.2.

## Current build (for pack manifests)

Latest stable hotfix: **v0.2.6428.27798** (August); branch model: normal public vs `beta` (confirmed user-facing name; internal Steam branch key to verify locally). Manifests must record the full build number + channel + source digests, not just a marketing version (spec 6.4). Game remains Early Access.
