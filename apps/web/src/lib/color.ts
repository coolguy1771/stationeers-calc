/**
 * Colour conversion for build-time assets (backlog QA-02).
 *
 * The installable identity must match the dark instrument-panel design system
 * (UI-01), so the icons and the web app manifest are derived from the same
 * OKLCH design tokens declared in `src/index.css` instead of eyeballed hex
 * values. The conversion below is the standard OKLab → linear sRGB → sRGB
 * transform; it exists so `scripts/generate-icons.ts` and the manifest tests
 * can turn a token into the hex a browser needs.
 */

export interface Oklch {
  /** Perceptual lightness, 0–1. */
  readonly l: number;
  /** Chroma, 0–~0.4. */
  readonly c: number;
  /** Hue angle in degrees. */
  readonly h: number;
}

/** Parses `oklch(0.17 0.006 250)` / `oklch(0.17 0.006 250 / 50%)`. */
export function parseOklch(value: string): Oklch | undefined {
  const match = /^oklch\(\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)/.exec(value.trim());
  if (match === null) return undefined;
  const [, l, c, h] = match;
  if (l === undefined || c === undefined || h === undefined) return undefined;
  return { l: Number(l), c: Number(c), h: Number(h) };
}

function gammaEncode(channel: number): number {
  const clamped = Math.min(1, Math.max(0, channel));
  return clamped <= 0.0031308
    ? 12.92 * clamped
    : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
}

/** OKLCH → `#rrggbb` (sRGB, clamped). */
export function oklchToHex({ l, c, h }: Oklch): string {
  const radians = (h * Math.PI) / 180;
  const a = c * Math.cos(radians);
  const b = c * Math.sin(radians);

  const lPrime = l + 0.3963377774 * a + 0.2158037573 * b;
  const mPrime = l - 0.1055613458 * a - 0.0638541728 * b;
  const sPrime = l - 0.0894841775 * a - 1.291485548 * b;

  const l3 = lPrime * lPrime * lPrime;
  const m3 = mPrime * mPrime * mPrime;
  const s3 = sPrime * sPrime * sPrime;

  const red = 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
  const green = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
  const blue = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3;

  const toByte = (channel: number): string =>
    Math.round(gammaEncode(channel) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toByte(red)}${toByte(green)}${toByte(blue)}`;
}

/** Reads one CSS custom property value out of a stylesheet source text. */
export function readCssToken(css: string, token: string): string | undefined {
  const pattern = new RegExp(`--${token}\\s*:\\s*([^;]+);`);
  return pattern.exec(css)?.[1]?.trim();
}
