-- Migration 0076: platform Google sign-in (docs/GOOGLE-SIGNIN-PLAN.md, Tier A).
-- Platform-level, NO tenant column, writable only by app_platform, read-only by app_rw, NO RLS.
-- platform_auth_providers holds the on/off switches. platform_google_client holds the single platform Google OAuth
-- client used ONLY for Super Admin, platform staff and store owners/staff (never for a store's customers).
CREATE TABLE IF NOT EXISTS "platform_auth_providers" (
  "provider" text PRIMARY KEY NOT NULL,
  "kind" text DEFAULT 'social' NOT NULL,
  "display_name" text NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "staff_signup_allowed" boolean DEFAULT true NOT NULL,
  "customer_signin_allowed" boolean DEFAULT false NOT NULL,
  "one_tap_allowed" boolean DEFAULT true NOT NULL,
  "sort" integer DEFAULT 0 NOT NULL,
  "updated_by" uuid,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "platform_auth_providers" ("provider", "kind", "display_name", "enabled", "sort")
VALUES ('google', 'social', 'Google', false, 1)
ON CONFLICT ("provider") DO NOTHING;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_google_client" (
  "id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
  "client_id" text,
  "secret_ciphertext" text,
  "secret_iv" text,
  "key_version" integer DEFAULT 1 NOT NULL,
  "last_test_at" timestamp with time zone,
  "last_test_status" text,
  "last_test_error" text,
  "updated_by" uuid,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "platform_google_client_single_row" CHECK ("id" = 'default')
);
--> statement-breakpoint
REVOKE ALL ON TABLE "platform_auth_providers" FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON TABLE "platform_auth_providers" FROM "app_rw";
--> statement-breakpoint
GRANT SELECT ON TABLE "platform_auth_providers" TO "app_rw";
--> statement-breakpoint
GRANT ALL ON TABLE "platform_auth_providers" TO "app_platform";
--> statement-breakpoint
REVOKE ALL ON TABLE "platform_google_client" FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON TABLE "platform_google_client" FROM "app_rw";
--> statement-breakpoint
GRANT SELECT ON TABLE "platform_google_client" TO "app_rw";
--> statement-breakpoint
GRANT ALL ON TABLE "platform_google_client" TO "app_platform";
--> statement-breakpoint
-- Platform staff were provisioned by an operator or accepted an emailed invitation, so their address is proven.
-- Better Auth links a Google account only to a user whose email is verified, so mark them verified.
UPDATE "users" SET "email_verified" = true WHERE "email_verified" = false AND "id" IN (SELECT "user_id" FROM "platform_staff");
