-- Migration 0056: Media library columns, media_usages, and per-kind upload quotas (MEDIA-LIBRARY-PLAN §5, §6.1)

-- 1. Extend media table
ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'image' NOT NULL;
--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'ready' NOT NULL;
--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "filename" text;
--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "title" text;
--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "caption" text;
--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "duration_ms" integer;
--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "sha256" text;
--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "trashed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "trashed_by" uuid;
--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "search" tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce("filename", '') || ' ' || coalesce("title", '') || ' ' || coalesce("alt", ''))) STORED;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "media" ADD CONSTRAINT "media_kind_chk" CHECK ("kind" in ('image', 'video', 'document'));
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "media" ADD CONSTRAINT "media_status_chk" CHECK ("status" in ('ready', 'trashed'));
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "media" ADD CONSTRAINT "media_duration_ms_chk" CHECK ("duration_ms" is null or "duration_ms" >= 0);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "media" ADD CONSTRAINT "media_trashed_status_chk" CHECK (("status" = 'trashed' and "trashed_at" is not null) or ("status" != 'trashed' and "trashed_at" is null));
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_tenant_status_created_idx" ON "media" ("tenant_id", "status", "created_at" DESC, "id" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_tenant_kind_idx" ON "media" ("tenant_id", "kind", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_search_idx" ON "media" USING gin ("search");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_tenant_trashed_idx" ON "media" ("tenant_id", "trashed_at") WHERE ("trashed_at" IS NOT NULL);
--> statement-breakpoint

-- 2. Backfill existing media rows (kind and filename)
UPDATE "media"
SET "kind" = CASE
  WHEN "mime" LIKE 'video/%' THEN 'video'
  WHEN "mime" LIKE 'image/%' THEN 'image'
  ELSE 'document'
END
WHERE "kind" IS NULL OR "kind" = 'image';
--> statement-breakpoint
UPDATE "media"
SET "filename" = SUBSTRING("storage_key" FROM '[^/]+$')
WHERE "filename" IS NULL;
--> statement-breakpoint

-- 3. Create media_usages tenant table
CREATE TABLE IF NOT EXISTS "media_usages" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "media_id" uuid NOT NULL,
  "owner_type" text NOT NULL,
  "owner_id" uuid NOT NULL,
  "field" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "media_usages_tenant_id_uniq" UNIQUE ("tenant_id", "id"),
  CONSTRAINT "media_usages_owner_field_uniq" UNIQUE ("tenant_id", "media_id", "owner_type", "owner_id", "field"),
  CONSTRAINT "media_usages_owner_type_chk" CHECK ("owner_type" in ('product', 'variant', 'collection', 'category', 'brand', 'page', 'theme', 'store_branding'))
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "media_usages" ADD CONSTRAINT "media_usages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "media_usages" ADD CONSTRAINT "media_usages_media_fk" FOREIGN KEY ("tenant_id", "media_id") REFERENCES "media"("tenant_id", "id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_usages_tenant_owner_idx" ON "media_usages" ("tenant_id", "owner_type", "owner_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_usages_tenant_media_idx" ON "media_usages" ("tenant_id", "media_id");
--> statement-breakpoint

-- 4. Enable RLS and grants on media_usages
ALTER TABLE "media_usages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "media_usages" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  CREATE POLICY "tenant_isolation" ON "media_usages" AS PERMISSIVE FOR ALL TO public
    USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "media_usages" TO "app_rw", "app_platform";
--> statement-breakpoint

-- 5. Backfill media_usages from existing catalog references
INSERT INTO "media_usages" ("tenant_id", "media_id", "owner_type", "owner_id", "field")
SELECT "tenant_id", "media_id", 'product', "product_id", 'gallery'
FROM "product_media"
ON CONFLICT ("tenant_id", "media_id", "owner_type", "owner_id", "field") DO NOTHING;
--> statement-breakpoint
INSERT INTO "media_usages" ("tenant_id", "media_id", "owner_type", "owner_id", "field")
SELECT "tenant_id", "image_media_id", 'variant', "id", 'image'
FROM "variants"
WHERE "image_media_id" IS NOT NULL
ON CONFLICT ("tenant_id", "media_id", "owner_type", "owner_id", "field") DO NOTHING;
--> statement-breakpoint
INSERT INTO "media_usages" ("tenant_id", "media_id", "owner_type", "owner_id", "field")
SELECT "tenant_id", "image_media_id", 'collection', "id", 'image'
FROM "collections"
WHERE "image_media_id" IS NOT NULL
ON CONFLICT ("tenant_id", "media_id", "owner_type", "owner_id", "field") DO NOTHING;
--> statement-breakpoint
INSERT INTO "media_usages" ("tenant_id", "media_id", "owner_type", "owner_id", "field")
SELECT "tenant_id", "image_media_id", 'category', "id", 'image'
FROM "categories"
WHERE "image_media_id" IS NOT NULL
ON CONFLICT ("tenant_id", "media_id", "owner_type", "owner_id", "field") DO NOTHING;
--> statement-breakpoint
INSERT INTO "media_usages" ("tenant_id", "media_id", "owner_type", "owner_id", "field")
SELECT "tenant_id", "logo_media_id", 'brand', "id", 'logo'
FROM "brands"
WHERE "logo_media_id" IS NOT NULL
ON CONFLICT ("tenant_id", "media_id", "owner_type", "owner_id", "field") DO NOTHING;
--> statement-breakpoint

-- 6. Quota definitions and tier limits seeding
INSERT INTO "quota_definitions" ("key", "description", "unit", "enforcement", "tier_xs", "tier_s", "tier_m", "tier_l")
VALUES
  ('media_image_mb', 'Max size of one image', 'MB', 'hard', 5, 5, 5, 5),
  ('media_video_mb', 'Max size of one video', 'MB', 'hard', 10, 10, 10, 10),
  ('media_document_mb', 'Max size of one document', 'MB', 'hard', 5, 5, 5, 5)
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "quota_tier_limits" ("tier_code", "quota_key", "value")
SELECT "code", 'media_image_mb', 5 FROM "quota_tiers"
ON CONFLICT ("tier_code", "quota_key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "quota_tier_limits" ("tier_code", "quota_key", "value")
SELECT "code", 'media_video_mb', 10 FROM "quota_tiers"
ON CONFLICT ("tier_code", "quota_key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "quota_tier_limits" ("tier_code", "quota_key", "value")
SELECT "code", 'media_document_mb', 5 FROM "quota_tiers"
ON CONFLICT ("tier_code", "quota_key") DO NOTHING;
