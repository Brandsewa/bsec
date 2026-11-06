/**
 * Platform brand tokens (docs/PLATFORM-BRANDING-PLAN.md, ADR-010: validated data, never code).
 * Pure: no database, no network. Unknown or invalid values fall back to the base, so a bad stored row can never break UI.
 */
import { contrastRatio, readableOn } from "../system/email-branding.ts";

export interface BrandAsset {
  url: string;
  width: number | null;
  height: number | null;
  alt: string;
}
export interface BrandLogoSet {
  full: BrandAsset | null;
  icon: BrandAsset | null;
}
export interface BrandButton {
  background: string;
  text: string;
}
/** Enumerated font stacks: no webfont loading, no merchant-supplied CSS (ADR-010). */
export const PLATFORM_BRAND_FONTS = {
  system: 'ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif',
  rounded: 'ui-rounded,"SF Pro Rounded","Hiragino Maru Gothic ProN",Quicksand,Nunito,system-ui,sans-serif',
  serif: 'ui-serif,Georgia,Cambria,"Times New Roman",serif',
  mono: 'ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace',
} as const;
export type PlatformBrandFont = keyof typeof PLATFORM_BRAND_FONTS;

/** "dark" and "light" name the SURFACE the asset or button sits on (owner decision 2026-11-05). */
export interface PlatformBrandTokens {
  logo: { dark: BrandLogoSet; light: BrandLogoSet };
  favicon: BrandAsset | null;
  color: { primary: string; secondary: string };
  button: { dark: BrandButton; light: BrandButton };
  /** Empty strings mean "not set": consumers keep their built-in wording. */
  identity: { name: string; tagline: string };
  font: PlatformBrandFont;
}

export const DEFAULT_BRAND: PlatformBrandTokens = {
  logo: { dark: { full: null, icon: null }, light: { full: null, icon: null } },
  favicon: null,
  color: { primary: "#1f6f4a", secondary: "#1c1f1d" },
  button: {
    dark: { background: "#ffffff", text: "#1c1f1d" },
    light: { background: "#1f6f4a", text: "#ffffff" },
  },
  identity: { name: "", tagline: "" },
  font: "system",
};

export interface BrandIssue {
  field: string;
  message: string;
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function hex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!HEX.test(v)) return null;
  return (v.length === 4 ? `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}` : v).toLowerCase();
}

function assetUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (v.length === 0 || v.length > 500) return null;
  if (v.startsWith("/") && !v.startsWith("//")) return v;
  try {
    return new URL(v).protocol === "https:" ? v : null;
  } catch {
    return null;
  }
}

function dim(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n <= 8192 ? Math.round(n) : null;
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function parseAsset(raw: unknown, field: string, issues: BrandIssue[]): BrandAsset | null | undefined {
  if (raw === undefined) return undefined; // keep the base value
  if (raw === null) return null;
  const o = obj(raw);
  const url = assetUrl(o.url);
  if (!url) {
    issues.push({ field, message: "Use an uploaded image served over https." });
    return undefined;
  }
  const alt = typeof o.alt === "string" ? o.alt.replace(/<[^>]*>/g, "").trim().slice(0, 120) : "";
  return { url, width: dim(o.width), height: dim(o.height), alt };
}

export function parseBrandTokens(
  raw: unknown,
  base: PlatformBrandTokens = DEFAULT_BRAND,
): { tokens: PlatformBrandTokens; issues: BrandIssue[] } {
  const issues: BrandIssue[] = [];
  const r = obj(raw);
  const out: PlatformBrandTokens = structuredClone(base);

  const logo = obj(r.logo);
  for (const theme of ["dark", "light"] as const) {
    const set = obj(logo[theme]);
    for (const kind of ["full", "icon"] as const) {
      const a = parseAsset(set[kind], `logo.${theme}.${kind}`, issues);
      if (a !== undefined) out.logo[theme][kind] = a;
    }
  }
  const fav = parseAsset(r.favicon, "favicon", issues);
  if (fav !== undefined) out.favicon = fav;

  const color = obj(r.color);
  for (const k of ["primary", "secondary"] as const) {
    if (color[k] === undefined) continue;
    const h = hex(color[k]);
    if (h) out.color[k] = h;
    else issues.push({ field: `color.${k}`, message: "Use a hex colour such as #1f6f4a." });
  }

  const button = obj(r.button);
  for (const theme of ["dark", "light"] as const) {
    const b = obj(button[theme]);
    for (const k of ["background", "text"] as const) {
      if (b[k] === undefined) continue;
      const h = hex(b[k]);
      if (h) out.button[theme][k] = h;
      else issues.push({ field: `button.${theme}.${k}`, message: "Use a hex colour such as #ffffff." });
    }
    const btn = out.button[theme];
    if (contrastRatio(btn.text, btn.background) < 4.5) {
      issues.push({ field: `button.${theme}.text`, message: "Too little contrast against the button background (needs 4.5:1)." });
      btn.text = readableOn(btn.background);
    }
  }

  const identity = obj(r.identity);
  for (const [k, max] of [["name", 60], ["tagline", 140]] as const) {
    if (identity[k] === undefined) continue;
    if (typeof identity[k] !== "string") {
      issues.push({ field: `identity.${k}`, message: "Use plain text." });
      continue;
    }
    out.identity[k] = (identity[k] as string).replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, max);
  }

  if (r.font !== undefined) {
    if (typeof r.font === "string" && Object.prototype.hasOwnProperty.call(PLATFORM_BRAND_FONTS, r.font)) out.font = r.font as PlatformBrandFont;
    else issues.push({ field: "font", message: `Choose one of: ${Object.keys(PLATFORM_BRAND_FONTS).join(", ")}.` });
  }
  return { tokens: out, issues };
}

export const SHADE_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const;

function mix(a: [number, number, number], b: [number, number, number], t: number): string {
  const c = a.map((v, i) => Math.round(v + ((b[i] ?? 0) - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Ten-step ramp derived from one colour: tints toward white above 500, shades toward black below. 500 is the colour itself. */
export function shadeRamp(color: string): Record<(typeof SHADE_STEPS)[number], string> {
  const n = parseInt(color.slice(1), 16);
  const rgb: [number, number, number] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const white: [number, number, number] = [255, 255, 255];
  const black: [number, number, number] = [0, 0, 0];
  const out = {} as Record<(typeof SHADE_STEPS)[number], string>;
  for (const step of SHADE_STEPS) {
    out[step] = step === 500 ? color : step < 500 ? mix(rgb, white, (500 - step) / 500 * 0.92) : mix(rgb, black, (step - 500) / 400 * 0.6);
  }
  return out;
}

/** CSS custom properties for `:root` (light surfaces) and `.dark`. Values are validated hex only, so the string is safe to inline. */
export function buildBrandCss(t: PlatformBrandTokens): string {
  const vars = (theme: "dark" | "light") =>
    `--brand-primary:${t.color.primary};--brand-primary-foreground:${readableOn(t.color.primary)};` +
    `--brand-secondary:${t.color.secondary};--brand-secondary-foreground:${readableOn(t.color.secondary)};` +
    `--brand-button-bg:${t.button[theme].background};--brand-button-fg:${t.button[theme].text};`;
  const ramp = Object.entries(shadeRamp(t.color.primary)).map(([k, v]) => `--brand-primary-${k}:${v};`).join("");
  return `:root{${vars("light")}${ramp}--brand-font:${PLATFORM_BRAND_FONTS[t.font]};}.dark{${vars("dark")}}`;
}
