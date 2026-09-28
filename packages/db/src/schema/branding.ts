import { sql } from "drizzle-orm";
import {
  integer,
  jsonb,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { tenantForeignKey, tenantTable } from "../tenant-table.ts";
import { media } from "./catalog.ts";

/**
 * Brand settings (PLAN §5.4, §8.1).
 * Single row per tenant with versioning for rollback.
 */
export const brandSettings = tenantTable(
  "brand_settings",
  {
    id: uuid("id").default(sql`uuidv7()`).primaryKey(),
    logoMediaId: uuid("logo_media_id"),
    logoDarkMediaId: uuid("logo_dark_media_id"),
    logoWidthPx: integer("logo_width_px").notNull().default(150),
    faviconMediaId: uuid("favicon_media_id"),
    appleTouchIconMediaId: uuid("apple_touch_icon_media_id"),
    socialImageMediaId: uuid("social_image_media_id"),
    colors: jsonb("colors").$type<{
      primary: string;
      secondary?: string;
      accent?: string;
      background: string;
      surface: string;
      text: string;
      muted?: string;
      border?: string;
      success?: string;
      warning?: string;
      error?: string;
    }>(),
    colorScheme: text("color_scheme").notNull().default("light"), // light, dark, auto
    fontHeading: text("font_heading").notNull().default("Inter"),
    fontBody: text("font_body").notNull().default("Inter"),
    fontScale: text("font_scale").notNull().default("default"), // compact, default, large
    radius: text("radius").notNull().default("md"), // none, sm, md, lg, full
    buttonStyle: text("button_style").notNull().default("solid"), // solid, outline, pill
    presetCode: text("preset_code"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    unique("brand_settings_tenant_id_uniq").on(t.tenantId),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.logoMediaId,
      target: media,
      name: "brand_settings_logo_media_fk",
      onDelete: "set null",
    }),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.logoDarkMediaId,
      target: media,
      name: "brand_settings_logo_dark_media_fk",
      onDelete: "set null",
    }),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.faviconMediaId,
      target: media,
      name: "brand_settings_favicon_media_fk",
      onDelete: "set null",
    }),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.appleTouchIconMediaId,
      target: media,
      name: "brand_settings_apple_touch_icon_media_fk",
      onDelete: "set null",
    }),
    tenantForeignKey({
      tableTenantId: t.tenantId,
      column: t.socialImageMediaId,
      target: media,
      name: "brand_settings_social_image_media_fk",
      onDelete: "set null",
    }),
  ],
);
