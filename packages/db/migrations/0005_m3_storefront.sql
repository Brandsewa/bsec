CREATE TABLE "store_status" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"mode" text DEFAULT 'coming_soon' NOT NULL,
	"headline" text,
	"message_json" jsonb,
	"launch_at" timestamp with time zone,
	"show_countdown" boolean DEFAULT false NOT NULL,
	"collect_emails" boolean DEFAULT true NOT NULL,
	"background_media_id" uuid,
	"password_hash" text,
	"retry_after_minutes" integer DEFAULT 60 NOT NULL,
	"bypass_token_hash" text,
	"changed_by" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_status_tenant_id_uniq" UNIQUE("tenant_id")
);
--> statement-breakpoint
ALTER TABLE "store_status" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "store_status" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store_status" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE TABLE "seo_settings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"indexing_enabled" boolean DEFAULT true NOT NULL,
	"title_template" text DEFAULT '%s | {{store_name}}' NOT NULL,
	"default_meta_description" text,
	"default_og_image_media_id" uuid,
	"twitter_handle" text,
	"organization_schema" jsonb,
	"local_business" jsonb,
	"robots_extra" text,
	"ai_crawlers" jsonb,
	"breadcrumbs_enabled" boolean DEFAULT true NOT NULL,
	"faq_schema_enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seo_settings_tenant_id_uniq" UNIQUE("tenant_id")
);
--> statement-breakpoint
ALTER TABLE "seo_settings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "seo_settings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "seo_settings" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE TABLE "search_queries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"query" text NOT NULL,
	"normalized_query" text NOT NULL,
	"results_count" integer DEFAULT 0 NOT NULL,
	"clicked_product_id" uuid,
	"day" date DEFAULT CURRENT_DATE NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "search_queries_tenant_norm_day_uniq" UNIQUE("tenant_id","normalized_query","day")
);
--> statement-breakpoint
ALTER TABLE "search_queries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "search_queries" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "search_queries" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX "search_queries_tenant_day_idx" ON "search_queries" ("tenant_id","day");
--> statement-breakpoint
CREATE TABLE "newsletter_subscribers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" "citext" NOT NULL,
	"status" text DEFAULT 'subscribed' NOT NULL,
	"source" text DEFAULT 'storefront' NOT NULL,
	"consent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unsubscribed_at" timestamp with time zone,
	CONSTRAINT "newsletter_subscribers_tenant_email_uniq" UNIQUE("tenant_id","email")
);
--> statement-breakpoint
ALTER TABLE "newsletter_subscribers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "newsletter_subscribers" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "newsletter_subscribers" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX "newsletter_subscribers_tenant_status_idx" ON "newsletter_subscribers" ("tenant_id","status");
--> statement-breakpoint
CREATE TABLE "carts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"token" text NOT NULL,
	"customer_id" uuid,
	"email" "citext",
	"phone" text,
	"currency" text DEFAULT 'INR' NOT NULL,
	"discount_codes" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"shipping_address" jsonb,
	"shipping_rate_id" text,
	"notes" text,
	"status" text DEFAULT 'active' NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recovered_at" timestamp with time zone,
	"recovery_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "carts_tenant_token_uniq" UNIQUE("tenant_id","token"),
	CONSTRAINT "carts_tenant_id_uniq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "carts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "carts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "carts" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX "carts_tenant_status_idx" ON "carts" ("tenant_id","status");
--> statement-breakpoint
CREATE TABLE "cart_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cart_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price_snapshot" bigint NOT NULL,
	"properties" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cart_items_tenant_cart_variant_uniq" UNIQUE("tenant_id","cart_id","variant_id")
);
--> statement-breakpoint
ALTER TABLE "cart_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "cart_items" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cart_items" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
-- Foreign Key Constraints (root tenant_id references)
ALTER TABLE "store_status" ADD CONSTRAINT "store_status_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "seo_settings" ADD CONSTRAINT "seo_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "search_queries" ADD CONSTRAINT "search_queries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "newsletter_subscribers" ADD CONSTRAINT "newsletter_subscribers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
-- Composite Foreign Keys
ALTER TABLE "store_status" ADD CONSTRAINT "store_status_background_media_fk" FOREIGN KEY ("tenant_id","background_media_id") REFERENCES "public"."media"("tenant_id","id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "seo_settings" ADD CONSTRAINT "seo_settings_default_og_image_media_fk" FOREIGN KEY ("tenant_id","default_og_image_media_id") REFERENCES "public"."media"("tenant_id","id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "search_queries" ADD CONSTRAINT "search_queries_clicked_product_fk" FOREIGN KEY ("tenant_id","clicked_product_id") REFERENCES "public"."products"("tenant_id","id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_fk" FOREIGN KEY ("tenant_id","cart_id") REFERENCES "public"."carts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_variant_fk" FOREIGN KEY ("tenant_id","variant_id") REFERENCES "public"."variants"("tenant_id","id") ON DELETE restrict ON UPDATE no action;
