-- Categories get the collection model (expand-only): a type (manual or automated), the rules and match mode for an
-- automated one, and a default product sort order. Every existing category stays manual with the assigned order, so
-- nothing changes for stores until an owner edits a category. No new table, so no new grants or RLS.
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "type" text DEFAULT 'manual' NOT NULL;
--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "match" text DEFAULT 'all' NOT NULL;
--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "rules" jsonb;
--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "sort_order" text DEFAULT 'manual' NOT NULL;
