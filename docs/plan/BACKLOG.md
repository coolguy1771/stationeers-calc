# P0 Backlog — working tracker

Source of truth: spec §16.1 (24 items, 167 SP). Status values: `done`, `in-progress (owner)`, `blocked (why)`, `planned`. SP are relative story points, not time.

| ID | SP | Item | Depends on | Status |
|---|---|---|---|---|
| FND-01 | 3 | Bun/Vite monorepo, TS strict, Vitest, CI | — | done (scaffold) |
| FND-02 | 8 | Canonical project/device/port/intent/connection schemas | FND-01 | in-progress (wave 1) |
| FND-03 | 5 | Local storage, persistence request, migration, import/export with §9.4 limits | FND-02 | in-progress (wave 1) |
| FND-04 | 5 | Canonical store, command/patch log, revision IDs | FND-02 | planned (wave 2) |
| FND-05 | 5 | Deterministic numeric library + revision-aware worker job infra | FND-01 | done — decimal.js-backed transcendentals, f32/f64 helpers, revision-aware jobs |
| EXT-01 | 5 | XML configuration and recipe extractor (Adapter A) | FND-01 | in-progress (wave 1) |
| EXT-02 | 8 | Runtime Stationpedia extractor (license review + fallback plan) | FND-01 | decision made: independent extractor (see research-2025-11-09-extraction.md); human EULA review still owed before publishing packs (6.8) |
| EXT-03 | 8 | Normalize data, versioned pack manifests | EXT-01, EXT-02 | planned |
| EXT-04 | 5 | Semantic pack diff, provenance coverage, input invalidation | EXT-03, SIM-00 | planned |
| EXT-05 | 8 | Spike: footprints, connectors, orientations, grid sizes, pipe volumes | EXT-02 | blocked — needs a game install (human) |
| DOM-01 | 8 | Typed ports, dual-grid placement, physical topology resolution | FND-02, EXT-05 | planned (blocked by EXT-05 go/no-go) |
| DOM-02 | 8 | Shared-volume network grouping, network volume, diagnostics | DOM-01 | planned |
| SIM-00 | 5 | Behavior-model registry, validity envelopes, status propagation | FND-02 | planned (wave 2) |
| SIM-01 | 8 | Reference fixture format and capture workflow | FND-02 | planned (wave 2); actual capture needs the game |
| SIM-02 | 8 | Verified atmospheric static calculations (§13 #11) | DOM-02, SIM-00, SIM-01, FND-05 | planned |
| SIM-03 | 5 | Results, model/topology status, diagnostics UI | SIM-02, UI-01 | planned |
| UI-01 | 5 | Application shell, component library, inspector | FND-02, EXT-03 | in-progress (early start per user: shell + design system + status vocabulary against mock data; wiring deferred until FND-02/EXT-03 land) |
| UI-02 | 8 | Schematic editor with typed connections and intents | DOM-01, UI-01, FND-04 | planned |
| UI-03 | 13 | Multi-level 2D dual-grid placement and orientation | DOM-01, EXT-05, FND-04 | planned |
| UI-04 | 13 | Pipe routing, connector snapping, collision checks | UI-03 | planned |
| UI-05 | 8 | Synchronize projections; Unplace/Delete semantics | UI-02, UI-04 | planned |
| BLD-01 | 5 | Aggregate routed elements into bill of materials | UI-04, EXT-01, EXT-03 | planned |
| QA-01 | 8 | Golden fixture regression suite + dual-editor E2E | UI-05, SIM-02 | planned |
| QA-02 | 5 | PWA/offline, storage durability, performance, release checks | FND-03, QA-01 | planned |

## Milestones (§16.2)

M0 extraction & verification feasibility → M1 engineering foundation → M2 dual editors → M3 verified atmospherics → M4 MVP release → M5 expanded simulation.

First development increment (§17): Pipe Network Designer vertical slice — place two components, connect (intent), build the route, resolve network volume, enter a scenario, get a Verified pressure result, generate materials, persist and reload identically.

## Needs a human (agents cannot do these)

- **EXT-05 / SIM-01**: require a clean vanilla Stationeers install and in-game fixture capture — the M0 go/no-go gate.
- **EXT-02**: license review of WikiExtractorMod and stationeers-pedia before any reuse (R20); legal sign-off is human.
- **6.8**: EULA/modding-terms review recorded in the repo before publishing any pack.

## Work log

- 2025-11-09: FND-01 scaffold committed; wave 1 dispatched (FND-02 + FND-03, FND-05, EXT-01, EXT-02 license/format research).
- 2025-11-09: research landed — both community extractors are unlicensed; decision: independent Adapter B extractor, repos used as references only. Geometry confirmed absent from Stationpedia → EXT-05 runtime probe is the real M0 gate. See research-2025-11-09-extraction.md.
- 2025-11-09: real Data XML obtained (43 files, gitignored) and inventoried — recipe format confirmed; blueprints.xml carries per-prefab 3D edge geometry. **Source install is modded → copy is format-reference only; clean vanilla source needed for pack generation (M0 prerequisite).**
- 2025-11-09: FND-05 merged — deterministic numerics backed by decimal.js (isolated 50-digit clone; bit-exact on 88 reference fixtures), hand-rolled f32/f64 helpers + ordered summation, revision-aware job runner with Zod-v4-validated worker protocol. Decision: library-grade transcendentals over hand-ported fdlibm (transcription risk); fast paths deferred until profiling demands them (spec 2.1).
- 2025-11-09: toolchain upgraded (TS7, vitest 5, oxlint — user's local changes adopted as fd49ccf; vite-env.d.ts added for TS7). UI foundation started early per user request: shell, routing, shadcn design system, and the spec's status-vocabulary components built against the frozen entity contract with mock data.
