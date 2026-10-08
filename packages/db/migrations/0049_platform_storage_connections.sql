-- Migration 0049: Platform Storage Connections (ADMIN-IMPROVEMENTS-PLAN Phase 1, SA-1)
-- Idempotent Drizzle migration

CREATE TABLE IF NOT EXISTS "platform_storage_connections" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "name" text NOT NULL,
  "driver" text NOT NULL,
  "purpose" text NOT NULL,
  "is_active" boolean DEFAULT false NOT NULL,
  "status" text DEFAULT 'untested' NOT NULL,
  "last_test_at" timestamp with time zone,
  "last_test_error" text,
  "endpoint" text,
  "region" text,
  "bucket" text,
  "public_base_url" text,
  "force_path_style" boolean DEFAULT false NOT NULL,
  "local_dir" text,
  "account_id" text,
  "direct_browser_upload" boolean DEFAULT false NOT NULL,
  "access_key_id_ciphertext" text,
  "secret_access_key_ciphertext" text,
  "iv" text,
  "key_version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "platform_storage_connections_active_purpose_idx"
  ON "platform_storage_connections" ("purpose")
  WHERE is_active = true;
--> statement-breakpoint

ALTER TABLE "media" ADD COLUMN IF NOT EXISTS "storage_connection_id" uuid REFERENCES "platform_storage_connections"("id") ON DELETE SET NULL;
--> statement-breakpoint

-- Grants: platform-scoped table, writable only by app_platform, read-only by app_rw
REVOKE ALL ON TABLE "platform_storage_connections" FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON TABLE "platform_storage_connections" FROM "app_rw";
--> statement-breakpoint
GRANT SELECT ON TABLE "platform_storage_connections" TO "app_rw";
--> statement-breakpoint
GRANT ALL ON TABLE "platform_storage_connections" TO "app_platform";
