-- Notification manager (ADR-039, docs/NOTIFICATION-MANAGER-PLAN.md). Expand-only: new tables, nothing existing changes.
-- Platform tables have no tenant column and no RLS: Super Admin (app_platform) writes, the worker and web (app_rw) read
-- the rules and branding and insert Super Admin inbox rows. Tenant tables use forced RLS.
CREATE TABLE "notification_rules" (
	"event_key" text NOT NULL,
	"channel" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"role_recipients" text[] DEFAULT '{}'::text[] NOT NULL,
	"extra_emails" text[] DEFAULT '{}'::text[] NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_rules_event_key_channel_pk" PRIMARY KEY("event_key","channel"),
	CONSTRAINT "notification_rules_channel_chk" CHECK ("channel" in ('in_app', 'email', 'sms', 'whatsapp'))
);
--> statement-breakpoint
ALTER TABLE "notification_rules" ADD CONSTRAINT "notification_rules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "platform_email_branding" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"tokens" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_email_branding" ADD CONSTRAINT "platform_email_branding_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "platform_notifications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"event_key" text NOT NULL,
	"tab" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"link" text,
	"event_ref" text,
	"read_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_notifications_event_ref_uniq" UNIQUE("user_id","event_ref"),
	CONSTRAINT "platform_notifications_tab_chk" CHECK ("tab" in ('stores', 'billing', 'system'))
);
--> statement-breakpoint
ALTER TABLE "platform_notifications" ADD CONSTRAINT "platform_notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "platform_notifications_user_idx" ON "platform_notifications" ("user_id","created_at");
--> statement-breakpoint
CREATE TABLE "notification_tenant_rules" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_key" text NOT NULL,
	"channel" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"extra_emails" text[] DEFAULT '{}'::text[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_tenant_rules_uniq" UNIQUE("tenant_id","event_key","channel"),
	CONSTRAINT "notification_tenant_rules_channel_chk" CHECK ("channel" in ('in_app', 'email', 'sms', 'whatsapp'))
);
--> statement-breakpoint
ALTER TABLE "notification_tenant_rules" ADD CONSTRAINT "notification_tenant_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notification_tenant_rules" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "notification_tenant_rules" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "notification_tenant_rules" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE TABLE "store_email_branding" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"tokens" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_email_branding_tenant_uniq" UNIQUE("tenant_id")
);
--> statement-breakpoint
ALTER TABLE "store_email_branding" ADD CONSTRAINT "store_email_branding_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "store_email_branding" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "store_email_branding" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store_email_branding" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"event_key" text NOT NULL,
	"tab" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"link" text,
	"event_ref" text,
	"read_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_event_ref_uniq" UNIQUE("tenant_id","user_id","event_ref"),
	CONSTRAINT "notifications_tab_chk" CHECK ("tab" in ('orders', 'system'))
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "notifications_tenant_user_idx" ON "notifications" ("tenant_id","user_id","created_at");
--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "notifications" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
REVOKE ALL ON TABLE "notification_rules", "platform_email_branding", "platform_notifications" FROM PUBLIC;
--> statement-breakpoint
-- New tables give app_rw full DML by default privileges; these three are platform-owned, so take it back first.
REVOKE ALL ON TABLE "notification_rules", "platform_email_branding", "platform_notifications" FROM "app_rw";
--> statement-breakpoint
GRANT SELECT ON TABLE "notification_rules", "platform_email_branding" TO "app_rw";
--> statement-breakpoint
GRANT INSERT ON TABLE "platform_notifications" TO "app_rw";
--> statement-breakpoint
-- Same shape as platform_email_log: the worker also prunes old cards, and RETURNING id (the idempotent insert and the
-- prune both report what they touched) needs SELECT on id and created_at only. It cannot read titles, bodies or users.
GRANT DELETE ON TABLE "platform_notifications" TO "app_rw";
--> statement-breakpoint
GRANT SELECT ("id", "created_at") ON TABLE "platform_notifications" TO "app_rw";
--> statement-breakpoint
GRANT ALL ON TABLE "notification_rules", "platform_email_branding", "platform_notifications" TO "app_platform";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "notification_tenant_rules", "store_email_branding", "notifications" TO "app_rw", "app_platform";
--> statement-breakpoint
-- The tenant runtime must never read platform_staff (b2-grants suite). Super Admin alerts still need the staff who hold a
-- role, so the worker gets this one narrow function: ids, email and role of active staff for the roles asked, nothing else.
CREATE FUNCTION "notification_platform_recipients"(roles text[]) RETURNS TABLE (user_id uuid, email text, role text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.user_id, u.email::text, s.role FROM platform_staff s JOIN users u ON u.id = s.user_id WHERE s.is_active AND s.role = ANY(roles)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "notification_platform_recipients"(text[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "notification_platform_recipients"(text[]) TO "app_rw", "app_platform";
