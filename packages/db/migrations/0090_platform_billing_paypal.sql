-- Platform billing: PayPal credentials (ADR-040, WP-5).
-- Stores PayPal platform credentials (client ID, encrypted secret, webhook ID) for test and live modes.
-- Secrets are encrypted using TENANT_SECRETS_KEY.
ALTER TABLE "platform_billing_settings" ADD COLUMN "paypal_test_client_id" text;
--> statement-breakpoint
ALTER TABLE "platform_billing_settings" ADD COLUMN "paypal_test_secret_ciphertext" text;
--> statement-breakpoint
ALTER TABLE "platform_billing_settings" ADD COLUMN "paypal_test_secret_iv" text;
--> statement-breakpoint
ALTER TABLE "platform_billing_settings" ADD COLUMN "paypal_test_webhook_id" text;
--> statement-breakpoint
ALTER TABLE "platform_billing_settings" ADD COLUMN "paypal_live_client_id" text;
--> statement-breakpoint
ALTER TABLE "platform_billing_settings" ADD COLUMN "paypal_live_secret_ciphertext" text;
--> statement-breakpoint
ALTER TABLE "platform_billing_settings" ADD COLUMN "paypal_live_secret_iv" text;
--> statement-breakpoint
ALTER TABLE "platform_billing_settings" ADD COLUMN "paypal_live_webhook_id" text;
