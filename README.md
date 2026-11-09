# Stationeers Engineer

Local-first engineering calculator, system designer, and simulation workbench for [Stationeers](https://store.steampowered.com/app/544850/Stationeers/): a logical schematic editor, a physical dual-grid layout editor, and an engine that reproduces verified game mechanics exactly — and says so when it can't.

**Status:** pre-MVP scaffold. Backlog and progress: `docs/plan/BACKLOG.md`. Product spec: `docs/spec/stationeers-engineer-spec-v2.2.md`.

## Quickstart

```sh
bun install
bun run dev        # Vite dev server (apps/web)
bun run test       # Vitest across all packages
bun run typecheck  # tsc over the whole monorepo
```

Requires Bun 1.2+.

## Layout

See `AGENTS.md` for the full layout table and working rules. Short version: `packages/domain` (model + schemas), `packages/engine` (deterministic numerics + calculations), `packages/packs` (game-data packs), `packages/persistence` (IndexedDB, import/export), `apps/web` (React SPA), `tools/extractor` (build-time data extraction).

## Principles

Exact for supported, verified mechanics; explicitly unsupported for everything else. Offline-first. Extract, don't transcribe. Every result shows its inputs, assumptions, provenance, and verification status.
