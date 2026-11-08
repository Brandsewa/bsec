-- Discount engine: automatic free items (ADR-045, docs/DISCOUNTS-PLAN.md). Expand-only: one new column with a default.
-- `auto_free_qty` is how many of a cart line's units the store added by itself for a buy-x-get-y offer, so the shopper's own
-- quantity (quantity - auto_free_qty) can be told apart from the free ones and recomputed when the cart changes.
ALTER TABLE "cart_items" ADD COLUMN "auto_free_qty" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_auto_free_qty_chk" CHECK ("auto_free_qty" >= 0 AND "auto_free_qty" <= "quantity");
