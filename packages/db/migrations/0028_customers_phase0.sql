-- Customers Phase 0: Foundations (0a truthful metrics, 0b guest customers, 0c consent record & history)

-- 1. Add is_guest, marketing_state, marketing_source, marketing_updated_at to customers
ALTER TABLE "customers" ADD COLUMN "is_guest" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "marketing_state" text DEFAULT 'not_subscribed' NOT NULL;
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "marketing_source" text;
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "marketing_updated_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX "customers_tenant_guest_idx" ON "customers" ("tenant_id", "is_guest");
--> statement-breakpoint
CREATE INDEX "customers_tenant_marketing_state_idx" ON "customers" ("tenant_id", "marketing_state");
--> statement-breakpoint

-- 2. Create customer_consent_events tenant table
CREATE TABLE "customer_consent_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"channel" text DEFAULT 'email' NOT NULL,
	"state" text NOT NULL,
	"source" text NOT NULL,
	"actor_type" text DEFAULT 'customer' NOT NULL,
	"actor_id" text,
	"ip" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_consent_events_tenant_id_uniq" UNIQUE("tenant_id", "id"),
	CONSTRAINT "customer_consent_events_state_chk" CHECK ("state" IN ('subscribed', 'unsubscribed', 'not_subscribed', 'invalid'))
);
--> statement-breakpoint
ALTER TABLE "customer_consent_events" ADD CONSTRAINT "customer_consent_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "customer_consent_events" ADD CONSTRAINT "customer_consent_events_customer_fk" FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "customers"("tenant_id", "id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "customer_consent_events_tenant_cust_at_idx" ON "customer_consent_events" ("tenant_id", "customer_id", "at");
--> statement-breakpoint
ALTER TABLE "customer_consent_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "customer_consent_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "customer_consent_events" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "customer_consent_events" TO "app_rw", "app_platform";
--> statement-breakpoint

-- 3. Idempotent Backfill for Consent:
-- 3a. Existing accepts_marketing = true rows become marketing_state = 'subscribed' with source 'legacy'
UPDATE "customers"
SET "marketing_state" = 'subscribed',
    "marketing_source" = COALESCE("marketing_source", 'legacy'),
    "marketing_updated_at" = COALESCE("marketing_updated_at", "marketing_consent_at", "created_at")
WHERE "accepts_marketing" = true AND "marketing_state" = 'not_subscribed';
--> statement-breakpoint

-- 3b. Backfill customer_consent_events for existing subscribed customers
INSERT INTO "customer_consent_events" ("tenant_id", "customer_id", "channel", "state", "source", "actor_type", "at")
SELECT "tenant_id", "id", 'email', 'subscribed', COALESCE("marketing_source", 'legacy'), 'system', COALESCE("marketing_updated_at", "marketing_consent_at", "created_at")
FROM "customers"
WHERE "marketing_state" = 'subscribed'
  AND NOT EXISTS (
    SELECT 1 FROM "customer_consent_events" e
    WHERE e.tenant_id = customers.tenant_id AND e.customer_id = customers.id
  );
--> statement-breakpoint

-- 3c. Link existing newsletter_subscribers to customers (or create guest customer if missing)
-- For existing customers who have a newsletter_subscribers row:
UPDATE "customers" c
SET "marketing_state" = 'subscribed',
    "accepts_marketing" = true,
    "marketing_source" = COALESCE(c."marketing_source", ns."source", 'legacy'),
    "marketing_updated_at" = COALESCE(c."marketing_updated_at", ns."consent_at", now())
FROM "newsletter_subscribers" ns
WHERE c."tenant_id" = ns."tenant_id"
  AND c."email" = ns."email"
  AND ns."status" = 'subscribed'
  AND c."marketing_state" <> 'subscribed';
--> statement-breakpoint

-- 4. Idempotent Backfill for Guests from Existing Orders:
-- Insert customers for distinct order emails that don't yet exist in customers
INSERT INTO "customers" ("tenant_id", "email", "phone", "name", "is_guest", "email_verified", "phone_verified", "created_at", "updated_at")
WITH first_orders AS (
  SELECT DISTINCT ON (o.tenant_id, o.email)
    o.tenant_id,
    o.email,
    NULLIF(regexp_replace(COALESCE(o.phone, ''), 'D', '', 'g'), '') AS phone,
    COALESCE(NULLIF(o.shipping_address->>'fullName', ''), '') AS name,
    o.placed_at
  FROM "orders" o
  WHERE o.email IS NOT NULL AND o.email <> ''
    AND NOT EXISTS (
      SELECT 1 FROM "customers" c
      WHERE c.tenant_id = o.tenant_id AND c.email = o.email
    )
  ORDER BY o.tenant_id, o.email, o.placed_at ASC
),
ranked AS (
  SELECT f.*,
    row_number() OVER (PARTITION BY f.tenant_id, f.phone ORDER BY f.placed_at, f.email) AS phone_rank
  FROM first_orders f
)
-- customers has a unique (tenant_id, phone): a phone already on a customer, or shared by two order emails, is left off
SELECT
  r.tenant_id,
  r.email,
  CASE
    WHEN r.phone IS NOT NULL AND r.phone_rank = 1
      AND NOT EXISTS (SELECT 1 FROM "customers" c2 WHERE c2.tenant_id = r.tenant_id AND c2.phone = r.phone)
    THEN r.phone
    ELSE NULL
  END,
  r.name,
  true,
  false,
  false,
  r.placed_at,
  r.placed_at
FROM ranked r;
--> statement-breakpoint

-- Link orders with null customer_id to their customer record by email
UPDATE "orders" o
SET "customer_id" = c.id
FROM "customers" c
WHERE o.tenant_id = c.tenant_id
  AND o.email = c.email
  AND o.customer_id IS NULL;
--> statement-breakpoint

-- 5. Idempotent Backfill for Customer Metrics:
WITH metrics AS (
  SELECT
    c.id AS customer_id,
    c.tenant_id AS tenant_id,
    COUNT(o.id) FILTER (WHERE (o.payment_status IN ('paid', 'partially_refunded') OR o.payment_status = 'cod_collected') AND o.status <> 'cancelled' AND (o.grand_total - COALESCE(ref.refunded, 0)) > 0)::int AS orders_count,
    COALESCE(SUM(o.grand_total - COALESCE(ref.refunded, 0)) FILTER (WHERE (o.payment_status IN ('paid', 'partially_refunded') OR o.payment_status = 'cod_collected') AND o.status <> 'cancelled'), 0)::bigint AS total_spent,
    MAX(o.placed_at) FILTER (WHERE (o.payment_status IN ('paid', 'partially_refunded') OR o.payment_status = 'cod_collected') AND o.status <> 'cancelled' AND (o.grand_total - COALESCE(ref.refunded, 0)) > 0) AS last_order_at
  FROM "customers" c
  LEFT JOIN "orders" o ON (o.tenant_id = c.tenant_id AND (o.customer_id = c.id OR (o.customer_id IS NULL AND o.email = c.email)))
  LEFT JOIN (
    SELECT tenant_id, order_id, COALESCE(SUM(amount), 0)::bigint AS refunded
    FROM "refunds"
    WHERE status IN ('succeeded', 'processed')
    GROUP BY tenant_id, order_id
  ) ref ON ref.tenant_id = o.tenant_id AND ref.order_id = o.id
  GROUP BY c.id, c.tenant_id
)
UPDATE "customers" c
SET "orders_count" = m.orders_count,
    "total_spent" = m.total_spent,
    "last_order_at" = m.last_order_at
FROM metrics m
WHERE c.id = m.customer_id AND c.tenant_id = m.tenant_id;
