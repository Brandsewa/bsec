-- Theme library states: a hidden theme is either a draft (never published) or archived (taken down by
-- staff). `archived_at` marks the second kind. Expand-only: a nullable column, no behaviour change for
-- older app versions (they only read `is_active`). Themes that were published and then hidden become archived.
ALTER TABLE "theme_templates" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "theme_templates"
SET "archived_at" = "updated_at"
WHERE "is_active" = false AND "published_at" IS NOT NULL AND "archived_at" IS NULL;
