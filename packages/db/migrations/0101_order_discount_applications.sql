-- Discount engine, phase 0 (ADR-045, docs/DISCOUNTS-PLAN.md). Expand-only: one new tenant table recording what each
-- discount did to an order. Nothing existing is changed or dropped.
CREATE TABLE "order_discount_applications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"discount_id" uuid NOT NULL,
	"code" text,
	"title" text NOT NULL,
	"discount_class" text DEFAULT 'order' NOT NULL,
	"type" text NOT NULL,
	"amount" bigint DEFAULT 0 NOT NULL,
	"shipping_amount" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_discount_applications_tenant_id_uniq" UNIQUE("tenant_id","id"),
	CONSTRAINT "order_discount_applications_amounts_chk" CHECK ("amount" >= 0 AND "shipping_amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "order_discount_applications" ADD CONSTRAINT "order_discount_applications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_discount_applications" ADD CONSTRAINT "order_discount_applications_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "orders"("tenant_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "order_discount_applications" ADD CONSTRAINT "order_discount_applications_discount_fk" FOREIGN KEY ("tenant_id","discount_id") REFERENCES "discounts"("tenant_id","id") ON DELETE restrict;
--> statement-breakpoint
CREATE INDEX "order_discount_applications_tenant_order_idx" ON "order_discount_applications" ("tenant_id","order_id");
--> statement-breakpoint
CREATE INDEX "order_discount_applications_tenant_discount_idx" ON "order_discount_applications" ("tenant_id","discount_id");
--> statement-breakpoint
ALTER TABLE "order_discount_applications" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "order_discount_applications" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "order_discount_applications" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
