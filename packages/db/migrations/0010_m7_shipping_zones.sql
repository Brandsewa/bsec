CREATE TABLE "shipping_zones" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"countries" text[] DEFAULT ARRAY['IN']::text[] NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipping_zones_tenant_id_uniq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "shipping_zones" ADD CONSTRAINT "shipping_zones_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "shipping_zones_tenant_default_idx" ON "shipping_zones" ("tenant_id","is_default");
--> statement-breakpoint
ALTER TABLE "shipping_zones" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "shipping_zones" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "shipping_zones" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE TABLE "shipping_rates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"zone_id" uuid NOT NULL,
	"name" text NOT NULL,
	"method" text DEFAULT 'standard' NOT NULL,
	"rate_type" text DEFAULT 'flat' NOT NULL,
	"price_paise" integer DEFAULT 0 NOT NULL,
	"threshold_paise" integer,
	"min_days" integer DEFAULT 2,
	"max_days" integer DEFAULT 5,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipping_rates_tenant_id_uniq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "shipping_rates" ADD CONSTRAINT "shipping_rates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "shipping_rates" ADD CONSTRAINT "shipping_rates_zone_fk" FOREIGN KEY ("tenant_id","zone_id") REFERENCES "shipping_zones"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "shipping_rates_tenant_zone_idx" ON "shipping_rates" ("tenant_id","zone_id");
--> statement-breakpoint
ALTER TABLE "shipping_rates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "shipping_rates" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "shipping_rates" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "shipping_zones", "shipping_rates" TO "app_rw";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "shipping_zones", "shipping_rates" TO "app_platform";
--> statement-breakpoint
-- Seed existing tenants with standard: 0, express: 15000 paise (M7)
DO $$
DECLARE
  t RECORD;
  zid uuid;
BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', t.id::text, true);
    IF NOT EXISTS (SELECT 1 FROM shipping_zones WHERE tenant_id = t.id) THEN
      zid := uuidv7();
      INSERT INTO shipping_zones (id, tenant_id, name, countries, is_default)
      VALUES (zid, t.id, 'Domestic (India)', ARRAY['IN'], true);

      INSERT INTO shipping_rates (id, tenant_id, zone_id, name, method, rate_type, price_paise, threshold_paise, min_days, max_days)
      VALUES
        (uuidv7(), t.id, zid, 'Standard Shipping', 'standard', 'flat', 0, NULL, 4, 7),
        (uuidv7(), t.id, zid, 'Express Shipping', 'express', 'flat', 15000, NULL, 2, 3);
    END IF;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END $$;
