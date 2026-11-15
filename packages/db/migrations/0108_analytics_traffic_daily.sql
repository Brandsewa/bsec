-- Merchant analytics, slice 2: daily traffic rollup (ADR-047). Expand-only: a new tenant table. Aggregate counts only.
CREATE TABLE "analytics_traffic_daily" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"day" date NOT NULL,
	"dimension" text NOT NULL,
	"key" text DEFAULT '' NOT NULL,
	"sessions" integer DEFAULT 0 NOT NULL,
	"pageviews" integer DEFAULT 0 NOT NULL,
	"product_views" integer DEFAULT 0 NOT NULL,
	"carts" integer DEFAULT 0 NOT NULL,
	"checkouts" integer DEFAULT 0 NOT NULL,
	"bounces" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "analytics_traffic_daily_uniq" UNIQUE("tenant_id","day","dimension","key"),
	CONSTRAINT "analytics_traffic_daily_dim_chk" CHECK ("dimension" IN ('total', 'referrer', 'source', 'country', 'device', 'landing'))
);
--> statement-breakpoint
ALTER TABLE "analytics_traffic_daily" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "analytics_traffic_daily" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "analytics_traffic_daily" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "analytics_traffic_daily" ADD CONSTRAINT "analytics_traffic_daily_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
