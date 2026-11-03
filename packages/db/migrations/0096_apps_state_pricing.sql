-- Apps framework and State Pricing (ADR-043, ADR-044, docs/STATE-PRICING-PLAN.md). Expand-only: new tables, new nullable
-- columns, and market_variant_price replaced by a version that is identical while app.price_region is empty.
CREATE TABLE "platform_apps" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"icon" text DEFAULT 'puzzle' NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"allowed_tenant_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_apps_visibility_chk" CHECK ("visibility" in ('public', 'private'))
);
--> statement-breakpoint
INSERT INTO "platform_apps" ("key","name","description","icon","category","visibility","enabled","sort") VALUES
  ('state-pricing','State Pricing','Show different product prices in different Indian states. The shopper''s state is detected automatically, or asked for with a pincode box.','map-pin','pricing','private',true,1)
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
REVOKE ALL ON TABLE "platform_apps" FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON TABLE "platform_apps" FROM "app_rw";
--> statement-breakpoint
GRANT SELECT ON TABLE "platform_apps" TO "app_rw";
--> statement-breakpoint
GRANT ALL ON TABLE "platform_apps" TO "app_platform";
--> statement-breakpoint
CREATE TABLE "platform_in_states" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'state' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
INSERT INTO "platform_in_states" ("code","name","kind","sort") VALUES
  ('AN','Andaman and Nicobar Islands','ut',1),('AP','Andhra Pradesh','state',2),('AR','Arunachal Pradesh','state',3),
  ('AS','Assam','state',4),('BR','Bihar','state',5),('CH','Chandigarh','ut',6),('CG','Chhattisgarh','state',7),
  ('DD','Dadra and Nagar Haveli and Daman and Diu','ut',8),('DL','Delhi','ut',9),('GA','Goa','state',10),
  ('GJ','Gujarat','state',11),('HR','Haryana','state',12),('HP','Himachal Pradesh','state',13),
  ('JK','Jammu and Kashmir','ut',14),('JH','Jharkhand','state',15),('KA','Karnataka','state',16),('KL','Kerala','state',17),
  ('LA','Ladakh','ut',18),('LD','Lakshadweep','ut',19),('MP','Madhya Pradesh','state',20),('MH','Maharashtra','state',21),
  ('MN','Manipur','state',22),('ML','Meghalaya','state',23),('MZ','Mizoram','state',24),('NL','Nagaland','state',25),
  ('OD','Odisha','state',26),('PY','Puducherry','ut',27),('PB','Punjab','state',28),('RJ','Rajasthan','state',29),
  ('SK','Sikkim','state',30),('TN','Tamil Nadu','state',31),('TG','Telangana','state',32),('TR','Tripura','state',33),
  ('UP','Uttar Pradesh','state',34),('UT','Uttarakhand','state',35),('WB','West Bengal','state',36)
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
REVOKE ALL ON TABLE "platform_in_states" FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON TABLE "platform_in_states" FROM "app_rw";
--> statement-breakpoint
GRANT SELECT ON TABLE "platform_in_states" TO "app_rw";
--> statement-breakpoint
GRANT ALL ON TABLE "platform_in_states" TO "app_platform";
--> statement-breakpoint
-- India Post pincode directory (platform data, loaded by apps/platform import:pincodes). Used by the State Pricing manual mode.
CREATE TABLE "platform_in_pincodes" (
	"pincode" text PRIMARY KEY NOT NULL,
	"state_code" text NOT NULL,
	CONSTRAINT "platform_in_pincodes_pincode_chk" CHECK ("pincode" ~ '^[1-9][0-9]{5}$')
);
--> statement-breakpoint
ALTER TABLE "platform_in_pincodes" ADD CONSTRAINT "platform_in_pincodes_state_code_fk" FOREIGN KEY ("state_code") REFERENCES "platform_in_states"("code") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
REVOKE ALL ON TABLE "platform_in_pincodes" FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON TABLE "platform_in_pincodes" FROM "app_rw";
--> statement-breakpoint
GRANT SELECT ON TABLE "platform_in_pincodes" TO "app_rw";
--> statement-breakpoint
GRANT ALL ON TABLE "platform_in_pincodes" TO "app_platform";
--> statement-breakpoint
CREATE TABLE "tenant_apps" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"app_key" text NOT NULL,
	"status" text DEFAULT 'installed' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"settings_version" integer DEFAULT 1 NOT NULL,
	"platform_suspended" boolean DEFAULT false NOT NULL,
	"installed_by" uuid,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_apps_tenant_app_uniq" UNIQUE("tenant_id","app_key"),
	CONSTRAINT "tenant_apps_status_chk" CHECK ("status" in ('installed', 'disabled'))
);
--> statement-breakpoint
ALTER TABLE "tenant_apps" ADD CONSTRAINT "tenant_apps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tenant_apps" ADD CONSTRAINT "tenant_apps_app_key_platform_apps_key_fk" FOREIGN KEY ("app_key") REFERENCES "platform_apps"("key") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tenant_apps" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tenant_apps" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenant_apps" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE TABLE "state_prices" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"state_code" text NOT NULL,
	"price" bigint NOT NULL,
	"compare_at_price" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "state_prices_tenant_variant_state_uniq" UNIQUE("tenant_id","variant_id","state_code"),
	CONSTRAINT "state_prices_price_chk" CHECK ("price" > 0)
);
--> statement-breakpoint
ALTER TABLE "state_prices" ADD CONSTRAINT "state_prices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "state_prices" ADD CONSTRAINT "state_prices_state_code_platform_in_states_code_fk" FOREIGN KEY ("state_code") REFERENCES "platform_in_states"("code") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "state_prices" ADD CONSTRAINT "state_prices_variant_fk" FOREIGN KEY ("tenant_id","variant_id") REFERENCES "variants"("tenant_id","id") ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX "state_prices_tenant_state_idx" ON "state_prices" ("tenant_id","state_code");
--> statement-breakpoint
ALTER TABLE "state_prices" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "state_prices" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "state_prices" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "carts" ADD COLUMN "price_region" text;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "price_region" text;
--> statement-breakpoint
-- The storefront sets the transaction-local app.price_region only for stores whose State Pricing app is active, so with
-- the setting empty this function is exactly migration 0089's: market price when scoped, else the variant's own price.
-- A state price replaces the price in the base market only (a store's other markets keep their own currencies).
CREATE OR REPLACE FUNCTION market_variant_price(p_tenant uuid, p_variant uuid, p_base bigint) RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    CASE WHEN nullif(current_setting('app.market_id', true), '') IS NULL
      OR EXISTS (SELECT 1 FROM markets m WHERE m.tenant_id = p_tenant AND m.id = nullif(current_setting('app.market_id', true), '')::uuid AND m.is_base)
      THEN (SELECT sp.price FROM state_prices sp
        WHERE sp.tenant_id = p_tenant AND sp.variant_id = p_variant
          AND sp.state_code = nullif(current_setting('app.price_region', true), ''))
    END,
    (SELECT mp.price FROM market_prices mp
      WHERE mp.tenant_id = p_tenant AND mp.variant_id = p_variant
        AND mp.market_id = nullif(current_setting('app.market_id', true), '')::uuid),
    p_base)
$$;
