ALTER TABLE "store_settings" ADD COLUMN "auto_publish_reviews" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"customer_id" uuid,
	"order_item_id" uuid,
	"reviewer_name" text NOT NULL,
	"rating" integer NOT NULL,
	"title" text,
	"body" text NOT NULL,
	"status" text DEFAULT 'on_hold' NOT NULL,
	"reply_text" text,
	"replied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_tenant_id_uniq" UNIQUE("tenant_id","id"),
	CONSTRAINT "reviews_rating_range_chk" CHECK (rating >= 1 AND rating <= 5)
);
--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_product_fk" FOREIGN KEY ("tenant_id","product_id") REFERENCES "products"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_variant_fk" FOREIGN KEY ("tenant_id","variant_id") REFERENCES "variants"("tenant_id","id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_customer_fk" FOREIGN KEY ("tenant_id","customer_id") REFERENCES "customers"("tenant_id","id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_order_item_fk" FOREIGN KEY ("tenant_id","order_item_id") REFERENCES "order_items"("tenant_id","id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "reviews_tenant_product_status_idx" ON "reviews" ("tenant_id","product_id","status","created_at");
--> statement-breakpoint
CREATE INDEX "reviews_tenant_status_idx" ON "reviews" ("tenant_id","status");
--> statement-breakpoint
CREATE INDEX "reviews_tenant_customer_idx" ON "reviews" ("tenant_id","customer_id");
--> statement-breakpoint
ALTER TABLE "reviews" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "reviews" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "reviews" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "reviews" TO "app_rw", "app_platform";
