import { describe, expect, it } from 'vitest';
import {
  APP_SHELL_PATH,
  CACHE_PREFIX,
  cacheNames,
  isApiLikePath,
  isAppRoute,
  isCacheableAssetRequest,
  isNavigationRequest,
  navigationFallbackPath,
  staleCaches,
  withoutVary,
} from './swPolicy';

const ORIGIN = 'https://app.example';

/**
 * Service-worker policy (spec 11; backlog QA-02). These are the decisions the
 * worker makes, tested without a browser.
 */
describe('offline navigation fallback (11)', () => {
  it('serves the cached shell for every SPA route', () => {
    const routes = [
      '/',
      '/design',
      '/settings',
      '/perf',
      '/project/mock.project.atmos',
      '/project/mock.project.atmos/schematic',
      '/project/mock.project.atmos/analysis/',
    ];
    for (const route of routes) {
      expect(isAppRoute(route)).toBe(true);
      expect(navigationFallbackPath(route)).toBe(APP_SHELL_PATH);
    }
  });

  it('leaves unknown paths and asset URLs with their real answer', () => {
    for (const path of ['/assets/index-abc.js', '/project', '/not-a-route', '/icons/icon-192.png']) {
      expect(isAppRoute(path)).toBe(false);
      expect(navigationFallbackPath(path)).toBeUndefined();
    }
  });

  it('treats only document requests as navigations', () => {
    expect(isNavigationRequest({ mode: 'navigate' })).toBe(true);
    expect(isNavigationRequest({ mode: 'cors' })).toBe(false);
    expect(isNavigationRequest({ mode: 'no-cors' })).toBe(false);
  });
});

describe('runtime caching guard (nothing API-ish is cached blindly)', () => {
  const request = (overrides: Partial<Parameters<typeof isCacheableAssetRequest>[0]>) => ({
    url: `${ORIGIN}/assets/index-abc.js`,
    method: 'GET',
    mode: 'cors' as const,
    accept: '*/*',
    ...overrides,
  });

  it('caches same-origin build assets', () => {
    expect(isCacheableAssetRequest(request({}), ORIGIN)).toBe(true);
  });

  it('passes API-shaped paths, JSON consumers and other origins through', () => {
    expect(isCacheableAssetRequest(request({ url: `${ORIGIN}/api/projects` }), ORIGIN)).toBe(false);
    expect(isCacheableAssetRequest(request({ url: `${ORIGIN}/graphql` }), ORIGIN)).toBe(false);
    expect(isCacheableAssetRequest(request({ url: `${ORIGIN}/pack.json` }), ORIGIN)).toBe(false);
    expect(
      isCacheableAssetRequest(request({ accept: 'application/json' }), ORIGIN),
    ).toBe(false);
    expect(
      isCacheableAssetRequest(request({ url: 'https://cdn.example/x.woff2' }), ORIGIN),
    ).toBe(false);
  });

  it('never intercepts non-GET or navigation requests', () => {
    expect(isCacheableAssetRequest(request({ method: 'POST' }), ORIGIN)).toBe(false);
    expect(isCacheableAssetRequest(request({ mode: 'navigate' }), ORIGIN)).toBe(false);
  });

  it('recognises API-shaped paths', () => {
    expect(isApiLikePath('/api/v1/pack')).toBe(true);
    expect(isApiLikePath('/assets/index-abc.js')).toBe(false);
  });
});

describe('versioned caches', () => {
  it('names caches per build', () => {
    expect(cacheNames('1.2.3')).toEqual({
      precache: `${CACHE_PREFIX}-precache-1.2.3`,
      runtime: `${CACHE_PREFIX}-runtime-1.2.3`,
    });
  });

  it('deletes only OUR caches from other builds', () => {
    const existing = [
      'stationeers-engineer-precache-0.0.1',
      'stationeers-engineer-runtime-0.0.1',
      'stationeers-engineer-precache-0.0.2',
      'stationeers-engineer-runtime-0.0.2',
      'someone-elses-cache',
      'workbox-precache-v2',
    ];
    expect(staleCaches(existing, '0.0.2')).toEqual([
      'stationeers-engineer-precache-0.0.1',
      'stationeers-engineer-runtime-0.0.1',
    ]);
  });
});

describe('Vary handling', () => {
  it('strips Vary but keeps the other headers', () => {
    const headers = new Headers({
      'content-type': 'text/javascript',
      'cache-control': 'no-cache',
      vary: 'Origin',
    });
    const stripped = withoutVary(headers);
    expect(stripped.get('vary')).toBeNull();
    expect(stripped.get('content-type')).toBe('text/javascript');
    expect(headers.get('vary')).toBe('Origin');
  });
});
