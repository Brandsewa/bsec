-- Shipping regions and tiers (owner request 2026-10-17). Expand only, all columns additive and nullable or defaulted, so
-- existing zones and flat/free-above rates behave exactly as before.
ALTER TABLE "shipping_zones" ADD COLUMN IF NOT EXISTS "states" text[] DEFAULT ARRAY[]::text[] NOT NULL;
--> statement-breakpoint
ALTER TABLE "shipping_rates" ADD COLUMN IF NOT EXISTS "min_subtotal_paise" integer;
--> statement-breakpoint
ALTER TABLE "shipping_rates" ADD COLUMN IF NOT EXISTS "max_subtotal_paise" integer;
--> statement-breakpoint
ALTER TABLE "shipping_rates" ADD COLUMN IF NOT EXISTS "min_weight_grams" integer;
--> statement-breakpoint
ALTER TABLE "shipping_rates" ADD COLUMN IF NOT EXISTS "max_weight_grams" integer;
--> statement-breakpoint
ALTER TABLE "shipping_rates" DROP CONSTRAINT IF EXISTS "shipping_rates_rate_type_chk";
--> statement-breakpoint
ALTER TABLE "shipping_rates" ADD CONSTRAINT "shipping_rates_rate_type_chk" CHECK ("rate_type" in ('flat', 'free_above_threshold', 'price_tier', 'weight_tier'));
