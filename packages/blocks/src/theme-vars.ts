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
  fonts?: Record<string, string | undefined> | undefined;
  radius?: string | undefined;
  [key: string]: unknown;
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

  const rawFontHeading = brandSettings?.fontHeading || themeTokens?.fonts?.heading;
  const rawFontBody = brandSettings?.fontBody || themeTokens?.fonts?.body;

  const primary = sanitizeColor(rawPrimary, "#0f172a");
  const secondary = sanitizeColor(rawSecondary, "#334155");
  const accent = sanitizeColor(rawAccent, "#2563eb");
  const background = sanitizeColor(rawBackground, "#ffffff");
  const surface = sanitizeColor(rawSurface, "#f8fafc");
  const text = sanitizeColor(rawText, "#0f172a");

  const fontHeading = sanitizeFont(rawFontHeading, "Inter");
  const fontBody = sanitizeFont(rawFontBody, "Inter");

  const radius = sanitizeRadius(rawRadius, "0.5rem");

  return {
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
    "--bs-font-heading": fontHeading === "Inter" ? "inherit" : `"${fontHeading}", inherit`,
    "--color-primary": primary,
    "--color-secondary": secondary,
    "--color-accent": accent,
    "--color-background": background,
    "--color-surface": surface,
    "--color-text": text,
    "--font-heading": fontHeading,
    "--font-body": fontBody,
    "--radius": radius,
  };
}
