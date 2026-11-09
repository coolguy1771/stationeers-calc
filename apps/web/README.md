# @stationeers/web — UI foundation (UI-01)

App shell, design system, routing, and the status-vocabulary components for
Stationeers Engineer. Spec: `docs/spec/stationeers-engineer-spec-v2.2.md`.
Backlog: `docs/plan/BACKLOG.md`.

## Layout

```
src/
  components/ui/        shadcn/ui primitives (manually vendored, shadcn convention)
  components/status/    status vocabulary — the spec-critical part, see below
  components/           shared: Placeholder, ThemeToggle, SaveStatusIndicator, DiagnosticsPanel,
                        UndoRedoControls, ExportBundleButton, ResultRevisionTag,
                        DeviceInstanceChip/List
  routes/               pages: ProjectsPage, ProjectLayout (+ tab pages), DesignPage, NotFoundPage
  mocks/                the seeded demo Project + explicitly-mock catalog/result/diagnostics data
  state/                canonical store adapter, persistence, selection, transient UI state
  lib/                  cn, shortHash, formatRelativeTime, stubbedAction (TODO toasts)
```

Routes: `/` projects · `/project/:projectId/{schematic,physical,catalog,analysis}` ·
`/design` showcase · `*` not-found.

## Status semantics (do not regress these)

Two INDEPENDENT statuses ride every calculation result (spec 3.5, 5.2.2):

- **Model status** (`ModelStatusBadge`, filled chips): Verified / Unverified /
  Unsupported / Incompatible. Verified = green; **Unverified = dashed amber —
  experimental, never styled as success**; Unsupported = neutral gray; an
  unsupported result is not a pass; Incompatible = red.
- **Topology status** (`TopologyStatusBadge`, outline chips): Buildable (solid
  outline) / Conceptual (dotted outline). Different question, different visual
  language.

`ResultStatusSummary` renders both side by side and derives the single honest
verdict: **exact only when Verified AND Buildable**; Verified + Conceptual reads
“Correct mechanics — assumed topology”.

Also in `components/status/`: `DataQualityBadge` (6.5 levels, dot + mono label,
used per property row for provenance — spec 13 #3), `SeverityBadge` (8), and
`IntentStatusChip` (derived intent topology: Unrouted / Routed / Routed with
warnings / Conflicting / Not buildable — display only, intents are stored bare,
derivation is never serialized, 9.1).

## Design system

- shadcn/ui on Tailwind v4 with CSS variables. **Dark is the shipped default**:
  `:root` carries dark values, `index.html` sets `class="dark"`, and light is an
  opt-in `.light` override (toggle in the shell, persisted by `state/themeStore.ts`).
- Fonts are bundled (offline-first, 13 #1): IBM Plex Sans for UI, IBM Plex Mono
  for values/IDs/hashes; `tabular` utility for aligning numeric columns.
- One cyan accent; green/amber/red are reserved for status semantics.

## Canonical store, persistence and selection (read this first)

The project model lives in ONE canonical store (spec 2.2, 2.2.1; backlog
FND-04, landed in `packages/domain/src/store/`). React Flow, PixiJS and Zustand
never hold project data; they are projections.

- `state/projectStore.ts` — the store adapter. `projectStore` is the singleton
  `Store`; `useProjectSnapshot()` gives `{ project, revision, revisionId,
  canUndo, canRedo }` (re-renders per committed revision),
  `useProject()` gives the document, and mutations go through
  `dispatchProjectCommand(command)` (returns a `StoreResult`),
  `runProjectCommand(command)` (same, but toasts the stable `StoreError`),
  `undoProject()` / `redoProject()`. State is seeded from
  `mocks/demoProject.ts`.
- `state/persistence.ts` — autosave. `startPersistence()` (called once by the
  workspace shell) subscribes to revisions, writes debounced snapshots of the
  project through `@stationeers/persistence`, and reports
  `dirty | saving | saved | error` via `usePersistence()`; the first save
  requests persistent storage (2.1) and surfaces the answer. The union is
  `SaveStatus`, which `SaveStatusIndicator` renders.
- `state/undoRedo.ts` — `useUndoRedo()` (cursor → disabled states) and
  `useUndoRedoShortcuts()` (Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z; text fields keep
  their own undo). The shell's `UndoRedoControls` uses the same actions.
- `state/selection.ts` — the shared selection (SYNC-004): transient, so it lives
  in Zustand (`uiStore.selection`) behind `useSelection()` / `useSelect()` /
  `isSelected()`. `DeviceInstanceChip` is the one selectable device affordance;
  `DeviceInstanceList` is the shared instance list for both editors.
- `state/analysis.ts` — `useTaggedMockResult()` tags the mocked
  `CalculationResult` with the revision it was computed on and asks the store's
  `isStale()` whether the project has moved past it (5.6).
  `components/ResultRevisionTag` renders the tag or the stale notice.
- `state/exportProject.ts` — `buildProjectExport()` / `exportCurrentProject()`:
  the SHA-256 transfer envelope from `@stationeers/persistence` (9.4), built
  from `projectStore.state`.
- `state/uiStore.ts` — **transient UI state only** (2.1: active project, active
  tab, selection). Nothing project-shaped may be added to it.

### Known gaps (owned outside this app)

- The store has no command to touch `meta.updatedAt` (it never reads a clock,
  5.1.1). Persistence stamps the timestamp on the bundle it writes; exports
  carry whatever timestamp the store last loaded.
- `createAutosave().schedule(bundle)` needs the serialized bundle up front, so
  every commit pays a full `serializeProject` (schema validation) even when the
  debounce coalesces writes. A `schedule(() => bundle)` variant would move that
  cost to write time.
- `createAutosave` reports `saving` as soon as a write is *queued*, and has no
  "pending" state, so `state/persistence.ts` overrides that synchronous event
  to keep `dirty` honest during the debounce window.
- One project per session: listing, creating, renaming and deleting persisted
  projects (7.1) is not wired yet, and the import affordance is still a stub.

## Notes for the next person

- All source files import relatively on purpose. The `@/*` alias is configured
  in `apps/web/tsconfig.json` + `apps/web/vite.config.ts`, but the root
  `vitest.config.ts` and root `tsconfig.json` (both outside this app's scope)
  carry no alias — anything a test imports transitively would fail to resolve.
  Using `@/` here requires adding the alias to those root configs first.
- Tests run under the root vitest config (`environment: node`); component tests
  opt into jsdom with the per-file pragma `// @vitest-environment jsdom`. Tests
  that let autosave write for real import `fake-indexeddb/auto` first
  (`routes/projectWorkspace.test.tsx`); `state/persistence.test.ts` injects a
  Dexie-shaped fake instead.
- Stubbed affordances (create/rename/archive/delete projects, import, editor
  tools, run analysis) raise `stubbedAction(...)` toasts naming the owning
  backlog item. Export, undo/redo, save status, selection and intent deletion
  are real.
