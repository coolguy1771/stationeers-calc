import { expect, test } from '@playwright/test';
import { runOfflineCheck } from './offlineCheck';

/**
 * Browser workflow test (spec 10.1, 11; backlog QA-02): the built app is
 * served by `vite preview`, the service worker installs, then the network is
 * cut and the shell must still open — including a deep SPA route.
 */
test('the app shell renders offline after a reload', async ({ browser, baseURL }) => {
  expect(baseURL).toBeTruthy();
  const result = await runOfflineCheck(browser, baseURL ?? 'http://127.0.0.1:4173');
  expect(result.shellHeading).toContain('Stationeers Engineer');
  expect(result.cacheNames.length).toBeGreaterThan(0);
  expect(result.manifest.display).toBe('standalone');
});
