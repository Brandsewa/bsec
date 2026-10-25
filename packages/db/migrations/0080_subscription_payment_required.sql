-- A store that signed up while the free trial was off must pay before it is opened: the admin shows an "Activate your store"
-- screen until the first payment arrives. Set at creation, cleared by the first successful charge. Expand-only.
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "payment_required" boolean DEFAULT false NOT NULL;
