-- Platform billing: national and international gateways are chosen separately (ADR-040).
-- `provider` is now the national gateway only (razorpay | cashfree); `paypal_enabled` switches PayPal on for stores outside India.
-- Expand step: a store that was billed while provider='paypal' keeps PayPal on, and the national gateway returns to Razorpay.
ALTER TABLE "platform_billing_settings" ADD COLUMN "paypal_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "platform_billing_settings" SET "paypal_enabled" = true, "provider" = 'razorpay' WHERE "provider" = 'paypal';
