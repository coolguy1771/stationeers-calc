/**
 * PWA icon generator (backlog QA-02).
 *
 * Draws the app mark from the design tokens in `src/index.css` and writes the
 * PNG/SVG assets under `public/icons/`. Run it after changing the mark or the
 * token values:
 *
 *   bun run --cwd apps/web icons
 *
 * Outputs are committed, so a normal build needs no image tooling: this script
 * is the source of the mark, not a build step. No game assets are used — the
 * mark is a plain geometric schematic junction.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import { deflateSync } from 'node:zlib';
import { oklchToHex, parseOklch, readCssToken } from '../src/lib/color';

const ICON_DIR = fileURLToPath(new URL('../public/icons/', import.meta.url));
const CSS = await readFile(new URL('../src/index.css', import.meta.url), 'utf8');

function tokenHex(name: string): string {
  const value = readCssToken(CSS, name);
  const parsed = value === undefined ? undefined : parseOklch(value);
  if (parsed === undefined) throw new Error(`token --${name} is not an oklch() colour`);
  return oklchToHex(parsed);
}

/** Instrument-panel plate: the card surface, so the mark reads on any launcher. */
const PLATE = tokenHex('card');
/** Single accent (--primary): the schematic mark itself. */
const ACCENT = tokenHex('primary');

type Rgb = readonly [number, number, number];

function rgb(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

const PLATE_RGB = rgb(PLATE);
const ACCENT_RGB = rgb(ACCENT);

/** Signed distance to a rounded box centred on the origin. */
function sdRoundBox(px: number, py: number, half: number, radius: number): number {
  const qx = Math.abs(px) - half + radius;
  const qy = Math.abs(py) - half + radius;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return outside + Math.min(Math.max(qx, qy), 0) - radius;
}

/** Signed distance to a capsule (thick line segment). */
function sdCapsule(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  radius: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const lengthSq = abx * abx + aby * aby;
  const t = lengthSq === 0 ? 0 : Math.min(1, Math.max(0, (apx * abx + apy * aby) / lengthSq));
  return Math.hypot(apx - abx * t, apy - aby * t) - radius;
}

function sdCircle(px: number, py: number, cx: number, cy: number, r: number): number {
  return Math.hypot(px - cx, py - cy) - r;
}

export interface IconSpec {
  readonly file: string;
  readonly size: number;
  /** Side of the mark's square, as a fraction of the canvas (maskable safe zone). */
  readonly glyph: number;
  /** Maskable icons must fill the canvas: the OS supplies the mask. */
  readonly maskable: boolean;
}

export const ICON_SPECS: readonly IconSpec[] = [
  { file: 'icon-192.png', size: 192, glyph: 0.78, maskable: false },
  { file: 'icon-512.png', size: 512, glyph: 0.78, maskable: false },
  { file: 'icon-maskable-512.png', size: 512, glyph: 0.64, maskable: true },
  { file: 'apple-touch-icon-180.png', size: 180, glyph: 0.78, maskable: false },
];

/**
 * The mark: a schematic T-junction with three port dots — the visual language
 * of the editors (typed connection intents), not a game asset.
 */
function distanceToMark(px: number, py: number, glyph: number): number {
  const offset = (1 - glyph) / 2;
  // Canvas coordinates are centred on the origin; the mark is authored in a
  // 0..1 square, so shift first and then scale into that square.
  const u = (px + 0.5 - offset) / glyph;
  const v = (py + 0.5 - offset) / glyph;
  const barRadius = 0.048;
  const dotRadius = 0.076;
  return Math.min(
    sdCapsule(u, v, 0.235, 0.335, 0.765, 0.335, barRadius),
    sdCapsule(u, v, 0.5, 0.335, 0.5, 0.675, barRadius),
    sdCircle(u, v, 0.235, 0.335, dotRadius),
    sdCircle(u, v, 0.765, 0.335, dotRadius),
    sdCircle(u, v, 0.5, 0.675, dotRadius),
  ) * glyph;
}

/** Analytic coverage of a distance field for one pixel (`unit` = 1 / size). */
function coverage(distance: number, unit: number): number {
  return Math.min(1, Math.max(0, 0.5 - distance / unit));
}

function renderIcon({ size, glyph, maskable }: IconSpec): Buffer {
  const unit = 1 / size;
  const pixels = Buffer.alloc(size * size * 4);
  const plateHalf = 0.5;
  const plateRadius = maskable ? 0 : 0.2;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const px = (x + 0.5) * unit - 0.5;
      const py = (y + 0.5) * unit - 0.5;

      const plateAlpha = coverage(
        maskable ? Math.abs(px) - plateHalf : sdRoundBox(px, py, plateHalf, plateRadius),
        unit,
      );
      const markAlpha = coverage(distanceToMark(px, py, glyph), unit) * plateAlpha;

      const blend = (base: number, accent: number): number =>
        Math.round(accent * markAlpha + base * (1 - markAlpha));
      const offset = (y * size + x) * 4;
      pixels[offset] = blend(PLATE_RGB[0], ACCENT_RGB[0]);
      pixels[offset + 1] = blend(PLATE_RGB[1], ACCENT_RGB[1]);
      pixels[offset + 2] = blend(PLATE_RGB[2], ACCENT_RGB[2]);
      pixels[offset + 3] = Math.round(plateAlpha * 255);
    }
  }

  return encodePng(size, size, pixels);
}

// -------------------------------------------------------------- PNG writer --

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  // 10..12 stay 0: deflate, adaptive filtering, no interlace.
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// -------------------------------------------------------------- SVG writer --

function markSvg(glyph: number, maskable: boolean): string {
  const offset = (1 - glyph) / 2;
  const scale = glyph;
  const shape = (value: number): string => (offset + value * scale).toFixed(4);
  const width = (value: number): string => (value * scale).toFixed(4);
  const corners = maskable ? 0 : 0.2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" width="512" height="512">
  <rect width="1" height="1" rx="${corners}" fill="${PLATE}" />
  <g stroke="${ACCENT}" stroke-width="${width(0.096)}" stroke-linecap="round">
    <line x1="${shape(0.235)}" y1="${shape(0.335)}" x2="${shape(0.765)}" y2="${shape(0.335)}" />
    <line x1="${shape(0.5)}" y1="${shape(0.335)}" x2="${shape(0.5)}" y2="${shape(0.675)}" />
  </g>
  <g fill="${ACCENT}">
    <circle cx="${shape(0.235)}" cy="${shape(0.335)}" r="${width(0.076)}" />
    <circle cx="${shape(0.765)}" cy="${shape(0.335)}" r="${width(0.076)}" />
    <circle cx="${shape(0.5)}" cy="${shape(0.675)}" r="${width(0.076)}" />
  </g>
</svg>
`;
}

await mkdir(ICON_DIR, { recursive: true });
for (const spec of ICON_SPECS) {
  await writeFile(`${ICON_DIR}${spec.file}`, renderIcon(spec));
  console.log(`wrote public/icons/${spec.file} (${spec.size}×${spec.size})`);
}
await writeFile(`${ICON_DIR}mark.svg`, markSvg(0.78, false));
console.log(`wrote public/icons/mark.svg (plate ${PLATE}, accent ${ACCENT})`);
