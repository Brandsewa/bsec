-- Platform invoices carry their currency: Indian stores are billed in INR, stores outside India in USD through PayPal (ADR-040).
-- Expand step: new defaulted column. Existing invoices are INR, except those of PayPal subscriptions, which were stored in cents
-- with GST computed on them by mistake; they become USD with no GST.
ALTER TABLE "platform_invoices" ADD COLUMN "currency" char(3) DEFAULT 'INR' NOT NULL;
--> statement-breakpoint
UPDATE "platform_invoices" SET "currency" = 'USD', "tax_paise" = 0
WHERE "subscription_id" IN (SELECT "id" FROM "subscriptions" WHERE "provider" = 'paypal');
