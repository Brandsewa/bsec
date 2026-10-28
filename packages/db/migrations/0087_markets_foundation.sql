-- Markets foundation (ADR-040, docs/MULTIMARKET-PLAN.md Phase 1). Expand-only: new tables, new nullable columns,
-- a base market backfilled for every existing store. Nothing existing changes behaviour.
CREATE TABLE "markets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"handle" text NOT NULL,
	"is_base" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"unit_system" text,
	"fx_rate" numeric(18, 8),
	"price_adjust_bps" integer DEFAULT 0 NOT NULL,
	"rounding" text DEFAULT 'none' NOT NULL,
	"tax_display" text DEFAULT 'inclusive' NOT NULL,
	"path_prefix" text,
	"catalog_mode" text DEFAULT 'all' NOT NULL,
	"locale" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "markets_tenant_id_uniq" UNIQUE("tenant_id","id"),
	CONSTRAINT "markets_tenant_handle_uniq" UNIQUE("tenant_id","handle"),
	CONSTRAINT "markets_status_chk" CHECK ("status" in ('draft', 'active', 'disabled')),
	CONSTRAINT "markets_unit_system_chk" CHECK ("unit_system" is null or "unit_system" in ('metric', 'imperial')),
	CONSTRAINT "markets_tax_display_chk" CHECK ("tax_display" in ('inclusive', 'exclusive')),
	CONSTRAINT "markets_catalog_mode_chk" CHECK ("catalog_mode" in ('all', 'selected')),
	CONSTRAINT "markets_rounding_chk" CHECK ("rounding" in ('none', 'nearest_whole', 'charm_99', 'charm_95')),
	CONSTRAINT "markets_base_no_prefix_chk" CHECK (not "is_base" or "path_prefix" is null)
);
--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "markets_tenant_base_uniq" ON "markets" ("tenant_id") WHERE is_base;
--> statement-breakpoint
ALTER TABLE "markets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "markets" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "markets" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE TABLE "market_countries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"market_id" uuid NOT NULL,
	"country" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_countries_tenant_country_uniq" UNIQUE("tenant_id","country"),
	CONSTRAINT "market_countries_country_chk" CHECK ("country" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
ALTER TABLE "market_countries" ADD CONSTRAINT "market_countries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "market_countries" ADD CONSTRAINT "market_countries_market_fk" FOREIGN KEY ("tenant_id","market_id") REFERENCES "markets"("tenant_id","id") ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX "market_countries_tenant_market_idx" ON "market_countries" ("tenant_id","market_id");
--> statement-breakpoint
ALTER TABLE "market_countries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "market_countries" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "market_countries" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
-- Platform data: no tenant column, no RLS. Writable only by app_platform; app_rw reads.
CREATE TABLE "platform_countries" (
	"iso2" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"default_currency" text NOT NULL,
	"default_locale" text NOT NULL,
	"default_timezone" text NOT NULL,
	"default_unit_system" text DEFAULT 'metric' NOT NULL,
	"address_schema" text DEFAULT 'generic' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "platform_countries" ("iso2","name","default_currency","default_locale","default_timezone","default_unit_system","address_schema","enabled","sort") VALUES
  ('IN','India','INR','en-IN','Asia/Kolkata','metric','in',true,1),
  ('US','United States','USD','en-US','America/New_York','imperial','us',true,2),
  ('CA','Canada','CAD','en-CA','America/Toronto','metric','ca',true,3)
ON CONFLICT ("iso2") DO NOTHING;
--> statement-breakpoint
REVOKE ALL ON TABLE "platform_countries" FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON TABLE "platform_countries" FROM "app_rw";
--> statement-breakpoint
GRANT SELECT ON TABLE "platform_countries" TO "app_rw";
--> statement-breakpoint
GRANT ALL ON TABLE "platform_countries" TO "app_platform";
--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "unit_system" text DEFAULT 'metric' NOT NULL;
--> statement-breakpoint
ALTER TABLE "store_settings" ADD CONSTRAINT "store_settings_unit_system_chk" CHECK ("unit_system" in ('metric', 'imperial'));
--> statement-breakpoint
ALTER TABLE "carts" ADD COLUMN "market_id" uuid;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "market_id" uuid;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "base_currency" text;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "fx_rate" numeric(18, 8);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "base_grand_total" bigint;
--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_market_fk" FOREIGN KEY ("tenant_id","market_id") REFERENCES "markets"("tenant_id","id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_market_fk" FOREIGN KEY ("tenant_id","market_id") REFERENCES "markets"("tenant_id","id") ON DELETE restrict;
--> statement-breakpoint
-- Backfill: one base market per store from its country and currency, covering every country its shipping zones
-- already serve (so behaviour is unchanged); weight unit; open carts and every order point at it.
-- The tenant tables are FORCE ROW LEVEL SECURITY: scope each step to one tenant at a time.
DO $$
DECLARE t record; mid uuid; cur text; cc text;
BEGIN
  FOR t IN SELECT id, country, currency FROM "tenants" LOOP
    PERFORM set_config('app.tenant_id', t.id::text, true);
    cc := upper(coalesce(nullif(t.country, ''), 'IN'));
    SELECT coalesce(nullif(s.currency, ''), t.currency, 'INR') INTO cur FROM "store_settings" s WHERE s.tenant_id = t.id;
    cur := upper(coalesce(cur, t.currency, 'INR'));
    INSERT INTO "markets" ("tenant_id","name","handle","is_base","status","currency","tax_display")
    VALUES (t.id,
      CASE cc WHEN 'IN' THEN 'India' WHEN 'US' THEN 'United States' WHEN 'CA' THEN 'Canada' ELSE cc END,
      lower(cc), true, 'active', cur, CASE cc WHEN 'IN' THEN 'inclusive' ELSE 'exclusive' END)
    RETURNING id INTO mid;
    INSERT INTO "market_countries" ("tenant_id","market_id","country")
      SELECT t.id, mid, x.c FROM (
        SELECT cc AS c
        UNION
        SELECT upper(z) FROM "shipping_zones" sz, unnest(sz.countries) AS z WHERE sz.tenant_id = t.id
      ) x WHERE x.c ~ '^[A-Z]{2}$'
      ON CONFLICT DO NOTHING;
    UPDATE "store_settings" SET "unit_system" = 'imperial' WHERE tenant_id = t.id AND "weight_unit" IN ('lb', 'oz');
    UPDATE "carts" SET "market_id" = mid WHERE tenant_id = t.id AND "market_id" IS NULL;
    UPDATE "orders" SET "market_id" = mid, "base_currency" = "currency", "base_grand_total" = "grand_total"
      WHERE tenant_id = t.id AND "market_id" IS NULL;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END $$;
