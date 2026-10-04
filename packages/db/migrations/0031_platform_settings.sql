-- Platform settings (single row, id = 'default'): platform-wide operational toggles (expand-only).
-- require_staff_mfa: when true, platform staff must enrol and sign in with TOTP (the historic behaviour).
-- When false, staff sign in with email + password only; enrolled authenticators keep working but are
-- never demanded, and the sign-in flow skips forced enrolment.
-- The table is created EMPTY on purpose. Enforcement defaults: required in production, optional when
-- APP_ENV=local, so fresh local stacks never force the authenticator dance. The Super Admin toggle
-- (platform.settings.update) writes the explicit row that overrides the default.
CREATE TABLE IF NOT EXISTS "platform_settings" (
  "id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
  "require_staff_mfa" boolean DEFAULT true NOT NULL,
  "updated_by" uuid REFERENCES "users"("id") ON DELETE set null,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
GRANT SELECT ON TABLE "platform_settings" TO "app_rw";
GRANT ALL ON TABLE "platform_settings" TO "app_platform";
