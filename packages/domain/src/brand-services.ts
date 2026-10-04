import { eq } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import type { Runtime } from "./runtime.ts";
import { assertPermission, type TenantContext } from "./context.ts";
import { invalidateCache } from "./cache-invalidation.ts";

export interface UpdateBrandSettingsInput {
  logoLightMediaId?: string | null | undefined;
  logoDarkMediaId?: string | null | undefined;
  logoWidth?: number | undefined;
  faviconMediaId?: string | null | undefined;
  socialImageMediaId?: string | null | undefined;
  fontHeading?: string | undefined;
  fontBody?: string | undefined;
  fontSizeScale?: string | undefined;
  colorSchemeName?: string | undefined;
  primaryColor?: string | undefined;
  secondaryColor?: string | undefined;
  accentColor?: string | undefined;
  backgroundColor?: string | undefined;
  surfaceColor?: string | undefined;
  textColor?: string | undefined;
  colorMode?: "light" | "dark" | "auto" | undefined;
  cornerRadius?: "none" | "small" | "medium" | "large" | "full" | undefined;
  buttonStyle?: "solid" | "outline" | "pill" | undefined;
}

const DEFAULT_BRAND_SETTINGS = {
  logoWidth: 150,
  fontHeading: "Inter",
  fontBody: "Inter",
  fontSizeScale: "default",
  colorSchemeName: "Classic",
  primaryColor: "#0f172a",
  secondaryColor: "#334155",
  accentColor: "#2563eb",
  backgroundColor: "#ffffff",
  surfaceColor: "#f8fafc",
  textColor: "#0f172a",
  colorMode: "light" as const,
  cornerRadius: "medium" as const,
  buttonStyle: "solid" as const,
  version: 1,
};

/**
 * Gets the current store brand settings, creating or falling back to defaults if not set.
 */
export async function getBrandSettings(rt: Runtime, ctx: TenantContext) {
  assertPermission(ctx, "settings.write");
  const db = rt._db.db;

  return withTenant(db, ctx.tenantId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.brandSettings)
      .where(eq(schema.brandSettings.tenantId, ctx.tenantId));

    if (!existing) {
      return {
        id: "default",
        logoLightMediaId: undefined,
        logoDarkMediaId: undefined,
        logoWidth: DEFAULT_BRAND_SETTINGS.logoWidth,
        faviconMediaId: undefined,
        socialImageMediaId: undefined,
        fontHeading: DEFAULT_BRAND_SETTINGS.fontHeading,
        fontBody: DEFAULT_BRAND_SETTINGS.fontBody,
        fontSizeScale: DEFAULT_BRAND_SETTINGS.fontSizeScale,
        colorSchemeName: DEFAULT_BRAND_SETTINGS.colorSchemeName,
        primaryColor: DEFAULT_BRAND_SETTINGS.primaryColor,
        secondaryColor: DEFAULT_BRAND_SETTINGS.secondaryColor,
        accentColor: DEFAULT_BRAND_SETTINGS.accentColor,
        backgroundColor: DEFAULT_BRAND_SETTINGS.backgroundColor,
        surfaceColor: DEFAULT_BRAND_SETTINGS.surfaceColor,
        textColor: DEFAULT_BRAND_SETTINGS.textColor,
        colorMode: DEFAULT_BRAND_SETTINGS.colorMode,
        cornerRadius: DEFAULT_BRAND_SETTINGS.cornerRadius,
        buttonStyle: DEFAULT_BRAND_SETTINGS.buttonStyle,
        version: DEFAULT_BRAND_SETTINGS.version,
        publishedAt: undefined,
      };
    }

    const colors = existing.colors ?? {
      primary: DEFAULT_BRAND_SETTINGS.primaryColor,
      background: DEFAULT_BRAND_SETTINGS.backgroundColor,
      surface: DEFAULT_BRAND_SETTINGS.surfaceColor,
      text: DEFAULT_BRAND_SETTINGS.textColor,
    };

    return {
      id: existing.id,
      logoLightMediaId: existing.logoMediaId,
      logoDarkMediaId: existing.logoDarkMediaId,
      logoWidth: existing.logoWidthPx,
      faviconMediaId: existing.faviconMediaId,
      socialImageMediaId: existing.socialImageMediaId,
      fontHeading: existing.fontHeading,
      fontBody: existing.fontBody,
      fontSizeScale: existing.fontScale,
      colorSchemeName: existing.presetCode || "Custom",
      primaryColor: colors.primary,
      secondaryColor: colors.secondary || DEFAULT_BRAND_SETTINGS.secondaryColor,
      accentColor: colors.accent || DEFAULT_BRAND_SETTINGS.accentColor,
      backgroundColor: colors.background,
      surfaceColor: colors.surface,
      textColor: colors.text,
      colorMode: (existing.colorScheme || "light") as "light" | "dark" | "auto",
      cornerRadius: (existing.radius === "md" ? "medium" : existing.radius || "medium") as "none" | "small" | "medium" | "large" | "full",
      buttonStyle: (existing.buttonStyle || "solid") as "solid" | "outline" | "pill",
      version: existing.version,
      publishedAt: existing.updatedAt?.toISOString(),
    };
  });
}

/**
 * Updates store brand settings.
 */
export async function updateBrandSettings(
  rt: Runtime,
  ctx: TenantContext,
  input: UpdateBrandSettingsInput,
) {
  assertPermission(ctx, "settings.write");
  const db = rt._db.db;

  await withTenant(db, ctx.tenantId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.brandSettings)
      .where(eq(schema.brandSettings.tenantId, ctx.tenantId));

    const currentColors = existing?.colors ?? {
      primary: DEFAULT_BRAND_SETTINGS.primaryColor,
      background: DEFAULT_BRAND_SETTINGS.backgroundColor,
      surface: DEFAULT_BRAND_SETTINGS.surfaceColor,
      text: DEFAULT_BRAND_SETTINGS.textColor,
    };

    const updatedColors: {
      primary: string;
      secondary?: string;
      accent?: string;
      background: string;
      surface: string;
      text: string;
    } = {
      primary: input.primaryColor ?? currentColors.primary,
      background: input.backgroundColor ?? currentColors.background,
      surface: input.surfaceColor ?? currentColors.surface,
      text: input.textColor ?? currentColors.text,
    };
    const sec = input.secondaryColor ?? currentColors.secondary;
    if (sec) updatedColors.secondary = sec;
    const acc = input.accentColor ?? currentColors.accent;
    if (acc) updatedColors.accent = acc;

    const radiusMap: Record<string, string> = {
      none: "none",
      small: "sm",
      medium: "md",
      large: "lg",
      full: "full",
    };

    if (existing) {
      const updateData: Record<string, unknown> = {
        colors: updatedColors,
        updatedAt: new Date(),
      };
      if (input.logoLightMediaId !== undefined) updateData.logoMediaId = input.logoLightMediaId;
      if (input.logoDarkMediaId !== undefined) updateData.logoDarkMediaId = input.logoDarkMediaId;
      if (input.logoWidth !== undefined) updateData.logoWidthPx = input.logoWidth;
      if (input.faviconMediaId !== undefined) updateData.faviconMediaId = input.faviconMediaId;
      if (input.socialImageMediaId !== undefined) updateData.socialImageMediaId = input.socialImageMediaId;
      if (input.fontHeading !== undefined) updateData.fontHeading = input.fontHeading;
      if (input.fontBody !== undefined) updateData.fontBody = input.fontBody;
      if (input.fontSizeScale !== undefined) updateData.fontScale = input.fontSizeScale;
      if (input.colorSchemeName !== undefined) updateData.presetCode = input.colorSchemeName;
      if (input.colorMode !== undefined) updateData.colorScheme = input.colorMode;
      if (input.cornerRadius !== undefined) updateData.radius = radiusMap[input.cornerRadius] || "md";
      if (input.buttonStyle !== undefined) updateData.buttonStyle = input.buttonStyle;

      await tx
        .update(schema.brandSettings)
        .set(updateData)
        .where(eq(schema.brandSettings.id, existing.id));
    } else {
      await tx.insert(schema.brandSettings).values({
        tenantId: ctx.tenantId,
        logoMediaId: input.logoLightMediaId,
        logoDarkMediaId: input.logoDarkMediaId,
        logoWidthPx: input.logoWidth ?? DEFAULT_BRAND_SETTINGS.logoWidth,
        faviconMediaId: input.faviconMediaId,
        socialImageMediaId: input.socialImageMediaId,
        colors: updatedColors,
        colorScheme: input.colorMode ?? DEFAULT_BRAND_SETTINGS.colorMode,
        fontHeading: input.fontHeading ?? DEFAULT_BRAND_SETTINGS.fontHeading,
        fontBody: input.fontBody ?? DEFAULT_BRAND_SETTINGS.fontBody,
        fontScale: input.fontSizeScale ?? DEFAULT_BRAND_SETTINGS.fontSizeScale,
        radius: input.cornerRadius ? (radiusMap[input.cornerRadius] || "md") : "md",
        buttonStyle: input.buttonStyle ?? DEFAULT_BRAND_SETTINGS.buttonStyle,
        presetCode: input.colorSchemeName ?? DEFAULT_BRAND_SETTINGS.colorSchemeName,
        version: 1,
      });
    }
  });

  await invalidateCache(rt, ctx, { type: "theme_or_brand_published" });

  return getBrandSettings(rt, ctx);
}

/**
 * Publishes brand settings and increments the version number for rollback tracking.
 */
export async function publishBrandSettings(rt: Runtime, ctx: TenantContext) {
  assertPermission(ctx, "settings.write");
  const db = rt._db.db;

  const nextVersion = await withTenant(db, ctx.tenantId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.brandSettings)
      .where(eq(schema.brandSettings.tenantId, ctx.tenantId));

    const version = (existing?.version ?? 0) + 1;

    if (existing) {
      await tx
        .update(schema.brandSettings)
        .set({
          version,
          updatedAt: new Date(),
        })
        .where(eq(schema.brandSettings.id, existing.id));
    } else {
      await tx.insert(schema.brandSettings).values({
        tenantId: ctx.tenantId,
        version,
      });
    }

    return version;
  });

  await invalidateCache(rt, ctx, { type: "theme_or_brand_published" });

  return { version: nextVersion };
}
