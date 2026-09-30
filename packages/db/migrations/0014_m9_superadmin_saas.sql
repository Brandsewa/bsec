-- Migration 0014: M9 Super Admin, SaaS Launch, Platform MFA, Impersonation & Tenant Lifecycle
-- Idempotent Drizzle migration

-- 1. Two Factors table for Better Auth TOTP & backup codes
CREATE TABLE IF NOT EXISTS "two_factors" (
  "id" text PRIMARY KEY NOT NULL,
  "secret" text NOT NULL,
  "backup_codes" text NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "verified" boolean DEFAULT false,
  "failed_verification_count" integer DEFAULT 0,
  "locked_until" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "two_factors_user_id_idx" ON "two_factors" ("user_id");
--> statement-breakpoint

-- 1b. Platform staff: MFA enrolment completion. A staff session is only accepted if it was created AFTER this
-- moment (i.e. it went through password + TOTP), so a password-only session that predates enrolment is dead.
ALTER TABLE "platform_staff" ADD COLUMN IF NOT EXISTS "mfa_verified_at" timestamp with time zone;
--> statement-breakpoint

-- 2. Platform Staff Invitations
CREATE TABLE IF NOT EXISTS "platform_staff_invitations" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "email" citext NOT NULL UNIQUE,
  "role" text DEFAULT 'platform_support' NOT NULL,
  "token_hash" text NOT NULL UNIQUE,
  "expires_at" timestamp with time zone NOT NULL,
  "accepted_at" timestamp with time zone,
  "invited_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- 3. Support Sessions (impersonation)
CREATE TABLE IF NOT EXISTS "support_sessions" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "platform_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "impersonated_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "reason" text NOT NULL,
  "ticket_ref" text NOT NULL,
  "scope" text DEFAULT 'read_only' NOT NULL,
  "consent" text DEFAULT 'owner_approved' NOT NULL,
  "approved_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "ended_at" timestamp with time zone,
  "ended_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "actions_count" integer DEFAULT 0 NOT NULL,
  "token_hash" text UNIQUE,
  "approved_at" timestamp with time zone,
  "denied_at" timestamp with time zone,
  "extended_at" timestamp with time zone,
  "write_confirmed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_sessions_tenant_id_idx" ON "support_sessions" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_sessions_platform_user_id_idx" ON "support_sessions" ("platform_user_id");
--> statement-breakpoint

-- 4. Tenant Deletions (pg-boss workflow)
CREATE TABLE IF NOT EXISTS "tenant_deletions" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "requested_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "reason" text NOT NULL,
  "step" text DEFAULT 'requested' NOT NULL,
  "export_id" uuid,
  "scheduled_for" timestamp with time zone NOT NULL,
  "completed_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "cancelled_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "error" text,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_deletions_tenant_id_idx" ON "tenant_deletions" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_deletions_step_idx" ON "tenant_deletions" ("step");
--> statement-breakpoint

-- 5. Tenant Notes (Super Admin internal operator notes)
CREATE TABLE IF NOT EXISTS "tenant_notes" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "author_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "body" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_notes_tenant_id_idx" ON "tenant_notes" ("tenant_id");
--> statement-breakpoint

-- 6. Store Settings standing consent
ALTER TABLE "store_settings" ADD COLUMN IF NOT EXISTS "standing_consent_for_support" boolean DEFAULT false NOT NULL;
--> statement-breakpoint

-- 7. Exports table (tenant-scoped with RLS)
CREATE TABLE IF NOT EXISTS "exports" (
  "id" uuid DEFAULT uuidv7() NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "type" text DEFAULT 'full_store' NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "file_key" text,
  "file_size_bytes" bigint,
  "requested_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "expires_at" timestamp with time zone NOT NULL,
  "error" text,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "exports_tenant_id_uniq" UNIQUE ("tenant_id", "id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "exports_tenant_id_idx" ON "exports" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "exports_status_idx" ON "exports" ("status");
--> statement-breakpoint

ALTER TABLE "exports" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "exports" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'exports' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON "exports"
      USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
  END IF;
END $$;
--> statement-breakpoint

-- 7b. Export file contents: platform-only (the tenant runtime can never read another store's archive)
CREATE TABLE IF NOT EXISTS "export_files" (
  "export_id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE cascade,
  "content_type" text DEFAULT 'application/gzip' NOT NULL,
  "sha256" text NOT NULL,
  "data" bytea NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "export_files_tenant_id_idx" ON "export_files" ("tenant_id");
--> statement-breakpoint

-- 8. Table privileges for platform isolation (PLAN §4, §6)
-- Tenant-owning tables the tenant runtime (app_rw) may read but never write. Self-service signup (app_saas)
-- gets its writes to organizations/tenants from saas-grants.ts.
REVOKE INSERT, UPDATE, DELETE ON TABLE "organizations", "tenants", "feature_flags" FROM "app_rw";
--> statement-breakpoint

-- Platform-only tables: the tenant runtime gets NO access at all (not even SELECT). two_factors holds TOTP seeds and
-- backup codes; the others hold staff/operator data. Only the platform service (app_platform) reads and writes them.
REVOKE ALL ON TABLE
  "platform_staff",
  "platform_staff_invitations",
  "support_sessions",
  "tenant_deletions",
  "tenant_notes",
  "two_factors",
  "export_files"
FROM "app_rw";
--> statement-breakpoint

GRANT ALL ON TABLE
  "organizations",
  "tenants",
  "feature_flags",
  "platform_staff",
  "platform_staff_invitations",
  "support_sessions",
  "tenant_deletions",
  "tenant_notes",
  "two_factors",
  "export_files"
TO "app_platform";
--> statement-breakpoint

-- The store admin validates a support token and counts actions, and nothing more: column-level access only.
-- token_hash is a SHA-256 of a 256-bit token; the raw token is never stored.
GRANT SELECT (
  "id", "tenant_id", "platform_user_id", "scope", "consent", "reason", "ticket_ref",
  "approved_at", "denied_at", "started_at", "expires_at", "ended_at", "extended_at",
  "write_confirmed_at", "actions_count", "token_hash"
) ON TABLE "support_sessions" TO "app_rw";
--> statement-breakpoint
GRANT UPDATE ("actions_count", "updated_at") ON TABLE "support_sessions" TO "app_rw";
--> statement-breakpoint
-- The owner approves or denies a pending session from the store admin (tenant runtime, own store only).
GRANT UPDATE ("approved_at", "approved_by_user_id", "denied_at", "expires_at", "updated_at") ON TABLE "support_sessions" TO "app_rw";
--> statement-breakpoint

-- exports is a tenant table with RLS
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "exports" TO "app_rw";
--> statement-breakpoint
GRANT ALL ON TABLE "exports" TO "app_platform";
