-- Markets configuration (ADR-040, docs/MULTIMARKET-PLAN.md phases 2-6 and 4B). Expand-only: new tables, new nullable
-- columns, wider provider check constraints. No existing behaviour changes.
ALTER TABLE "markets" ADD COLUMN "tax_collect" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "tax_shipping_too" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "compliance_ack_by" uuid;
--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "compliance_ack_at" timestamp with time zone;
--> statement-breakpoint
CREATE TABLE "market_prices" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"market_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"price" bigint NOT NULL,
	"compare_at_price" bigint,
	"source" text DEFAULT 'derived' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_prices_tenant_market_variant_uniq" UNIQUE("tenant_id","market_id","variant_id"),
	CONSTRAINT "market_prices_source_chk" CHECK ("source" in ('derived', 'fixed')),
	CONSTRAINT "market_prices_price_chk" CHECK ("price" >= 0)
);
--> statement-breakpoint
ALTER TABLE "market_prices" ADD CONSTRAINT "market_prices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "market_prices" ADD CONSTRAINT "market_prices_market_fk" FOREIGN KEY ("tenant_id","market_id") REFERENCES "markets"("tenant_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "market_prices" ADD CONSTRAINT "market_prices_variant_fk" FOREIGN KEY ("tenant_id","variant_id") REFERENCES "variants"("tenant_id","id") ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX "market_prices_tenant_variant_idx" ON "market_prices" ("tenant_id","variant_id");
--> statement-breakpoint
ALTER TABLE "market_prices" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "market_prices" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "market_prices" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE TABLE "market_fx_history" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"market_id" uuid NOT NULL,
	"rate" numeric(18, 8) NOT NULL,
	"set_by" uuid,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "market_fx_history" ADD CONSTRAINT "market_fx_history_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "market_fx_history" ADD CONSTRAINT "market_fx_history_market_fk" FOREIGN KEY ("tenant_id","market_id") REFERENCES "markets"("tenant_id","id") ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX "market_fx_history_tenant_market_idx" ON "market_fx_history" ("tenant_id","market_id","set_at");
--> statement-breakpoint
ALTER TABLE "market_fx_history" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "market_fx_history" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "market_fx_history" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE TABLE "market_products" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"market_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"published" boolean DEFAULT true NOT NULL,
	CONSTRAINT "market_products_tenant_market_product_uniq" UNIQUE("tenant_id","market_id","product_id")
);
--> statement-breakpoint
ALTER TABLE "market_products" ADD CONSTRAINT "market_products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "market_products" ADD CONSTRAINT "market_products_market_fk" FOREIGN KEY ("tenant_id","market_id") REFERENCES "markets"("tenant_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "market_products" ADD CONSTRAINT "market_products_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "products"("tenant_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "market_products" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "market_products" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "market_products" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE TABLE "market_payment_methods" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"market_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "market_payment_methods_tenant_market_provider_uniq" UNIQUE("tenant_id","market_id","provider")
);
--> statement-breakpoint
ALTER TABLE "market_payment_methods" ADD CONSTRAINT "market_payment_methods_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "market_payment_methods" ADD CONSTRAINT "market_payment_methods_market_fk" FOREIGN KEY ("tenant_id","market_id") REFERENCES "markets"("tenant_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "market_payment_methods" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "market_payment_methods" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "market_payment_methods" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE TABLE "market_policies" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"market_id" uuid NOT NULL,
	"return_settings" jsonb,
	"cancellation" jsonb,
	"policy_text" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_policies_tenant_market_uniq" UNIQUE("tenant_id","market_id")
);
--> statement-breakpoint
ALTER TABLE "market_policies" ADD CONSTRAINT "market_policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "market_policies" ADD CONSTRAINT "market_policies_market_fk" FOREIGN KEY ("tenant_id","market_id") REFERENCES "markets"("tenant_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "market_policies" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "market_policies" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "market_policies" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE TABLE "market_tax_rules" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"market_id" uuid NOT NULL,
	"country" text NOT NULL,
	"region" text DEFAULT '*' NOT NULL,
	"tax_name" text NOT NULL,
	"rate_bps" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "market_tax_rules_rate_chk" CHECK ("rate_bps" >= 0 and "rate_bps" <= 10000)
);
--> statement-breakpoint
ALTER TABLE "market_tax_rules" ADD CONSTRAINT "market_tax_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "market_tax_rules" ADD CONSTRAINT "market_tax_rules_market_fk" FOREIGN KEY ("tenant_id","market_id") REFERENCES "markets"("tenant_id","id") ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX "market_tax_rules_tenant_market_idx" ON "market_tax_rules" ("tenant_id","market_id");
--> statement-breakpoint
ALTER TABLE "market_tax_rules" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "market_tax_rules" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "market_tax_rules" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "shipping_zones" ADD COLUMN "market_id" uuid;
--> statement-breakpoint
ALTER TABLE "shipping_zones" ADD CONSTRAINT "shipping_zones_market_fk" FOREIGN KEY ("tenant_id","market_id") REFERENCES "markets"("tenant_id","id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "tax_breakdown" jsonb;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "policy_snapshot" jsonb;
--> statement-breakpoint
-- Existing shipping zones belong to the base market; every store keeps offering what it offered.
-- Tenant tables are FORCE ROW LEVEL SECURITY: scope each step to one tenant.
DO $$
DECLARE t record; mid uuid;
BEGIN
  FOR t IN SELECT id FROM "tenants" LOOP
    PERFORM set_config('app.tenant_id', t.id::text, true);
    SELECT id INTO mid FROM "markets" WHERE tenant_id = t.id AND is_base;
    IF mid IS NOT NULL THEN
      UPDATE "shipping_zones" SET "market_id" = mid WHERE tenant_id = t.id AND "market_id" IS NULL;
      INSERT INTO "market_payment_methods" ("tenant_id","market_id","provider","enabled","sort_order")
        SELECT t.id, mid, pm.provider, true, pm.sort_order FROM "payment_methods" pm WHERE pm.tenant_id = t.id
        ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END $$;
--> statement-breakpoint
-- Gateways: PayPal joins Razorpay, Stripe and Cashfree (owner decision 2026-10-28, sandbox first).
ALTER TABLE "payment_methods" DROP CONSTRAINT IF EXISTS "payment_methods_provider_chk";
--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_provider_chk" CHECK ("provider" IN ('cod', 'razorpay', 'stripe', 'cashfree', 'paypal'));
--> statement-breakpoint
INSERT INTO "platform_payment_providers" ("provider", "display_name", "enabled", "live_mode_allowed", "sort")
VALUES ('paypal', 'PayPal', false, false, 4)
ON CONFLICT ("provider") DO NOTHING;
--> statement-breakpoint
ALTER TABLE "platform_billing_settings" DROP CONSTRAINT IF EXISTS "platform_billing_settings_provider_chk";
--> statement-breakpoint
ALTER TABLE "platform_billing_settings" ADD CONSTRAINT "platform_billing_settings_provider_chk" CHECK ("provider" IN ('razorpay', 'cashfree', 'paypal'));
--> statement-breakpoint
-- Brand Sewa's own global pricing (decision 13): a USD price next to the INR one, and the extra-market limit per plan.
ALTER TABLE "plans" ADD COLUMN "price_monthly_usd_cents" bigint;
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "price_yearly_usd_cents" bigint;
--> statement-breakpoint
UPDATE "plans" SET "limits" = coalesce("limits", '{}'::jsonb) || jsonb_build_object('max_extra_markets',
  CASE "code" WHEN 'starter' THEN 1 WHEN 'growth' THEN 2 WHEN 'pro' THEN 5 ELSE 1 END)
  WHERE NOT (coalesce("limits", '{}'::jsonb) ? 'max_extra_markets');
