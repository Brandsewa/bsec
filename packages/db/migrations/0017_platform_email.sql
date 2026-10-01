-- Migration 0017: Platform Email Settings and Log (AUTH-OVERHAUL-PLAN Phase A)
-- Idempotent Drizzle migration

CREATE TABLE IF NOT EXISTS "platform_email_settings" (
  "id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
  "provider" text DEFAULT 'zoho_zeptomail' NOT NULL,
  "host" text DEFAULT 'smtp.zeptomail.in' NOT NULL,
  "port" integer DEFAULT 587 NOT NULL,
  "secure_mode" text DEFAULT 'starttls' NOT NULL,
  "username" text DEFAULT 'emailapikey' NOT NULL,
  "password_ciphertext" text,
  "password_iv" text,
  "key_version" integer DEFAULT 1 NOT NULL,
  "from_email" citext DEFAULT 'no-reply@gobs.cloud' NOT NULL,
  "from_name" text DEFAULT 'Brand Sewa' NOT NULL,
  "reply_to" citext,
  "enabled" boolean DEFAULT false NOT NULL,
  "last_test_at" timestamp with time zone,
  "last_test_status" text,
  "last_test_error" text,
  "updated_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "platform_email_log" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "tenant_id" uuid REFERENCES "tenants"("id") ON DELETE set null,
  "to_email" citext NOT NULL,
  "template" text NOT NULL,
  "status" text NOT NULL,
  "provider_message_id" text,
  "error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "platform_email_log_created_at_idx" ON "platform_email_log" ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_email_log_tenant_idx" ON "platform_email_log" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_email_log_to_email_idx" ON "platform_email_log" ("to_email");
--> statement-breakpoint

-- Role permissions (AUTH-OVERHAUL-PLAN §3.1)
-- Platform-level, NO tenant column, writable only by app_platform, NO RLS.
-- app_rw has SELECT on platform_email_settings and INSERT on platform_email_log so that
-- the background worker / web runtime can send transactional emails and record delivery status.
REVOKE ALL ON TABLE "platform_email_settings", "platform_email_log" FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON TABLE "platform_email_settings", "platform_email_log" FROM "app_rw";
--> statement-breakpoint
GRANT SELECT ON TABLE "platform_email_settings" TO "app_rw";
--> statement-breakpoint
GRANT INSERT ON TABLE "platform_email_log" TO "app_rw";
--> statement-breakpoint
GRANT ALL ON TABLE "platform_email_settings", "platform_email_log" TO "app_platform";
