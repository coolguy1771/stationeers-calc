/**
 * Build identity for the app shell (spec 2.1, 11; backlog QA-02).
 *
 * `import.meta.env.VITE_APP_VERSION` is filled in by `vite.config.ts` from
 * `apps/web/package.json` at build time — the same value versions the service
 * worker caches (`src/pwa/swPolicy.ts`). Under a plain Vitest run the define is
 * absent, hence the explicit development marker rather than an invented
 * release number.
 */
export const APP_VERSION: string = import.meta.env.VITE_APP_VERSION ?? '0.0.0-dev';

/** True when the app runs as an installed PWA rather than a browser tab (11). */
export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false;
  const standaloneMedia = window.matchMedia?.('(display-mode: standalone)').matches ?? false;
  // iOS Safari exposes only the legacy non-standard flag.
  const legacyIos =
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return standaloneMedia || legacyIos;
}
