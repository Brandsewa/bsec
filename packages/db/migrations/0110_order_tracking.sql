-- Merchant analytics slice 5b (ADR-047): per-order context for the server-side conversion APIs (Meta CAPI, GA4 Measurement Protocol). Expand-only: a new tenant table.
CREATE TABLE "order_tracking" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"consent_analytics" boolean DEFAULT false NOT NULL,
	"consent_marketing" boolean DEFAULT false NOT NULL,
	"client_ip" text,
	"user_agent" text,
	"fbp" text,
	"fbc" text,
	"ga_client_id" text,
	"source_url" text,
	"meta_status" text DEFAULT 'skipped' NOT NULL,
	"meta_detail" text,
	"ga4_status" text DEFAULT 'skipped' NOT NULL,
	"ga4_detail" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_tracking_tenant_order_uniq" UNIQUE("tenant_id","order_id"),
	CONSTRAINT "order_tracking_meta_status_chk" CHECK ("meta_status" IN ('pending', 'sent', 'failed', 'skipped')),
	CONSTRAINT "order_tracking_ga4_status_chk" CHECK ("ga4_status" IN ('pending', 'sent', 'failed', 'skipped'))
);
--> statement-breakpoint
ALTER TABLE "order_tracking" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "order_tracking" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "order_tracking" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "order_tracking" ADD CONSTRAINT "order_tracking_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_tracking" ADD CONSTRAINT "order_tracking_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."orders"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "order_tracking_tenant_created_idx" ON "order_tracking" ("tenant_id","created_at");
