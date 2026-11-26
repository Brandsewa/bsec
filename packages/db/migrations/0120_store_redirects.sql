-- Store redirects (ADR-051). Expand-only: one new tenant table, nothing existing changes.

CREATE TABLE "tenant_redirects" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"from_path" citext NOT NULL,
	"to_path" text NOT NULL,
	"status_code" integer DEFAULT 308 NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_redirects_tenant_from_uniq" UNIQUE ("tenant_id", "from_path"),
	CONSTRAINT "tenant_redirects_tenant_id_uniq" UNIQUE ("tenant_id", "id"),
	CONSTRAINT "tenant_redirects_status_chk" CHECK ("status_code" in (301, 302, 307, 308)),
	CONSTRAINT "tenant_redirects_source_chk" CHECK ("source" in ('manual', 'import', 'auto'))
);
--> statement-breakpoint
CREATE INDEX "tenant_redirects_tenant_created_idx" ON "tenant_redirects" USING btree ("tenant_id","created_at");
--> statement-breakpoint
ALTER TABLE "tenant_redirects" ADD CONSTRAINT "tenant_redirects_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tenant_redirects" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tenant_redirects" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenant_redirects" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
