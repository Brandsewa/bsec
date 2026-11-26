-- Deleting a variant keeps order history (decision 2026-11-26, docs/changes/2026-11-26-claude-variant-delete-order-history.md).
-- Expand-only: no data changes. Old code always writes a variant_id, so it keeps working against this schema.
--
-- 1. order_items.variant_id becomes nullable and is cleared when its variant is deleted. The line keeps its own copy of
--    product title, variant title, SKU, prices, tax and cost. The domain only deletes a variant whose orders are all
--    cancelled, returned or delivered (packages/domain/src/catalog/variant-builder.ts).
-- 2. reviews and product_media already said ON DELETE SET NULL, but on a two-column key that also clears tenant_id,
--    which is NOT NULL, so deleting a reviewed variant failed. SET NULL ("variant_id") clears only the variant column.

ALTER TABLE "order_items" ALTER COLUMN "variant_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "order_items" DROP CONSTRAINT "order_items_variant_fk";
--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_fk" FOREIGN KEY ("tenant_id","variant_id") REFERENCES "public"."variants"("tenant_id","id") ON DELETE SET NULL ("variant_id") ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reviews" DROP CONSTRAINT "reviews_variant_fk";
--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_variant_fk" FOREIGN KEY ("tenant_id","variant_id") REFERENCES "public"."variants"("tenant_id","id") ON DELETE SET NULL ("variant_id") ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "product_media" DROP CONSTRAINT "product_media_variant_fk";
--> statement-breakpoint
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_variant_fk" FOREIGN KEY ("tenant_id","variant_id") REFERENCES "public"."variants"("tenant_id","id") ON DELETE SET NULL ("variant_id") ON UPDATE no action;
