/**
 * Accent colour derivation for customer account and Appearance preview (Guide §11).
 *
 * Given a store primary/accent hex color, derives accessible variants in OKLCH:
 * - fill: original normalized hex
 * - onFill: #000000 or #ffffff based on highest WCAG contrast against fill
 * - ink: darkened in OKLCH lightness until contrast on white surface is >= 4.5:1
 * - deep: pressed / darkened state
 * - soft: light tinted pastel background
 * - ring: focus ring (fill)
 *
 * Returns null if the input hex is invalid, allowing callers to fall back to platform mint (#00d4a4).
 */

export interface DerivedAccent {
  fill: string;
  deep: string;
  ink: string;
  soft: string;
  ring: string;
  onFill: string;
}

/** Parse hex string to [r, g, b] (0..255). Returns null on invalid input. */
export function parseHex(hex: unknown): [number, number, number] | null {
  if (typeof hex !== "string") return null;
  const clean = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{3,8}$/.test(clean)) return null;

  let r: number;
  let g: number;
  let b: number;
  if (clean.length === 3 || clean.length === 4) {
    const c0 = clean.charAt(0);
    const c1 = clean.charAt(1);
    const c2 = clean.charAt(2);
    r = parseInt(c0 + c0, 16);
    g = parseInt(c1 + c1, 16);
    b = parseInt(c2 + c2, 16);
  } else if (clean.length === 6 || clean.length === 8) {
    r = parseInt(clean.slice(0, 2), 16);
    g = parseInt(clean.slice(2, 4), 16);
    b = parseInt(clean.slice(4, 6), 16);
  } else {
    return null;
  }

  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
  return [r, g, b];
}

/** Convert [r, g, b] to 6-digit lowercase hex string. */
export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const toHex = (v: number) => clamp(v).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Relative luminance according to WCAG 2.1. */
export function relativeLuminance(r: number, g: number, b: number): number {
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** Contrast ratio between two relative luminance values. */
export function contrastRatio(lum1: number, lum2: number): number {
  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Contrast ratio between two RGB colors. */
export function contrastRatioRgb(c1: [number, number, number], c2: [number, number, number]): number {
  return contrastRatio(relativeLuminance(c1[0], c1[1], c1[2]), relativeLuminance(c2[0], c2[1], c2[2]));
}

// sRGB <-> OKLCH transformations (Björn Ottosson's OKLab)
function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function linearToSrgb(c: number): number {
  const clamped = Math.max(0, Math.min(1, c));
  return clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
}

export function rgbToOklch(r: number, g: number, b: number): { l: number; c: number; h: number } {
  const rLin = srgbToLinear(r);
  const gLin = srgbToLinear(g);
  const bLin = srgbToLinear(b);

  const l = 0.4122214708 * rLin + 0.5363325363 * gLin + 0.0514459929 * bLin;
  const m = 0.2119034982 * rLin + 0.6806995451 * gLin + 0.1073969566 * bLin;
  const s = 0.0883024619 * rLin + 0.2817188376 * gLin + 0.6299787005 * bLin;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  const L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
  const b_ = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;

  const C = Math.sqrt(a * a + b_ * b_);
  let H = Math.atan2(b_, a) * (180 / Math.PI);
  if (H < 0) H += 360;

  return { l: L, c: C, h: H };
}

export function oklchToRgb(L: number, C: number, H: number): [number, number, number] {
  const hRad = (H * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  const rLin = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const gLin = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bLin = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;

  return [
    Math.round(linearToSrgb(rLin) * 255),
    Math.round(linearToSrgb(gLin) * 255),
    Math.round(linearToSrgb(bLin) * 255),
  ];
}

/**
 * Derives accessible accent variables from a raw hex code.
 *
 * @param hex Raw color hex string (e.g. "#00d4a4", "00d4a4", "#ff0000")
 * @returns DerivedAccent object or null if input is invalid
 */
export function deriveAccent(hex: string | null | undefined): DerivedAccent | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;

  const fill = rgbToHex(rgb[0], rgb[1], rgb[2]);
  const lum = relativeLuminance(rgb[0], rgb[1], rgb[2]);

  // onFill: pick black (#000000) or white (#ffffff) based on higher contrast
  const contrastBlack = contrastRatio(lum, 0);
  const contrastWhite = contrastRatio(lum, 1);
  const onFill = contrastBlack >= contrastWhite ? "#000000" : "#ffffff";

  const { l: L, c: C, h: H } = rgbToOklch(rgb[0], rgb[1], rgb[2]);

  // ink: must achieve at least 4.5:1 contrast against white (#ffffff, lum = 1)
  let inkRgb = rgb;
  if (contrastWhite < 4.5) {
    let lowL = 0;
    let highL = L;
    let bestRgb = oklchToRgb(0, 0, H);

    for (let i = 0; i < 20; i++) {
      const midL = (lowL + highL) / 2;
      const midChroma = Math.min(C, midL * 0.8 + 0.05);
      const testRgb = oklchToRgb(midL, midChroma, H);
      const testLum = relativeLuminance(testRgb[0], testRgb[1], testRgb[2]);

      if (contrastRatio(1, testLum) >= 4.5) {
        bestRgb = testRgb;
        lowL = midL; // Try higher lightness while maintaining >= 4.5:1
      } else {
        highL = midL; // Too bright, needs to be darker
      }
    }
    inkRgb = bestRgb;
  }
  const ink = rgbToHex(inkRgb[0], inkRgb[1], inkRgb[2]);

  // deep: pressed state (darkened)
  const deepL = L > 0.15 ? Math.max(0, L - 0.08) : Math.max(0, L * 0.7);
  const deepRgb = oklchToRgb(deepL, C, H);
  const deep = rgbToHex(deepRgb[0], deepRgb[1], deepRgb[2]);

  // soft: light tinted background
  const softL = 0.96;
  const softC = Math.min(C * 0.2, 0.035);
  const softRgb = oklchToRgb(softL, softC, H);
  const soft = rgbToHex(softRgb[0], softRgb[1], softRgb[2]);

  // ring: focus ring is fill
  const ring = fill;

  return {
    fill,
    deep,
    ink,
    soft,
    ring,
    onFill,
  };
}
