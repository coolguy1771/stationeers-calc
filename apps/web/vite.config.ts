import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

/** App version shown in the storage panel and used to version the SW caches. */
const appVersion = (
  JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;

/**
 * Build configuration (spec 2.1, 11; backlog QA-02).
 *
 * The service worker is a hand-written `src/sw.ts` that `vite-plugin-pwa`'s
 * `injectManifest` strategy bundles and fills with the precache list of hashed
 * build assets (`self.__WB_MANIFEST`). The caching policy itself lives in
 * `src/pwa/swPolicy.ts` so it is unit-testable; Workbox routing is not used and
 * no external workbox runtime is shipped.
 *
 * Registration is ours too (`injectRegister: false`): `src/pwa/registration.ts`
 * owns the update prompt, so the shell can say "a new version is available".
 * The web app manifest is a committed file (`public/manifest.webmanifest`) —
 * `manifest: false` keeps one source of truth for the installable identity.
 */
export default defineConfig({
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: false,
      registerType: 'prompt',
      manifest: false,
      injectManifest: {
        // The app shell: documents, code, styles, bundled fonts, icons.
        globPatterns: ['**/*.{html,js,css,woff2,woff,svg,png,webmanifest}'],
        // Never precache the worker itself.
        globIgnores: ['**/sw.js', '**/workbox-*.js'],
        // Left readable: minification aliases `self`, and workbox can only
        // inject the precache list into the literal `self.__WB_MANIFEST`.
        minify: false,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
