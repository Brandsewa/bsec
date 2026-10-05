-- Settings Rebuild Phase 7: email_log enhancements, store_policies, store_policy_versions, orders terms consent columns, privacy_settings, privacy_requests
-- Slices 7A, 7B & 7C

-- 1. email_log enhancements
ALTER TABLE "email_log" ADD COLUMN IF NOT EXISTS "event_key" text;
--> statement-breakpoint
ALTER TABLE "email_log" ADD COLUMN IF NOT EXISTS "channel" text DEFAULT 'email' NOT NULL;
--> statement-breakpoint
ALTER TABLE "email_log" ADD COLUMN IF NOT EXISTS "suppressed_reason" text;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'email_log_channel_chk'
  ) THEN
    ALTER TABLE "email_log" ADD CONSTRAINT "email_log_channel_chk" CHECK ("channel" = 'email');
  END IF;
END $$;
--> statement-breakpoint

-- 2. Create store_policies tenant table
CREATE TABLE IF NOT EXISTS "store_policies" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"handle" text NOT NULL,
	"title" text NOT NULL,
	"draft_content" jsonb NOT NULL,
	"published_version_id" uuid,
	"draft_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_policies_tenant_handle_uniq" UNIQUE("tenant_id", "handle"),
	CONSTRAINT "store_policies_tenant_id_uniq" UNIQUE("tenant_id", "id"),
	CONSTRAINT "store_policies_handle_chk" CHECK ("handle" IN ('refund', 'privacy', 'terms', 'shipping', 'legal_notice')),
	CONSTRAINT "store_policies_title_chk" CHECK (char_length("title") BETWEEN 1 AND 120)
);
--> statement-breakpoint
ALTER TABLE "store_policies" ADD CONSTRAINT "store_policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "store_policies" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "store_policies" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store_policies" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "store_policies" TO "app_rw", "app_platform";
--> statement-breakpoint

-- 3. Create store_policy_versions tenant table (append-only)
CREATE TABLE IF NOT EXISTS "store_policy_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"content" jsonb NOT NULL,
	"content_sha256" text NOT NULL,
	"published_by" uuid,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_policy_versions_policy_version_uniq" UNIQUE("policy_id", "version"),
	CONSTRAINT "store_policy_versions_tenant_id_uniq" UNIQUE("tenant_id", "id"),
	CONSTRAINT "store_policy_versions_version_chk" CHECK ("version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "store_policy_versions" ADD CONSTRAINT "store_policy_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "store_policy_versions" ADD CONSTRAINT "store_policy_versions_policy_fk" FOREIGN KEY ("tenant_id", "policy_id") REFERENCES "store_policies"("tenant_id", "id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "store_policies" ADD CONSTRAINT "store_policies_published_version_fk" FOREIGN KEY ("tenant_id", "published_version_id") REFERENCES "store_policy_versions"("tenant_id", "id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "store_policy_versions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "store_policy_versions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store_policy_versions" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
-- CRITICAL APPEND-ONLY PRIVILEGE RULE: app_rw is granted SELECT, INSERT only (NO UPDATE, NO DELETE)
REVOKE UPDATE, DELETE ON TABLE "store_policy_versions" FROM "app_rw";
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "store_policy_versions" TO "app_rw";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "store_policy_versions" TO "app_platform";
--> statement-breakpoint

-- 4. Expand orders with terms consent columns
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "terms_policy_version_id" uuid;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "terms_accepted_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_terms_policy_version_fk" FOREIGN KEY ("tenant_id", "terms_policy_version_id") REFERENCES "store_policy_versions"("tenant_id", "id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint

-- 5. Create privacy_settings tenant table
CREATE TABLE IF NOT EXISTS "privacy_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"privacy_contact_email" citext,
	"grievance_officer_name" text,
	"request_sla_days" integer DEFAULT 30 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "privacy_settings_tenant_id_uniq" UNIQUE("tenant_id"),
	CONSTRAINT "privacy_settings_tenant_id_id_uniq" UNIQUE("tenant_id", "id"),
	CONSTRAINT "privacy_settings_sla_chk" CHECK ("request_sla_days" BETWEEN 7 AND 90),
	CONSTRAINT "privacy_settings_grievance_officer_chk" CHECK ("grievance_officer_name" IS NULL OR char_length("grievance_officer_name") BETWEEN 1 AND 120)
);
--> statement-breakpoint
ALTER TABLE "privacy_settings" ADD CONSTRAINT "privacy_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "privacy_settings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "privacy_settings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "privacy_settings" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "privacy_settings" TO "app_rw", "app_platform";
--> statement-breakpoint

-- 6. Create privacy_requests tenant table
CREATE TABLE IF NOT EXISTS "privacy_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_id" uuid,
	"requester_email" citext NOT NULL,
	"kind" text NOT NULL,
	"details" text,
	"status" text DEFAULT 'pending_verification' NOT NULL,
	"verified_at" timestamp with time zone,
	"due_at" timestamp with time zone NOT NULL,
	"handled_by" uuid,
	"handled_at" timestamp with time zone,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "privacy_requests_tenant_id_uniq" UNIQUE("tenant_id", "id"),
	CONSTRAINT "privacy_requests_kind_chk" CHECK ("kind" IN ('access', 'correction', 'erasure', 'grievance', 'withdraw_consent')),
	CONSTRAINT "privacy_requests_details_chk" CHECK ("details" IS NULL OR char_length("details") <= 2000),
	CONSTRAINT "privacy_requests_status_chk" CHECK ("status" IN ('pending_verification', 'open', 'in_progress', 'completed', 'rejected')),
	CONSTRAINT "privacy_requests_resolution_note_chk" CHECK ("resolution_note" IS NULL OR char_length("resolution_note") <= 1000)
);
--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_customer_fk" FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "customers"("tenant_id", "id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "privacy_requests_tenant_status_due_idx" ON "privacy_requests" ("tenant_id", "status", "due_at");
--> statement-breakpoint
ALTER TABLE "privacy_requests" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "privacy_requests" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "privacy_requests" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "privacy_requests" TO "app_rw", "app_platform";
