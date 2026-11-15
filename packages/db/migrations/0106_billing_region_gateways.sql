-- Platform billing: each region has a primary gateway and an optional backup (docs/EMBEDDED-CHECKOUT-PLAN.md section 5.2).
-- India: `provider` (razorpay | cashfree) is primary, the other national gateway is the backup.
-- International: `international_provider` (paypal | razorpay) is primary, the other is the backup.
-- Expand step: defaults keep today's behaviour (PayPal first for stores outside India).
ALTER TABLE "platform_billing_settings" ADD COLUMN "international_provider" text DEFAULT 'paypal' NOT NULL;
--> statement-breakpoint
ALTER TABLE "platform_billing_settings" ADD COLUMN "national_backup_enabled" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "platform_billing_settings" ADD COLUMN "international_backup_enabled" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
-- Razorpay plans exist per currency now (INR for Indian stores, USD for stores outside India). `amount_paise` holds the
-- minor unit of `currency` (paise or cents); the name stays so nothing that reads it breaks.
ALTER TABLE "platform_razorpay_plans" ADD COLUMN "currency" text DEFAULT 'INR' NOT NULL;
--> statement-breakpoint
ALTER TABLE "platform_razorpay_plans" DROP CONSTRAINT "platform_razorpay_plans_uniq";
--> statement-breakpoint
ALTER TABLE "platform_razorpay_plans" ADD CONSTRAINT "platform_razorpay_plans_uniq" UNIQUE ("plan_id", "interval", "mode", "currency", "amount_paise");
