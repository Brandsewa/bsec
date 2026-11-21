-- Discount engine, phase 4 (ADR-045). Expand-only: a flag on discounts (default false) and one new tenant table holding
-- generated single-use codes. Existing discounts and the running app are unaffected.
ALTER TABLE "discounts" ADD COLUMN "uses_code_list" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE "discount_codes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"discount_id" uuid NOT NULL,
	"code" citext NOT NULL,
	"used_at" timestamp with time zone,
	"used_order_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discount_codes_tenant_code_uniq" UNIQUE("tenant_id","code"),
	CONSTRAINT "discount_codes_tenant_id_uniq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "discount_codes" ADD CONSTRAINT "discount_codes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "discount_codes" ADD CONSTRAINT "discount_codes_discount_fk" FOREIGN KEY ("tenant_id","discount_id") REFERENCES "discounts"("tenant_id","id") ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX "discount_codes_tenant_discount_idx" ON "discount_codes" ("tenant_id","discount_id");
--> statement-breakpoint
ALTER TABLE "discount_codes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "discount_codes" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "discount_codes" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
