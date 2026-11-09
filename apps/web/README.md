# @stationeers/web — UI foundation (UI-01)

App shell, design system, routing, and the status-vocabulary components for
Stationeers Engineer. Spec: `docs/spec/stationeers-engineer-spec-v2.2.md`.
Backlog: `docs/plan/BACKLOG.md`.

## Layout

```
src/
  components/ui/        shadcn/ui primitives (manually vendored, shadcn convention)
  components/status/    status vocabulary — the spec-critical part, see below
  components/           shared: Placeholder, ThemeToggle, SaveStatusIndicator, DiagnosticsPanel
  routes/               pages: ProjectsPage, ProjectLayout (+ tab pages), DesignPage, NotFoundPage
  mocks/                explicitly-mock data typed from @stationeers/domain (replaced by FND-04 selectors)
  state/                transient UI state ONLY (see seam below)
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

## The FND-04 seam (wave 2: read this first)

`src/state/uiStore.ts` is **transient UI state only** (spec 2.1: selection,
active tab, save-status placeholder). The canonical project model never enters
Zustand — it lives in the canonical store with a command/patch log and revision
IDs (spec 2.2.1, backlog FND-04). When FND-04 lands, replace the `src/mocks/`
exports with selectors over that store; the components above them should not
need changes. `SaveStatusIndicator` already consumes the placeholder machine
(`saved | dirty | saving | error`) that FND-03 will drive.

## Notes for the next person

- All source files import relatively on purpose. The `@/*` alias is configured
  in `apps/web/tsconfig.json` + `apps/web/vite.config.ts`, but the root
  `vitest.config.ts` and root `tsconfig.json` (both outside this app's scope)
  carry no alias — anything a test imports transitively would fail to resolve.
  Using `@/` here requires adding the alias to those root configs first.
- Tests run under the root vitest config (`environment: node`); component tests
  opt into jsdom with the per-file pragma `// @vitest-environment jsdom`.
- Stubbed affordances (create/rename/archive/delete, export, editor tools, run
  analysis) raise `stubbedAction(...)` toasts naming the owning backlog item.
