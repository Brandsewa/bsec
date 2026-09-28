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

export function computeThemeTokens(
  brandSettings?: BrandSettingsLike | null,
  themeTokens?: ThemeTokensLike | null,
): Record<string, string> {
  const brandRadiusKey =
    brandSettings?.cornerRadius ?? brandSettings?.radius ?? "md";
  const mappedRadius =
    RADIUS_MAP[brandRadiusKey] ?? (typeof brandRadiusKey === "string" ? brandRadiusKey : "0.5rem");

  const colors = (themeTokens?.colors as Record<string, string | undefined>) ?? {};

  const primary =
    brandSettings?.primaryColor ||
    colors["primary"] ||
    "#0f172a";

  const secondary =
    brandSettings?.secondaryColor ||
    colors["secondary"] ||
    "#334155";

  const accent =
    brandSettings?.accentColor ||
    colors["accent"] ||
    "#2563eb";

  const background =
    brandSettings?.backgroundColor ||
    colors["background"] ||
    "#ffffff";

  const surface =
    brandSettings?.surfaceColor ||
    colors["surface"] ||
    "#f8fafc";

  const text =
    brandSettings?.textColor ||
    colors["text"] ||
    "#0f172a";

  const fontHeading =
    brandSettings?.fontHeading ||
    themeTokens?.fonts?.heading ||
    "Inter";

  const fontBody =
    brandSettings?.fontBody ||
    themeTokens?.fonts?.body ||
    "Inter";

  const radius = themeTokens?.radius || mappedRadius;

  return {
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
