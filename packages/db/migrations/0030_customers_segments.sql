-- Customers Phase 2 (2A): customer segments (manual and automatic) and manual membership.
-- Migration number 0030: 0029 is reserved by the open Customers Phase 1 PR
-- (0029_customers_phase1), which merges before this branch's Stage B.

-- 1. customer_segments: a named group of customers (manual) or a saved, validated rule set
--    evaluated live (automatic). At most 20 rows per store (enforced in the domain service).
CREATE TABLE "customer_segments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"kind" text DEFAULT 'manual' NOT NULL,
	"rules" jsonb,
	"is_preset" boolean DEFAULT false NOT NULL,
	"member_count" integer DEFAULT 0 NOT NULL,
	"counted_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_segments_tenant_id_uniq" UNIQUE("tenant_id", "id"),
	CONSTRAINT "customer_segments_kind_chk" CHECK ("kind" IN ('manual', 'automatic')),
	CONSTRAINT "customer_segments_rules_chk" CHECK (("kind" = 'manual' AND "rules" IS NULL) OR ("kind" = 'automatic' AND "rules" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "customer_segments" ADD CONSTRAINT "customer_segments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "customer_segments_tenant_name_ci_uniq" ON "customer_segments" ("tenant_id", lower("name"));
--> statement-breakpoint
CREATE INDEX "customer_segments_tenant_kind_idx" ON "customer_segments" ("tenant_id", "kind");
--> statement-breakpoint
ALTER TABLE "customer_segments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "customer_segments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "customer_segments" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "customer_segments" TO "app_rw", "app_platform";
--> statement-breakpoint

-- 2. customer_segment_members: explicit membership for manual segments; cascades with the
--    segment or the customer (deleting a customer removes their memberships, PLAN §7).
CREATE TABLE "customer_segment_members" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"segment_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"added_by" uuid,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_segment_members_uniq" UNIQUE("tenant_id", "segment_id", "customer_id")
);
--> statement-breakpoint
ALTER TABLE "customer_segment_members" ADD CONSTRAINT "customer_segment_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "customer_segment_members" ADD CONSTRAINT "customer_segment_members_segment_fk" FOREIGN KEY ("tenant_id", "segment_id") REFERENCES "customer_segments"("tenant_id", "id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "customer_segment_members" ADD CONSTRAINT "customer_segment_members_customer_fk" FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "customers"("tenant_id", "id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "customer_segment_members_tenant_cust_idx" ON "customer_segment_members" ("tenant_id", "customer_id");
--> statement-breakpoint
ALTER TABLE "customer_segment_members" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "customer_segment_members" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "customer_segment_members" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "customer_segment_members" TO "app_rw", "app_platform";
