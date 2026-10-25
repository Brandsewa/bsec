-- The free trial new stores get is a platform setting (Super Admin, Platform billing): on or off, and how many days.
-- Defaults keep today's behaviour (14 days). Expand-only (docs/migrations.md).
ALTER TABLE "platform_billing_settings" ADD COLUMN IF NOT EXISTS "trial_enabled" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "platform_billing_settings" ADD COLUMN IF NOT EXISTS "trial_days" integer DEFAULT 14 NOT NULL;
--> statement-breakpoint
ALTER TABLE "platform_billing_settings" ADD CONSTRAINT "platform_billing_settings_trial_days_chk" CHECK ("trial_days" BETWEEN 1 AND 90);
