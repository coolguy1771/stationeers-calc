# Offline behaviour, installability and performance (QA-02)

Backlog item **QA-02** — PWA/offline, storage durability, performance, release
checks (spec §11, §2.1 "data durability", §9.4, §10.1). This document records
what the app caches and why, how updates reach the user, what each browser does
to local storage, how to run the checks, and the measured baseline on named
hardware. Nothing here sets a release threshold: spec §11 says *"measure
benchmarks before setting hard release thresholds"*.

Code map:

| Concern | Where |
|---|---|
| Web app manifest + icons | `apps/web/public/manifest.webmanifest`, `apps/web/public/icons/` |
| Icon generator (design-token derived) | `apps/web/scripts/generate-icons.ts` |
| Service worker | `apps/web/src/sw.ts` (bundled/injected by `vite-plugin-pwa`) |
| Caching policy (pure, unit-tested) | `apps/web/src/pwa/swPolicy.ts` |
| Registration + update prompt state machine | `apps/web/src/pwa/registration.ts` |
| Storage/settings panel | `apps/web/src/routes/SettingsPage.tsx`, `apps/web/src/components/settings/StoragePanel.tsx` |
| Storage probe | `apps/web/src/state/storageDurability.ts` |
| Perf seed + measurements | `apps/web/src/perf/`, `apps/web/src/routes/PerfPage.tsx` |
| Browser checks | `apps/web/e2e/offline.spec.ts`, `apps/web/scripts/offline-smoke.ts`, `apps/web/scripts/perf-baseline.ts` |

---

## 1. What is precached, and why

The build emits a service worker (`dist/sw.js`, ~10.6 kB including the injected list) whose precache list is
generated at build time by `vite-plugin-pwa`'s `injectManifest` strategy, so it
matches exactly what that build produced — currently **65 entries, ~2.0 MB**:

| Precache entry group | Why |
|---|---|
| `index.html` | The SPA document. Every route is rendered from it. |
| `assets/index-<hash>.js`, `.css` | The application shell; without them the document paints nothing. |
| `assets/*.woff2`, `*.woff` (56 files) | IBM Plex bundled by `@fontsource` (spec §13 #1). The UI must not depend on a font CDN, and the editor is unreadable with a fallback face. |
| `icons/*.png`, `icons/mark.svg` | Install and launcher identity; also requested by `index.html`. |
| `manifest.webmanifest` | Needed for install state and the theme colour after an offline start. |
| `sw.js` | **Not** precached (it *is* the worker). |

Two caches exist per build, both named `stationeers-engineer-<kind>-<version>`
where `<version>` is `apps/web/package.json`'s version (injected as
`import.meta.env.VITE_APP_VERSION`):

- **precache** — the shell entries above, content-hashed and therefore
  immutable. Served cache-first with no revalidation.
- **runtime** — same-origin assets that were not in the precache list (for
  example an icon added by a later deploy, or a font subset requested before
  install finished), stored stale-while-revalidate. Only `ok` responses are
  stored.

Precaching is done with `fetch(url, { cache: 'reload' })` + `cache.put` rather
than `Cache.addAll` for two reasons that both bit during development:

1. `addAll` rejects the whole list on a duplicate entry, and workbox's injected
   list is *relative* (`index.html`) while the shell constant is absolute
   (`/index.html`).
2. `addAll` stores `Vary` verbatim. Static hosts frequently answer with
   `Vary: Origin` (Vite's own preview server does), and Cache matching honours
   `Vary` — so an entry stored at install time would **miss** for a page request
   whose headers differ, leaving an app that looks broken offline with the bytes
   sitting in the cache. `withoutVary()` in `src/pwa/swPolicy.ts` strips it; a
   content-hashed asset is the same bytes for everyone.

**Guards (nothing is cached blindly).** `isCacheableAssetRequest()` in
`src/pwa/swPolicy.ts` only lets through same-origin `GET` requests that are not
navigations, not API-shaped (`/api/…`, `/graphql…`, `*.json`) and not JSON
consumers (`Accept: application/json`). Everything else — cross-origin,
non-GET, data — goes straight to the network. The app has no API today; the
guard exists so adding one cannot silently break offline correctness. Unit
tests: `src/pwa/swPolicy.test.ts`, plus the end-to-end worker test in
`src/sw.test.ts`.

**Offline navigation.** A document request (`request.mode === 'navigate'`) is
network-first; when the network fails the cached `index.html` is served, so the
SPA renders whatever route was asked for. Only routes the SPA owns fall back:
`/`, `/design`, `/settings`, `/perf`, `/project/:id[/…]`
(`navigationFallbackPath()`); unknown paths keep their real answer instead of
being disguised as the app. If the shell is somehow not cached, the worker
answers **503 with an explicit message** rather than a blank page.

**Installability.** `public/manifest.webmanifest` declares
`name`/`short_name`/`description`, `start_url` and `scope` `/`,
`display: standalone`, a maskable 512 icon, and
`theme_color = background_color = #0d1012`, which is the `--background` design
token (UI-01) converted from OKLCH. `index.html` links the manifest, the theme
colour, the SVG mark and a 180 px `apple-touch-icon`. Icons are generated from
the same tokens by `bun run --cwd apps/web icons` and committed; the mark is a
plain geometric T-junction with three port dots — **no game assets** (spec §6.8).

---

## 2. The update flow

`registerType: 'prompt'` semantics, implemented in `src/pwa/registration.ts`
(state machine) and `src/pwa/serviceWorkerClient.ts` (page singleton):

1. `main.tsx` calls `startServiceWorker()` **before** the first render. In `vite
   dev` nothing is registered — a worker cached from an earlier production build
   would serve stale code against Vite's module graph — and the app reports the
   honest `unsupported` state.
2. `container.register('/sw.js', { scope: '/' })` → installing → `ready`.
3. The worker **does not** call `skipWaiting()` on install. A newly installed
   worker whose predecessor still controls the page becomes *waiting*, and the
   app moves to `update-available`.
4. The shell renders a banner — *"A new version … is available. Reload to use
   it — saved projects stay in this browser."* — with **Reload** and dismiss.
   Dismissing keeps the new build installed; it does not nag again for that
   build.
5. **Reload** posts `SKIP_WAITING` to the waiting worker. The worker activates,
   `activate` deletes every `stationeers-engineer-*` cache from earlier builds
   (foreign caches are never touched), calls `clients.claim()`, and the page
   reloads on the browser's `controllerchange`. The reload happens **only** when
   the user asks: an engineer mid-edit must not lose the canvas to a background
   deploy.
6. Settings → *Offline app shell* shows the same state and offers *Check for
   updates* (`registration.update()`), which can surface `update-available`
   without waiting for a page load.

Cache version = app version, so **bump `apps/web/package.json` when the shell
changes shape**; a same-version redeploy still refreshes the precache (the
worker bytes change, which is what triggers the update prompt), but keeping the
version honest keeps `role="alert"` diagnostics and the panel's version display
truthful. Stale-cache deletion is tested in
`src/pwa/swPolicy.test.ts` (`staleCaches`) and `src/sw.test.ts` (activate).

---

## 3. Storage durability per browser (spec §2.1, §11)

Projects live in IndexedDB on this device. There is no account and no server
copy, so eviction is data loss. The app therefore:

- requests persistent storage on the first successful save
  (`state/persistence.ts`) and shows the answer;
- offers a request action again on the Settings page, with the current grant
  state, `navigator.storage.estimate()` usage/quota, and a warning at **75 %**
  (`STORAGE_HIGH_RATIO`) and an "export now" escalation at **90 %**
  (`STORAGE_CRITICAL_RATIO`);
- nudges an export after 25 committed revisions (`state/exportPrompt.ts`) and
  links the export action from the storage panel;
- recommends installation, which is what actually changes Safari's behaviour.

| Browser | Persistent storage | Eviction risk |
|---|---|---|
| **Chromium (Chrome/Edge)** | `persist()` usually granted without a prompt when the site is installed or considered "engaging" | Not evicted once granted; otherwise the origin is evicted under storage pressure, oldest-unused first |
| **Firefox** | `persist()` prompts (or is granted from site-permission heuristics) | Not evicted once granted |
| **Safari (macOS/iOS)** | `navigator.storage.persist()` is not available in older versions; Safari 15.4+ exposes `persisted()`/`persist()` but grants by heuristic, not on request | **Uninstalled sites: script-written storage may be cleared after ~7 days without a visit.** Installed web apps (Add to Dock / Add to Home Screen) are exempt |
| **Any browser, private/incognito** | Never persistent | Cleared when the session ends — the panel reports `denied`, and export is the only backup |

Where the Storage API is missing (older Safari, jsdom, some embedded webviews)
every row says so explicitly rather than showing a zero: an unavailable API is
not "no data". See `readStorageDurability()` and
`src/components/settings/StoragePanel.test.tsx`.

Install guidance surfaced by the panel copy:

- **Chrome/Edge**: install icon in the omnibox, or ⋮ → *Apps → Install this
  site as an app*.
- **Safari (macOS 14+)**: *File → Add to Dock*.
- **iOS/iPadOS**: *Share → Add to Home Screen*.
- Installed copies open with no browser chrome (`display: standalone`), work
  offline from the cached shell, and are excluded from Safari's 7-day eviction.

Honest gap: the app cannot *force* durability. The panel, the export nudge and
this document are the mitigations the spec asks for.

---

## 4. Running the checks

```bash
bun install

# Offline smoke: build → serve dist → install the SW → cut the network → reload
bun run --cwd apps/web offline:smoke      # scripts/offline-smoke.ts

# Same check through the Playwright runner (chromium only)
bun run --cwd apps/web e2e                # build + playwright test
bun run --cwd apps/web e2e:offline        # only e2e/offline.spec.ts

# Performance baseline: build → serve dist → drive /perf in Chromium
bun run --cwd apps/web perf:baseline      # scripts/perf-baseline.ts

# Regenerate the committed icons after changing the mark or the design tokens
bun run --cwd apps/web icons
```

Playwright browsers are not vendored: `bunx playwright install chromium` once
per machine. When no browser is available both scripts print
`SKIPPED: no Chromium for Playwright in this environment` and exit 0 — a skip is
reported as a skip, never as a pass. The runner is not wired into CI (that is
QA-01's multi-engine matrix).

Manual check for installability: `bun run --cwd apps/web build && bun run --cwd
apps/web preview`, open the URL, then DevTools → *Application → Manifest* (all
icons resolved, installable) and *Application → Service Workers* (activated and
waiting for nothing). Both scripts drive the built `dist/`, not the dev server.

What the offline check asserts (`e2e/offlineCheck.ts`):

1. `/` loads and a service worker **controls** the page;
2. the manifest resolves and declares `display: standalone`;
3. after `context.setOffline(true)`, a **reload** renders the shell
   (`Stationeers Engineer` heading);
4. a deep route (`/project/mock.project.atmos/schematic`) opened offline mounts
   React inside `#root` — the shell answered, not a browser error page;
5. at least one `stationeers-engineer-*` cache exists.

`scripts/offline-smoke.ts` additionally checks the **update flow** end to end
(`runUpdateCheck` in `e2e/offlineCheck.ts`): it runs the app, rewrites the served
`sw.js` version stamp to publish a "new build" behind the running page, reloads
so the browser performs its update check, and asserts that the app **offers**
the reload (`[data-service-worker-update="available"]`) instead of swapping
builds silently. Clicking *Reload* must then hand the page to the new build —
asserted by the new build's caches being present afterwards (the old cache name
is gone, because `activate` cleaned it up). The Playwright spec cannot run this
phase: `vite preview` serves a fixed `dist/`, so the check mutates a temporary
copy instead.

Status in this environment: **both phases pass** — offline reload + deep route,
and the update prompt + accepted reload (Chromium 158.0.8127.18 headless shell,
downloaded with `bunx playwright install chromium`); the Playwright spec
(`bun run --cwd apps/web e2e`) passes as well (`1 passed`).

---

## 5. Measured performance baseline (spec §11 "about 200 device instances")

Harness: `/perf` (not linked in the UI) seeds the canonical store with a
deterministic synthetic project — 200 device instances, 200 placements, 199
confirmed intents — draws the real `SchematicCanvas`, and measures:

- **seed** — `swapProjectInStore()` (includes `createStore` schema validation);
- **first canvas render** — seed → the frame that first paints the canvas;
- **drag commit** — one drag-stop layout commit (`setNodePosition` command →
  React re-render of the projection → next painted frame), 20 samples. React
  Flow moves the node locally while the pointer is down, and the editor commits
  once at drag stop (`state/schematicLayout.ts`, 250 ms debounce), so this is
  the per-drag cost the app adds — **not** the per-pointer-move cost, which is
  React Flow's own transform (spec §11: "Do not recompute the world on every
  pointer movement" — already satisfied by construction);
- **intent topology derivation** — reported separately so a slow canvas is not
  blamed on the derived statuses (§9.1: derived, never serialized).

**Environment:** Apple M1 Max · macOS 27.2 · Bun 1.4.4 · production build
(`bun run --cwd apps/web build`) · Playwright Chromium headless shell
158.0.8127.18 (software rasterizer, no GPU) · viewport 1600×1000 · 10 logical
cores.

| Measurement | Run 1 | Run 2 |
|---|---|---|
| Seed (`swapProjectInStore`) | 3.5 ms | 2.7 ms |
| First canvas render (200 nodes, 199 edges) | 102.9 ms | 108.4 ms |
| Drag commit — median | 50.0 ms | 50.0 ms |
| Drag commit — p95 / max | 62.9 / 63.5 ms | 68.4 / 82.9 ms |
| Intent topology derivation (199 intents) | 0.6 ms | 0.7 ms |

Reading the numbers (deliberately no pass/fail line):

- Initial draw of 200 nodes is ~0.1 s — acceptable for opening a project, and it
  is one-off.
- A drag *stop* costs ~50 ms of main thread (~3 frames at 60 Hz), i.e. one
  visible hitch per drag, not sustained jank. In a headed, GPU-accelerated
  browser this should be lower, but that has **not** been measured here (no
  display in this environment), so the table stands as the pessimistic baseline.
- The derivation of 199 intent statuses is noise (<1 ms); the cost is React
  Flow's reconciliation of 200 nodes + 199 edges, not our model code.

### Viewport culling / chunked rendering: what is needed now vs deferred

Spec §11: *"Physical rendering uses viewport culling or chunked rendering as
needed."* Decision for now: **no culling, no chunking** — and here is the
evidence and the trigger for revisiting it:

- **Not needed now**: 200 instances draw in ~0.1 s and each drag-stop commit is
  ~50 ms in software rendering; there is no per-pointer-move recomputation to
  optimise (the canvas is a projection rebuilt per committed revision, and drags
  commit once at stop). Adding culling today would add a second source of truth
  about what is on screen for no measured win at the spec's target size.
- **Deferred, with a trigger**: if the baseline for 200 instances exceeds ~100 ms
  per drag commit on a reference desktop, or the product needs >500 instances,
  do these in order: (1) memoize node data/edge arrays so unchanged nodes skip
  re-render on a layout-only revision; (2) viewport culling of off-screen nodes
  and edges (React Flow `onlyRenderVisibleElements`); (3) chunked rendering of
  the physical grid editor when UI-03/UI-04 land with PixiJS; (4) move derived
  work (intent topology, network resolution) into the worker once DOM-01/SIM-02
  exist. Each of these is a follow-up item, not part of QA-02.
- **Worker-backed analysis** (§11 "does not block editing") has nothing to
  schedule yet: SIM-02 owns the first real calculation. The harness page is the
  place to measure it when it lands.

---

## 6. Known gaps / handed to other items

- **QA-01** owns the browser matrix (Chromium/Firefox/WebKit, spec §5.5) and the
  golden-fixture E2E suite. This item ships a chromium-only Playwright config
  and one offline workflow; nothing is wired into CI.
- The offline and perf checks need `bunx playwright install chromium` on a new
  machine; scripts skip (exit 0) without it.
- **Worker-backed analysis performance** cannot be measured until SIM-02 lands
  (no calculations exist yet).
- **Safari eviction behaviour** is documented and handled in the UI, but not
  measured on real iOS hardware in this environment.
- `apps/web/package.json` version is the SW cache version; a release process
  must bump it when the shell changes (see §2).
- The `/perf` route ships in production on purpose (it is the only way to
  measure production numbers); it is not linked anywhere in the UI. If a future
  release gate wants it gone, `vite.config.ts` can drop it via a build-time
  `import.meta.env` guard — not done, because hiding the harness would make the
  documented baseline unreproducible.
