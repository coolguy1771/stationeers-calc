// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_VERSION } from './pwa/appInfo';
import { APP_SHELL_PATH, cacheNames } from './pwa/swPolicy';

/**
 * Service worker wiring (spec 2.1 "Service Worker for offline resources", 11;
 * backlog QA-02).
 *
 * The policy functions are tested on their own (`pwa/swPolicy.test.ts`); this
 * file drives the WORKER: it installs the real `src/sw.ts` against fake
 * `CacheStorage`/`fetch` globals and dispatches the lifecycle events (install,
 * activate, fetch, message) a browser would, asserting what respondWith
 * actually returns.
 */

/** Minimal `Cache`/`CacheStorage` double — enough for what the worker calls. */
class FakeCache {
  readonly entries = new Map<string, Response>();

  async put(request: string | Request, response: Response): Promise<void> {
    this.entries.set(urlOf(request), response);
  }

  async match(request: string | Request): Promise<Response | undefined> {
    return this.entries.get(urlOf(request));
  }

  async keys(): Promise<Request[]> {
    return [...this.entries.keys()].map((url) => ({ url }) as unknown as Request);
  }
}

class FakeCacheStorage {
  readonly caches = new Map<string, FakeCache>();

  async open(name: string): Promise<FakeCache> {
    const existing = this.caches.get(name);
    if (existing !== undefined) return existing;
    const created = new FakeCache();
    this.caches.set(name, created);
    return created;
  }

  async keys(): Promise<string[]> {
    return [...this.caches.keys()];
  }

  async delete(name: string): Promise<boolean> {
    return this.caches.delete(name);
  }

  async match(
    request: string | Request,
    options?: { cacheName?: string },
  ): Promise<Response | undefined> {
    if (options?.cacheName !== undefined) {
      return this.caches.get(options.cacheName)?.match(request);
    }
    for (const cache of this.caches.values()) {
      const hit = await cache.match(request);
      if (hit !== undefined) return hit;
    }
    return undefined;
  }
}

function urlOf(request: string | Request): string {
  const raw = typeof request === 'string' ? request : request.url;
  return new URL(raw, 'http://localhost:3000').href;
}

const ORIGIN = 'http://localhost:3000';
// The cache version comes from the build define, which differs between a root
// run and an apps/web run; the worker's own value is the only correct one.
const NAMES = cacheNames(APP_VERSION);

/**
 * Request double: `new Request(url, { mode: 'navigate' })` is rejected by
 * undici, and the worker only reads url/method/mode/accept anyway.
 */
function fakeRequest(url: string, mode: RequestMode): Request {
  return {
    url: new URL(url, ORIGIN).href,
    method: 'GET',
    mode,
    headers: new Headers(),
  } as unknown as Request;
}

interface DispatchFields {
  request?: Request;
  data?: unknown;
}

interface Dispatched {
  /** Promises handed to `event.waitUntil`. */
  readonly waits: Promise<unknown>[];
  /** What the worker handed to `event.respondWith`, if it intercepted. */
  responded?: Promise<Response> | Response;
}

/**
 * Dispatches an event with the fields a browser would attach to it
 * (`waitUntil`, `respondWith`, `request`, `data`).
 */
function dispatch(type: string, fields: DispatchFields = {}): Dispatched {
  const handle: Dispatched = { waits: [] };
  const event = Object.assign(new Event(type), fields, {
    waitUntil: (promise: Promise<unknown>) => handle.waits.push(promise),
    respondWith: (response: Promise<Response> | Response) => {
      handle.responded = response;
    },
  });
  window.dispatchEvent(event);
  return handle;
}

const storage = new FakeCacheStorage();
let skipWaiting: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  vi.stubGlobal('caches', storage);
  await import('./sw');
});

beforeEach(() => {
  storage.caches.clear();
  skipWaiting = vi.fn(async () => undefined);
  Object.assign(window, { skipWaiting });
  (window as unknown as { __WB_MANIFEST?: unknown }).__WB_MANIFEST = [
    { url: 'index.html', revision: 'abc' },
    { url: 'assets/app.js', revision: null },
  ];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal('caches', storage);
});

async function runWaits(handle: Dispatched): Promise<void> {
  await Promise.all(handle.waits);
}

describe('install: precache the app shell', () => {
  it('caches the shell document and the build assets that were listed', async () => {
    const fetches: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : String(input);
      fetches.push(url);
      return new Response(`body:${url}`, {
        status: 200,
        headers: { 'content-type': 'text/javascript', vary: 'Origin' },
      });
    });

    await runWaits(dispatch('install'));

    expect(fetches.sort()).toEqual(
      [`${ORIGIN}${APP_SHELL_PATH}`, `${ORIGIN}/assets/app.js`].sort(),
    );
    const cache = storage.caches.get(NAMES.precache);
    expect(cache).toBeDefined();
    expect([...(cache?.entries.keys() ?? [])].sort()).toEqual(
      [`${ORIGIN}${APP_SHELL_PATH}`, `${ORIGIN}/assets/app.js`].sort(),
    );
    // Vary is stripped, so later lookups from the page cannot miss.
    expect(cache?.entries.get(`${ORIGIN}/assets/app.js`)?.headers.get('vary')).toBeNull();
  });

  it('fails the install loudly when an asset cannot be fetched', async () => {
    vi.stubGlobal('fetch', async () => new Response('missing', { status: 404 }));
    const handle = dispatch('install');
    await expect(Promise.all(handle.waits)).rejects.toThrow(/Precache failed/);
  });
});

describe('activate: versioned cache cleanup', () => {
  it('deletes older builds of ours and leaves foreign caches alone', async () => {
    const claim = vi.fn(async () => undefined);
    Object.assign(window, { clients: { claim } });
    const previous = cacheNames('0.0.0-previous');
    await storage.open(previous.precache);
    await storage.open(previous.runtime);
    await storage.open('someone-else');
    await storage.open(NAMES.precache);

    await runWaits(dispatch('activate'));

    expect((await storage.keys()).sort()).toEqual(
      [NAMES.precache, 'someone-else'].sort(),
    );
    expect(claim).toHaveBeenCalledTimes(1);
  });
});

describe('fetch: offline navigation falls back to the cached shell', () => {
  beforeEach(async () => {
    const cache = await storage.open(NAMES.precache);
    await cache.put(APP_SHELL_PATH, new Response('<html>shell</html>', { status: 200 }));
  });

  it('serves the shell for an app route when the network is gone', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });

    const event = dispatch('fetch', {
      request: fakeRequest('/project/mock.project.atmos/schematic', 'navigate'),
    });
    expect(event.responded).toBeDefined();
    const response = await event.responded;

    expect(response?.status).toBe(200);
    expect(await response?.text()).toBe('<html>shell</html>');
  });

  it('does not answer for paths the SPA does not own', async () => {
    const event = dispatch('fetch', {
      request: fakeRequest('/assets/missing.js', 'navigate'),
    });
    expect(event.responded).toBeUndefined();
  });

  it('reports the shell as missing instead of rendering a blank page', async () => {
    storage.caches.clear();
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });

    const event = dispatch('fetch', {
      request: fakeRequest('/', 'navigate'),
    });
    const response = await event.responded;

    expect(response?.status).toBe(503);
    expect(await response?.text()).toMatch(/app shell is not cached/i);
  });
});

describe('fetch: assets and API-ish requests', () => {
  it('serves a precached asset without touching the network', async () => {
    const cache = await storage.open(NAMES.precache);
    await cache.put(`/assets/app.js`, new Response('console.log(1)', { status: 200 }));
    const network = vi.fn(async () => new Response('from network'));
    vi.stubGlobal('fetch', network);

    const event = dispatch('fetch', {
      request: fakeRequest('/assets/app.js', 'cors'),
    });
    const response = await event.responded;

    expect(await response?.text()).toBe('console.log(1)');
    expect(network).not.toHaveBeenCalled();
  });

  it('lets API-shaped requests through untouched', async () => {
    const event = dispatch('fetch', {
      request: fakeRequest('/api/projects', 'cors'),
    });
    expect(event.responded).toBeUndefined();
  });

  it('answers 504 for an uncached asset while offline', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });

    const event = dispatch('fetch', {
      request: fakeRequest('/assets/uncached.js', 'cors'),
    });
    const response = await event.responded;

    expect(response?.status).toBe(504);
  });
});

describe('message: update prompt handover', () => {
  it('activates the waiting worker when the page asks it to', () => {
    dispatch('message', { data: 'SKIP_WAITING' });
    expect(skipWaiting).toHaveBeenCalledTimes(1);
  });

  it('ignores unrelated messages', () => {
    dispatch('message', { data: 'something-else' });
    expect(skipWaiting).not.toHaveBeenCalled();
  });
});
