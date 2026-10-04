-- Settings Rebuild Phase 4: Customer Account Settings, Order Settings, and Consent Event enhancements

-- 1. customer_account_settings: controls login methods, self-service returns/cancellation, and sign-in links
CREATE TABLE IF NOT EXISTS "customer_account_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"show_sign_in_links" boolean DEFAULT true NOT NULL,
	"email_password_enabled" boolean DEFAULT true NOT NULL,
	"phone_otp_enabled" boolean DEFAULT true NOT NULL,
	"allow_self_serve_returns" boolean DEFAULT true NOT NULL,
	"allow_self_serve_cancellation" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_account_settings_tenant_id_uniq" UNIQUE("tenant_id"),
	CONSTRAINT "customer_account_settings_tenant_id_id_uniq" UNIQUE("tenant_id", "id"),
	CONSTRAINT "customer_account_settings_login_method_chk" CHECK ("email_password_enabled" OR "phone_otp_enabled")
);
--> statement-breakpoint
ALTER TABLE "customer_account_settings" ADD CONSTRAINT "customer_account_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "customer_account_settings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "customer_account_settings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "customer_account_settings" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "customer_account_settings" TO "app_rw", "app_platform";
--> statement-breakpoint

-- 2. Expand store_settings with order_settings JSONB
ALTER TABLE "store_settings" ADD COLUMN IF NOT EXISTS "order_settings" jsonb;
--> statement-breakpoint

-- 3. Expand customer_consent_events with text_version and ip_hash
ALTER TABLE "customer_consent_events" ADD COLUMN IF NOT EXISTS "text_version" text;
--> statement-breakpoint
ALTER TABLE "customer_consent_events" ADD COLUMN IF NOT EXISTS "ip_hash" text;
