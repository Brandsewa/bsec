-- Migration 0058_media_usages_branding.sql
-- Backfill media_usages with owner_type = 'store_branding' from brand_settings, store_status, and seo_settings (MEDIA-LIBRARY-PLAN §5.2 / S4).

INSERT INTO "media_usages" ("tenant_id", "media_id", "owner_type", "owner_id", "field")
SELECT "tenant_id", "logo_media_id", 'store_branding', "id", 'logo'
FROM "brand_settings"
WHERE "logo_media_id" IS NOT NULL
ON CONFLICT ("tenant_id", "media_id", "owner_type", "owner_id", "field") DO NOTHING;
--> statement-breakpoint
INSERT INTO "media_usages" ("tenant_id", "media_id", "owner_type", "owner_id", "field")
SELECT "tenant_id", "logo_dark_media_id", 'store_branding', "id", 'logo_dark'
FROM "brand_settings"
WHERE "logo_dark_media_id" IS NOT NULL
ON CONFLICT ("tenant_id", "media_id", "owner_type", "owner_id", "field") DO NOTHING;
--> statement-breakpoint
INSERT INTO "media_usages" ("tenant_id", "media_id", "owner_type", "owner_id", "field")
SELECT "tenant_id", "favicon_media_id", 'store_branding', "id", 'favicon'
FROM "brand_settings"
WHERE "favicon_media_id" IS NOT NULL
ON CONFLICT ("tenant_id", "media_id", "owner_type", "owner_id", "field") DO NOTHING;
--> statement-breakpoint
INSERT INTO "media_usages" ("tenant_id", "media_id", "owner_type", "owner_id", "field")
SELECT "tenant_id", "apple_touch_icon_media_id", 'store_branding', "id", 'apple_touch_icon'
FROM "brand_settings"
WHERE "apple_touch_icon_media_id" IS NOT NULL
ON CONFLICT ("tenant_id", "media_id", "owner_type", "owner_id", "field") DO NOTHING;
--> statement-breakpoint
INSERT INTO "media_usages" ("tenant_id", "media_id", "owner_type", "owner_id", "field")
SELECT "tenant_id", "social_image_media_id", 'store_branding', "id", 'social_image'
FROM "brand_settings"
WHERE "social_image_media_id" IS NOT NULL
ON CONFLICT ("tenant_id", "media_id", "owner_type", "owner_id", "field") DO NOTHING;
--> statement-breakpoint
INSERT INTO "media_usages" ("tenant_id", "media_id", "owner_type", "owner_id", "field")
SELECT "tenant_id", "background_media_id", 'store_branding', "id", 'status_background'
FROM "store_status"
WHERE "background_media_id" IS NOT NULL
ON CONFLICT ("tenant_id", "media_id", "owner_type", "owner_id", "field") DO NOTHING;
--> statement-breakpoint
INSERT INTO "media_usages" ("tenant_id", "media_id", "owner_type", "owner_id", "field")
SELECT "tenant_id", "default_og_image_media_id", 'store_branding', "id", 'seo_og_image'
FROM "seo_settings"
WHERE "default_og_image_media_id" IS NOT NULL
ON CONFLICT ("tenant_id", "media_id", "owner_type", "owner_id", "field") DO NOTHING;
