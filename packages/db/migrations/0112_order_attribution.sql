-- Merchant analytics Phase 2, attribution (ADR-047): where an order came from. Expand-only: a new tenant table.
CREATE TABLE "order_attribution" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"referrer_host" text,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"landing_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_attribution_tenant_order_uniq" UNIQUE("tenant_id","order_id")
);
--> statement-breakpoint
ALTER TABLE "order_attribution" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "order_attribution" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "order_attribution" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "order_attribution" ADD CONSTRAINT "order_attribution_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_attribution" ADD CONSTRAINT "order_attribution_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "public"."orders"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
