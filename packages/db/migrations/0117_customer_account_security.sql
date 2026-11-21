-- Customer account security and channel consent (docs/ACCOUNTS-PROFILE-PLAN.md, phase 2). Expand-only.
-- Sign-in trail the shopper sees on their Security page. A tenant table: RLS forced, composite FK to customers.
CREATE TABLE "customer_security_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"type" text NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_security_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "customer_security_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "customer_security_events" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "customer_security_events" ADD CONSTRAINT "customer_security_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "customer_security_events" ADD CONSTRAINT "customer_security_events_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "customers"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "customer_security_events_cust_created_idx" ON "customer_security_events" ("tenant_id","customer_id","created_at" DESC NULLS LAST);
--> statement-breakpoint
-- Texting and WhatsApp consent, separate from the email choice (accepts_marketing). Off until the shopper opts in.
ALTER TABLE "customers" ADD COLUMN "consent_sms" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "consent_whatsapp" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "channel_consent_updated_at" timestamp with time zone;
