-- Settings Rebuild Phase 6: tax_classes, products tax_class_id fk, order_items tax snapshot, invoices credit note columns
-- Slices 6A & 6D

-- 1. Create tax_classes tenant table
CREATE TABLE IF NOT EXISTS "tax_classes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"rate_bps" integer NOT NULL,
	"default_hsn" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_classes_tenant_name_uniq" UNIQUE("tenant_id", "name"),
	CONSTRAINT "tax_classes_tenant_id_id_uniq" UNIQUE("tenant_id", "id"),
	CONSTRAINT "tax_classes_name_chk" CHECK (char_length("name") BETWEEN 1 AND 60),
	CONSTRAINT "tax_classes_rate_bps_chk" CHECK ("rate_bps" IN (0, 250, 300, 500, 1200, 1800, 2800)),
	CONSTRAINT "tax_classes_default_hsn_chk" CHECK ("default_hsn" IS NULL OR "default_hsn" ~ '^[0-9]{4}([0-9]{2}([0-9]{2})?)?$')
);
--> statement-breakpoint
ALTER TABLE "tax_classes" ADD CONSTRAINT "tax_classes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tax_classes_one_default" ON "tax_classes" ("tenant_id") WHERE "is_default";
--> statement-breakpoint
ALTER TABLE "tax_classes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tax_classes" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tax_classes" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "tax_classes" TO "app_rw", "app_platform";
--> statement-breakpoint

-- 2. Assert no non-null tax_class_id exists in products before adding composite tenant FK
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "products" WHERE "tax_class_id" IS NOT NULL) THEN
		RAISE EXCEPTION 'Non-null tax_class_id found in products table before composite FK creation';
	END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_tax_class_fk" FOREIGN KEY ("tenant_id", "tax_class_id") REFERENCES "tax_classes"("tenant_id", "id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint

-- 3. Expand order_items with taxable_value_paise and tax_paise
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "taxable_value_paise" integer;
--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "tax_paise" integer;
--> statement-breakpoint

-- 4. Expand invoices with return_id, parent_invoice_id, and constraints
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "return_id" uuid;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "parent_invoice_id" uuid;
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_return_fk" FOREIGN KEY ("tenant_id", "return_id") REFERENCES "returns"("tenant_id", "id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_parent_invoice_fk" FOREIGN KEY ("tenant_id", "parent_invoice_id") REFERENCES "invoices"("tenant_id", "id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_tenant_return_credit_note_uniq" ON "invoices" ("tenant_id", "return_id") WHERE "type" = 'credit_note';
