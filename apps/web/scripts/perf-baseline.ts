/**
 * Performance baseline run (spec 11 "measure benchmarks before setting hard
 * release thresholds"; backlog QA-02).
 *
 *   bun run --cwd apps/web perf:baseline
 *
 * Builds the production bundle, serves it, drives `/perf` in Chromium and
 * prints the harness report — the numbers recorded in
 * `docs/plan/offline-and-performance.md`. Production build on purpose: dev
 * server numbers say nothing about the shipped app. Skips loudly (exit 0) when
 * no Playwright browser is installed.
 */
import { chromium } from '@playwright/test';
import { isMissingBrowserError } from '../e2e/offlineCheck';
import type { PerfReport } from '../src/perf/harness';
import { appDir, buildApp, serveDist } from './lib/distServer';

const APP_DIR = appDir();
const PORT = 4320;
const TIMEOUT_MS = 180_000;

console.log('[perf] building the app…');
await buildApp(APP_DIR);

const server = await serveDist(`${APP_DIR}/dist`, PORT);
console.log(`[perf] serving dist at ${server.url}`);

let browser;
try {
  browser = await chromium.launch();
} catch (error) {
  await server.stop();
  if (isMissingBrowserError(error)) {
    console.warn(
      '[perf] SKIPPED: no Chromium for Playwright in this environment.\n' +
        '        Install it with: bunx playwright install chromium',
    );
    process.exit(0);
  }
  throw error;
}

try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));

  await page.goto(`${server.url}/perf`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__PERF_REPORT__ !== undefined, undefined, {
    timeout: TIMEOUT_MS,
  });
  const report = (await page.evaluate(() => window.__PERF_REPORT__)) as PerfReport;

  console.log('[perf] harness report');
  console.log(JSON.stringify(report, null, 2));
  if (failures.length > 0) {
    console.error('[perf] page errors:', failures.join(' | '));
    process.exitCode = 1;
  }
  await context.close();
} catch (error) {
  console.error('[perf] FAIL');
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await browser.close();
  await server.stop();
}
