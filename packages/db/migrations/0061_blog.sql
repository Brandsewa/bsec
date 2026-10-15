ALTER TABLE "store_settings" ADD COLUMN IF NOT EXISTS "blog_settings" jsonb;
--> statement-breakpoint
CREATE TABLE "blog_categories" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"slug" citext NOT NULL,
	"description" text,
	"image_media_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"seo" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blog_categories_tenant_slug_uniq" UNIQUE("tenant_id","slug"),
	CONSTRAINT "blog_categories_tenant_id_uniq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "blog_categories" ADD CONSTRAINT "blog_categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "blog_categories" ADD CONSTRAINT "blog_categories_parent_fk" FOREIGN KEY ("tenant_id","parent_id") REFERENCES "blog_categories"("tenant_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "blog_categories" ADD CONSTRAINT "blog_categories_image_media_fk" FOREIGN KEY ("tenant_id","image_media_id") REFERENCES "media"("tenant_id","id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "blog_categories_tenant_parent_idx" ON "blog_categories" ("tenant_id","parent_id","position");
--> statement-breakpoint
ALTER TABLE "blog_categories" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "blog_categories" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "blog_categories" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "blog_categories" TO "app_rw", "app_platform";
--> statement-breakpoint
CREATE TABLE "blog_posts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"slug" citext NOT NULL,
	"excerpt" text,
	"content_html" text DEFAULT '' NOT NULL,
	"content_text" text DEFAULT '' NOT NULL,
	"reading_minutes" integer DEFAULT 1 NOT NULL,
	"featured_image_media_id" uuid,
	"featured_image_alt" text,
	"category_id" uuid,
	"author_user_id" uuid,
	"author_name" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"is_featured" boolean DEFAULT false NOT NULL,
	"seo" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blog_posts_tenant_slug_uniq" UNIQUE("tenant_id","slug"),
	CONSTRAINT "blog_posts_tenant_id_uniq" UNIQUE("tenant_id","id"),
	CONSTRAINT "blog_posts_status_chk" CHECK (status in ('draft', 'scheduled', 'published'))
);
--> statement-breakpoint
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_category_fk" FOREIGN KEY ("tenant_id","category_id") REFERENCES "blog_categories"("tenant_id","id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_featured_media_fk" FOREIGN KEY ("tenant_id","featured_image_media_id") REFERENCES "media"("tenant_id","id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "blog_posts_tenant_status_published_idx" ON "blog_posts" ("tenant_id","status","published_at");
--> statement-breakpoint
CREATE INDEX "blog_posts_tenant_category_published_idx" ON "blog_posts" ("tenant_id","category_id","published_at");
--> statement-breakpoint
ALTER TABLE "blog_posts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "blog_posts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "blog_posts" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "blog_posts" TO "app_rw", "app_platform";
--> statement-breakpoint
CREATE TABLE "blog_slug_redirects" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"from_slug" citext NOT NULL,
	"post_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blog_slug_redirects_tenant_from_uniq" UNIQUE("tenant_id","from_slug"),
	CONSTRAINT "blog_slug_redirects_tenant_id_uniq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "blog_slug_redirects" ADD CONSTRAINT "blog_slug_redirects_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "blog_slug_redirects" ADD CONSTRAINT "blog_slug_redirects_post_fk" FOREIGN KEY ("tenant_id","post_id") REFERENCES "blog_posts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "blog_slug_redirects" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "blog_slug_redirects" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "blog_slug_redirects" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "blog_slug_redirects" TO "app_rw", "app_platform";
--> statement-breakpoint
ALTER TABLE "media_usages" DROP CONSTRAINT IF EXISTS "media_usages_owner_type_chk";
--> statement-breakpoint
ALTER TABLE "media_usages" ADD CONSTRAINT "media_usages_owner_type_chk" CHECK ("owner_type" in ('product', 'variant', 'collection', 'category', 'brand', 'page', 'theme', 'store_branding', 'blog_post', 'blog_category'));
