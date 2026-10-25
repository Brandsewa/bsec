-- When the merchant finished authorising automatic payment (UPI AutoPay, card mandate) on the gateway. Null until then, so the
-- admin can tell "subscription created" from "payment method set up". Expand-only (docs/migrations.md).
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "authorized_at" timestamp with time zone;
