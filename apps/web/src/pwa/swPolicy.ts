/**
 * Service-worker caching policy (spec 2.1, 11; backlog QA-02).
 *
 * Every decision about WHAT is cached, WHICH caches belong to the running
 * build, and WHICH navigations fall back to the app shell lives here as pure
 * functions. `src/sw.ts` does the Cache API work and nothing else, so the
 * policy is unit-tested without a service-worker environment.
 */

/** Prefix of every Cache API cache this app owns. */
export const CACHE_PREFIX = 'stationeers-engineer';

/** Document served for an offline navigation to an app route. */
export const APP_SHELL_PATH = '/index.html';

/** Reply when offline and the shell is somehow not cached: explicit, not blank. */
export const OFFLINE_FALLBACK_BODY =
  '<!doctype html><title>Stationeers Engineer — offline</title>' +
  '<p>The app shell is not cached yet. Open the app once while online, then reload.</p>';

/** Cache names for one build. A new version never reuses another build's cache. */
export function cacheNames(version: string): { precache: string; runtime: string } {
  return {
    precache: `${CACHE_PREFIX}-precache-${version}`,
    runtime: `${CACHE_PREFIX}-runtime-${version}`,
  };
}

/** Caches owned by this app, i.e. the only ones activation may delete. */
export function isOwnedCache(name: string): boolean {
  return name.startsWith(`${CACHE_PREFIX}-`);
}

/**
 * Versioned cache cleanup (activate): every cache this app owns that the
 * running build does not use. Foreign caches are never touched.
 */
export function staleCaches(existing: readonly string[], version: string): string[] {
  const keep = new Set(Object.values(cacheNames(version)));
  return existing.filter((name) => isOwnedCache(name) && !keep.has(name));
}

/**
 * Routes the SPA owns (11: `/`, `/project/:id/*`, `/design`; plus the settings
 * panel and the diagnostic perf harness). These are the paths a document
 * navigation may serve the cached shell for.
 */
const APP_ROUTES: readonly RegExp[] = [
  /^\/$/,
  /^\/design\/?$/,
  /^\/settings\/?$/,
  /^\/perf\/?$/,
  /^\/project\/[^/]+(?:\/[^/]+)*\/?$/,
];

/** True when `pathname` is a client-side route of this app. */
export function isAppRoute(pathname: string): boolean {
  return APP_ROUTES.some((pattern) => pattern.test(pathname));
}

/**
 * Offline navigation fallback: the cached shell for app routes, `undefined` for
 * everything else (unknown paths and asset URLs keep their real answer instead
 * of being disguised as the app).
 */
export function navigationFallbackPath(pathname: string): string | undefined {
  return isAppRoute(pathname) ? APP_SHELL_PATH : undefined;
}

/** A document navigation, i.e. a request for a page rather than an asset. */
export function isNavigationRequest(request: { readonly mode: string }): boolean {
  return request.mode === 'navigate';
}

/**
 * API-ish paths and media are never cached blindly: they are data, not app
 * shell, and a stale copy would be a lie about the server's answer. The app has
 * no API today; the guard exists so adding one cannot silently break offline
 * correctness.
 */
export function isApiLikePath(pathname: string): boolean {
  return (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/graphql') ||
    pathname.endsWith('.json')
  );
}

export interface AssetRequestLike {
  readonly url: string;
  readonly method: string;
  readonly mode: string;
  /** `Accept` header, already lowercased; absent header is fine. */
  readonly accept?: string | undefined;
}

/**
 * Runtime caching gate for built assets: same-origin GETs for the app shell
 * only. Navigations (shell fallback), API-shaped paths, JSON consumers,
 * cross-origin requests and non-GET methods pass straight through to the
 * network.
 */
export function isCacheableAssetRequest(
  request: AssetRequestLike,
  origin: string,
): boolean {
  if (request.method !== 'GET') return false;
  if (isNavigationRequest(request)) return false;
  if (request.accept?.includes('application/json') === true) return false;
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return false;
  }
  if (url.origin !== origin) return false;
  return !isApiLikePath(url.pathname);
}

/**
 * Copies response headers without `Vary`.
 *
 * A build asset is the same bytes for every requester, but static hosts commonly
 * add `Vary: Origin` (Vite's preview server does). Cache matching honours
 * `Vary`, so an entry stored from an install-time fetch would then MISS for a
 * page request whose headers differ — the app would look offline-broken while
 * the bytes sit in the cache. Stripping it is the honest description of a
 * content-hashed asset.
 */
export function withoutVary(headers: Headers): Headers {
  const copy = new Headers(headers);
  copy.delete('vary');
  return copy;
}

/** Message the page posts to a waiting worker to activate it (update prompt). */
export const SKIP_WAITING_MESSAGE = 'SKIP_WAITING' as const;
