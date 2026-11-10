import { describe, expect, it } from 'vitest';
import { oklchToHex, parseOklch, readCssToken } from './color';

/**
 * The icon/manifest colours are derived from the design tokens (UI-01), so this
 * conversion has to be right — a wrong hex is a mismatched installed window.
 */
describe('OKLCH → hex', () => {
  it('converts the dark instrument-panel background token', () => {
    expect(oklchToHex({ l: 0.17, c: 0.006, h: 250 })).toBe('#0d1012');
  });

  it('converts the card surface and the cyan accent', () => {
    expect(oklchToHex({ l: 0.2, c: 0.007, h: 250 })).toBe('#141619');
    expect(oklchToHex({ l: 0.78, c: 0.115, h: 205 })).toBe('#46ccda');
  });

  it('parses the token syntax used in index.css', () => {
    expect(parseOklch('oklch(0.17 0.006 250)')).toEqual({ l: 0.17, c: 0.006, h: 250 });
    expect(parseOklch('oklch(0.17 0.006 250 / 40%)')).toEqual({
      l: 0.17,
      c: 0.006,
      h: 250,
    });
    expect(parseOklch('#0d1012')).toBeUndefined();
  });

  it('reads a CSS custom property from a stylesheet', () => {
    const css = ':root {\n  --background: oklch(0.17 0.006 250);\n}';
    expect(readCssToken(css, 'background')).toBe('oklch(0.17 0.006 250)');
    expect(readCssToken(css, 'missing')).toBeUndefined();
  });
});
