-- Migration 0052: Platform Channel Providers and Message Log (ADMIN-IMPROVEMENTS-PLAN Phase 4, §6.2)
-- Idempotent Drizzle migration

CREATE TABLE IF NOT EXISTS "platform_channel_providers" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "channel" text NOT NULL,
  "provider" text NOT NULL,
  "display_name" text NOT NULL,
  "config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "secret_ciphertext" text,
  "secret_iv" text,
  "secret_key_version" integer DEFAULT 1 NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "is_default" boolean DEFAULT false NOT NULL,
  "last_test_at" timestamp with time zone,
  "last_test_status" text,
  "last_test_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "platform_channel_providers_default_idx"
  ON "platform_channel_providers" ("channel")
  WHERE is_default = true;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "platform_message_log" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "channel" text NOT NULL,
  "tenant_id" uuid REFERENCES "tenants"("id") ON DELETE set null,
  "to_masked" text NOT NULL,
  "template" text NOT NULL,
  "provider" text NOT NULL,
  "status" text NOT NULL,
  "provider_message_id" text,
  "error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "platform_message_log_created_at_idx" ON "platform_message_log" ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_message_log_channel_idx" ON "platform_message_log" ("channel");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_message_log_tenant_idx" ON "platform_message_log" ("tenant_id");
--> statement-breakpoint

-- Role permissions (ADMIN-IMPROVEMENTS-PLAN §6.2)
-- Platform-level, NO tenant column, writable only by app_platform, NO RLS.
-- app_rw has SELECT on platform_channel_providers, INSERT and DELETE on platform_message_log,
-- and SELECT on ("id", "created_at") for 90-day retention prune.
REVOKE ALL ON TABLE "platform_channel_providers", "platform_message_log" FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON TABLE "platform_channel_providers", "platform_message_log" FROM "app_rw";
--> statement-breakpoint
GRANT SELECT ON TABLE "platform_channel_providers" TO "app_rw";
--> statement-breakpoint
GRANT INSERT, DELETE ON TABLE "platform_message_log" TO "app_rw";
--> statement-breakpoint
GRANT SELECT ("id", "created_at") ON TABLE "platform_message_log" TO "app_rw";
--> statement-breakpoint
GRANT ALL ON TABLE "platform_channel_providers", "platform_message_log" TO "app_platform";
