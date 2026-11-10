import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright setup for browser workflows (spec 10.1; backlog QA-02).
 *
 * Chromium only for now: these checks cover installability and the offline app
 * shell. The multi-engine matrix (Chromium/Firefox/WebKit, spec 5.5) belongs to
 * QA-01, which owns the golden-fixture browser runs. Not wired into CI yet.
 *
 * Run: `bun run --cwd apps/web e2e` (builds, then tests against `vite preview`).
 */
const PORT = 4173;

export default defineConfig({
  testDir: './e2e',
  // Browser workflows are slow (build serve + service worker install + an
  // offline reload); the default 30 s per test is too tight.
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'off',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `bunx --bun vite preview --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
