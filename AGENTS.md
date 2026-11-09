# Stationeers Engineer — Agent Working Guide

Offline-first engineering calculator and dual-editor workbench (logical schematic + physical grid) for the game Stationeers.

The authoritative product spec is `docs/spec/stationeers-engineer-spec-v2.2.md` — read the sections relevant to your task before implementing. The working backlog is `docs/plan/BACKLOG.md`; the spec-to-code architecture map is `docs/plan/ARCHITECTURE.md`.

## Commands

- `bun install` — install workspace dependencies (Bun is the runtime and package manager)
- `bun run dev` — Vite dev server (apps/web)
- `bun run build` — production build
- `bun run test` — Vitest across all packages
- `bun run typecheck` — one tsc program over the whole monorepo
- `bun tools/extractor/src/cli.ts --help` — extraction CLI

Run `bun run typecheck && bun run test` before finishing any change; every backlog item ships with its tests (spec 10.1).

## Repository layout (spec 2.2 layering)

| Path | Layer | Owns |
|---|---|---|
| `packages/domain` | Domain model | Entities (contract: `src/entities.ts`), Zod schemas, canonical store (FND-04) |
| `packages/engine` | Engineering engine | Deterministic numerics, behavior models, calculations, worker jobs |
| `packages/packs` | Game data (runtime) | Pack schema, loading, semantic diff |
| `packages/persistence` | Persistence | IndexedDB store, migrations, import/export |
| `apps/web` | Presentation | React SPA, editors, inspectors |
| `tools/extractor` | Game data (build-time) | Extraction adapters A–D, normalization, pack manifests |

Packages import each other by workspace name (`@stationeers/domain`, …). Package `exports` point at TS source — there is no per-package build step.

## Hard rules (spec citations; violations are review blockers)

1. React Flow, PixiJS, and Zustand state are never the authoritative project data model (2.2). The canonical model lives in `packages/domain`.
2. Model status (verified / unverified / unsupported / incompatible) and topology status (buildable / conceptual) are separate, independently reported statuses (3.5, 5.2). Never label an Unverified or Conceptual result as exact; unsupported is never a pass.
3. A Verified calculation may consume only `extracted-and-validated` pack properties (6.5); anything else downgrades the result to Unverified with a diagnostic naming the input.
4. Never invent game geometry, constants, or behavior (6.1 Adapter C). Missing data is reported explicitly, not fabricated or defaulted (4.7, 7.6).
5. Determinism (5.1.1): transcendental/power math goes through `packages/engine` numerics, never `Math.*`; apply fround at the game-precision points the behavior model documents.
6. Derived entities (resolved networks, rooms, intent topology status) are computed on load, never serialized (9.1).
7. Extraction runs only on clean vanilla installs; mod content is out of scope for MVP (6.3).
8. Imported projects and packs are untrusted (9.4): size and decompressed-size limits, schema validation before migration, bounded graphs, no code execution, sanitized strings, content hashes.

## Conventions

- TypeScript strict, `noUncheckedIndexedAccess` on. Prefer plain data + functions over classes in domain/engine code.
- Zod (v3 API) for every runtime validation boundary.
- Conventional Commits, one logical change per commit.
- Diagnostics carry stable codes, severity, affected entity IDs, and the source rule (8).
