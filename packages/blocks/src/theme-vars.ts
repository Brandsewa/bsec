export interface BrandSettingsLike {
  primaryColor?: string | null | undefined;
  secondaryColor?: string | null | undefined;
  accentColor?: string | null | undefined;
  backgroundColor?: string | null | undefined;
  surfaceColor?: string | null | undefined;
  textColor?: string | null | undefined;
  fontHeading?: string | null | undefined;
  fontBody?: string | null | undefined;
  cornerRadius?: string | null | undefined;
  radius?: string | null | undefined;
  [key: string]: unknown;
}

export interface ThemeTokensLike {
  colors?: Record<string, string | undefined> | undefined;
  /** heading / body font names, plus headingWeight / bodyWeight (see FONT_WEIGHTS). */
  fonts?: Record<string, string | number | undefined> | undefined;
  radius?: string | undefined;
  /** Button look: solid (filled), outline or soft (tinted); own corner radius; uppercase labels. */
  buttons?:
    | {
        style?: string | undefined;
        radius?: string | undefined;
        /** Default button size: sm, md or lg. */
        size?: string | undefined;
        uppercase?: boolean | undefined;
        /** Main ("dark") button: background and text colour. Unset: the brand colour and its readable text colour. */
        darkBg?: string | undefined;
        darkText?: string | undefined;
        /** Secondary ("light") button: background and text colour. Unset: the soft background and the text colour. */
        lightBg?: string | undefined;
        lightText?: string | undefined;
      }
    | undefined;
  /** Heading sizes in pixels per level and device (see HEADING_LEVELS, DEFAULT_HEADING_SIZES). */
  fontSizes?: Record<string, Partial<Record<string, unknown>> | undefined> | undefined;
  /** Legacy shapes written by the first launch template; still read, never written. */
  typography?: { headingFont?: string | undefined; bodyFont?: string | undefined } | undefined;
  shape?: { radius?: string | undefined; buttonStyle?: string | undefined } | undefined;
  [key: string]: unknown;
}

/** Fonts a theme can choose. A short curated list keeps the page light and the editor safe. */
export const THEME_FONTS = [
  "Inter",
  "Poppins",
  "DM Sans",
  "Work Sans",
  "Montserrat",
  "Nunito",
  "Space Grotesk",
  "Playfair Display",
  "Lora",
  "Merriweather",
] as const;

/**
 * Heading sizes. Each level has a size per device, in pixels in the settings and emitted as rem
 * (so they follow the visitor's own font-size setting). Mobile-first: the stylesheet uses the mobile
 * size below 768px, the tablet size from 768px and the desktop size from 1024px (blocks.css).
 * The defaults reproduce the sizes the block stylesheet used before sizes were configurable.
 */
export const HEADING_LEVELS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;
export type HeadingLevel = (typeof HEADING_LEVELS)[number];
export const SIZE_DEVICES = ["desktop", "tablet", "mobile"] as const;
export type SizeDevice = (typeof SIZE_DEVICES)[number];
export type HeadingSizes = Record<HeadingLevel, Record<SizeDevice, number>>;
export const MIN_HEADING_PX = 12;
export const MAX_HEADING_PX = 120;

export const DEFAULT_HEADING_SIZES: HeadingSizes = {
  h1: { desktop: 60, tablet: 48, mobile: 36 },
  h2: { desktop: 36, tablet: 32, mobile: 28 },
  h3: { desktop: 24, tablet: 24, mobile: 22 },
  h4: { desktop: 18, tablet: 18, mobile: 18 },
  h5: { desktop: 16, tablet: 16, mobile: 16 },
  h6: { desktop: 14, tablet: 14, mobile: 14 },
};

/** A size in pixels clamped to the allowed range, or the fallback when it is not a usable number. */
function sanitizeHeadingPx(val: unknown, fallback: number): number {
  const n = typeof val === "number" ? val : typeof val === "string" && val.trim() !== "" ? Number(val) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_HEADING_PX, Math.max(MIN_HEADING_PX, Math.round(n)));
}

/** The heading sizes a theme resolves to: its own values where valid, the defaults elsewhere. */
export function resolveHeadingSizes(tokens: ThemeTokensLike | null | undefined): HeadingSizes {
  const out = {} as HeadingSizes;
  for (const level of HEADING_LEVELS) {
    const own = tokens?.fontSizes?.[level] ?? {};
    const def = DEFAULT_HEADING_SIZES[level];
    out[level] = {
      desktop: sanitizeHeadingPx(own["desktop"], def.desktop),
      tablet: sanitizeHeadingPx(own["tablet"], def.tablet),
      mobile: sanitizeHeadingPx(own["mobile"], def.mobile),
    };
  }
  return out;
}

/** Weights the theme fonts are loaded in (googleFontsHref requests 400 to 700). */
export const FONT_WEIGHTS = [400, 500, 600, 700] as const;
export type FontWeight = (typeof FONT_WEIGHTS)[number];
export const DEFAULT_HEADING_WEIGHT: FontWeight = 700;
export const DEFAULT_BODY_WEIGHT: FontWeight = 400;

export function resolveFontWeight(val: unknown, fallback: FontWeight): FontWeight {
  const n = typeof val === "number" ? val : typeof val === "string" ? Number(val) : NaN;
  return (FONT_WEIGHTS as readonly number[]).includes(n) ? (n as FontWeight) : fallback;
}

export const THEME_RADII = ["none", "sm", "md", "lg", "full"] as const;
/** Button sizes a theme can default to; blocks can override per button. */
export const BUTTON_SIZES = ["sm", "md", "lg"] as const;
export type ButtonSize = (typeof BUTTON_SIZES)[number];
export const BUTTON_SIZE_METRICS: Record<ButtonSize, { pad: string; font: string }> = {
  sm: { pad: "0.5rem 1rem", font: "0.875rem" },
  md: { pad: "0.75rem 1.5rem", font: "1rem" },
  lg: { pad: "1rem 2rem", font: "1.0625rem" },
};
export function resolveButtonSize(val: unknown): ButtonSize {
  return (BUTTON_SIZES as readonly unknown[]).includes(val) ? (val as ButtonSize) : "md";
}

export const BUTTON_STYLES = ["solid", "outline", "soft"] as const;

/** One Google Fonts stylesheet URL for the fonts a theme uses (null when none are curated fonts). */
export function googleFontsHref(tokens: ThemeTokensLike | null | undefined): string | null {
  const names = new Set<string>();
  for (const f of [tokens?.fonts?.heading ?? tokens?.typography?.headingFont, tokens?.fonts?.body ?? tokens?.typography?.bodyFont]) {
    if (typeof f === "string" && (THEME_FONTS as readonly string[]).includes(f)) names.add(f);
  }
  if (names.size === 0) return null;
  const fam = [...names].map((n) => `family=${n.replace(/ /g, "+")}:wght@400;500;600;700`).join("&");
  return `https://fonts.googleapis.com/css2?${fam}&display=swap`;
}

const RADIUS_MAP: Record<string, string> = {
  none: "0px",
  sm: "0.25rem",
  small: "0.25rem",
  md: "0.5rem",
  medium: "0.5rem",
  lg: "0.75rem",
  large: "0.75rem",
  full: "9999px",
};

const HEX_COLOR_REGEX = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const RGB_HSL_COLOR_REGEX =
  /^(?:rgb|rgba|hsl|hsla)\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?(?:\s*,\s*[\d.]+%)?\s*\)$/i;
const FONT_SAFE_REGEX = /^[a-zA-Z0-9\s,_-]+$/;
const DIMENSION_RADIUS_REGEX = /^\d+(\.\d+)?(px|rem|em|%)$/;

function sanitizeColor(val: unknown, fallback: string): string {
  if (typeof val !== "string") return fallback;
  const trimmed = val.trim();
  if (HEX_COLOR_REGEX.test(trimmed) || RGB_HSL_COLOR_REGEX.test(trimmed)) {
    return trimmed;
  }
  return fallback;
}

function sanitizeFont(val: unknown, fallback: string): string {
  if (typeof val !== "string") return fallback;
  const trimmed = val.trim();
  if (
    trimmed.includes(";") ||
    trimmed.includes("{") ||
    trimmed.includes("}") ||
    trimmed.includes("url") ||
    trimmed.includes("import") ||
    trimmed.includes('"') ||
    trimmed.includes("'")
  ) {
    return fallback;
  }
  if (!FONT_SAFE_REGEX.test(trimmed)) {
    return fallback;
  }
  return trimmed;
}

function sanitizeRadius(val: unknown, fallback: string): string {
  if (typeof val !== "string") return fallback;
  const trimmed = val.trim();
  const mapped = RADIUS_MAP[trimmed];
  if (mapped) {
    return mapped;
  }
  if (DIMENSION_RADIUS_REGEX.test(trimmed)) {
    return trimmed;
  }
  return fallback;
}

/** Black or white, whichever reads better on the given hex colour (falls back to white). */
function readableOn(color: string): string {
  const m = /^#([0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-f])/i.exec(color);
  if (!m?.[1]) return "#ffffff";
  const hex = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  // Pick whichever of white or near-black has the higher WCAG contrast ratio (they tie at lum ~0.18).
  return lum > 0.18 ? "#0f172a" : "#ffffff";
}

export function computeThemeTokens(
  brandSettings?: BrandSettingsLike | null,
  themeTokens?: ThemeTokensLike | null,
): Record<string, string> {
  const brandRadiusKey =
    brandSettings?.cornerRadius ?? brandSettings?.radius ?? "md";

  const rawRadius =
    typeof themeTokens?.radius === "string"
      ? themeTokens.radius
      : typeof themeTokens?.shape?.radius === "string"
        ? themeTokens.shape.radius
        : typeof brandRadiusKey === "string"
          ? brandRadiusKey
          : "md";

  const colors = (themeTokens?.colors as Record<string, string | undefined>) ?? {};

  const rawPrimary = brandSettings?.primaryColor || colors["primary"];
  const rawSecondary = brandSettings?.secondaryColor || colors["secondary"];
  const rawAccent = brandSettings?.accentColor || colors["accent"];
  const rawBackground = brandSettings?.backgroundColor || colors["background"];
  const rawSurface = brandSettings?.surfaceColor || colors["surface"];
  const rawText = brandSettings?.textColor || colors["text"];

  const rawFontHeading = brandSettings?.fontHeading || themeTokens?.fonts?.heading || themeTokens?.typography?.headingFont;
  const rawFontBody = brandSettings?.fontBody || themeTokens?.fonts?.body || themeTokens?.typography?.bodyFont;

  const primary = sanitizeColor(rawPrimary, "#0f172a");
  const secondary = sanitizeColor(rawSecondary, "#334155");
  const accent = sanitizeColor(rawAccent, "#2563eb");
  const background = sanitizeColor(rawBackground, "#ffffff");
  const surface = sanitizeColor(rawSurface, "#f8fafc");
  const text = sanitizeColor(rawText, "#0f172a");

  const fontHeading = sanitizeFont(rawFontHeading, "Inter");
  const fontBody = sanitizeFont(rawFontBody, "Inter");

  const radiusFull = sanitizeRadius(rawRadius, "0.5rem");
  // A pill is for buttons and chips; on cards and images it would turn them into circles.
  const radius = radiusFull === "9999px" ? "1.25rem" : radiusFull;
  const btnRadius = sanitizeRadius(themeTokens?.buttons?.radius ?? rawRadius, radiusFull);
  // Two button colour schemes. "Dark" is the main button (its background doubles as the base of the outline
  // and soft styles); "light" is the secondary button. Unset values fall back to the original look.
  const btnTokens = themeTokens?.buttons;
  const darkBg = sanitizeColor(btnTokens?.darkBg, primary);
  const darkFg = sanitizeColor(btnTokens?.darkText, readableOn(darkBg));
  const hasLightBg = typeof btnTokens?.lightBg === "string" && sanitizeColor(btnTokens.lightBg, "") !== "";
  const lightBg = sanitizeColor(btnTokens?.lightBg, surface);
  const lightFg = sanitizeColor(btnTokens?.lightText, text);
  const btnStyleRaw = themeTokens?.buttons?.style ?? themeTokens?.shape?.buttonStyle;
  const btnStyle = btnStyleRaw === "outline" || btnStyleRaw === "soft" ? btnStyleRaw : "solid";
  const btn =
    btnStyle === "outline"
      ? { bg: "transparent", fg: darkBg, bd: darkBg }
      : btnStyle === "soft"
        ? { bg: `color-mix(in srgb, ${darkBg} 14%, transparent)`, fg: darkBg, bd: "transparent" }
        : { bg: darkBg, fg: darkFg, bd: darkBg };

  const sizes = resolveHeadingSizes(themeTokens);
  const sizeVars: Record<string, string> = {};
  for (const level of HEADING_LEVELS) {
    sizeVars[`--bs-${level}-d`] = `${sizes[level].desktop / 16}rem`;
    sizeVars[`--bs-${level}-t`] = `${sizes[level].tablet / 16}rem`;
    sizeVars[`--bs-${level}-m`] = `${sizes[level].mobile / 16}rem`;
  }

  return {
    ...sizeVars,
    // Block stylesheet variables (blocks.css). Same sanitized values, separate namespace so
    // they cannot collide with host Tailwind/theme variables.
    "--bs-primary": primary,
    "--bs-primary-fg": readableOn(primary),
    "--bs-surface": surface,
    "--bs-bg": background,
    "--bs-text": text,
    "--bs-muted": `color-mix(in srgb, ${text} 60%, ${background})`,
    "--bs-border": `color-mix(in srgb, ${text} 15%, ${background})`,
    "--bs-radius": radius,
    "--bs-btn-radius": btnRadius,
    "--bs-btn-bg": btn.bg,
    "--bs-btn-fg": btn.fg,
    "--bs-btn-bd": btn.bd,
    "--bs-btn-dark-bg": darkBg,
    "--bs-btn-dark-fg": darkFg,
    "--bs-btn-light-bg": lightBg,
    "--bs-btn-light-fg": lightFg,
    "--bs-btn-light-bd": hasLightBg ? lightBg : `color-mix(in srgb, ${text} 15%, ${background})`,
    "--bs-heading-weight": String(resolveFontWeight(themeTokens?.fonts?.["headingWeight"], DEFAULT_HEADING_WEIGHT)),
    "--bs-body-weight": String(resolveFontWeight(themeTokens?.fonts?.["bodyWeight"], DEFAULT_BODY_WEIGHT)),
    "--bs-btn-pad": BUTTON_SIZE_METRICS[resolveButtonSize(themeTokens?.buttons?.size)].pad,
    "--bs-btn-fs": BUTTON_SIZE_METRICS[resolveButtonSize(themeTokens?.buttons?.size)].font,
    "--bs-btn-case": themeTokens?.buttons?.uppercase ? "uppercase" : "none",
    "--bs-font-heading": `"${fontHeading}", ui-sans-serif, system-ui, sans-serif`,
    "--bs-font-body": `"${fontBody}", ui-sans-serif, system-ui, sans-serif`,
    "--color-primary": primary,
    "--color-secondary": secondary,
    "--color-accent": accent,
    "--color-background": background,
    "--color-surface": surface,
    "--color-text": text,
    // Bare names: the long-standing contract of these variables. Blocks use the --bs-font-* ones, which add fallbacks.
    "--font-heading": fontHeading,
    "--font-body": fontBody,
    "--radius": radius,
  };
}

/**
 * The CSS variables a store's look resolves to. Stores that use the theme system (tokens carry
 * source "theme", set when a library theme is activated or theme settings are saved) are styled
 * by those tokens; everyone else keeps being styled by Branding settings, as before.
 */
export function resolveThemeTokens(
  brandSettings?: BrandSettingsLike | null,
  themeTokens?: ThemeTokensLike | null,
): Record<string, string> {
  return themeTokens?.["source"] === "theme"
    ? computeThemeTokens(null, themeTokens)
    : computeThemeTokens(brandSettings ?? null, themeTokens ?? null);
}
