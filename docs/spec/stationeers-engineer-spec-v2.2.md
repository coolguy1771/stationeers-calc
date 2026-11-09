# Stationeers Engineer

## Product Requirements & Technical Design Specification — v2.2

**Status:** Revised implementation specification (supersedes v2.0 and v2.1)
**Architecture:** Offline-capable, client-side SPA
**Simulation fidelity:** Build-pinned reproduction of game mechanics, limited to verified capabilities within stated validity envelopes
**Primary editors:** Synchronized logical schematic and physical construction layout
**Game data:** Automated extraction, versioned normalization, and verification
**Target platform:** Desktop browsers; mobile is view-and-inspect only until touch editing is specified

---

# 0. Revision Notes

## 0.1 Fixes to sections 1–5 (carried from v2.1)

| # | Flaw in v2.0 | Fix |
|---|---|---|
| R1 | Schematic called a "projection" of the physical graph (3.3) yet could hold unrouted connections (3.1, 3.5). | Schematic = derived projection + overlay of stored ConnectionIntents (3.3). |
| R2 | One "verified" label mixed "mechanic modeled correctly" with "network actually buildable." | Two independent statuses: model status and topology status (3.5, 5.2). |
| R3 | No status rule for results combining several behavior models. | Weakest contributing status wins (5.2.2). |
| R4 | "Verified" had no input-range limits. | Validity envelopes; out-of-envelope inputs downgrade (5.2.1). |
| R5 | Determinism claimed for an undefined environment; browser Math.exp/pow are not bit-specified across engines; game may use 32-bit floats. | Numeric representation contract and cross-engine CI (5.1.1, 5.5). |
| R6 | Single integer grid; the game uses a large grid and a small grid. | Explicit dual-grid model (4.2). |
| R7 | Orientation "discrete" and unspecified; devices mount on floors, walls, ceilings. | Enumerated, extracted orientation set per definition (4.2). |
| R8 | Temperature, energy, and derived pressure stored side by side. | One canonical thermal variable; the rest derived (4.5). |
| R9 | Unrouted networks have no defined volume. | Assumed volume required, result capped at Conceptual (4.7). |
| R10 | Rooms drawn by hand. | Rooms derived from sealing structures (4.6). |
| R11 | No tick length or per-domain cadence. | Tick model extracted per build (5.4). |
| R12 | No canonical store; undo across editors/workers unspecified. | Canonical store, command log, revision IDs (2.2.1). |
| R13 | No deletion or unplace semantics. | SYNC-011 to SYNC-015 (3.4). |

## 0.2 Fixes to sections 6–14, backlog, and front matter

| # | Flaw in v2.0 | Fix |
|---|---|---|
| R14 | 6.8 allows "require local user extraction," but 6.7 says no game installation is required and extraction tooling is developer-only. | Two pack channels: published packs (no install needed) and user-generated packs (optional, documented tool), each with a defined feature level (6.7, 6.8). |
| R15 | Adapter B extracts icons, while 6.8 says icons may not be redistributable. | Icons and text excluded from published packs by default; included only after documented rights review (6.1, 6.8). |
| R16 | 6.5 data-quality levels and 5.2 verification statuses are separate vocabularies with no rule linking them; a Verified calculation could consume an unvalidated property. | A Verified capability may consume only "Extracted and validated" properties (or values derived only from them) (6.5). |
| R17 | 6.6 step 6 "invalidate impacted behavior verification" has no mechanism for finding what is impacted. | Each behavior model declares the properties and constants it consumes; the semantic diff flags models whose inputs changed (6.6). |
| R18 | 6.3 mentions mod-added content, but nothing else supports mods; extracting from a modded install can contaminate vanilla packs. | Extraction runs only on clean vanilla installs; mod content out of scope for MVP (6.3). |
| R19 | Game branch unspecified (stable vs beta). | Packs record branch; only stable builds are published as supported (6.4). |
| R20 | Runtime extraction depends on third-party mods (BepInEx) that break on game updates; their licenses are unreviewed. | Dependency risk recorded; license review required before reuse; fallback adapter required (6.1, 15). |
| R21 | 9.1 serialization does not distinguish ConnectionIntents from physical connections, and does not forbid serializing derived state. | Intents serialized separately; derived networks/rooms never serialized (9.1). |
| R22 | 9.3 caches keyed by a whole-model digest, so any edit invalidates every result — contradicting 11's incremental recomputation. | Per-network/per-subgraph digests (9.3). |
| R23 | 9.4 import limits omit decompressed size (compression bombs); local-storage eviction risk never addressed. | Decompressed-size limit; persistent-storage request and export prompts (2.1, 9.4). |
| R24 | 11 targets Safari with offline-first local storage, but Safari may evict script-written storage for sites not used recently unless installed. | Safari eviction behavior documented; export prompts; installed-PWA path recommended (11). |
| R25 | 12 MVP promises "basic atmospheric analysis where verified" and 13 #11 requires verified calculations to match fixtures — both are satisfied vacuously if nothing is verified. | Minimum verified calculation set named (12, 13 #11). |
| R26 | 13 #3 requires provenance only for verified properties. | Every displayed property shows provenance and quality level (13 #3). |
| R27 | No backlog item extracts physical geometry or pipe volume, even though M0, the risks section, and the "first real implementation task" all depend on it. | New EXT-05 spike; UI-03, DOM-01 depend on it (16). |
| R28 | Undo/redo command model arrives last (UI-05) after both editors are built, forcing a retrofit. | New FND-04 canonical store precedes editors; UI-05 reduced (16). |
| R29 | Fixture capture (SIM-01) depends on EXT-03, yet the risks section says the reference harness must come first. | SIM-01 depends only on FND-02 and starts in M0 (16). |
| R30 | No backlog items for the behavior-model registry, deterministic numerics, or worker job infrastructure required by section 5. | New SIM-00 and FND-05 (16). |
| R31 | BOM (BLD-01) does not depend on the recipe extractor (EXT-01). | Dependency added (16). |
| R32 | Backlog total stated as 141 SP, then "corrected" to 149 SP in the same document; tracker says 24 items but lists 20; the 4 post-MVP items (60 SP) are not listed. | One total stated; hidden items flagged as missing (16). |
| R33 | Vertical slice "calculate a verified pressure result" has no initial inventory. | Slice includes a scenario with initial moles and temperature (17). |
| R34 | 7.7 lists "basic electrical loads" as an initial calculator, but electrical is post-MVP in 12. | Moved to post-MVP candidates (7.7). |
| R35 | Front matter contains pasted citation artifacts (favicon image links, "+1" markers, tracking parameters in URLs), a duplicated title block, and conversational text inside the spec. | Front matter moved to Appendix A and cleaned. |

---

# 1. Product Vision

Stationeers Engineer is a local-first engineering calculator, system designer, and game-specific simulation workbench for Stationeers.

It combines:

- Quick engineering calculators.
- Logical equipment and network schematics.
- Physical base and equipment layout planning.
- Game-specific engineering calculations.
- Validated equipment configurations.
- Reproducible scenario simulation.
- Construction quantities and build instructions.

A player should be able to design a complete subsystem, determine its operating requirements, verify supported game behavior, and translate the design into an actionable in-game build.

Product boundary: **exact for supported, verified mechanics; explicitly unsupported for everything else.**

## 1.1 Core principles

1. **Accuracy over completeness.** Do not pretend to simulate an unsupported mechanic.
2. **One engineering model, two editors.** Logical and physical representations must remain consistent.
3. **Extract, don't transcribe.** Game data originates from game assets and runtime extraction whenever feasible.
4. **Reproducibility.** Results are tied to a particular game build, data pack, and engine implementation.
5. **Offline-first.** Engineering and editing functionality must work without an API server.
6. **Progressive complexity.** Support standalone calculations before full-base simulation.
7. **Explainability.** Results expose their inputs, assumptions, sources, and verification status.

## 1.2 Product scope

The long-term product covers:

- Atmospherics and gas inventories.
- Gas/liquid piping and phase changes.
- Thermal control systems.
- Electrical power distribution.
- Manufacturing and resource processing.
- IC10 logic and automation.
- Room/environment systems.
- Multi-system simulation.

These domains are introduced through individually validated modules. A domain ships only when at least one of its capabilities reaches Verified status (5.2). MVP scope is defined in section 12.

---

# 2. Architecture

## 2.1 Runtime architecture

The production application is a static SPA.

**Frontend**

- React + TypeScript + Vite.
- React Router.
- Tailwind CSS + shadcn/ui.
- Zustand for transient UI state only (selection, hover, tool mode, viewport).
- XYFlow / React Flow for schematic editing.
- PixiJS for the 2D construction grid.
- Dexie / IndexedDB for persistent local projects.
- Zod for runtime schema validation.

**Engineering engine**

- Framework-independent TypeScript domain packages.
- Typed physical-network resolution.
- Deterministic game-mechanics implementations (5.1.1).
- Versioned behavior-model registry.
- Worker-hosted simulations.
- Optional Rust/WASM only after profiling identifies a need.

**Persistence**

- IndexedDB for local projects, layout, revisions, and caches.
- JSON and optionally compressed binary for portable project bundles.
- Static, content-addressed game-data packs.
- Service Worker for offline resources.

**Data durability**

- On first project save, request persistent storage (`navigator.storage.persist()`) and show the result.
- Because there is no server copy, prompt the user to export a bundle after significant work since the last export.
- Show storage usage and quota in settings.

There is no runtime API server, account requirement, or centralized database.

## 2.2 Separation of concerns

The system consists of five independently testable layers.

1. **Game data:** Extracted device/item definitions and constants.
2. **Domain model:** Components, ports, networks, positions, inventories, and scenarios.
3. **Engineering engine:** Topology resolution, device behaviors, calculations, and simulation.
4. **Presentation:** Schematic, construction layout, inspectors, and charts.
5. **Persistence:** Project versioning, migrations, snapshots, and import/export.

React Flow, PixiJS, and Zustand must never be the authoritative project data model.

### 2.2.1 Canonical model store

- The domain model lives in a single canonical store outside any rendering library.
- All mutations are commands that produce a patch and its inverse.
- Each committed command increments a monotonic project revision ID.
- Undo/redo replays inverse/forward patches; both editors re-derive their views.
- Worker jobs are tagged with the revision ID they started on (5.6).
- Persistence writes debounced snapshots plus the command log since the last snapshot.

## 2.3 Build-time extraction versus runtime execution

The application runs entirely in the browser.

Game-data extraction may use local tooling outside the browser: CLI programs, XML parsers, a game installation, an instrumented game or dedicated-server instance, and optional extractor mods.

These are **data-production tools**, not application backend services. The generated artifacts are static versioned files.

## 2.4 Game-build support policy

- The app ships one current published pack and its behavior models, plus a declared list of older supported builds.
- Each project records the build and pack hash it was authored against.
- Opening a project authored against an unsupported or newer build shows the mismatch and offers re-targeting.
- Re-targeting reports renamed, removed, or changed definitions and ports. Instances whose definitions no longer exist become orphaned placeholders, never silently deleted (SYNC-009).
- Results computed under one build are never displayed as valid for another.

---

# 3. Dual-Editor User Experience

## 3.1 Schematic editor

The schematic represents logical engineering relationships.

Features:

- Device nodes and typed connection ports.
- Pipes, electrical connections, and data-network connections.
- Subsystems and reusable groups.
- Device settings.
- Network inspection.
- Automatic logical network resolution.
- Connection validation.
- Error and warning highlighting.
- Undo/redo.
- Automatic diagram layout.

The schematic does not imply physical distance, construction dimensions, or pipe lengths.

Schematic edges are either derived from physical connectivity or are ConnectionIntents (3.3). They represent connectivity, not flow direction.

## 3.2 Physical layout editor

The physical editor represents buildable placement and routing.

Features:

- Dual-grid coordinates matching the game's large and small grids (4.2).
- X, Y, Z positioning.
- Floor/level selection.
- Equipment footprints.
- Rotation and mounting orientation.
- Pipe and cable routing.
- Junctions, branches, and bends.
- Sealing structures (walls, floors, frames) from which rooms are derived (4.6).
- Equipment clearance/occupancy.
- Multi-floor connections.
- Layer visibility and filtering.
- Construction quantities.

Rendering begins as a 2D top-down grid with floor navigation. Vertical runs and wall/ceiling-mounted devices must remain selectable and inspectable (for example, as markers with an elevation badge).

3D visualization is explicitly deferred.

## 3.3 Shared engineering model

The editors operate on a shared graph of device instances, physical connectors, networks, and placements.

Every device instance has:

- Stable instance ID.
- Game-data definition ID.
- Optional physical placement.
- Logical port identities.
- Configurable device state.
- Construction footprint.
- Versioned behavior association.

Each physical connection is composed of actual build elements (pipe segments, junctions, devices).

The schematic is composed of:

1. A **derived projection** of the physical graph (resolved connectivity between placed devices).
2. An **overlay of ConnectionIntents**: user-declared logical connections not (yet) realized physically.

Intents are canonical stored entities; the projection is never stored.

## 3.4 Synchronization contracts

**SYNC-001:** Adding a schematic component creates an unplaced engineering component.

**SYNC-002:** Placing an existing unplaced component does not create a duplicate.

**SYNC-003:** Adding a component from the physical editor creates the corresponding schematic entity.

**SYNC-004:** Selecting a component in either editor selects the same underlying instance.

**SYNC-005:** Physically connecting compatible ports updates resolved connectivity and marks any matching intent Routed.

**SYNC-006:** Removing physical connections updates resolved networks and the schematic projection.

**SYNC-007:** Intents without a physical route are shown as Unrouted.

**SYNC-008:** When a physical change breaks a route that satisfied an intent, the intent becomes Conflicting and is reported; the intent is retained.

**SYNC-009:** No editor operation silently discards connections, intents, inventory, or device settings.

**SYNC-010:** Undo/redo affects the canonical model and both projections.

**SYNC-011:** Removing a device in the physical editor offers Unplace (default: instance and settings kept, physical connections removed) or Delete (instance removed everywhere). Delete requires confirmation if the instance has intents, inventory, or non-default settings.

**SYNC-012:** Deleting a device from the schematic deletes the instance and placement everywhere, with the same confirmation rule.

**SYNC-013:** Deleting a device removes its intents as part of the same undoable command.

**SYNC-014:** Physical connectivity without a corresponding intent is valid; intents are optional.

**SYNC-015:** Connectivity the game forms automatically (for example, adjacent compatible pipe ends) is resolved identically to explicit connections.

## 3.5 Connectivity status and authority

**The physical layout is authoritative for buildable connectivity. Intents express what the designer wants.**

Intent topology status: Unrouted · Routed · Routed with warnings · Conflicting · Not buildable.

Each calculation result carries two independent statuses:

- **Model status** (Verified / Unverified / Unsupported / Incompatible), from 5.2.
- **Topology status**: *Buildable* (all participating networks resolved from physical placement with verified footprints and connectors) or *Conceptual* (any dependence on an Unrouted intent, unplaced device, unverified footprint, or assumed volume).

A result is labeled exact only if it is both Verified and Buildable. Verified + Conceptual is displayed as "correct mechanics, assumed topology."

## 3.6 Physical placement limitations

Exact footprints, connector positions, and orientations require verified game data.

Unknown footprints block buildability validation and force Conceptual status, but do not prevent logical design.

The physical editor must not fabricate footprint or connectivity geometry and present it as game-accurate.

---

# 4. Engineering Domain Model

## 4.1 Core entities

- Project
- Environment
- Scenario
- DeviceDefinition
- DeviceInstance
- PortDefinition
- PortInstance
- PhysicalPlacement
- ConstructionElement
- ConnectionIntent
- PhysicalConnection
- ResolvedNetwork (derived)
- NetworkInventory
- Room (derived)
- BehaviorModel
- CalculationResult
- ValidationDiagnostic

Stored entities have stable identifiers. Derived entities have identifiers that are deterministic functions of their member elements, so results and diagnostics can reference them across recomputation.

## 4.2 Coordinate model

- **Large-grid coordinates:** integer X/Y/Z cells for large structures (frames, walls, large devices).
- **Small-grid coordinates:** integer X/Y/Z cells at the game's small-grid subdivision for pipes, cables, and small devices.
- Grid sizes and the large-to-small ratio are extracted per build, not hard-coded.
- Each DeviceDefinition declares which grid it snaps to.

Orientation: each DeviceDefinition declares an enumerated set of allowed orientations (including floor, wall, and ceiling mounting where allowed), sourced from extraction. Instance orientation must be in that set.

Occupancy: footprint and connector positions are defined in local coordinates and transformed by orientation. A cell cannot contain incompatible solid equipment. Overlapping construction layers are permitted only where game rules allow coexistence, as verified.

## 4.3 Port model

Ports declare:

- Port identifier.
- Connection medium.
- Local position and direction.
- Compatible construction categories.
- Passive or device-mediated.
- Port-specific capabilities.
- Source and verification status.

Connection domains: gas-pipe networks, liquid-pipe networks, electrical power, data/logic networks, chute/item transport, environment/room interaction, thermal coupling.

Gas and liquid pipe networks must not be assumed to contain exclusively one phase.

## 4.4 Network semantics

The engine distinguishes structural pipe connectivity, shared-volume atmospheric networks, containment/storage entities, active mass-transfer devices, thermal connections, electrical circuits, and data connections.

Shared-volume networks are resolved from physical connectivity and device boundary rules. Whether a device is a boundary or a pass-through is a verified property of its definition, not inferred.

A pump connecting two atmospheric networks does not merge their inventories.

## 4.5 Atmospheric inventories

Canonical (stored) state per network:

- Moles by species and phase (gas, liquid, solid where applicable).
- One thermal state variable — whichever the game stores as canonical for the pinned build (temperature or internal energy), confirmed by extraction.
- Volume, when not derived from topology (4.7).

Derived (computed on read, never stored): the other thermal variable, pressure, partial pressures, composition percentages, and any other quantity computable from canonical state.

A solver that does not support a phase present in an inventory reports Unsupported rather than ignoring it.

## 4.6 Rooms

- Rooms are derived from sealing structures using the game's verified sealing rules; room volume is computed from enclosed cells.
- A user-drawn boundary is allowed only as an explicit assumption and forces Conceptual status.
- Until sealing rules are verified, all room-based results are Conceptual.

## 4.7 Network volume

- Buildable network volume = sum of verified per-element volumes (pipe segments, junctions, device internal volumes) along the resolved network.
- For Unrouted or partly unplaced networks, the user enters an assumed volume; the result is Conceptual and the assumption appears in its explanation.
- The engine never silently substitutes a default volume.

---

# 5. Exact-Fidelity Engineering Engine

## 5.1 Definition of exact

"Exact" means intentionally reproducing the behavior of a specific supported game build within defined numerical tolerances, for a Buildable topology (3.5). It does not imply infinite precision or universal mechanic support.

Results are associated with: game build, pack hash, behavior-model version, engine version, scenario definition, reference fixture version, and numerical tolerance.

### 5.1.1 Numeric representation

- Each behavior model documents the precision the game uses for that mechanic (for example, 32-bit vs 64-bit float), established during extraction.
- Where the game uses 32-bit floats, results are rounded to 32-bit at the same points (for example, with `Math.fround`), as confirmed by fixtures.
- Transcendental and power functions come from a bundled deterministic implementation, not the browser's `Math` object.
- Summation order follows the game's order where it affects results.

## 5.2 Verification states

**Verified** — Matches recorded in-game reference fixtures for the pinned build, within a declared validity envelope.

**Unverified** — Implemented without sufficient validation. Shown only as explicitly marked experimental output, never as exact.

**Unsupported** — No usable implementation or insufficient verified information.

**Incompatible** — Known not to match the selected build.

The exact-results workspace shows Verified results by default. Experimental results require a separate opt-in and never carry the Verified designation.

### 5.2.1 Validity envelopes

Each Verified capability declares the input ranges its fixtures cover (temperature, pressure, species, phases, device settings). Out-of-envelope inputs downgrade that capability to Unverified for that result, with a diagnostic naming the input.

### 5.2.2 Status propagation

- Result model status = weakest contributing status (Incompatible < Unsupported < Unverified < Verified).
- Topology status is Conceptual if any contributing network is Conceptual.
- Each result lists its contributing models and their statuses.

## 5.3 Physics implementation

Implement game mechanics rather than generic physics wherever they differ.

Possible modules: game-specific gas pressure; mixture and heat-energy behavior; pipe-network shared volumes; gas/liquid/solid state transitions; device-specific transfer; network pressure integrity; heat exchange; electrical consumption and storage; environment interaction; combustion and manufacturing; IC10 execution.

Each module requires its own fixtures and validity envelope, and declares the pack properties and constants it consumes (used by 6.6).

## 5.4 Simulation execution

**Static evaluation:** topology resolution, known inventories, component capacities, connection integrity, build requirements, verified closed-form calculations.

**Time-stepped evaluation:** device updates, network transfers, heat/energy changes, phase transitions, electrical consumption, automation-driven state changes.

Tick model:

- Tick length(s) and per-domain update cadence (atmospherics, electrical, logic) are extracted per build and stored in the pack.
- The transient solver uses a versioned update order matching observed game behavior for supported mechanics.
- Where the game's own order is non-deterministic, the behavior model documents it, and fixture tolerances cover observed run-to-run variation.

Generic continuous ODE integration must not be assumed to match the game's discrete update sequence.

## 5.5 Determinism

Identical inputs, pack, and engine versions yield identical outputs in every supported browser engine, enforced by running the fixture suite in each engine in CI.

Fixture tolerances apply to comparison against the game, not between browsers.

Simulation output includes initial state, step count and simulated time, state trajectories, discrete events, warnings, final state, and verification metadata (model/topology status, contributing models, envelopes).

## 5.6 Runtime performance

Inexpensive static calculations may run on the main thread. Graph-intensive or time-stepped calculations run in Web Workers with cancellation and progress reporting.

Every worker job carries the revision ID it started on. A result older than the current revision is discarded or shown as stale; it never overwrites newer state.

---

# 6. Automated Game-Data Extraction

## 6.1 Extraction pipeline

**Clean vanilla game installation → Source extraction → Normalization → Validation → Semantic diff → Versioned data pack**

### Adapter A — XML

Extract supported configuration from game-provided XML (recipes, world definitions, other exposed values).

### Adapter B — Runtime Stationpedia

Use an instrumented runtime or extraction mod to retrieve device identities, prefab identifiers, device properties, build requirements, logic interfaces, and physical constants.

Icons and descriptive text may be extracted for local developer use but are excluded from published packs unless cleared under 6.8.

Third-party extractor mods may be reused only after their licenses are reviewed. Because mod loaders can break on game updates, Adapter B must have a documented fallback (for example, a project-maintained extractor) before it becomes the sole source for any P0 data.

### Adapter C — Geometry

Extract or capture footprints, connector positions, orientation sets, grid sizes, per-element volumes, and sealing rules. If not available from metadata, populate through runtime inspection and verified placement fixtures. Geometry is never invented.

### Adapter D — Behavior verification

Supplement metadata with controlled game experiments capturing initial conditions, device configuration, game build, observed state transitions, expected outputs, timing, and tick model (5.4).

## 6.2 Data normalization

All extractors output a versioned intermediate representation. The normalizer deterministically resolves duplicate identities, canonical prefab identifiers, cross-file references, recipe dependencies, unit conversions, optional fields, build-specific data, and source provenance.

## 6.3 Stable identities

- Preserve game-native identifiers where possible.
- Never key on translated display names.
- Source-specific identifiers may map into canonical stable IDs.
- Extraction runs only on clean vanilla installs. Mod-added content is out of scope for the MVP; when added, it uses a separate namespace so it cannot collide with vanilla IDs.

## 6.4 Versioned pack manifest

Each pack contains: pack schema version, game build/version, game branch (stable/beta), extraction tool versions, source digests, extraction date, normalization version, entity counts, behavior-model compatibility, content hashes, data coverage report, and channel (published or user-generated, 6.7).

Only stable-branch builds are published as supported.

## 6.5 Data quality levels

Each extracted property has one level:

- Extracted and validated.
- Extracted but not semantically verified.
- Missing.
- Conflicting between sources.
- Inferred/derived (must identify its calculation and dependencies).

**Link to verification:** a Verified capability (5.2) may consume only properties at "Extracted and validated," or derived values whose dependencies are all validated. Any other input downgrades the result to Unverified.

A device can appear in the catalog even when some capabilities are unsupported.

## 6.6 Continuous update workflow

On a new stable game build:

1. Acquire source data from a clean install.
2. Run supported extractors.
3. Normalize.
4. Semantic diff against the last pack.
5. Identify changed constants, devices, recipes, interfaces, and geometry.
6. Mark Unverified every behavior model whose declared inputs (5.3) changed, and every model whose fixtures were captured on an older build if the tick model or numeric representation changed.
7. Re-run fixtures; re-capture fixtures for invalidated models.
8. Publish only after quality gates pass.

**Game updates are never automatically promoted to verified support.**

## 6.7 Runtime data loading and pack channels

The SPA loads prebuilt packs. Users can pin projects to a pack; pinned packs are cached locally for offline use.

Two channels:

- **Published packs:** distributed with the SPA, containing only redistributable content (6.8). No game installation is required.
- **User-generated packs (optional):** produced by the user running the documented extraction tool against their own install, imported as files, and validated under 9.4. They may include locally extracted icons/text that cannot be published. Features depending only on published data must not require them.

## 6.8 Legal and distribution requirements

- Review the game's EULA and modding terms before publishing any pack, and record the review in the repository.
- Published packs contain factual, normalized values only by default (IDs, constants, port layouts, footprints, recipes).
- Icons, art, descriptive text, and other assets are excluded unless rights are cleared; otherwise use independently created alternatives or the user-generated channel.
- Never distribute game assemblies, decompiled code, or proprietary binaries.

---

# 7. Feature Requirements

## 7.1 Project management

- Create, rename, duplicate, archive, and delete projects.
- Pin projects to a game-data pack.
- Save automatically to IndexedDB.
- Export/import versioned project bundles; prompt for export as in 2.1.
- Support schema migrations.
- Create project snapshots.
- Show unsaved/error states.

## 7.2 Component catalog

- Search by name, identifier, function, and category.
- Display extracted properties with provenance and quality level.
- Filter by supported game build.
- Show verification/coverage status.
- Display known footprint and connector interfaces.
- Show construction requirements when extracted.

## 7.3 Schematic design

- Place component instances.
- Connect logical ports (creating intents).
- Inspect networks.
- Group components.
- Display network categories.
- Validate topology.
- Highlight unsupported or incompatible devices.
- Identify unrouted and conflicting intents.

## 7.4 Physical design

- Place devices on the dual grid.
- Rotate within each device's allowed orientations.
- Select building level.
- Route pipes and cables.
- Calculate required construction segments.
- Show collisions.
- Validate connector alignment.
- Synchronize with the schematic.
- Display unresolved routes.

## 7.5 Engineering analysis

- Select a supported network/scenario.
- Enter initial conditions.
- Run verified static calculations.
- Display model status, topology status, and provenance.
- Identify unverified behavior and out-of-envelope inputs.
- Show which required features are unsupported.
- Export analysis results.

## 7.6 Bill of materials

Aggregate device kits, pipe and cable elements, construction materials, and manufacturing ingredients from a compatible pack.

Unknown recipes produce an explicitly incomplete bill of materials, listing what is missing, rather than an incorrect total.

## 7.7 Calculation library

The initial library supports only mechanics with sufficient fixtures.

MVP candidates: gas inventories; partial pressures; gas mixture calculations; shared pipe-network volumes; container capacities; recipe material expansion.

Post-MVP candidates: basic electrical loads.

Each calculator is enabled independently when verified.

---

# 8. Validation and Diagnostics

Diagnostics have: stable code, severity, affected entity IDs, description, game-data version, source rule, and suggested resolution when applicable.

Categories:

- Invalid connection.
- Unrouted connection.
- Conflicting intent.
- Physical collision.
- Invalid orientation.
- Missing device property.
- Unsupported mechanic.
- Out-of-envelope input.
- Incompatible game build.
- Operating-limit violation.
- Insufficient initial conditions.
- Simulation divergence.
- Data-pack inconsistency.

An unsupported result is not a pass.

Buildability validation and simulation verification are separate results (the topology and model statuses of 3.5). A design can be physically buildable but lack a verified operating simulation.

---

# 9. Data Contracts and Persistence

## 9.1 Project serialization

The portable project schema includes:

- Schema version.
- Project metadata.
- Pinned pack ID/hash and channel.
- Device instances and settings.
- Physical placements (grid, coordinates, orientation).
- Physical connections and routes (construction elements).
- ConnectionIntents, serialized separately from physical connections.
- Schematic layout metadata.
- Scenarios, initial conditions, and assumed volumes.
- User settings.
- Optional references to computed results.

Do not serialize React Flow or PixiJS objects, or derived entities (resolved networks, rooms, intent topology status); these are recomputed on load.

## 9.2 Project migration

Every supported old schema has a deterministic migration. Migration failures preserve the source data. Unknown future schemas are rejected, never silently coerced.

## 9.3 Cache invalidation

Calculation caches are keyed per resolved network (or per affected subgraph), by:

- Digest of the canonical entities in that network and its boundary devices.
- Pack digest.
- Behavior engine version.
- Scenario digest.
- Calculation capability.

An edit invalidates only results whose network digest changed.

## 9.4 Security

Imported projects and packs are untrusted.

- Enforce file-size and decompressed-size limits.
- Validate against schemas before migration.
- Bound graph sizes, entity counts, and nesting.
- Never execute imported code; packs are data only.
- Sanitize user-generated display strings.
- Detect corrupted projects via content hashes.
- Reject unknown pack hashes clearly rather than guessing.
- Make simulation jobs cancellable.

---

# 10. Testing and Verification

## 10.1 Automated tests

- Vitest for domain and engineering tests.
- Playwright for browser workflows, run in Chromium, Firefox, and WebKit.
- Schema contract tests for imported/exported files.
- Property-based tests for invariants (for example, undo/redo round-trips, network resolution stability).
- Golden fixture tests for game behavior, run in every supported browser engine (5.5).

Tests are written with each backlog item, not deferred to QA-01.

## 10.2 Extractor tests

- Known inputs produce stable normalized output.
- Game identifiers remain stable.
- Duplicate records are detected.
- Missing source fields are reported.
- Schema changes fail explicitly.
- Content hashes are reproducible.
- Pack diffs identify changed properties.
- Behavior models with changed inputs are invalidated (6.6).

## 10.3 Simulation verification

Reference fixtures include: game build and branch, scenario initial state, device configuration, observation interval and tick model, recorded outputs, tolerances, validity envelope, source reference, and verification status.

Compare against game observations, not only equations.

## 10.4 Dual-editor tests

1. Create schematic component, place physically, preserve instance ID.
2. Place physical component, observe schematic creation.
3. Connect physically, observe logical network update and intent marked Routed.
4. Remove pipe segment, observe network separation and intent marked Conflicting.
5. Create intent without routing, receive Unrouted diagnostic.
6. Rotate device, recalculate connector alignment; reject disallowed orientations.
7. Undo layout operation, restore both representations.
8. Unplace vs Delete preserve or remove instance, settings, and intents as specified.
9. Save/reload preserves identical topology and intents.
10. Run validated analysis, edit project, invalidate only the affected network's result.

---

# 11. Performance and Browser Requirements

Initial target:

- Desktop Chrome/Chromium, Firefox, and Safari.
- PWA installability and offline project access.
- Smooth manipulation of about 200 device instances on a reference desktop.
- Worker-backed analysis that does not block editing.
- Incremental recomputation after edits (9.3).
- IndexedDB persistence with visible save status.

Storage durability: some browsers, notably Safari, may evict site storage for sites not used recently unless the app is installed or persistent storage is granted. The app must request persistence, recommend installation, and prompt for exports (2.1). Document this in the user help.

Physical rendering uses viewport culling or chunked rendering as needed. Do not recompute the world on every pointer movement.

Measure benchmarks before setting hard release thresholds.

---

# 12. Release Boundaries

## MVP

Both editors, restricted domain:

- Browser application shell.
- Extracted versioned catalog (published channel).
- Canonical engineering model and command store.
- Logical schematic editor.
- 2D dual-grid physical editor.
- Bidirectional synchronization.
- Gas/liquid pipe connectivity.
- Device placements with verified connector geometry.
- Atmospheric analysis: at minimum the verified set in 13 #11.
- Validation diagnostics.
- Bill of materials (incomplete where recipes are missing).
- Offline project persistence.
- Import/export.

**The MVP does not promise dynamic phase-change or thermal simulation.**

If connector geometry cannot be extracted or captured by M0 (16.2), the MVP scope must be re-planned before M2 begins.

## Post-MVP

- Expanded atmospheric device simulation.
- Thermal/phase-change modeling.
- Electrical circuit analysis.
- Manufacturing optimization.
- IC10 generation and execution.
- Advanced scenario simulation.
- 3D visualization.
- Mod content support.
- Optional community integrations.

---

# 13. MVP Acceptance Criteria

1. The SPA operates offline after installation.
2. A published game-data pack loads successfully.
3. Every displayed property shows provenance and quality level.
4. A user can create a system schematic.
5. The same equipment can be placed into a physical grid.
6. Component identity persists across both views.
7. Connector geometry and orientation are validated.
8. Pipe routing updates logical network connectivity.
9. Removing a pipe segment correctly separates networks.
10. Unrouted and conflicting intents are identified.
11. These calculations are Verified and match fixtures within tolerance, across their declared envelopes, in every supported browser engine: (a) shared-volume pipe network volume for supported pipe types; (b) gas pressure and partial pressures for a single network from moles, species, and thermal state.
12. Unsupported or Conceptual results cannot be reported as exact.
13. Material quantities reflect placed equipment and routing, and list any missing recipes.
14. Projects survive browser reload.
15. Project import/export preserves both representations and intents.
16. Game-version mismatches are detected and re-targeting works (2.4).
17. Extraction and normalization outputs are reproducible.
18. Automated regression tests pass for the supported feature set.

**Release policy:** A Verified feature with failing fixtures blocks release. An unsupported feature does not block release if it is isolated and labeled.

---

# 14. Success Definition

The product succeeds when players can build a meaningful system as a schematic, lay it out on a game-aligned grid, calculate supported operating requirements, identify design problems, and generate a useful construction plan — without trusting fabricated data or running a backend service.

The long-term objective is broad game-mechanics coverage. The initial objective is a narrow, trustworthy system that can expand without redesigning its foundation.

---

# 15. Architectural Risks

**Physical geometry extraction.** Stationpedia metadata may not expose orientation-dependent connector positions, footprints, or occupancy rules. EXT-05 resolves this in M0. If unavailable, Adapter C populates geometry through runtime inspection and verified placement fixtures. Never invent geometry.

**Behavior extraction.** Reading device properties is far easier than reproducing the update cycle. The reference harness (SIM-01) starts in M0, before the physics engine, so "exact" stays a tested property rather than an assertion.

**Third-party extractor dependency.** Existing community extractor mods may break on game updates or carry incompatible licenses. Review licenses before reuse and keep a fallback (6.1).

**Data distribution.** Extraction can produce copyrighted text, icons, or assets. Keep packs independently versioned, publish only cleared content, and support user-generated packs for the rest (6.7, 6.8).

---

# 16. Implementation Backlog

Estimates are relative story points (SP), not calendar commitments. P0 = required for MVP. Items marked † are new or changed in v2.2; their SP are reviewer estimates and should be re-estimated by the team.

## 16.1 P0 items

| ID | Workstream | SP | Item | Depends on |
|---|---|---|---|---|
| FND-01 | Foundation | 3 | Initialize Vite monorepo, TypeScript, linting, tests, CI (incl. multi-engine Playwright) | — |
| FND-02 | Foundation | 8 | Canonical project, device, port, intent, and connection schemas | FND-01 |
| FND-03 | Foundation | 5 | Local storage, persistence request, migration, JSON import/export with 9.4 limits | FND-02 |
| FND-04 † | Foundation | 5 | Canonical store, command/patch log, revision IDs | FND-02 |
| FND-05 † | Foundation | 5 | Deterministic numeric library and revision-aware worker job infrastructure | FND-01 |
| EXT-01 | Extraction | 5 | XML configuration and recipe extractor | FND-01 |
| EXT-02 | Extraction | 8 | Runtime Stationpedia extractor adapter (license review + fallback plan) | FND-01 |
| EXT-03 | Extraction | 8 | Normalize data and create versioned pack manifests | EXT-01, EXT-02 |
| EXT-04 | Extraction | 5 | Semantic pack diff, provenance coverage, and behavior-model input invalidation | EXT-03, SIM-00 |
| EXT-05 † | Extraction | 8 | Spike: extract or capture footprints, connectors, orientations, grid sizes, pipe volumes for one pinned build | EXT-02 |
| DOM-01 | Domain | 8 | Typed ports, dual-grid placement, physical topology resolution | FND-02, EXT-05 |
| DOM-02 | Domain | 8 | Shared-volume network grouping, network volume, diagnostics | DOM-01 |
| SIM-00 † | Verification | 5 | Behavior-model registry, validity envelopes, status propagation | FND-02 |
| SIM-01 † | Verification | 8 | In-game reference fixture format and capture workflow (starts in M0) | FND-02 |
| SIM-02 | Verification | 8 | Verified atmospheric static calculations (13 #11) | DOM-02, SIM-00, SIM-01, FND-05 |
| SIM-03 | Verification | 5 | Results, model/topology status, and diagnostics UI | SIM-02, UI-01 |
| UI-01 | Editors | 5 | Application shell, component library, inspector | FND-02, EXT-03 |
| UI-02 † | Editors | 8 | Schematic editor with typed connections and intents | DOM-01, UI-01, FND-04 |
| UI-03 † | Editors | 13 | Multi-level 2D dual-grid placement and orientation | DOM-01, EXT-05, FND-04 |
| UI-04 | Editors | 13 | Pipe routing, connector snapping, collision checks | UI-03 |
| UI-05 † | Editors | 8 | Synchronize projections; Unplace/Delete semantics (store now in FND-04) | UI-02, UI-04 |
| BLD-01 † | Build tools | 5 | Aggregate routed elements into bill of materials | UI-04, EXT-01, EXT-03 |
| QA-01 | Release | 8 | Golden fixture regression suite and dual-editor E2E tests | UI-05, SIM-02 |
| QA-02 | Release | 5 | PWA/offline behavior, storage durability, performance, release checks | FND-03, QA-01 |

**P0 total: 24 items, 167 SP** (v2.0: 20 items, 149 SP; +5 FND-04, +5 FND-05, +8 EXT-05, +5 SIM-00, −5 UI-05).

Note: v2.0's tracker reported 24 total items with 20 visible; the 4 hidden post-MVP items (60 SP) are not listed in the source and must be added.

## 16.2 Milestones and release gates

| Milestone | Deliverable | Exit criterion |
|---|---|---|
| M0 | Extraction and verification feasibility | Reproducible catalog with stable IDs; EXT-05 go/no-go on geometry and pipe volume; fixture capture workflow proven on one scenario |
| M1 | Engineering foundation | Typed domain model, canonical store, network resolution, persistence |
| M2 | Dual editors | Schematic and grid editing synchronized without identity or intent loss |
| M3 | Verified atmospherics | 13 #11 calculations match fixtures in every supported engine |
| M4 | MVP release | Offline operation, valid materials lists, end-to-end workflow tests |
| M5 | Expanded simulation | Verified device transfer and transient behaviors |

---

# 17. Recommended First Development Increment

## Vertical slice: Pipe Network Designer

**Definition of done:** Place two supported components; connect them in the schematic (intent); build the physical route; resolve the network and its volume; enter a scenario (gas species, moles, thermal state); calculate a verified pressure result; generate material quantities; persist and reload the design with identical results.

The first implementation task is EXT-05 plus SIM-01: prove extraction of device identity, connector geometry, and pipe volume from one pinned build, and capture one reference fixture for the slice's pressure calculation. The rest of the foundation builds on that, not on speculative game data.

---

# Appendix A. Research Findings (Background)

- Stationeers stores configurable data, including recipes and world settings, as XML under `rocketstation_Data/StreamingAssets/Data` and `Worlds`. (Source: Stationeers modding documentation.)
- WikiExtractorMod — https://github.com/Stationeers-ic/WikiExtractorMod — is an existing BepInEx extractor for Stationpedia content, game constants, logic values, and assets. License and maintenance status to be reviewed (15).
- stationeers-pedia — https://github.com/NotFastJustLoud92/stationeers-pedia — demonstrates runtime extraction of Stationpedia metadata, including a headless approach for text. License and maintenance status to be reviewed (15).
- Extracting device properties does not extract behavior; some mechanics exist only in compiled code or runtime systems, requiring the verification process in 6.1 Adapter D.
- Stationeers deliberately simplifies compression, thermal transfer, fluid flow, and phase change. An exact simulator must reproduce those game rules, not real-world thermodynamics. (Source: Stationeers Community Wiki.)

**End of specification v2.2.**
