ALTER TABLE "products" ADD COLUMN "price_on_request" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE "quote_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"product_title" text NOT NULL,
	"variant_title" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"email" "citext" NOT NULL,
	"phone" text NOT NULL,
	"company" text,
	"message" text,
	"status" text DEFAULT 'new' NOT NULL,
	"admin_note" text,
	"quoted_total" bigint,
	"quote_note" text,
	"valid_until" timestamp with time zone,
	"quoted_at" timestamp with time zone,
	"order_id" uuid,
	"customer_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quote_requests_tenant_number_uniq" UNIQUE("tenant_id","number"),
	CONSTRAINT "quote_requests_tenant_id_uniq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "products"("tenant_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_variant_fk" FOREIGN KEY ("tenant_id","variant_id") REFERENCES "variants"("tenant_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_order_fk" FOREIGN KEY ("tenant_id","order_id") REFERENCES "orders"("tenant_id","id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "customers"("tenant_id","id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "quote_requests_tenant_status_created_idx" ON "quote_requests" ("tenant_id","status","created_at");
--> statement-breakpoint
CREATE INDEX "quote_requests_tenant_email_idx" ON "quote_requests" ("tenant_id","email");
--> statement-breakpoint
ALTER TABLE "quote_requests" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "quote_requests" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "quote_requests" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "quote_requests" TO "app_rw", "app_platform";
