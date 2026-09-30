/**
 * Extra privileges for app_saas (see roles.ts). Applied after every migration run, not from a one-time
 * migration, so it works whichever order the role and the tables came into existence in. Idempotent.
 *
 * app_saas inherits everything app_rw has (it is a member of app_rw). On top of that it may write the
 * platform-owned tables the self-service paths need. It still cannot touch plans, reserved slugs, quota
 * definitions/overrides, platform staff, feature flags or theme templates, and platform_audit_logs stays
 * insert-only for everyone except app_platform.
 */
export const APP_SAAS_WRITABLE_TABLES = [
  "signup_leads",
  "slug_reservations",
  "tenant_size_tiers",
  "subscriptions",
  "platform_invoices",
  "quota_events",
  "tenant_owner_invites",
] as const;

export const APP_SAAS_GRANTS_SQL = `
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_saas') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${APP_SAAS_WRITABLE_TABLES.map((t) => `"${t}"`).join(", ")} TO app_saas;
  END IF;
END $$;`;
