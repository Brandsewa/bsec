-- Platform billing B5 (dunning) and B6 (invoice PDF). Expand-only (docs/migrations.md).
-- 1. When a paid subscription first fails to charge, and how far the reminder emails have got (0 none, 1 failure notice,
--    2 last-days reminder, 3 store limited). Cleared by the next successful charge.
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "past_due_since" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "dunning_stage" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
-- 2. Who issues the platform's GST invoices (the owner enters this in Super Admin, Platform billing). The tax rate is in
--    basis points and applies to the plan price, which is quoted inclusive of tax.
ALTER TABLE "platform_billing_settings" ADD COLUMN IF NOT EXISTS "invoice_legal_name" text;
--> statement-breakpoint
ALTER TABLE "platform_billing_settings" ADD COLUMN IF NOT EXISTS "invoice_address" text;
--> statement-breakpoint
ALTER TABLE "platform_billing_settings" ADD COLUMN IF NOT EXISTS "invoice_state" text;
--> statement-breakpoint
ALTER TABLE "platform_billing_settings" ADD COLUMN IF NOT EXISTS "invoice_gstin" text;
--> statement-breakpoint
ALTER TABLE "platform_billing_settings" ADD COLUMN IF NOT EXISTS "invoice_sac" text;
--> statement-breakpoint
ALTER TABLE "platform_billing_settings" ADD COLUMN IF NOT EXISTS "gst_rate_bps" integer DEFAULT 1800 NOT NULL;
--> statement-breakpoint
ALTER TABLE "platform_billing_settings" ADD CONSTRAINT "platform_billing_settings_gst_chk" CHECK ("gst_rate_bps" BETWEEN 0 AND 2800);
