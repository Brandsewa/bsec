-- Promotions and free periods (owner decisions 2026-10-17, ADR-035). Platform-level tables, no RLS: only the platform
-- service (app_platform) manages them; stores never read them. Promotion length is capped at 12 months, prepaid terms
-- are 6, 12 or 36 months, no GST for now.
CREATE TABLE "promotions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"kind" text NOT NULL,
	"percent_off" integer,
	"duration_months" integer NOT NULL,
	"applies_to_plan_codes" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"max_redemptions" integer,
	"redeemed_count" integer DEFAULT 0 NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promotions_code_uniq" UNIQUE("code"),
	CONSTRAINT "promotions_kind_chk" CHECK ("kind" in ('percent_off', 'free_months')),
	CONSTRAINT "promotions_percent_chk" CHECK (("kind" = 'percent_off' AND "percent_off" BETWEEN 1 AND 100) OR ("kind" = 'free_months' AND "percent_off" IS NULL)),
	CONSTRAINT "promotions_duration_chk" CHECK ("duration_months" BETWEEN 1 AND 12),
	CONSTRAINT "promotions_max_redemptions_chk" CHECK ("max_redemptions" IS NULL OR "max_redemptions" > 0)
);
--> statement-breakpoint
CREATE TABLE "tenant_promotions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"promotion_id" uuid,
	"kind" text NOT NULL,
	"percent_off" integer,
	"duration_months" integer NOT NULL,
	"plan_code" text,
	"term_months" integer DEFAULT 12 NOT NULL,
	"source" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'active' NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"granted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_promotions_kind_chk" CHECK ("kind" in ('percent_off', 'free_months')),
	CONSTRAINT "tenant_promotions_duration_chk" CHECK ("duration_months" BETWEEN 1 AND 12),
	CONSTRAINT "tenant_promotions_term_chk" CHECK ("term_months" in (6, 12, 36)),
	CONSTRAINT "tenant_promotions_source_chk" CHECK ("source" in ('code', 'staff')),
	CONSTRAINT "tenant_promotions_status_chk" CHECK ("status" in ('active', 'ended', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "tenant_promotions" ADD CONSTRAINT "tenant_promotions_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tenant_promotions" ADD CONSTRAINT "tenant_promotions_promotion_fk" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "tenant_promotions_tenant_idx" ON "tenant_promotions" ("tenant_id","status");
--> statement-breakpoint
CREATE INDEX "tenant_promotions_due_idx" ON "tenant_promotions" ("status","ends_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_promotions_one_active_per_tenant" ON "tenant_promotions" ("tenant_id") WHERE "status" = 'active';
--> statement-breakpoint
-- Platform-only tables: the default privileges hand every new table to app_rw, so take it back. The platform service
-- (app_platform) manages them; self-service signup (app_saas) may redeem codes (see saas-grants.ts).
REVOKE ALL ON TABLE "promotions", "tenant_promotions" FROM "app_rw";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "promotions", "tenant_promotions" TO "app_platform";
