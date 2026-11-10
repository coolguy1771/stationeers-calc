/// <reference types="vite/client" />

/**
 * Build-time app version (see `vite.config.ts` `define`): the version in
 * `apps/web/package.json` at build time. Absent under plain Vitest runs, where
 * `src/pwa/appInfo.ts` falls back to the development marker.
 */
interface ImportMetaEnv {
  readonly VITE_APP_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
