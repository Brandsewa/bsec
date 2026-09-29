-- NOTE(M8): Minimal quota schema built for M7 rate limiting and job concurrency enforcement;
-- M8 will formalize additional quotas (products, staff, storage, etc.) and admin management.
CREATE TABLE "rate_limit_counters" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "rate_limit_counters_expires_idx" ON "rate_limit_counters" ("expires_at");
--> statement-breakpoint
CREATE TABLE "quota_definitions" (
	"key" text PRIMARY KEY NOT NULL,
	"description" text,
	"tier_xs" integer NOT NULL,
	"tier_s" integer NOT NULL,
	"tier_m" integer NOT NULL,
	"tier_l" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "quota_definitions" ("key", "description", "tier_xs", "tier_s", "tier_m", "tier_l")
VALUES
  ('uncached_storefront_rpm', 'Uncached storefront requests per minute (counted in-app; page views included)', 3000, 4500, 9000, 18000),
  ('admin_api_rpm', 'Admin and API requests per minute', 600, 1200, 2400, 4800),
  ('job_concurrency', 'Background job concurrency ceiling per store', 4, 6, 8, 16)
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
CREATE TABLE "tenant_size_tiers" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"tier" text DEFAULT 'XS' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_size_tiers" ADD CONSTRAINT "tenant_size_tiers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "tenant_quota_overrides" (
	"tenant_id" uuid NOT NULL,
	"quota_key" text NOT NULL,
	"value" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_quota_overrides_tenant_id_quota_key_pk" PRIMARY KEY("tenant_id","quota_key")
);
--> statement-breakpoint
ALTER TABLE "tenant_quota_overrides" ADD CONSTRAINT "tenant_quota_overrides_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tenant_quota_overrides" ADD CONSTRAINT "tenant_quota_overrides_quota_key_quota_definitions_key_fk" FOREIGN KEY ("quota_key") REFERENCES "quota_definitions"("key") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE "tenant_active_jobs" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"active_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_active_jobs" ADD CONSTRAINT "tenant_active_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Quota configuration is platform-controlled: the tenant runtime role (app_rw) may read it but never change it.
-- (rate_limit_counters and tenant_active_jobs stay writable by app_rw: the limiter itself writes them.)
REVOKE INSERT, UPDATE, DELETE ON "quota_definitions", "tenant_size_tiers", "tenant_quota_overrides" FROM "app_rw";
