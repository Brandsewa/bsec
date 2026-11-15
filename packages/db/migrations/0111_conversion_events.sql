-- Merchant analytics slice 5c (ADR-047): server-side Meta events before an order exists (AddToCart, InitiateCheckout). Expand-only: a new tenant table.
CREATE TABLE "conversion_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_name" text NOT NULL,
	"event_id" text NOT NULL,
	"event_time" timestamp with time zone DEFAULT now() NOT NULL,
	"currency" text NOT NULL,
	"value" numeric(14, 2) NOT NULL,
	"items" jsonb NOT NULL,
	"client_ip" text,
	"user_agent" text,
	"fbp" text,
	"fbc" text,
	"source_url" text,
	"meta_status" text DEFAULT 'pending' NOT NULL,
	"meta_detail" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversion_events_tenant_event_uniq" UNIQUE("tenant_id","event_id"),
	CONSTRAINT "conversion_events_name_chk" CHECK ("event_name" IN ('AddToCart', 'InitiateCheckout')),
	CONSTRAINT "conversion_events_meta_status_chk" CHECK ("meta_status" IN ('pending', 'sent', 'failed', 'skipped'))
);
--> statement-breakpoint
ALTER TABLE "conversion_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "conversion_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "conversion_events" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "conversion_events" ADD CONSTRAINT "conversion_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "conversion_events_tenant_created_idx" ON "conversion_events" ("tenant_id","created_at");
