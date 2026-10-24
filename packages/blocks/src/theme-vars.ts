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
  /** Global layout defaults: site width, section and container sizing/margin/padding per device. */
  layout?: ThemeLayoutSettings | undefined;
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

/** Body text size per device, stored beside the heading levels as fontSizes.body. */
export const MIN_BODY_PX = 12;
export const MAX_BODY_PX = 24;
export const DEFAULT_BODY_SIZES: Record<SizeDevice, number> = { desktop: 16, tablet: 16, mobile: 16 };

export function resolveBodySizes(tokens: ThemeTokensLike | null | undefined): Record<SizeDevice, number> {
  const own = tokens?.fontSizes?.["body"] ?? {};
  const one = (val: unknown, fallback: number) => {
    const n = typeof val === "number" ? val : typeof val === "string" && val.trim() !== "" ? Number(val) : NaN;
    return Number.isFinite(n) ? Math.min(MAX_BODY_PX, Math.max(MIN_BODY_PX, Math.round(n))) : fallback;
  };
  return {
    desktop: one(own["desktop"], DEFAULT_BODY_SIZES.desktop),
    tablet: one(own["tablet"], DEFAULT_BODY_SIZES.tablet),
    mobile: one(own["mobile"], DEFAULT_BODY_SIZES.mobile),
  };
}

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

export interface SpacingQuadValues {
  top?: string | undefined;
  right?: string | undefined;
  bottom?: string | undefined;
  left?: string | undefined;
}

export interface SizingValues {
  width?: string | undefined;
  minWidth?: string | undefined;
  maxWidth?: string | undefined;
}

export interface ThemeLayoutElementSettings {
  margin?: SpacingQuadValues | undefined;
  padding?: SpacingQuadValues | undefined;
  width?: string | undefined;
  minWidth?: string | undefined;
  maxWidth?: string | undefined;
  sizing?: SizingValues | undefined;
}

export interface ThemeLayoutDeviceSettings {
  siteWidth?: string | undefined;
  section?: ThemeLayoutElementSettings | undefined;
  container?: ThemeLayoutElementSettings | undefined;
}

export interface ThemeLayoutSettings {
  desktop?: ThemeLayoutDeviceSettings | undefined;
  tablet?: ThemeLayoutDeviceSettings | undefined;
  mobile?: ThemeLayoutDeviceSettings | undefined;
}

export const DEFAULT_SITE_WIDTHS: Record<SizeDevice, string> = {
  desktop: "1200px",
  tablet: "100%",
  mobile: "100%",
};

export function sanitizeLayoutLength(val: unknown, fallback?: string): string | undefined {
  if (typeof val === "number" && Number.isFinite(val)) {
    return `${val}px`;
  }
  if (typeof val !== "string") return fallback;
  const trimmed = val.trim();
  if (!trimmed) return fallback;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return `${trimmed}px`;
  }
  if (/^-?\d+(\.\d+)?(px|%|rem|em|vw|vh)$/.test(trimmed)) {
    return trimmed;
  }
  if (trimmed === "auto" || trimmed === "none" || trimmed === "initial") {
    return trimmed;
  }
  return fallback;
}

export interface ResolvedDeviceLayout {
  siteWidth: string;
  section: {
    margin: SpacingQuadValues;
    padding: SpacingQuadValues;
    sizing: SizingValues;
  };
  container: {
    margin: SpacingQuadValues;
    padding: SpacingQuadValues;
    sizing: SizingValues;
  };
}

export type ResolvedThemeLayout = Record<SizeDevice, ResolvedDeviceLayout>;

export function resolveThemeLayout(tokens: ThemeTokensLike | null | undefined): ResolvedThemeLayout {
  const layout = tokens?.layout;
  const resolveDevice = (dev: SizeDevice): ResolvedDeviceLayout => {
    const rawDev = layout?.[dev] ?? {};
    const siteWidth = sanitizeLayoutLength(rawDev.siteWidth, DEFAULT_SITE_WIDTHS[dev]) ?? DEFAULT_SITE_WIDTHS[dev];

    const getElementProps = (rawElem: ThemeLayoutElementSettings | undefined) => {
      const margin: SpacingQuadValues = {
        top: sanitizeLayoutLength(rawElem?.margin?.top),
        right: sanitizeLayoutLength(rawElem?.margin?.right),
        bottom: sanitizeLayoutLength(rawElem?.margin?.bottom),
        left: sanitizeLayoutLength(rawElem?.margin?.left),
      };
      const padding: SpacingQuadValues = {
        top: sanitizeLayoutLength(rawElem?.padding?.top),
        right: sanitizeLayoutLength(rawElem?.padding?.right),
        bottom: sanitizeLayoutLength(rawElem?.padding?.bottom),
        left: sanitizeLayoutLength(rawElem?.padding?.left),
      };
      const sizing: SizingValues = {
        width: sanitizeLayoutLength(rawElem?.sizing?.width ?? rawElem?.width),
        minWidth: sanitizeLayoutLength(rawElem?.sizing?.minWidth ?? rawElem?.minWidth),
        maxWidth: sanitizeLayoutLength(rawElem?.sizing?.maxWidth ?? rawElem?.maxWidth),
      };
      return { margin, padding, sizing };
    };

    return {
      siteWidth,
      section: getElementProps(rawDev.section),
      container: getElementProps(rawDev.container),
    };
  };

  return {
    desktop: resolveDevice("desktop"),
    tablet: resolveDevice("tablet"),
    mobile: resolveDevice("mobile"),
  };
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
export function readableOn(color: string): string {
  const m = /^#([0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-f])/i.exec(color);
  if (!m?.[1]) return "#ffffff";
  const hex = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  // Pick whichever of white or near-black has the higher WCAG contrast ratio (they tie at lum ~0.18).
  return lum > 0.18 ? "#0f172a" : "#ffffff";
}

export const DEFAULT_THEME_COLORS = {
  siteBackground: "#ffffff",
  primary: "#0f172a",
  secondary: "#334155",
  accent1: "#2563eb",
  accent2: "#f59e0b",
  lightHeading: "#0f172a",
  lightText: "#334155",
  lightButton: "#0f172a",
  lightButtonText: "#ffffff",
  lightBackground: "#f8fafc",
  darkHeading: "#ffffff",
  darkText: "#ffffff",
  darkButton: "#ffffff",
  darkButtonText: "#0f172a",
  darkBackground: "#0f172a",
} as const;

export type ThemeColorKey = keyof typeof DEFAULT_THEME_COLORS;

export interface GlobalColorDef {
  key: ThemeColorKey;
  label: string;
  group: "site" | "palette" | "light" | "dark";
  groupLabel: string;
}

export const GLOBAL_COLOR_DEFINITIONS: readonly GlobalColorDef[] = [
  { key: "siteBackground", label: "Site Background", group: "site", groupLabel: "Site Background" },
  { key: "primary", label: "Primary", group: "palette", groupLabel: "Palette" },
  { key: "secondary", label: "Secondary", group: "palette", groupLabel: "Palette" },
  { key: "accent1", label: "Accent 1", group: "palette", groupLabel: "Palette" },
  { key: "accent2", label: "Accent 2", group: "palette", groupLabel: "Palette" },
  { key: "lightHeading", label: "Heading", group: "light", groupLabel: "Light Scheme" },
  { key: "lightText", label: "Text", group: "light", groupLabel: "Light Scheme" },
  { key: "lightButton", label: "Button", group: "light", groupLabel: "Light Scheme" },
  { key: "lightButtonText", label: "Button Text", group: "light", groupLabel: "Light Scheme" },
  { key: "lightBackground", label: "Backgrounds", group: "light", groupLabel: "Light Scheme" },
  { key: "darkHeading", label: "Heading", group: "dark", groupLabel: "Dark Scheme" },
  { key: "darkText", label: "Text", group: "dark", groupLabel: "Dark Scheme" },
  { key: "darkButton", label: "Button Background", group: "dark", groupLabel: "Dark Scheme" },
  { key: "darkButtonText", label: "Button Text", group: "dark", groupLabel: "Dark Scheme" },
  { key: "darkBackground", label: "Backgrounds", group: "dark", groupLabel: "Dark Scheme" },
] as const;

export type ResolvedThemeColors = Record<ThemeColorKey, string> & {
  background: string;
  accent: string;
  surface: string;
  text: string;
  dark: string;
  textOnDark: string;
};

export function resolveThemeColors(
  brandSettings?: BrandSettingsLike | null,
  themeTokens?: ThemeTokensLike | null,
): ResolvedThemeColors {
  const c = (themeTokens?.colors as Record<string, string | undefined>) ?? {};
  const b = themeTokens?.buttons ?? {};

  const rawPrimary = brandSettings?.primaryColor || c["primary"];
  const rawSecondary = brandSettings?.secondaryColor || c["secondary"];
  const rawAccent1 = brandSettings?.accentColor || c["accent1"] || c["accent"];
  const rawAccent2 = c["accent2"];
  const rawBackground = brandSettings?.backgroundColor || c["siteBackground"] || c["background"];

  const rawLightHeading = c["lightHeading"] || c["heading"] || rawPrimary;
  const rawLightText = brandSettings?.textColor || c["lightText"] || c["text"];
  const rawLightBg = brandSettings?.surfaceColor || c["lightBackground"] || c["surface"];

  const primary = sanitizeColor(rawPrimary, DEFAULT_THEME_COLORS.primary);
  const secondary = sanitizeColor(rawSecondary, DEFAULT_THEME_COLORS.secondary);
  const accent1 = sanitizeColor(rawAccent1, DEFAULT_THEME_COLORS.accent1);
  const accent2 = sanitizeColor(rawAccent2, DEFAULT_THEME_COLORS.accent2);
  const siteBackground = sanitizeColor(rawBackground, DEFAULT_THEME_COLORS.siteBackground);

  const lightHeading = sanitizeColor(rawLightHeading, primary);
  const lightText = sanitizeColor(rawLightText, DEFAULT_THEME_COLORS.lightText);
  const lightButton = sanitizeColor(c["lightButton"] || b.darkBg, primary);
  const lightButtonText = sanitizeColor(c["lightButtonText"] || b.darkText, readableOn(lightButton));
  const lightBackground = sanitizeColor(rawLightBg, DEFAULT_THEME_COLORS.lightBackground);

  const rawDarkBg = brandSettings?.["darkColor"] || c["darkBackground"] || c["dark"];
  const darkBackground = sanitizeColor(rawDarkBg, DEFAULT_THEME_COLORS.darkBackground);
  const darkHeading = sanitizeColor(c["darkHeading"], DEFAULT_THEME_COLORS.darkHeading);
  const rawDarkText = c["darkText"] || c["textOnDark"];
  const darkText = rawDarkText ? sanitizeColor(rawDarkText, DEFAULT_THEME_COLORS.darkText) : readableOn(darkBackground);
  const darkButton = sanitizeColor(c["darkButton"], DEFAULT_THEME_COLORS.darkButton);
  const darkButtonText = sanitizeColor(c["darkButtonText"] || b.lightText, DEFAULT_THEME_COLORS.darkButtonText);

  return {
    siteBackground,
    primary,
    secondary,
    accent1,
    accent2,
    lightHeading,
    lightText,
    lightButton,
    lightButtonText,
    lightBackground,
    darkHeading,
    darkText,
    darkButton,
    darkButtonText,
    darkBackground,
    // Legacy aliases
    background: siteBackground,
    accent: accent1,
    surface: lightBackground,
    text: lightText,
    dark: darkBackground,
    textOnDark: darkText,
  };
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

  const resolvedColors = resolveThemeColors(brandSettings, themeTokens);

  const primary = resolvedColors.primary;
  const secondary = resolvedColors.secondary;
  const accent = resolvedColors.accent1;
  const accent1 = resolvedColors.accent1;
  const accent2 = resolvedColors.accent2;
  const background = resolvedColors.siteBackground;
  const surface = resolvedColors.lightBackground;
  const text = resolvedColors.lightText;
  const dark = resolvedColors.darkBackground;
  const onDark = resolvedColors.darkText;

  const rawFontHeading = brandSettings?.fontHeading || themeTokens?.fonts?.heading || themeTokens?.typography?.headingFont;
  const rawFontBody = brandSettings?.fontBody || themeTokens?.fonts?.body || themeTokens?.typography?.bodyFont;

  const fontHeading = sanitizeFont(rawFontHeading, "Inter");
  const fontBody = sanitizeFont(rawFontBody, "Inter");

  const radiusFull = sanitizeRadius(rawRadius, "0.5rem");
  // A pill is for buttons and chips; on cards and images it would turn them into circles.
  const radius = radiusFull === "9999px" ? "1.25rem" : radiusFull;
  const btnRadius = sanitizeRadius(themeTokens?.buttons?.radius ?? rawRadius, radiusFull);
  // Two button colour schemes. "Dark" is the main button (its background doubles as the base of the outline
  // and soft styles); "light" is the secondary button. Unset values fall back to the original look.
  const btnTokens = themeTokens?.buttons;
  const darkBg = sanitizeColor(btnTokens?.darkBg, resolvedColors.lightButton);
  const darkFg = sanitizeColor(btnTokens?.darkText, resolvedColors.lightButtonText);
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

  const body = resolveBodySizes(themeTokens);
  sizeVars["--bs-body-d"] = `${body.desktop / 16}rem`;
  sizeVars["--bs-body-t"] = `${body.tablet / 16}rem`;
  sizeVars["--bs-body-m"] = `${body.mobile / 16}rem`;

  const layout = resolveThemeLayout(themeTokens);
  const layoutVars: Record<string, string> = {};
  const devLetters: Record<SizeDevice, string> = { desktop: "d", tablet: "t", mobile: "m" };
  for (const dev of SIZE_DEVICES) {
    const ltr = devLetters[dev];
    const devLayout = layout[dev];
    layoutVars[`--bs-site-w-${ltr}`] = devLayout.siteWidth;

    const sec = devLayout.section;
    if (sec.padding.top) layoutVars[`--bs-sec-${ltr}-pt`] = sec.padding.top;
    if (sec.padding.right) layoutVars[`--bs-sec-${ltr}-pr`] = sec.padding.right;
    if (sec.padding.bottom) layoutVars[`--bs-sec-${ltr}-pb`] = sec.padding.bottom;
    if (sec.padding.left) layoutVars[`--bs-sec-${ltr}-pl`] = sec.padding.left;
    if (sec.margin.top) layoutVars[`--bs-sec-${ltr}-mt`] = sec.margin.top;
    if (sec.margin.right) layoutVars[`--bs-sec-${ltr}-mr`] = sec.margin.right;
    if (sec.margin.bottom) layoutVars[`--bs-sec-${ltr}-mb`] = sec.margin.bottom;
    if (sec.margin.left) layoutVars[`--bs-sec-${ltr}-ml`] = sec.margin.left;
    if (sec.sizing.width) layoutVars[`--bs-sec-${ltr}-w`] = sec.sizing.width;
    if (sec.sizing.minWidth) layoutVars[`--bs-sec-${ltr}-mnw`] = sec.sizing.minWidth;
    if (sec.sizing.maxWidth) layoutVars[`--bs-sec-${ltr}-mxw`] = sec.sizing.maxWidth;

    const cnt = devLayout.container;
    if (cnt.padding.top) layoutVars[`--bs-cnt-${ltr}-pt`] = cnt.padding.top;
    if (cnt.padding.right) layoutVars[`--bs-cnt-${ltr}-pr`] = cnt.padding.right;
    if (cnt.padding.bottom) layoutVars[`--bs-cnt-${ltr}-pb`] = cnt.padding.bottom;
    if (cnt.padding.left) layoutVars[`--bs-cnt-${ltr}-pl`] = cnt.padding.left;
    if (cnt.margin.top) layoutVars[`--bs-cnt-${ltr}-mt`] = cnt.margin.top;
    if (cnt.margin.right) layoutVars[`--bs-cnt-${ltr}-mr`] = cnt.margin.right;
    if (cnt.margin.bottom) layoutVars[`--bs-cnt-${ltr}-mb`] = cnt.margin.bottom;
    if (cnt.margin.left) layoutVars[`--bs-cnt-${ltr}-ml`] = cnt.margin.left;
    if (cnt.sizing.width) layoutVars[`--bs-cnt-${ltr}-w`] = cnt.sizing.width;
    if (cnt.sizing.minWidth) layoutVars[`--bs-cnt-${ltr}-mnw`] = cnt.sizing.minWidth;
    if (cnt.sizing.maxWidth) layoutVars[`--bs-cnt-${ltr}-mxw`] = cnt.sizing.maxWidth;
  }

  return {
    ...sizeVars,
    ...layoutVars,
    // Block stylesheet variables (blocks.css). Same sanitized values, separate namespace so
    // they cannot collide with host Tailwind/theme variables.
    "--bs-primary": primary,
    "--bs-primary-fg": readableOn(primary),
    "--bs-secondary": secondary,
    "--bs-accent": accent,
    "--bs-accent1": accent1,
    "--bs-accent2": accent2,
    "--bs-surface": surface,
    "--bs-site-bg": background,
    "--bs-bg": background,
    "--bs-text": text,
    "--bs-dark": dark,
    "--bs-on-dark": onDark,
    "--bs-light-heading": resolvedColors.lightHeading,
    "--bs-light-text": resolvedColors.lightText,
    "--bs-light-btn-bg": resolvedColors.lightButton,
    "--bs-light-btn-fg": resolvedColors.lightButtonText,
    "--bs-light-bg": resolvedColors.lightBackground,
    "--bs-dark-heading": resolvedColors.darkHeading,
    "--bs-dark-text": resolvedColors.darkText,
    "--bs-dark-btn-bg": resolvedColors.darkButton,
    "--bs-dark-btn-fg": resolvedColors.darkButtonText,
    "--bs-dark-bg": resolvedColors.darkBackground,
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
    "--color-dark": dark,
    "--color-text-on-dark": onDark,
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
