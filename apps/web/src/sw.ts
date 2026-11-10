import { APP_VERSION } from './pwa/appInfo';
import {
  APP_SHELL_PATH,
  OFFLINE_FALLBACK_BODY,
  SKIP_WAITING_MESSAGE,
  cacheNames,
  isCacheableAssetRequest,
  isNavigationRequest,
  navigationFallbackPath,
  staleCaches,
  withoutVary,
} from './pwa/swPolicy';

/**
 * Offline app shell (spec 2.1 "Service Worker for offline resources", 11;
 * backlog QA-02).
 *
 * `vite-plugin-pwa`'s `injectManifest` strategy bundles this file and replaces
 * `self.__WB_MANIFEST` with the hashed build assets, so the precache list is
 * exactly what this build emitted. The policy lives in `./pwa/swPolicy.ts`
 * (pure, unit-tested); this file only performs Cache API calls:
 *
 * 1. install  — precache the app shell (`index.html`, JS, CSS, bundled fonts,
 *               icons, the web app manifest) into a build-versioned cache.
 * 2. activate — delete earlier builds' caches (ours only), then take control.
 * 3. fetch    — navigations to app routes: network first, cached shell when
 *               offline; same-origin assets: stale-while-revalidate; everything
 *               else (API-shaped, JSON, cross-origin, non-GET) passes through.
 * 4. message  — `SKIP_WAITING` from the update prompt ("a new version is
 *               available — reload").
 *
 * Typing note: the worker globals are described by the local interfaces below
 * instead of `lib.webworker`, because the repository typechecks the DOM app and
 * the SW in one program and those libs collide.
 */

interface PrecacheEntry {
  readonly url: string;
  readonly revision?: string | null;
}

interface ExtendableEventLike extends Event {
  waitUntil(promise: Promise<unknown>): void;
}

interface FetchEventLike extends ExtendableEventLike {
  readonly request: Request;
  respondWith(response: Promise<Response> | Response): void;
}

interface MessageEventLike extends Event {
  readonly data: unknown;
}

interface SwClientLike {
  readonly id: string;
  postMessage(message: unknown): void;
}

interface SwScopeLike {
  addEventListener(type: string, listener: (event: unknown) => void): void;
  skipWaiting(): Promise<void>;
  readonly clients: {
    claim(): Promise<void>;
    matchAll(options?: {
      type?: string;
      includeUncontrolled?: boolean;
    }): Promise<SwClientLike[]>;
  };
}

const scope = self as unknown as SwScopeLike;
const names = cacheNames(APP_VERSION);

/** Assets to precache. The shell document is always included, so an offline
 * reload can never land on a blank page. */
function precacheUrls(): string[] {
  // Written as a literal `self.__WB_MANIFEST` on purpose: workbox's
  // injectManifest replaces that exact expression after bundling (type
  // assertions are erased, so this survives as the literal token).
  const manifest =
    (self as unknown as { __WB_MANIFEST?: readonly PrecacheEntry[] })
      .__WB_MANIFEST ?? [];
  const urls = manifest.map((entry) => entry.url);
  // Compare RESOLVED paths: the injected list is relative (`index.html`), and
  // `Cache.addAll` rejects a list containing the same request twice.
  const paths = new Set(
    urls.map((url) => new URL(url, self.location.origin).pathname),
  );
  return paths.has(APP_SHELL_PATH) ? urls : [APP_SHELL_PATH, ...urls];
}

/**
 * Fetches and stores the app shell. `addAll` is deliberately not used: it
 * rejects on duplicate/invalid entries and stores `Vary` verbatim, which makes
 * later lookups miss against hosts that add `Vary: Origin`.
 */
async function precache(): Promise<void> {
  const cache = await caches.open(names.precache);
  await Promise.all(
    precacheUrls().map(async (url) => {
      const absolute = new URL(url, self.location.origin).href;
      const response = await fetch(absolute, { cache: 'reload' });
      if (!response.ok) {
        throw new Error(`Precache failed for ${absolute} (${response.status})`);
      }
      await cache.put(
        absolute,
        new Response(await response.blob(), {
          status: response.status,
          statusText: response.statusText,
          headers: withoutVary(response.headers),
        }),
      );
    }),
  );
}

async function cleanupCaches(): Promise<void> {
  const existing = await caches.keys();
  const stale = staleCaches(existing, APP_VERSION);
  await Promise.all(stale.map((name) => caches.delete(name)));
}

/** Network first, cached shell second: the shell renders any SPA route. */
async function navigationResponse(request: Request): Promise<Response> {
  try {
    return await fetch(request);
  } catch {
    const shell = await caches.match(APP_SHELL_PATH, {
      cacheName: names.precache,
    });
    if (shell !== undefined) return shell;
    return new Response(OFFLINE_FALLBACK_BODY, {
      status: 503,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }
}

/**
 * Stale-while-revalidate for same-origin assets: instant from cache, refreshed
 * in the background. Only `ok` responses are stored (never opaque cross-origin
 * payloads or error pages).
 */
async function assetResponse(
  event: FetchEventLike,
  request: Request,
): Promise<Response> {
  const cache = await caches.open(names.runtime);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then(async (response) => {
      if (response.ok) {
        const stored = new Response(await response.clone().blob(), {
          status: response.status,
          statusText: response.statusText,
          headers: withoutVary(response.headers),
        });
        await cache.put(request, stored);
      }
      return response;
    })
    .catch(() => undefined);
  if (cached !== undefined) {
    event.waitUntil(network);
    return cached;
  }
  const response = await network;
  if (response !== undefined) return response;
  // No cache entry and no network: an explicit failure beats a half-rendered
  // page pretending the asset exists.
  return new Response('', { status: 504, statusText: 'Offline and not cached' });
}

scope.addEventListener('install', (event) => {
  // No skipWaiting here: the update prompt decides when to swap builds (11).
  (event as ExtendableEventLike).waitUntil(precache());
});

scope.addEventListener('activate', (event) => {
  (event as ExtendableEventLike).waitUntil(
    (async () => {
      await cleanupCaches();
      await scope.clients.claim();
    })(),
  );
});

scope.addEventListener('message', (event) => {
  if ((event as MessageEventLike).data === SKIP_WAITING_MESSAGE) {
    void scope.skipWaiting();
  }
});

scope.addEventListener('fetch', (event) => {
  const fetchEvent = event as FetchEventLike;
  const { request } = fetchEvent;

  if (isNavigationRequest(request)) {
    // Unknown paths keep their real answer instead of being served the shell.
    const fallback = navigationFallbackPath(new URL(request.url).pathname);
    if (fallback === undefined) return;
    fetchEvent.respondWith(navigationResponse(request));
    return;
  }

  const accept = request.headers.get('accept')?.toLowerCase();
  const cacheable = isCacheableAssetRequest(
    {
      url: request.url,
      method: request.method,
      mode: request.mode,
      accept,
    },
    self.location.origin,
  );
  if (!cacheable) return;

  fetchEvent.respondWith(
    (async () => {
      // Precache hits are content-hashed: cache first, no revalidation.
      const precached = await caches.match(request, {
        cacheName: names.precache,
      });
      if (precached !== undefined) return precached;
      return assetResponse(fetchEvent, request);
    })(),
  );
});
