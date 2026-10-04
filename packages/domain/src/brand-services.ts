import { and, eq } from "drizzle-orm";
import { schema, withTenant, type Db } from "@bs/db";
import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import type { Runtime } from "./runtime.ts";
import { assertPermission, type TenantContext } from "./context.ts";
import { invalidateCache } from "./cache-invalidation.ts";
import { createR2Client, getR2Config, isMediaStorageConfigured } from "./media/storage.ts";

export const APPROVED_BRAND_FONTS = [
  "Inter",
  "Montserrat",
  "Poppins",
  "Nunito",
  "Work Sans",
  "Plus Jakarta Sans",
  "DM Sans",
  "Mukta",
  "Playfair Display",
  "Lora",
  "Rozha One",
  "Space Grotesk",
  "Merriweather",
] as const;

export type BrandFont = (typeof APPROVED_BRAND_FONTS)[number];

export interface UpdateBrandSettingsInput {
  logoLightMediaId?: string | null | undefined;
  logoDarkMediaId?: string | null | undefined;
  logoWidth?: number | undefined;
  faviconMediaId?: string | null | undefined;
  socialImageMediaId?: string | null | undefined;
  fontHeading?: BrandFont | undefined;
  fontBody?: BrandFont | undefined;
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
  s3Client?: S3Client | undefined;
}

export const FAVICON_ALLOWED_MIMES = [
  "image/png",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "image/svg+xml",
] as const;

export const LOGO_ALLOWED_MIMES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
] as const;

export const SOCIAL_IMAGE_ALLOWED_MIMES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
] as const;

export const MAX_FAVICON_BYTES = 512 * 1024; // 512 KB
export const MAX_BRAND_MEDIA_BYTES = 5 * 1024 * 1024; // 5 MB

export function isUnsafeSvgContent(content: string): boolean {
  if (/<script/i.test(content)) return true;
  if (/on\w+\s*=/i.test(content)) return true;
  if (/javascript:/i.test(content) || /vbscript:/i.test(content) || /data:text\/html/i.test(content)) return true;
  if (/<(?:use|image|feImage)\b[^>]*?\b(?:href|xlink:href)\s*=\s*["']?https?:\/\//i.test(content)) return true;
  if (/@import\b/i.test(content)) return true;
  if (/url\s*\(\s*["']?https?:\/\//i.test(content)) return true;
  return false;
}

const DEFAULT_BRAND_SETTINGS = {
  logoWidth: 150,
  fontHeading: "Inter" as BrandFont,
  fontBody: "Inter" as BrandFont,
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
  assertPermission(ctx, "settings.read");
  return getBrandSettingsInternal(rt, ctx.tenantId);
}

export async function getBrandSettingsInternal(rt: Runtime, tenantId: string) {
  const db = rt._db.db;

  return withTenant(db, tenantId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.brandSettings)
      .where(eq(schema.brandSettings.tenantId, tenantId));

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
      fontHeading: (existing.fontHeading && (APPROVED_BRAND_FONTS as readonly string[]).includes(existing.fontHeading)
        ? existing.fontHeading
        : DEFAULT_BRAND_SETTINGS.fontHeading) as BrandFont,
      fontBody: (existing.fontBody && (APPROVED_BRAND_FONTS as readonly string[]).includes(existing.fontBody)
        ? existing.fontBody
        : DEFAULT_BRAND_SETTINGS.fontBody) as BrandFont,
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

const AUDIT_BRAND_FIELDS = [
  "logoLightMediaId",
  "logoDarkMediaId",
  "logoWidth",
  "faviconMediaId",
  "socialImageMediaId",
  "fontHeading",
  "fontBody",
  "fontSizeScale",
  "colorSchemeName",
  "primaryColor",
  "secondaryColor",
  "accentColor",
  "backgroundColor",
  "surfaceColor",
  "textColor",
  "colorMode",
  "cornerRadius",
  "buttonStyle",
] as const;

async function validateMediaSlot(
  tx: Db,
  tenantId: string,
  slot: "favicon" | "logoLight" | "logoDark" | "socialImage",
  mediaId: string | null | undefined,
  s3Client?: S3Client,
) {
  if (!mediaId) return;

  const [row] = await tx
    .select()
    .from(schema.media)
    .where(and(eq(schema.media.id, mediaId), eq(schema.media.tenantId, tenantId)))
    .limit(1);

  if (!row) {
    throw new Error(`Media asset '${mediaId}' not found for slot '${slot}' or access denied.`);
  }

  const mime = row.mime.toLowerCase().trim();
  const bytes = Number(row.bytes);

  if (slot === "favicon") {
    if (!FAVICON_ALLOWED_MIMES.includes(mime as (typeof FAVICON_ALLOWED_MIMES)[number])) {
      throw new Error(`Invalid media format '${row.mime}' for favicon. Allowed formats: PNG, ICO, SVG.`);
    }
    if (bytes > MAX_FAVICON_BYTES) {
      throw new Error(`Favicon file size (${bytes} bytes) exceeds maximum allowed limit of 512 KB.`);
    }
    if (row.width && row.height && row.width !== row.height) {
      throw new Error("Favicon must be square (width equals height).");
    }
  } else if (slot === "logoLight" || slot === "logoDark") {
    if (!LOGO_ALLOWED_MIMES.includes(mime as (typeof LOGO_ALLOWED_MIMES)[number])) {
      throw new Error(`Invalid media format '${row.mime}' for ${slot}. Allowed formats: PNG, JPEG, WebP, SVG.`);
    }
    if (bytes > MAX_BRAND_MEDIA_BYTES) {
      throw new Error(`Media file size for ${slot} (${bytes} bytes) exceeds maximum allowed limit of 5 MB.`);
    }
  } else if (slot === "socialImage") {
    if (!SOCIAL_IMAGE_ALLOWED_MIMES.includes(mime as (typeof SOCIAL_IMAGE_ALLOWED_MIMES)[number])) {
      throw new Error(`Invalid media format '${row.mime}' for social image. Allowed formats: PNG, JPEG, WebP, SVG.`);
    }
    if (bytes > MAX_BRAND_MEDIA_BYTES) {
      throw new Error(`Media file size for social image (${bytes} bytes) exceeds maximum allowed limit of 5 MB.`);
    }
  }

  if (mime === "image/svg+xml") {
    let svgText: string | null = null;
    if (row.alt && row.alt.includes("<svg")) {
      svgText = row.alt;
    } else if (row.storageKey && row.storageKey.includes("<svg")) {
      svgText = row.storageKey;
    } else if (s3Client || isMediaStorageConfigured()) {
      try {
        const s3 = s3Client ?? createR2Client();
        const cfg = getR2Config();
        const cmd = new GetObjectCommand({
          Bucket: cfg.bucketName,
          Key: row.storageKey,
        });
        const res = await s3.send(cmd);
        if (res.Body) {
          svgText = await res.Body.transformToString();
        }
      } catch {
        // Storage lookup failed or not reachable
      }
    }

    if (svgText && isUnsafeSvgContent(svgText)) {
      throw new Error(`Unsafe SVG for slot '${slot}': file contains disallowed scripts or external references.`);
    }
  }
}

/**
 * Updates store brand settings.
 */
export async function updateBrandSettings(
  rt: Runtime,
  ctx: TenantContext,
  input: UpdateBrandSettingsInput,
) {
  assertPermission(ctx, "branding.manage");
  const db = rt._db.db;

  await withTenant(db, ctx.tenantId, async (tx) => {
    // 1. Validate media slots
    if (input.faviconMediaId !== undefined) {
      await validateMediaSlot(tx, ctx.tenantId, "favicon", input.faviconMediaId, input.s3Client);
    }
    if (input.logoLightMediaId !== undefined) {
      await validateMediaSlot(tx, ctx.tenantId, "logoLight", input.logoLightMediaId, input.s3Client);
    }
    if (input.logoDarkMediaId !== undefined) {
      await validateMediaSlot(tx, ctx.tenantId, "logoDark", input.logoDarkMediaId, input.s3Client);
    }
    if (input.socialImageMediaId !== undefined) {
      await validateMediaSlot(tx, ctx.tenantId, "socialImage", input.socialImageMediaId, input.s3Client);
    }

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

    const beforeState: Record<string, unknown> = existing
      ? {
          logoLightMediaId: existing.logoMediaId,
          logoDarkMediaId: existing.logoDarkMediaId,
          logoWidth: existing.logoWidthPx,
          faviconMediaId: existing.faviconMediaId,
          socialImageMediaId: existing.socialImageMediaId,
          fontHeading: existing.fontHeading,
          fontBody: existing.fontBody,
          fontSizeScale: existing.fontScale,
          colorSchemeName: existing.presetCode || "Custom",
          primaryColor: currentColors.primary,
          secondaryColor: currentColors.secondary || DEFAULT_BRAND_SETTINGS.secondaryColor,
          accentColor: currentColors.accent || DEFAULT_BRAND_SETTINGS.accentColor,
          backgroundColor: currentColors.background,
          surfaceColor: currentColors.surface,
          textColor: currentColors.text,
          colorMode: existing.colorScheme || "light",
          cornerRadius: existing.radius === "md" ? "medium" : existing.radius || "medium",
          buttonStyle: existing.buttonStyle || "solid",
        }
      : {};

    const afterState: Record<string, unknown> = {
      logoLightMediaId: input.logoLightMediaId !== undefined ? input.logoLightMediaId : (beforeState.logoLightMediaId ?? null),
      logoDarkMediaId: input.logoDarkMediaId !== undefined ? input.logoDarkMediaId : (beforeState.logoDarkMediaId ?? null),
      logoWidth: input.logoWidth !== undefined ? input.logoWidth : (beforeState.logoWidth ?? DEFAULT_BRAND_SETTINGS.logoWidth),
      faviconMediaId: input.faviconMediaId !== undefined ? input.faviconMediaId : (beforeState.faviconMediaId ?? null),
      socialImageMediaId: input.socialImageMediaId !== undefined ? input.socialImageMediaId : (beforeState.socialImageMediaId ?? null),
      fontHeading: input.fontHeading !== undefined ? input.fontHeading : (beforeState.fontHeading ?? DEFAULT_BRAND_SETTINGS.fontHeading),
      fontBody: input.fontBody !== undefined ? input.fontBody : (beforeState.fontBody ?? DEFAULT_BRAND_SETTINGS.fontBody),
      fontSizeScale: input.fontSizeScale !== undefined ? input.fontSizeScale : (beforeState.fontSizeScale ?? DEFAULT_BRAND_SETTINGS.fontSizeScale),
      colorSchemeName: input.colorSchemeName !== undefined ? input.colorSchemeName : (beforeState.colorSchemeName ?? DEFAULT_BRAND_SETTINGS.colorSchemeName),
      primaryColor: updatedColors.primary,
      secondaryColor: updatedColors.secondary || DEFAULT_BRAND_SETTINGS.secondaryColor,
      accentColor: updatedColors.accent || DEFAULT_BRAND_SETTINGS.accentColor,
      backgroundColor: updatedColors.background,
      surfaceColor: updatedColors.surface,
      textColor: updatedColors.text,
      colorMode: input.colorMode !== undefined ? input.colorMode : (beforeState.colorMode ?? DEFAULT_BRAND_SETTINGS.colorMode),
      cornerRadius: input.cornerRadius !== undefined ? input.cornerRadius : (beforeState.cornerRadius ?? DEFAULT_BRAND_SETTINGS.cornerRadius),
      buttonStyle: input.buttonStyle !== undefined ? input.buttonStyle : (beforeState.buttonStyle ?? DEFAULT_BRAND_SETTINGS.buttonStyle),
    };

    let targetId = existing?.id;

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
      const [inserted] = await tx
        .insert(schema.brandSettings)
        .values({
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
        })
        .returning();
      targetId = inserted?.id;
    }

    // Write audit log
    const diff: Record<string, { before: unknown; after: unknown }> = {};
    for (const key of AUDIT_BRAND_FIELDS) {
      const b = beforeState[key];
      const a = afterState[key];
      if (JSON.stringify(b) !== JSON.stringify(a)) {
        diff[key] = { before: b ?? null, after: a };
      }
    }

    if (Object.keys(diff).length > 0) {
      await tx.insert(schema.auditLogs).values({
        tenantId: ctx.tenantId,
        actorType: ctx.actor.type,
        actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
        action: "brand_settings.update",
        targetType: "brand_settings",
        targetId: targetId ?? ctx.tenantId,
        diff,
      });
    }
  });

  await invalidateCache(rt, ctx, { type: "theme_or_brand_published" });

  return getBrandSettingsInternal(rt, ctx.tenantId);
}

/**
 * Publishes brand settings and increments the version number for rollback tracking.
 */
export async function publishBrandSettings(rt: Runtime, ctx: TenantContext) {
  assertPermission(ctx, "branding.manage");
  const db = rt._db.db;

  const nextVersion = await withTenant(db, ctx.tenantId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.brandSettings)
      .where(eq(schema.brandSettings.tenantId, ctx.tenantId));

    const prevVersion = existing?.version ?? 0;
    const version = prevVersion + 1;
    let targetId = existing?.id;

    if (existing) {
      await tx
        .update(schema.brandSettings)
        .set({
          version,
          updatedAt: new Date(),
        })
        .where(eq(schema.brandSettings.id, existing.id));
    } else {
      const [inserted] = await tx
        .insert(schema.brandSettings)
        .values({
          tenantId: ctx.tenantId,
          version,
        })
        .returning();
      targetId = inserted?.id;
    }

    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "brand_settings.publish",
      targetType: "brand_settings",
      targetId: targetId ?? ctx.tenantId,
      diff: {
        version: { before: prevVersion, after: version },
      },
    });

    return version;
  });

  await invalidateCache(rt, ctx, { type: "theme_or_brand_published" });

  return { version: nextVersion };
}
