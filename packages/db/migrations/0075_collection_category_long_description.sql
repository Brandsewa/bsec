-- Categories and collections get a long, formatted description (expand-only). The existing plain "description" stays and is
-- now the short description shown under the title; the new column holds validated block content shown below the product list.
-- No new table, so no new grants or RLS.
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "description_json" jsonb;
--> statement-breakpoint
ALTER TABLE "collections" ADD COLUMN IF NOT EXISTS "description_json" jsonb;
