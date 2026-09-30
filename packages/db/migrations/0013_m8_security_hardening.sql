-- Migration 0013: M8 Security Hardening & Platform Table Privileges
-- Revoke INSERT, UPDATE and DELETE from app_rw on every platform-owned table:
-- plans, reserved_slugs, tenant_size_tiers, all quota config tables, subscriptions,
-- platform_invoices, quota_events, tenant_owner_invites, signup_leads and slug_reservations.

REVOKE INSERT, UPDATE, DELETE ON TABLE
  "plans",
  "reserved_slugs",
  "tenant_size_tiers",
  "quota_definitions",
  "tenant_quota_overrides",
  "subscriptions",
  "platform_invoices",
  "quota_events",
  "tenant_owner_invites",
  "signup_leads",
  "slug_reservations",
  "theme_templates"
FROM "app_rw";
--> statement-breakpoint

-- platform_audit_logs is append-only for app_rw: SELECT and INSERT only.
REVOKE UPDATE, DELETE ON TABLE "platform_audit_logs" FROM "app_rw";
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "platform_audit_logs" TO "app_rw";
--> statement-breakpoint

-- Ensure app_platform retains full DML on all platform tables
GRANT ALL ON TABLE
  "plans",
  "reserved_slugs",
  "tenant_size_tiers",
  "quota_definitions",
  "tenant_quota_overrides",
  "subscriptions",
  "platform_invoices",
  "quota_events",
  "tenant_owner_invites",
  "signup_leads",
  "slug_reservations",
  "theme_templates",
  "platform_audit_logs"
TO "app_platform";
--> statement-breakpoint

-- Dynamically ensure all tenant-scoped tables (tables with RLS enabled) remain writable by app_rw
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity = true
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO "app_rw"', r.relname);
  END LOOP;
END $$;
--> statement-breakpoint

-- Explicitly ensure runtime non-RLS tables needed by app_rw have required DML
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "_platform_meta",
  "users",
  "sessions",
  "accounts",
  "verifications",
  "webhook_inbox",
  "rate_limit_counters",
  "tenant_active_jobs",
  "domains"
TO "app_rw";
--> statement-breakpoint

-- Store real Razorpay plan IDs on the plans table (M8 B5)
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "razorpay_plan_id_monthly" text;
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "razorpay_plan_id_yearly" text;

