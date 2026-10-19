-- Cashfree as a second gateway (ADR-037). Expand-only (docs/migrations.md).
-- 1. Platform billing: the platform's own Cashfree credentials (client id + secret per mode). Cashfree signs webhooks with the
--    client secret, so there is no separate webhook secret. `provider` (razorpay | cashfree) already exists and names the
--    gateway new subscriptions use; subscriptions already created keep their own provider.
ALTER TABLE "platform_billing_settings" ADD COLUMN IF NOT EXISTS "cashfree_test_client_id" text;
--> statement-breakpoint
ALTER TABLE "platform_billing_settings" ADD COLUMN IF NOT EXISTS "cashfree_test_secret_ciphertext" text;
--> statement-breakpoint
ALTER TABLE "platform_billing_settings" ADD COLUMN IF NOT EXISTS "cashfree_test_secret_iv" text;
--> statement-breakpoint
ALTER TABLE "platform_billing_settings" ADD COLUMN IF NOT EXISTS "cashfree_live_client_id" text;
--> statement-breakpoint
ALTER TABLE "platform_billing_settings" ADD COLUMN IF NOT EXISTS "cashfree_live_secret_ciphertext" text;
--> statement-breakpoint
ALTER TABLE "platform_billing_settings" ADD COLUMN IF NOT EXISTS "cashfree_live_secret_iv" text;
--> statement-breakpoint
ALTER TABLE "platform_billing_settings" ADD CONSTRAINT "platform_billing_settings_provider_chk" CHECK ("provider" IN ('razorpay', 'cashfree'));
--> statement-breakpoint
-- 2. Stores can hold a Cashfree payment method row. Cashfree starts disabled for stores until Super Admin turns it on.
ALTER TABLE "payment_methods" DROP CONSTRAINT IF EXISTS "payment_methods_provider_chk";
--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_provider_chk" CHECK ("provider" IN ('cod', 'razorpay', 'stripe', 'cashfree'));
--> statement-breakpoint
INSERT INTO "platform_payment_providers" ("provider", "display_name", "enabled", "live_mode_allowed", "sort")
VALUES ('cashfree', 'Cashfree', false, false, 3)
ON CONFLICT ("provider") DO NOTHING;
