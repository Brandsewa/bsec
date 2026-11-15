-- SEO Phase 2 (docs/SEO-GEO-AEO-PLAN.md): IndexNow. Expand-only: one nullable column, no default, no backfill.
-- `indexnow_pinged_at` is when the sweep last told search engines about this store's changed pages. NULL means "not enrolled yet":
-- the first sweep sets it to now without sending the whole catalogue.
ALTER TABLE "seo_settings" ADD COLUMN "indexnow_pinged_at" timestamp with time zone;
