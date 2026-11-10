import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { oklchToHex, parseOklch, readCssToken } from '../lib/color';

/**
 * Installability contract (spec 11; backlog QA-02).
 *
 * Parsed from the files that actually ship: `public/manifest.webmanifest` and
 * the icons are copied verbatim into `dist/`, and `index.html` is the emitted
 * document. A manifest that stops matching its icons (or its design tokens) is
 * a silent installability regression, so it is asserted here.
 */

const MANIFEST_URL = new URL('../../public/manifest.webmanifest', import.meta.url);
const PUBLIC_DIR_URL = new URL('../../public/', import.meta.url);
const ICON_DIR_URL = new URL('../../public/icons/', import.meta.url);
const INDEX_HTML_URL = new URL('../../index.html', import.meta.url);
const CSS_URL = new URL('../index.css', import.meta.url);

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

interface Manifest {
  id?: string;
  name?: string;
  short_name?: string;
  description?: string;
  start_url?: string;
  scope?: string;
  display?: string;
  theme_color?: string;
  background_color?: string;
  lang?: string;
  icons?: ManifestIcon[];
}

const manifest = JSON.parse(readFileSync(MANIFEST_URL, 'utf8')) as Manifest;
const indexHtml = readFileSync(INDEX_HTML_URL, 'utf8');
const css = readFileSync(CSS_URL, 'utf8');

/** PNG width/height from the IHDR chunk (a real file check, not a name check). */
function pngSize(file: string): { width: number; height: number } {
  const bytes = readFileSync(file);
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function iconFile(src: string): string {
  // Icon `src` values are absolute app paths; the files live in public/.
  return new URL(src.replace(/^\//, ''), PUBLIC_DIR_URL).pathname;
}

describe('web app manifest (11: installability)', () => {
  it('names the app and starts at the shell', () => {
    expect(manifest.name).toBe('Stationeers Engineer');
    expect(manifest.short_name).toBe('Stationeers');
    expect(manifest.description?.length ?? 0).toBeGreaterThan(20);
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.lang).toBe('en');
  });

  it('uses the dark instrument-panel colours (UI-01 tokens)', () => {
    const background = readCssToken(css, 'background');
    expect(background).toBeDefined();
    const expected = oklchToHex(parseOklch(background ?? '') ?? { l: 0, c: 0, h: 0 });
    expect(manifest.theme_color).toBe(expected);
    expect(manifest.background_color).toBe(expected);
  });

  it('ships 192/512 any + 512 maskable icons that exist at the declared size', () => {
    const icons = manifest.icons ?? [];
    const any = icons.filter((icon) => (icon.purpose ?? 'any') === 'any');
    const maskable = icons.filter((icon) => icon.purpose === 'maskable');

    expect(any.map((icon) => icon.sizes).sort()).toEqual(['192x192', '512x512']);
    expect(maskable.map((icon) => icon.sizes)).toEqual(['512x512']);

    for (const icon of icons) {
      expect(icon.type).toBe('image/png');
      const file = iconFile(icon.src);
      expect(statSync(file).isFile()).toBe(true);
      const [width, height] = icon.sizes.split('x').map(Number);
      expect(pngSize(file)).toEqual({ width, height });
    }
  });

  it('links the manifest, theme colour and apple-touch-icon from index.html', () => {
    expect(indexHtml).toMatch(/<link rel="manifest" href="\/manifest\.webmanifest" \/>/);
    expect(indexHtml).toMatch(
      new RegExp(`<meta name="theme-color" content="${manifest.theme_color}" />`),
    );
    const appleIcon = /<link rel="apple-touch-icon"[^>]*href="([^"]+)"/.exec(indexHtml);
    expect(appleIcon?.[1]).toBeDefined();
    expect(statSync(iconFile(appleIcon?.[1] ?? '')).isFile()).toBe(true);
    // A vector favicon is derived from the same mark as the PNGs.
    expect(indexHtml).toContain('type="image/svg+xml" href="/icons/mark.svg"');
    expect(statSync(new URL('mark.svg', ICON_DIR_URL)).isFile()).toBe(true);
  });
});
