-- Migration 0077: Google sign-in for a store's customers (docs/GOOGLE-SIGNIN-PLAN.md, Tier B). Expand-only.
-- Each store connects its OWN Google app (public Client ID only, no secret is stored). New tenant tables with forced RLS
-- and composite tenant foreign keys.
CREATE TABLE "store_social_auth" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"client_id" text,
	"one_tap_enabled" boolean DEFAULT true NOT NULL,
	"verified_at" timestamp with time zone,
	"verified_client_id" text,
	"verified_host" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_social_auth_tenant_provider_uniq" UNIQUE("tenant_id","provider"),
	CONSTRAINT "store_social_auth_tenant_id_uniq" UNIQUE("tenant_id","id"),
	CONSTRAINT "store_social_auth_provider_chk" CHECK ("provider" in ('google'))
);
--> statement-breakpoint
ALTER TABLE "store_social_auth" ADD CONSTRAINT "store_social_auth_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "store_social_auth" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "store_social_auth" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store_social_auth" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "store_social_auth" TO "app_rw", "app_platform";
--> statement-breakpoint
CREATE TABLE "customer_identities" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"subject" text NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_identities_tenant_provider_subject_uniq" UNIQUE("tenant_id","provider","subject"),
	CONSTRAINT "customer_identities_tenant_id_uniq" UNIQUE("tenant_id","id"),
	CONSTRAINT "customer_identities_provider_chk" CHECK ("provider" in ('google'))
);
--> statement-breakpoint
ALTER TABLE "customer_identities" ADD CONSTRAINT "customer_identities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "customer_identities" ADD CONSTRAINT "customer_identities_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "customers"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "customer_identities_tenant_customer_idx" ON "customer_identities" ("tenant_id","customer_id");
--> statement-breakpoint
ALTER TABLE "customer_identities" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "customer_identities" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "customer_identities" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "customer_identities" TO "app_rw", "app_platform";
