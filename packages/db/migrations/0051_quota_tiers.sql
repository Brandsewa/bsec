-- Migration 0051: Quota Tiers and Limits (ADMIN-IMPROVEMENTS-PLAN Phase 3, SA-2, ADR-025)
-- Idempotent Drizzle migration

CREATE TABLE IF NOT EXISTS "quota_tiers" (
  "code" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "sort" integer DEFAULT 0 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "price_monthly_paise" bigint DEFAULT 0 NOT NULL,
  "price_yearly_paise" bigint DEFAULT 0 NOT NULL,
  "currency" text DEFAULT 'INR' NOT NULL,
  "is_public" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "quota_tier_limits" (
  "tier_code" text NOT NULL REFERENCES "quota_tiers"("code") ON DELETE CASCADE,
  "quota_key" text NOT NULL REFERENCES "quota_definitions"("key") ON DELETE CASCADE,
  "value" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "quota_tier_limits_pkey" PRIMARY KEY ("tier_code", "quota_key")
);
--> statement-breakpoint

-- Backfill initial tiers XS, S, M, L
INSERT INTO "quota_tiers" ("code", "name", "description", "sort", "is_active", "price_monthly_paise", "price_yearly_paise", "currency", "is_public")
VALUES
  ('XS', 'Extra Small (Starter)', 'Default starter tier for new stores', 1, true, 0, 0, 'INR', true),
  ('S', 'Small (Growth)', 'Growth tier for expanding catalogs', 2, true, 0, 0, 'INR', true),
  ('M', 'Medium (Scale)', 'Scale tier for high-volume stores', 3, true, 0, 0, 'INR', true),
  ('L', 'Large (Enterprise)', 'Enterprise tier with maximum headroom', 4, true, 0, 0, 'INR', true)
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint

-- Backfill limits from quota_definitions
INSERT INTO "quota_tier_limits" ("tier_code", "quota_key", "value")
SELECT 'XS', "key", "tier_xs" FROM "quota_definitions"
ON CONFLICT ("tier_code", "quota_key") DO UPDATE SET "value" = EXCLUDED."value";
--> statement-breakpoint

INSERT INTO "quota_tier_limits" ("tier_code", "quota_key", "value")
SELECT 'S', "key", "tier_s" FROM "quota_definitions"
ON CONFLICT ("tier_code", "quota_key") DO UPDATE SET "value" = EXCLUDED."value";
--> statement-breakpoint

INSERT INTO "quota_tier_limits" ("tier_code", "quota_key", "value")
SELECT 'M', "key", "tier_m" FROM "quota_definitions"
ON CONFLICT ("tier_code", "quota_key") DO UPDATE SET "value" = EXCLUDED."value";
--> statement-breakpoint

INSERT INTO "quota_tier_limits" ("tier_code", "quota_key", "value")
SELECT 'L', "key", "tier_l" FROM "quota_definitions"
ON CONFLICT ("tier_code", "quota_key") DO UPDATE SET "value" = EXCLUDED."value";
--> statement-breakpoint

-- Grants: platform-scoped tables, writable only by app_platform, read-only by app_rw
REVOKE ALL ON TABLE "quota_tiers" FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON TABLE "quota_tiers" FROM "app_rw";
--> statement-breakpoint
GRANT SELECT ON TABLE "quota_tiers" TO "app_rw";
--> statement-breakpoint
GRANT ALL ON TABLE "quota_tiers" TO "app_platform";
--> statement-breakpoint

REVOKE ALL ON TABLE "quota_tier_limits" FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON TABLE "quota_tier_limits" FROM "app_rw";
--> statement-breakpoint
GRANT SELECT ON TABLE "quota_tier_limits" TO "app_rw";
--> statement-breakpoint
GRANT ALL ON TABLE "quota_tier_limits" TO "app_platform";
