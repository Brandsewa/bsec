-- Migration 0059_media_derivatives.sql
-- Add media derivatives, dominant_color, focal points, and sha256 index (Plan S2, S3, S4).

ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "derivatives" jsonb;
--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "dominant_color" text;
--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "focal_x" real;
--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "focal_y" real;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'media_focal_chk'
  ) THEN
    ALTER TABLE "media" ADD CONSTRAINT "media_focal_chk" CHECK (
      ("focal_x" IS NULL AND "focal_y" IS NULL) OR
      ("focal_x" BETWEEN 0 AND 1 AND "focal_y" BETWEEN 0 AND 1)
    );
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_tenant_sha256_idx" ON "media" ("tenant_id", "sha256") WHERE "sha256" IS NOT NULL;
