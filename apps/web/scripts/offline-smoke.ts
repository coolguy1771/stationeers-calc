/**
 * Offline + update smoke check (spec §11; backlog QA-02).
 *
 *   bun run --cwd apps/web offline:smoke
 *
 * Builds the app, copies `dist/` to a temp directory, serves it locally and, in
 * Chromium:
 *
 * 1. **offline** — install the worker, cut the network with
 *    `context.setOffline(true)`, reload, and assert the cached shell still
 *    renders `/` and a deep SPA route;
 * 2. **update** — rewrite the served `sw.js` (a simulated deployment), reload,
 *    and assert the app OFFERS the reload instead of swapping builds silently;
 *    accepting it must hand the page to the new build's caches.
 *
 * When no Playwright browser is installed the check SKIPS loudly (exit 0)
 * instead of pretending it passed; install one with
 * `bunx playwright install chromium`.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import {
  isMissingBrowserError,
  runOfflineCheck,
  runUpdateCheck,
} from '../e2e/offlineCheck';
import { appDir, buildApp, copyDist, serveDist } from './lib/distServer';

const APP_DIR = appDir();
const PORT = 4319;
/** Cache-version marker the simulated deployment advertises. */
const NEXT_VERSION = '0.0.1-smoke-update';

console.log('[offline] building the app…');
await buildApp(APP_DIR);

const copy = await copyDist(join(APP_DIR, 'dist'));
const server = await serveDist(copy.dist, PORT);
console.log(`[offline] serving dist at ${server.url}`);

let browser;
try {
  browser = await chromium.launch();
} catch (error) {
  await server.stop();
  await copy.dispose();
  if (isMissingBrowserError(error)) {
    console.warn(
      '[offline] SKIPPED: no Chromium for Playwright in this environment.\n' +
        '          Install it with: bunx playwright install chromium',
    );
    process.exit(0);
  }
  throw error;
}

try {
  const offline = await runOfflineCheck(browser, server.url);
  console.log('[offline] PASS');
  console.log(`  shell heading : ${offline.shellHeading}`);
  console.log(`  offline route : ${offline.offlineRoute}`);
  console.log(`  manifest      : ${offline.manifest.name} (${offline.manifest.display})`);
  console.log(`  caches        : ${offline.cacheNames.join(', ')}`);

  const workerPath = join(copy.dist, 'sw.js');
  const update = await runUpdateCheck(browser, server.url, {
    newVersionMarker: NEXT_VERSION,
    // Simulate a deployment: same assets, a worker that reports a new version.
    async deploy() {
      const worker = await readFile(workerPath, 'utf8');
      const patched = worker.replace(
        /const APP_VERSION = "[^"]+";/,
        `const APP_VERSION = "${NEXT_VERSION}";`,
      );
      if (patched === worker) {
        throw new Error('could not version-stamp the served worker');
      }
      await writeFile(workerPath, patched);
    },
  });
  console.log('[update] PASS');
  console.log(`  prompt        : ${update.promptText.replace(/\s+/g, ' ')}`);
  console.log(`  caches        : ${update.cacheNames.join(', ')}`);
} catch (error) {
  console.error('[offline] FAIL');
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await browser.close();
  await server.stop();
  await copy.dispose();
}
