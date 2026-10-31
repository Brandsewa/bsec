-- Product import runs (docs/PRODUCT-BULK-IO-PLAN.md). Expand-only: one new tenant table, no existing behaviour changes.
CREATE TABLE "product_import_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"status" text DEFAULT 'previewed' NOT NULL,
	"conflict_policy" text DEFAULT 'update' NOT NULL,
	"mode" text DEFAULT 'create_and_update' NOT NULL,
	"file_name" text,
	"products_total" integer DEFAULT 0 NOT NULL,
	"products_done" integer DEFAULT 0 NOT NULL,
	"created" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"images_total" integer DEFAULT 0 NOT NULL,
	"images_done" integer DEFAULT 0 NOT NULL,
	"images_failed" integer DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"errors_truncated" integer DEFAULT 0 NOT NULL,
	"requested_by" uuid,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_import_runs_status_chk" CHECK ("status" in ('previewed', 'running', 'completed', 'completed_with_errors', 'failed')),
	CONSTRAINT "product_import_runs_policy_chk" CHECK ("conflict_policy" in ('skip', 'update', 'replace')),
	CONSTRAINT "product_import_runs_mode_chk" CHECK ("mode" in ('create_only', 'update_only', 'create_and_update'))
);
--> statement-breakpoint
ALTER TABLE "product_import_runs" ADD CONSTRAINT "product_import_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "product_import_runs_tenant_created_idx" ON "product_import_runs" USING btree ("tenant_id","created_at");
--> statement-breakpoint
ALTER TABLE "product_import_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "product_import_runs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "product_import_runs" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
