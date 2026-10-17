-- Custom fields (owner request 2026-10-17, ADR-034). New tenant tables with forced RLS, composite tenant foreign keys,
-- and the plan feature flag: custom fields are on from the Growth plan up.
CREATE TABLE "custom_field_definitions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"resource_type" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"help_text" text,
	"required" boolean DEFAULT false NOT NULL,
	"show_on_storefront" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_field_definitions_tenant_key_uniq" UNIQUE("tenant_id","resource_type","key"),
	CONSTRAINT "custom_field_definitions_tenant_id_uniq" UNIQUE("tenant_id","id"),
	CONSTRAINT "custom_field_definitions_resource_chk" CHECK ("resource_type" in ('product', 'collection')),
	CONSTRAINT "custom_field_definitions_type_chk" CHECK ("type" in ('text', 'rich_text', 'image', 'dropdown', 'multi_select', 'number', 'boolean'))
);
--> statement-breakpoint
ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "custom_field_definitions_tenant_resource_idx" ON "custom_field_definitions" ("tenant_id","resource_type","position");
--> statement-breakpoint
ALTER TABLE "custom_field_definitions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "custom_field_definitions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "custom_field_definitions" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "custom_field_definitions" TO "app_rw", "app_platform";
--> statement-breakpoint
CREATE TABLE "custom_field_values" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"definition_id" uuid NOT NULL,
	"product_id" uuid,
	"collection_id" uuid,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_field_values_one_owner_chk" CHECK (num_nonnulls("product_id", "collection_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_definition_fk" FOREIGN KEY ("tenant_id","definition_id") REFERENCES "custom_field_definitions"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "products"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_collection_fk" FOREIGN KEY ("tenant_id","collection_id") REFERENCES "collections"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "custom_field_values_product_uniq" ON "custom_field_values" ("tenant_id","definition_id","product_id") WHERE "product_id" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX "custom_field_values_collection_uniq" ON "custom_field_values" ("tenant_id","definition_id","collection_id") WHERE "collection_id" is not null;
--> statement-breakpoint
CREATE INDEX "custom_field_values_tenant_product_idx" ON "custom_field_values" ("tenant_id","product_id");
--> statement-breakpoint
CREATE INDEX "custom_field_values_tenant_collection_idx" ON "custom_field_values" ("tenant_id","collection_id");
--> statement-breakpoint
ALTER TABLE "custom_field_values" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "custom_field_values" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "custom_field_values" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "custom_field_values" TO "app_rw", "app_platform";
--> statement-breakpoint
UPDATE "plans" SET "features" = "features" || '{"custom_fields": false}'::jsonb WHERE "code" = 'starter';
--> statement-breakpoint
UPDATE "plans" SET "features" = "features" || '{"custom_fields": true}'::jsonb WHERE "code" IN ('growth', 'pro');
