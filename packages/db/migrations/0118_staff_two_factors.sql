-- Optional authenticator-app MFA for store staff (docs/ACCOUNTS-PROFILE-PLAN.md, phase 1). Expand-only.
-- The platform's "two_factors" table stays unreachable by the tenant runtime (migration 0014): TOTP seeds of Super Admin
-- staff must never be readable by app_rw. Store staff get their own table, which app_rw may use, and their own on/off flag,
-- so a person who is both store staff and platform staff has two independent second factors and one can never change the other.
ALTER TABLE "users" ADD COLUMN "store_two_factor_enabled" boolean DEFAULT false;
--> statement-breakpoint
CREATE TABLE "staff_two_factors" (
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
CREATE INDEX "staff_two_factors_user_id_idx" ON "staff_two_factors" ("user_id");
