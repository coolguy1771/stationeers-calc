import type { Browser, BrowserContext, Page } from '@playwright/test';

/**
 * Offline app-shell check (spec 11 "PWA installability and offline project
 * access", 10.1 Playwright; backlog QA-02).
 *
 * Shared by the Playwright spec (`e2e/offline.spec.ts`, `bun run --cwd
 * apps/web e2e`) and the standalone script (`scripts/offline-smoke.ts`), so
 * "the app opens offline" is asserted in one place:
 *
 * 1. load `/` online, wait until the service worker controls the page,
 * 2. cut the network with `context.setOffline(true)`,
 * 3. reload: the cached shell must render the projects page,
 * 4. open a deep SPA route offline: the shell must serve it too.
 */

export interface OfflineCheckResult {
  /** Heading the shell rendered after the offline reload. */
  readonly shellHeading: string;
  /** Route that was opened while offline. */
  readonly offlineRoute: string;
  /** Cache Storage caches the worker created (evidence of precaching). */
  readonly cacheNames: readonly string[];
  /** Manifest fields the browser sees, for the installability evidence. */
  readonly manifest: { readonly name: string; readonly display: string };
}

const DEEP_ROUTE = '/project/mock.project.atmos/schematic';
const OFFLINE_TIMEOUT_MS = 30_000;

/** Waits until a service worker controls the page (first install claims it). */
async function waitForControl(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      navigator.serviceWorker !== undefined &&
      navigator.serviceWorker.controller !== null,
    undefined,
    { timeout: OFFLINE_TIMEOUT_MS },
  );
}

async function readManifest(page: Page): Promise<OfflineCheckResult['manifest']> {
  const href = await page.getAttribute('link[rel="manifest"]', 'href');
  if (href === null) throw new Error('index.html has no <link rel="manifest">');
  const manifest = (await page.evaluate(async (url) => {
    const response = await fetch(url);
    return (await response.json()) as { name?: string; display?: string };
  }, href)) as { name?: string; display?: string };
  return { name: manifest.name ?? '', display: manifest.display ?? '' };
}

export async function runOfflineCheck(
  browser: Browser,
  baseUrl: string,
): Promise<OfflineCheckResult> {
  const context: BrowserContext = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}/`, { waitUntil: 'load' });
    await page.getByRole('heading', { name: 'Stationeers Engineer' }).waitFor();
    await waitForControl(page);
    const manifest = await readManifest(page);
    if (manifest.display !== 'standalone') {
      throw new Error(`manifest display is "${manifest.display}", expected standalone`);
    }

    // Network away: everything from here on comes from the service worker.
    await context.setOffline(true);

    await page.reload({ waitUntil: 'load', timeout: OFFLINE_TIMEOUT_MS });
    const heading = await page
      .getByRole('heading', { name: 'Stationeers Engineer' })
      .innerText({ timeout: OFFLINE_TIMEOUT_MS });

    await page.goto(`${baseUrl}${DEEP_ROUTE}`, {
      waitUntil: 'load',
      timeout: OFFLINE_TIMEOUT_MS,
    });
    const mounted = await page.evaluate(
      () => (document.getElementById('root')?.childElementCount ?? 0) > 0,
    );
    if (!mounted) {
      throw new Error(`the cached shell did not render ${DEEP_ROUTE} offline`);
    }

    const cacheNames = (await page.evaluate(() => caches.keys())) as string[];
    const precached = cacheNames.some((name) =>
      name.startsWith('stationeers-engineer-'),
    );
    if (!precached) {
      throw new Error(`no app cache found (caches: ${cacheNames.join(', ')})`);
    }

    return {
      shellHeading: heading.trim(),
      offlineRoute: DEEP_ROUTE,
      cacheNames,
      manifest,
    };
  } finally {
    await context.setOffline(false);
    await context.close();
  }
}

export interface UpdateCheckResult {
  /** What the prompt told the user. */
  readonly promptText: string;
  /** Cache Storage right after the new build took over. */
  readonly cacheNames: readonly string[];
}

export interface UpdateCheckOptions {
  /**
   * Publishes a new build while the page is already running the old one —
   * simulated by rewriting the served `sw.js` version stamp.
   */
  deploy(): Promise<void>;
  /** Cache-version marker the new build advertises. */
  readonly newVersionMarker: string;
}

/**
 * Update prompt check (spec §11; backlog QA-02).
 *
 * Runs the app, publishes a new build behind it (`options.deploy`), reloads so
 * the browser performs its update check, and asserts the app OFFERS the reload
 * instead of swapping builds under the user. Accepting it must hand the page to
 * the new build — visible as the new build's caches.
 */
export async function runUpdateCheck(
  browser: Browser,
  baseUrl: string,
  options: UpdateCheckOptions,
): Promise<UpdateCheckResult> {
  const newVersionMarker = options.newVersionMarker;
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}/`, { waitUntil: 'load' });
    await page.getByRole('heading', { name: 'Stationeers Engineer' }).waitFor();
    await waitForControl(page);

    await options.deploy();
    // A new build is on the server now; this navigation runs the update check.
    await page.reload({ waitUntil: 'load' });

    const prompt = page.locator('[data-service-worker-update="available"]');
    await prompt.waitFor({ timeout: OFFLINE_TIMEOUT_MS });
    const promptText = (await prompt.innerText()).trim();

    await page.getByRole('button', { name: 'Reload' }).click();

    // The accepted reload lands on the new build, with no prompt left over.
    await page.waitForFunction(
      () => document.querySelector('[data-service-worker-update]') === null,
      undefined,
      { timeout: OFFLINE_TIMEOUT_MS },
    );
    await page.waitForFunction(
      async (marker) => (await caches.keys()).some((name) => name.includes(marker)),
      newVersionMarker,
      { timeout: OFFLINE_TIMEOUT_MS },
    );
    const cacheNames = (await page.evaluate(() => caches.keys())) as string[];
    return { promptText, cacheNames };
  } finally {
    await context.close();
  }
}

/** Launch error that means "no browser here", not "the app is broken". */
export function isMissingBrowserError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Executable doesn't exist|browserType\.launch|Host system is missing/i.test(
    message,
  );
}
