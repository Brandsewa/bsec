/**
 * WCAG 2.1 Contrast & Relative Luminance Utilities per PLAN §8.1.
 */

export interface WcagContrastResult {
  ratio: number;
  aaPass: boolean;
  aaaPass: boolean;
  aaLargePass: boolean;
  suggestedColor?: string;
}

/**
 * Normalizes 3-digit or 6-digit hex string with or without '#' to [R, G, B] in 0-255.
 */
export function parseHexColor(hex: string): [number, number, number] {
  const clean = hex.replace(/^#/, "").trim();
  if (clean.length === 3) {
    const c0 = clean.charAt(0);
    const c1 = clean.charAt(1);
    const c2 = clean.charAt(2);
    const r = parseInt(c0 + c0, 16);
    const g = parseInt(c1 + c1, 16);
    const b = parseInt(c2 + c2, 16);
    return [r, g, b];
  }
  if (clean.length === 6) {
    const r = parseInt(clean.substring(0, 2), 16);
    const g = parseInt(clean.substring(2, 4), 16);
    const b = parseInt(clean.substring(4, 6), 16);
    return [r, g, b];
  }
  throw new Error(`Invalid hex color: "${hex}"`);
}

/**
 * Converts [R, G, B] (0-255) back to #rrggbb hex string.
 */
export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  const toHex = (n: number) => clamp(n).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Calculates WCAG 2.1 relative luminance for a given hex color.
 * L = 0.2126 * R + 0.7152 * G + 0.0722 * B
 */
export function getRelativeLuminance(hex: string): number {
  const [r255, g255, b255] = parseHexColor(hex);

  const toLinear = (c255: number): number => {
    const c = c255 / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };

  const r = toLinear(r255);
  const g = toLinear(g255);
  const b = toLinear(b255);

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Calculates WCAG 2.1 contrast ratio between two colors (range: 1.0 to 21.0).
 */
export function getContrastRatio(color1: string, color2: string): number {
  const l1 = getRelativeLuminance(color1);
  const l2 = getRelativeLuminance(color2);

  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);

  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Checks contrast against WCAG AA standards (4.5:1 for normal text, 3:1 for large text).
 * If failing, calculates a suggested compliant color.
 */
export function checkWcagContrast(foreground: string, background: string): WcagContrastResult {
  const ratio = getContrastRatio(foreground, background);
  const aaPass = ratio >= 4.5;
  const aaaPass = ratio >= 7.0;
  const aaLargePass = ratio >= 3.0;

  if (aaPass) {
    return { ratio, aaPass, aaaPass, aaLargePass };
  }

  // Suggest a fix by adjusting the foreground lightness
  const suggestedColor = calculateSuggestedColor(foreground, background);

  return {
    ratio,
    aaPass,
    aaaPass,
    aaLargePass,
    suggestedColor,
  };
}

/**
 * Adjusts foreground color lightness to achieve WCAG AA compliance (ratio >= 4.5).
 */
function calculateSuggestedColor(foreground: string, background: string): string {
  const bgLuminance = getRelativeLuminance(background);
  const [r, g, b] = parseHexColor(foreground);
  const [h, s, l] = rgbToHsl(r, g, b);

  // If background is light (lum > 0.35), darken foreground; otherwise lighten foreground
  const shouldDarken = bgLuminance > 0.35;

  let bestColor = foreground;
  let bestRatio = getContrastRatio(foreground, background);

  // Step lightness up or down
  for (let step = 1; step <= 100; step++) {
    const testL = shouldDarken ? Math.max(0, l - step * 0.01) : Math.min(1, l + step * 0.01);
    const [tr, tg, tb] = hslToRgb(h, s, testL);
    const testHex = rgbToHex(tr, tg, tb);
    const testRatio = getContrastRatio(testHex, background);

    if (testRatio >= 4.55) {
      return testHex;
    }

    if (testRatio > bestRatio) {
      bestRatio = testRatio;
      bestColor = testHex;
    }

    if (shouldDarken && testL <= 0) break;
    if (!shouldDarken && testL >= 1) break;
  }

  if (bestRatio >= 4.5) {
    return bestColor;
  }

  // Fallback to pure black or white if monochromatic boundary reached
  const blackRatio = getContrastRatio("#000000", background);
  const whiteRatio = getContrastRatio("#ffffff", background);
  return blackRatio >= whiteRatio ? "#000000" : "#ffffff";
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rNorm = r / 255;
  const gNorm = g / 255;
  const bNorm = b / 255;

  const max = Math.max(rNorm, gNorm, bNorm);
  const min = Math.min(rNorm, gNorm, bNorm);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case rNorm:
        h = (gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0);
        break;
      case gNorm:
        h = (bNorm - rNorm) / d + 2;
        break;
      case bNorm:
        h = (rNorm - gNorm) / d + 4;
        break;
    }
    h /= 6;
  }

  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const val = Math.round(l * 255);
    return [val, val, val];
  }

  const hue2rgb = (p: number, q: number, tInput: number): number => {
    let t = tInput;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  const r = hue2rgb(p, q, h + 1 / 3);
  const g = hue2rgb(p, q, h);
  const b = hue2rgb(p, q, h - 1 / 3);

  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}
