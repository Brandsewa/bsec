-- AI access for stores over MCP (ADR-050, docs/MCP-PLAN.md). Expand-only: new tables, seed rows, no change to existing columns.
-- Tenant tables (forced RLS): store_ai_settings, agent_connections, agent_call_log.
-- Platform-scoped tables (no RLS, like support_sessions: a token or OAuth client is resolved before the store is known): oauth_clients,
-- oauth_authorization_requests, agent_tokens. Only hashes of secrets are stored.

CREATE TABLE "store_ai_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"matrix" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"allow_publishing" boolean DEFAULT false NOT NULL,
	"consent_version" integer,
	"consent_at" timestamp with time zone,
	"consent_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "store_ai_settings_tenant_uniq" UNIQUE ("tenant_id")
);
--> statement-breakpoint
CREATE TABLE "agent_connections" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"client_id" text NOT NULL,
	"client_name" text NOT NULL,
	"protocol" text DEFAULT 'mcp' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"paused_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	CONSTRAINT "agent_connections_tenant_id_uniq" UNIQUE ("tenant_id", "id"),
	CONSTRAINT "agent_connections_status_chk" CHECK ("status" IN ('active', 'revoked', 'paused'))
);
--> statement-breakpoint
CREATE TABLE "agent_call_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"tool" text NOT NULL,
	"status" text NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"bytes" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_clients" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"redirect_uris" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" text DEFAULT 'dcr' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "oauth_authorization_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"client_id" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"state" text,
	"code_challenge" text NOT NULL,
	"scope" text,
	"resource" text,
	"expires_at" timestamp with time zone NOT NULL,
	"tenant_id" uuid,
	"user_id" uuid,
	"connection_id" uuid,
	"code_hash" text,
	"code_expires_at" timestamp with time zone,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_authorization_requests_code_hash_unique" UNIQUE ("code_hash")
);
--> statement-breakpoint
CREATE TABLE "agent_tokens" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"token_hash" text NOT NULL,
	"family" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"rotated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_tokens_token_hash_unique" UNIQUE ("token_hash"),
	CONSTRAINT "agent_tokens_kind_chk" CHECK ("kind" IN ('access', 'refresh'))
);
--> statement-breakpoint

-- Foreign keys.
ALTER TABLE "store_ai_settings" ADD CONSTRAINT "store_ai_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "store_ai_settings" ADD CONSTRAINT "store_ai_settings_consent_by_user_id_users_id_fk" FOREIGN KEY ("consent_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "store_ai_settings" ADD CONSTRAINT "store_ai_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_connections" ADD CONSTRAINT "agent_connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_connections" ADD CONSTRAINT "agent_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_connections" ADD CONSTRAINT "agent_connections_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_call_log" ADD CONSTRAINT "agent_call_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_call_log" ADD CONSTRAINT "agent_call_log_connection_fk" FOREIGN KEY ("tenant_id", "connection_id") REFERENCES "agent_connections"("tenant_id", "id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "oauth_authorization_requests" ADD CONSTRAINT "oauth_authorization_requests_client_id_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "oauth_authorization_requests" ADD CONSTRAINT "oauth_authorization_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "oauth_authorization_requests" ADD CONSTRAINT "oauth_authorization_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_tokens" ADD CONSTRAINT "agent_tokens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "agent_connections_tenant_status_idx" ON "agent_connections" ("tenant_id", "status");
--> statement-breakpoint
CREATE INDEX "agent_connections_user_idx" ON "agent_connections" ("user_id");
--> statement-breakpoint
CREATE INDEX "agent_call_log_tenant_time_idx" ON "agent_call_log" ("tenant_id", "created_at");
--> statement-breakpoint
CREATE INDEX "oauth_authorization_requests_expires_idx" ON "oauth_authorization_requests" ("expires_at");
--> statement-breakpoint
CREATE INDEX "agent_tokens_connection_idx" ON "agent_tokens" ("tenant_id", "connection_id");
--> statement-breakpoint
CREATE INDEX "agent_tokens_family_idx" ON "agent_tokens" ("family");
--> statement-breakpoint

-- Row level security on the three tenant tables (hard rule 1): enabled, forced, one isolation policy each.
ALTER TABLE "store_ai_settings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "store_ai_settings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store_ai_settings" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "agent_connections" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "agent_connections" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "agent_connections" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "agent_call_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "agent_call_log" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "agent_call_log" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint

-- Platform-scoped token tables (ADR-050 decision 6, hard rule 9): default privileges hand app_rw full DML on every new table,
-- so take it back and grant only what the runtime needs. A token row is created, read by hash, and can only be rotated or revoked.
REVOKE ALL ON TABLE "oauth_clients", "oauth_authorization_requests", "agent_tokens" FROM "app_rw";
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON TABLE "oauth_clients", "oauth_authorization_requests", "agent_tokens" TO "app_rw";
--> statement-breakpoint
GRANT UPDATE ("last_used_at", "name", "redirect_uris") ON TABLE "oauth_clients" TO "app_rw";
--> statement-breakpoint
GRANT UPDATE ("tenant_id", "user_id", "connection_id", "code_hash", "code_expires_at", "used_at") ON TABLE "oauth_authorization_requests" TO "app_rw";
--> statement-breakpoint
GRANT UPDATE ("rotated_at", "revoked_at") ON TABLE "agent_tokens" TO "app_rw";
--> statement-breakpoint

-- Plan entitlement (ADR-050 decision 4): AI access is on the Growth and Pro plans, read like custom_fields from plans.features.
UPDATE "plans" SET "features" = "features" || '{"ai_access": false}'::jsonb WHERE "code" = 'starter';
--> statement-breakpoint
UPDATE "plans" SET "features" = "features" || '{"ai_access": true}'::jsonb WHERE "code" IN ('growth', 'pro');
--> statement-breakpoint

-- Kill switch (ADR-011): default on; Super Admin sets kill_switch to stop all AI access at once.
INSERT INTO "feature_flags" ("key", "default_on", "rules", "kill_switch", "created_at", "updated_at")
VALUES ('ai_access', true, '{"description": "AI access over MCP: global on/off, per-store override"}'::jsonb, false, now(), now())
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint

-- Limits (docs/MCP-PLAN.md section 7). Growth = tier M, Pro = tier L (saas/plan-tiers.ts). XS and S are not entitled, so they get small values.
INSERT INTO "quota_definitions" ("key", "description", "unit", "enforcement", "tier_xs", "tier_s", "tier_m", "tier_l")
VALUES
  ('ai_calls_min_conn', 'AI calls per minute for one connected AI app', 'calls/min', 'hard', 0, 0, 60, 120),
  ('ai_calls_min_store', 'AI calls per minute for the whole store', 'calls/min', 'hard', 0, 0, 120, 300),
  ('ai_writes_min_store', 'AI write calls per minute for the whole store', 'calls/min', 'hard', 0, 0, 20, 60),
  ('ai_reports_min_store', 'AI report calls per minute for the whole store', 'calls/min', 'hard', 0, 0, 10, 30),
  ('ai_calls_day_store', 'AI calls per day for the whole store', 'calls/day', 'hard', 0, 0, 3000, 15000),
  ('ai_writes_day_store', 'AI write calls per day for the whole store', 'calls/day', 'hard', 0, 0, 200, 1000)
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "quota_tier_limits" ("tier_code", "quota_key", "value")
SELECT 'XS', "key", "tier_xs" FROM "quota_definitions" WHERE "key" LIKE 'ai\_%' ESCAPE '\'
ON CONFLICT ("tier_code", "quota_key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "quota_tier_limits" ("tier_code", "quota_key", "value")
SELECT 'S', "key", "tier_s" FROM "quota_definitions" WHERE "key" LIKE 'ai\_%' ESCAPE '\'
ON CONFLICT ("tier_code", "quota_key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "quota_tier_limits" ("tier_code", "quota_key", "value")
SELECT 'M', "key", "tier_m" FROM "quota_definitions" WHERE "key" LIKE 'ai\_%' ESCAPE '\'
ON CONFLICT ("tier_code", "quota_key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "quota_tier_limits" ("tier_code", "quota_key", "value")
SELECT 'L', "key", "tier_l" FROM "quota_definitions" WHERE "key" LIKE 'ai\_%' ESCAPE '\'
ON CONFLICT ("tier_code", "quota_key") DO NOTHING;
