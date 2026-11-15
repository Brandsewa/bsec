-- Merchant analytics, slice 1: first-party traffic events (ADR-046, docs/ANALYTICS-PLAN.md). Expand-only: a new tenant table.
CREATE TABLE "analytics_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_type" text NOT NULL,
	"visitor_hash" text NOT NULL,
	"path" text NOT NULL,
	"product_slug" text,
	"referrer_host" text,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"country" text,
	"device" text,
	CONSTRAINT "analytics_events_type_chk" CHECK ("event_type" IN ('pageview', 'add_to_cart', 'begin_checkout')),
	CONSTRAINT "analytics_events_device_chk" CHECK ("device" IS NULL OR "device" IN ('desktop', 'mobile', 'tablet'))
);
--> statement-breakpoint
ALTER TABLE "analytics_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "analytics_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "analytics_events" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "analytics_events_tenant_time_idx" ON "analytics_events" ("tenant_id","occurred_at");
--> statement-breakpoint
CREATE INDEX "analytics_events_tenant_type_time_idx" ON "analytics_events" ("tenant_id","event_type","occurred_at");
