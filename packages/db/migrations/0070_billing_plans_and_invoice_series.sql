-- Platform billing B2 and B4 (docs/PLATFORM-BILLING-PLAN.md). Expand-only (docs/migrations.md).
-- 1. Razorpay plans are immutable and differ between test and live mode, so every plan the platform creates in Razorpay
--    is recorded per (plan, interval, mode, amount). A price change creates a new row; subscribers keep their old plan.
CREATE TABLE IF NOT EXISTS "platform_razorpay_plans" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"plan_id" uuid NOT NULL REFERENCES "plans"("id") ON DELETE CASCADE,
	"interval" text NOT NULL,
	"mode" text NOT NULL,
	"razorpay_plan_id" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_razorpay_plans_interval_chk" CHECK ("interval" IN ('monthly', 'yearly')),
	CONSTRAINT "platform_razorpay_plans_mode_chk" CHECK ("mode" IN ('test', 'live')),
	CONSTRAINT "platform_razorpay_plans_uniq" UNIQUE ("plan_id", "interval", "mode", "amount_paise")
);
--> statement-breakpoint
-- 2. One invoice per provider payment, so the same payment arriving in two webhook events cannot be invoiced twice.
ALTER TABLE "platform_invoices" ADD COLUMN IF NOT EXISTS "provider_payment_id" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "platform_invoices_provider_payment_uniq" ON "platform_invoices" ("provider_payment_id") WHERE "provider_payment_id" IS NOT NULL;
--> statement-breakpoint
-- 3. Gapless invoice numbers per financial-year series (GST requires a consecutive series). The counter row is locked
--    by the issuing transaction, so a rolled-back invoice never leaves a gap.
CREATE TABLE IF NOT EXISTS "platform_invoice_counters" (
	"series" text PRIMARY KEY NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
REVOKE ALL ON TABLE "platform_razorpay_plans", "platform_invoice_counters" FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON TABLE "platform_razorpay_plans", "platform_invoice_counters" FROM "app_rw";
--> statement-breakpoint
GRANT ALL ON TABLE "platform_razorpay_plans", "platform_invoice_counters" TO "app_platform";
