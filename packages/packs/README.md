# @stationeers/packs

Versioned game-data packs (spec §6.4, §6.5, §6.7). A pack is the only source of
game facts the rest of the app reads: recipes, items, device definitions, and the
quality/provenance of every one of their properties.

| Module | Owns |
|---|---|
| `schema.ts` | The pack manifest + payload contract (Zod), derived-count consistency, content hash field |
| `build.ts` | `buildPack` — extractor IR + install metadata → validated, frozen pack |
| `load.ts` | `loadPack`/`loadPackJson`/`loadPackBytes` — untrusted-input loading (§9.4) |
| `quality.ts` | The §6.5 levels, promotion input, property resolver, and the Verified link |
| `input.ts` | The extraction-input contract this package accepts (IR v2, coverage, manifest) |
| `diff.ts` | `diffPacks` — the semantic diff of two packs, and the §6.6 step 6 invalidation feed |
| `provenance-coverage.ts` | `provenanceCoverageReport` — §6.5 tallies, missing joins, and what blocks publishing |
| `invalidation.ts` | `planModelInvalidation` — applies a changelog to the behavior-model registry |

> [!WARNING]
> **Nothing is validated yet.** Every value a pack carries today is
> `extracted-unverified`, `missing`, or `conflicting` — Adapter A extracts
> numbers whose unit semantics have not been established, and no fixture suite
> has run. A pack therefore cannot back a *Verified* capability (§6.5), and no
> pack may be published until the prerequisites at the end of this file are met.

## Manifest (§6.4)

`buildPack` writes one JSON object: manifest fields, then `payload`.

| Field | Meaning |
|---|---|
| `packSchemaVersion` | Pack format version (currently `1`). Unknown versions are rejected, never coerced (§9.2) |
| `packId` | Derived: `stationeers-<branch>-<gameBuild>`; never caller-chosen |
| `gameBuild` | Full numeric build, e.g. `0.2.6428.27798` — not a marketing version |
| `gameBranch` | `stable` \| `beta`: the game branch the data came from |
| `channel` | `published` \| `user-generated` (§6.7) |
| `toolVersions` | `{ extractor, ir }` — extractor release and IR version that produced the data |
| `normalizationVersion` | Version of the normalizer that produced the IR (§6.2) |
| `sourceDigests` | Per-file SHA-256 + byte size of the install XML, plus digests of the IR and coverage documents |
| `extractionDate` | ISO-8601 UTC timestamp, supplied by the caller (never "now" from the builder) |
| `entityCounts` | `{ recipes, items, devices }`; must equal the payload (schema-enforced) |
| `behaviorModelCompatibility` | `{ status: not-declared \| compatible \| incompatible, … }`; defaults to `not-declared` |
| `coverage` | Counts, families mapped/unmapped, control elements, missing fields, diagnostic tallies, skipped files, `joins`, `unpacked` |
| `contentHash` | SHA-256 over the canonical JSON of the pack with `contentHash` removed |

Payload entities — `payload.recipes[]`, `payload.items[]`, `payload.devices[]` —
carry values in the game's own vocabulary and a `properties` map with one entry
per emitted property:

```json
{
  "id": "HydraulicPipeBenderRecipes/ItemKitDynamicCanister",
  "family": "HydraulicPipeBenderRecipes",
  "displayName": "",
  "output": { "prefabId": "ItemKitDynamicCanister", "quantity": { "text": ".5", "value": 0.5, "unitStatus": "unverified" } },
  "time": { "text": "20", "value": 20, "unitStatus": "unverified" },
  "provenance": { "sourceFile": "PipeBender.xml", "sourcePath": "/GameData/…/RecipeData[3]", "quality": "extracted-unverified" },
  "properties": {
    "displayName": { "quality": "missing", "notes": "the game XML carries no display name; Adapter B (Stationpedia) supplies it" },
    "output.quantity": { "quality": "extracted-unverified", "sourceFile": "PipeBender.xml", "sourcePath": "…/Output" },
    "time": { "quality": "extracted-unverified", "sourceFile": "PipeBender.xml", "sourcePath": "…/Recipe/Time" }
  }
}
```

Property paths mirror the extractor IR's `fieldProvenance` keys: `displayName`,
`output.prefabId`, `output.quantity`, `inputs[<n>].quantity`, `time`, `energy`,
`temperature.start|stop`, `pressure.start|stop`, `tier`; items add `category`;
devices add `sourceQuality`. Entries are written for every present value **and**
for required-but-absent ones (`displayName`, `output.quantity`) so an absent
value is never mistaken for a default.

## The §6.5 promotion rule

Every property has one of five levels: `extracted-and-validated`,
`extracted-unverified`, `missing`, `conflicting`, `inferred`.

**Nothing is promoted automatically.** The extractor's output is never trusted
as validated — if it ever claims `extracted-and-validated`, the builder
downgrades it to `extracted-unverified` and records why. The only route to
`extracted-and-validated` is an explicit promotion input:

```json
{
  "promotions": [
    {
      "entityType": "recipe",
      "entityId": "HydraulicPipeBenderRecipes/ItemKitDynamicCanister",
      "property": "time",
      "approvedBy": "alice",
      "approvedAt": "2025-11-10T00:00:00Z",
      "reference": "SIM-01 fixture smelter-tick/v1",
      "unit": "s"
    }
  ]
}
```

Rules the builder enforces (each with a stable `PACK-PROMOTION-*` code):

- The input is a **list of named properties**, not a switch. An empty list is a
  mistake and is rejected.
- The entity and property must exist in the pack. Promoting a value the source
  does not supply fails (`PACK-PROMOTION-MISSING-PROPERTY`).
- A property whose sources conflict cannot be validated until the conflict is
  resolved (`PACK-PROMOTION-CONFLICTING`).
- A quantity needs unit semantics. Adapter A cannot tell mass from count from
  moles, so the approval must name the unit it establishes (`"unit": "s"`), or
the value must already carry a verified unit. A unit that contradicts the
value's verified unit is rejected.
- The approval record (`approvedBy`, `approvedAt`, `reference`, `unit`) is stored
  on the property, so every validated value is traceable to who validated it and
  against what.

### The Verified link

```ts
import { assertCapabilityVerified } from '@stationeers/packs';

assertCapabilityVerified(pack, {
  id: 'smelter-throughput',
  consumes: [{ entityType: 'recipe', entityId: '…', property: 'time' }],
});
```

It throws `PackError` with code `PACK-CAPABILITY-UNVALIDATED-INPUT` when any
consumed property is not `extracted-and-validated`, listing each offending input
and its actual level. `propertyQuality` fails closed: an entity or property the
pack does not carry reads as `missing`. A capability that consumes unvalidated
data must be reported **Unverified**, never "exact" (§5.2, AGENTS.md #3).

## Channels (§6.7)

- `user-generated` — built by a user from their own install with
  `stationeers-extract pack`. Imported as a file and validated as untrusted input
  (§9.4). May carry locally extracted display names.
- `published` — distributed with the SPA. Only **stable-branch** builds may be
  published (`gameBranch: "stable"`); the builder and the schema both refuse a
  published beta pack. Publishing also requires the §6.8 review (see the end of
  this file).

## Building a pack from a clean vanilla install

```sh
# 1. Extract the install's Data directory (clean vanilla only, §6.3)
bun tools/extractor/src/cli.ts xml \
  "<SteamLibrary>/steamapps/common/Stationeers/rocketstation_Data/StreamingAssets/Data" \
  --out /tmp/stationeers-ir

# 2. Build + validate the pack
bun tools/extractor/src/cli.ts pack /tmp/stationeers-ir \
  --out /tmp/stationeers-pack.json \
  --build 0.2.6428.27798 \
  --branch stable \
  --date 2025-11-10T00:00:00Z \
  [--channel published|user-generated] \
  [--validated promotions.json]
```

The build number and branch are facts about the installation, not about the data
— `Data/` does not contain them, so the CLI takes them as arguments. Pin
`--date` for a byte-reproducible artifact: the same IR plus the same metadata
produces the same file and the same `contentHash` on every run.

## Loading (untrusted input, §9.4)

`loadPack`/`loadPackJson`/`loadPackBytes` check, in order: file-size cap
(16 MiB), JSON parse, `packSchemaVersion` (a future version is rejected with
`PACK-SCHEMA-FUTURE`, an older one without a migration with
`PACK-SCHEMA-UNSUPPORTED`), the full schema (bounded entity counts, no unknown
keys, counts must match the payload), the content hash (`PACK-HASH-MISMATCH`),
and data-quality invariants (`PACK-QUALITY-INVARIANT`: a validated value needs an
approval and a verified unit). The result is deep-frozen.

## Semantic diff (§6.6 steps 4–6)

```ts
import { diffPacks, planModelInvalidation, provenanceCoverageReport } from '@stationeers/packs';

const changelog = diffPacks(lastPublishedPack, candidatePack);
const report = provenanceCoverageReport(candidatePack, changelog);
const plan = planModelInvalidation(modelRegistry, changelog);
```

`diffPacks(previous, next)` is pure and deterministic: the same two packs always
produce the same changelog (byte-identical under `canonicalJson`), whatever the
payload order, property-map insertion order, or JSON key order. It reports:

| Changelog field | What moved |
|---|---|
| `entities[]` | Per entity type and stable id: `added` / `removed` / `changed`, with `properties[]` and `fields[]` |
| `properties[]` | Per property: `kinds` (`added`, `removed`, `value-changed`, `quality-changed`, `provenance-changed`), `before`/`after` entries, `beforeValue`/`afterValue`, `qualityChange` (with `direction`), and `invalidating` |
| `fields[]` | Entity data the property map does not address — ingredient names, recipe family, record-level provenance, device definition keys — as canonical JSON |
| `coverage` | Family mapping transitions, join transitions, control mappings, missing-field delta, per-code diagnostic deltas, §6.5/per-family counters, and source-file add/remove/change |
| `manifest` | `gameBuild`, `gameBranch`, `channel`, `toolVersions` (extractor + IR), `normalizationVersion`, `behaviorModelCompatibility`, `extractionDate`, `entityCounts` — each only when it moved |
| `invalidatingProperties` / `invalidatingConstants` | Sorted names of the inputs whose value or §6.5 level moved *downward* — the step 6 feed |
| `identical` | True when the two packs carry the same game data (entity, coverage, and manifest movement ignored for `extractionDate` and source digests) |

### What invalidates a model

`invalidatingProperties` is what §6.6 step 6 consumes, so its semantics are
deliberate:

- **A value change invalidates.** Including a quantity's unit semantics: `3` with
  an unknown unit and `3 s` are different inputs.
- **A quality downgrade invalidates.** `extracted-and-validated →
  extracted-unverified` (or unverified → missing, unverified → conflicting) means
  a model can no longer stand behind a Verified result. Levels are ranked
  `validated > inferred > unverified > missing > conflicting` (`QUALITY_RANK`).
- **A quality improvement does not invalidate.** `missing → unverified`,
  `unverified → validated`: nothing that was reported became wrong, so the model
  is reported but not marked. (An improvement that *also* lands a value is still
  a value change, and does invalidate on that basis.)
- **A pure provenance change does not invalidate.** Same value, same level, new
  source file/path or approval: the input the model reads is identical.
- **Appearing or disappearing values invalidate**, including every property of an
  added or removed entity. The feed is name-granular (models declare names, spec
  5.3), so this can over-invalidate a model that reads the same name on another
  entity — a needless re-verification, never a stale Verified result.

Properties and constants are separate namespaces end to end: a changed property
named `time` does not touch a model that consumes the *constant* `time`. The pack
format has no pack-level constants yet, so `invalidatingConstants` is always empty
today — reported as a gap rather than guessed at.

### Applying the diff (§6.6 step 6)

`planModelInvalidation(registry, changelog)` uses the engine's
`findModelsAffectedBy` (the one definition of "affected") and returns, per model:
the changed property/constant names it declared, its status before, the status to
record, and a one-line reason. Only a model that was `verified` is marked
`unverified`; `unverified` stays, and `unsupported`/`incompatible` are never
raised. The registry is not modified — the caller applies the statuses.

### Coverage and the publishing gate

`provenanceCoverageReport(pack, changelog?)` summarizes per entity type how many
property entries sit at each §6.5 level, how many moved (and how many of those
invalidate), which joins are supplied and which are missing, and returns
`blockers` — why the pack may not publish yet (`PUBLISH-NOTHING-VALIDATED`,
`PUBLISH-JOIN-MISSING`, `PUBLISH-DEVICES-EMPTY`, `PUBLISH-MISSING-FIELDS`,
`PUBLISH-FAMILY-UNMAPPED`, `PUBLISH-DIAGNOSTIC-ERROR`,
`PUBLISH-BRANCH-NOT-STABLE`, `PUBLISH-BEHAVIOR-MODELS-INCOMPATIBLE`). An empty
blocker list clears the gates *this report covers*; §6.8 legal review and the
human fixture capture sit outside it.

## What still blocks a published pack

1. **A clean vanilla install.** All extraction so far is calibrated against a
   modded install used as a *format* reference; no value from it may enter a
   published pack (§6.3, R18).
2. **Adapter B (EXT-02).** Display names, material→prefab joins, and
   family→machine joins do not exist in the XML. Until Adapter B supplies them,
   `coverage.joins` reports all three `missing`, every `displayName` is empty and
   marked `missing`, and ingredients are material names, not item ids.
3. **Validation (Adapter D / SIM-01).** No property is `extracted-and-validated`;
   unit semantics for quantities, times, energies, and thresholds are
   unestablished. The promotion input exists so a fixture-backed validation pass
   can record what it established — nothing has run yet.
4. **§6.8 legal review.** The EULA/modding-terms review must be recorded in the
   repository before any pack is published, and icons/descriptive text are
   excluded unless rights are cleared.
5. **Geometry (EXT-05).** `payload.devices` is empty: footprints, connectors, and
   orientations are not in the Stationpedia data (see
   `docs/plan/research-2025-11-09-extraction.md`).
