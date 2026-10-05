-- Settings Rebuild Phase 5: payment_methods and plan_change_requests tables, and backfill
-- Slices 5A & 5D

-- 1. payment_methods tenant table
CREATE TABLE IF NOT EXISTS "payment_methods" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"display_name" text NOT NULL,
	"status" text DEFAULT 'disabled' NOT NULL,
	"mode" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"public_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"setup_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"enabled_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_methods_tenant_provider_uniq" UNIQUE("tenant_id", "provider"),
	CONSTRAINT "payment_methods_tenant_id_id_uniq" UNIQUE("tenant_id", "id"),
	CONSTRAINT "payment_methods_provider_chk" CHECK ("provider" IN ('cod', 'razorpay')),
	CONSTRAINT "payment_methods_display_name_chk" CHECK (char_length("display_name") BETWEEN 1 AND 80),
	CONSTRAINT "payment_methods_status_chk" CHECK ("status" IN ('disabled', 'pending_setup', 'active', 'unavailable', 'error')),
	CONSTRAINT "payment_methods_mode_chk" CHECK ("mode" IS NULL OR "mode" IN ('live', 'test')),
	CONSTRAINT "payment_methods_sort_order_chk" CHECK ("sort_order" >= 0)
);
--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment_methods" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "payment_methods" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "payment_methods" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "payment_methods" TO "app_rw", "app_platform";
--> statement-breakpoint

-- 2. plan_change_requests tenant table
CREATE TABLE IF NOT EXISTS "plan_change_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"from_plan_id" uuid,
	"to_plan_id" uuid NOT NULL,
	"interval" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'open' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_change_requests_tenant_id_id_uniq" UNIQUE("tenant_id", "id"),
	CONSTRAINT "plan_change_requests_interval_chk" CHECK ("interval" IN ('monthly', 'yearly')),
	CONSTRAINT "plan_change_requests_note_chk" CHECK ("note" IS NULL OR char_length("note") <= 500),
	CONSTRAINT "plan_change_requests_status_chk" CHECK ("status" IN ('open', 'approved', 'declined', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "plan_change_requests" ADD CONSTRAINT "plan_change_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "plan_change_requests" ADD CONSTRAINT "plan_change_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "plan_change_requests" ADD CONSTRAINT "plan_change_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "plan_change_requests_one_open" ON "plan_change_requests" ("tenant_id") WHERE "status" = 'open';
--> statement-breakpoint
ALTER TABLE "plan_change_requests" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "plan_change_requests" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "plan_change_requests" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "plan_change_requests" TO "app_rw", "app_platform";
--> statement-breakpoint

-- 3. Idempotent backfill of COD payment_methods from store_settings
INSERT INTO "payment_methods" (
	"tenant_id",
	"provider",
	"display_name",
	"status",
	"mode",
	"sort_order",
	"public_config",
	"setup_state",
	"version",
	"enabled_at",
	"disabled_at"
)
SELECT
	ss."tenant_id",
	'cod',
	'Cash on Delivery (COD)',
	CASE
		WHEN COALESCE((ss."checkout"->'cod'->>'enabled')::boolean, true) THEN 'active'
		ELSE 'disabled'
	END,
	NULL,
	0,
	jsonb_build_object(
		'v', 1,
		'feePaise', COALESCE((ss."checkout"->'cod'->>'feePaise')::integer, 5000),
		'minOrderPaise', NULL,
		'maxOrderPaise', NULL
	),
	jsonb_build_object(
		'v', 1,
		'configured', true,
		'requiredSecretsPresent', '[]'::jsonb
	),
	1,
	CASE
		WHEN COALESCE((ss."checkout"->'cod'->>'enabled')::boolean, true) THEN now()
		ELSE NULL
	END,
	CASE
		WHEN NOT COALESCE((ss."checkout"->'cod'->>'enabled')::boolean, true) THEN now()
		ELSE NULL
	END
FROM "store_settings" ss
ON CONFLICT ("tenant_id", "provider") DO NOTHING;
