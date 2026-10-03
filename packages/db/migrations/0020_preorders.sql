ALTER TABLE "variants" ADD COLUMN "preorder_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "variants" ADD COLUMN "preorder_ships_on" date;
--> statement-breakpoint
ALTER TABLE "variants" ADD COLUMN "preorder_message" text;
--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "ships_on" date;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "ships_on" date;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "preorder_released_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX "orders_tenant_ships_on_idx" ON "orders" ("tenant_id", "ships_on") WHERE "ships_on" IS NOT NULL;
