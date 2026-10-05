-- Settings Rebuild Phase 8: storage usage view, store_status maintenance schedule, and store_status_transitions append-only table
-- Slices 8A & 8B

-- 1. store_status maintenance extensions
ALTER TABLE "store_status" ADD COLUMN IF NOT EXISTS "maintenance_starts_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "store_status" ADD COLUMN IF NOT EXISTS "maintenance_ends_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "store_status" ADD COLUMN IF NOT EXISTS "mode_before_maintenance" text;
--> statement-breakpoint
ALTER TABLE "store_status" ADD COLUMN IF NOT EXISTS "maintenance_allow_staff_preview" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'store_status_maintenance_window_chk'
  ) THEN
    ALTER TABLE "store_status" ADD CONSTRAINT "store_status_maintenance_window_chk" CHECK ("maintenance_ends_at" IS NULL OR "maintenance_starts_at" IS NULL OR "maintenance_ends_at" > "maintenance_starts_at");
  END IF;
END $$;
--> statement-breakpoint

-- 2. Create store_status_transitions tenant table (append-only)
CREATE TABLE IF NOT EXISTS "store_status_transitions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"from_mode" text NOT NULL,
	"to_mode" text NOT NULL,
	"reason" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_status_transitions_tenant_id_id_uniq" UNIQUE("tenant_id", "id"),
	CONSTRAINT "store_status_transitions_reason_chk" CHECK ("reason" IN ('manual', 'scheduled_start', 'scheduled_end', 'watchdog_restore', 'platform'))
);
--> statement-breakpoint
ALTER TABLE "store_status_transitions" ADD CONSTRAINT "store_status_transitions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "store_status_transitions_tenant_at_idx" ON "store_status_transitions" ("tenant_id", "at" DESC);
--> statement-breakpoint
ALTER TABLE "store_status_transitions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "store_status_transitions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store_status_transitions" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "store_status_transitions" TO "app_rw", "app_platform";
--> statement-breakpoint
REVOKE UPDATE, DELETE ON TABLE "store_status_transitions" FROM "app_rw";
--> statement-breakpoint
