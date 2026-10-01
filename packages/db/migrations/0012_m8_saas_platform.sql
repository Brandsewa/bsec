-- Milestone M8: Self-Service SaaS Platform Migration
-- Formalizes quotas, plans, subscriptions, invoices, audit logs, templates, leads, reservations, and onboarding.

-- 1. Extend quota_definitions and tenant_quota_overrides
ALTER TABLE "quota_definitions" ADD COLUMN IF NOT EXISTS "unit" text DEFAULT 'count' NOT NULL;
--> statement-breakpoint
ALTER TABLE "quota_definitions" ADD COLUMN IF NOT EXISTS "enforcement" text DEFAULT 'hard' NOT NULL;
--> statement-breakpoint
ALTER TABLE "tenant_quota_overrides" ADD COLUMN IF NOT EXISTS "reason" text;
--> statement-breakpoint
ALTER TABLE "tenant_quota_overrides" ADD COLUMN IF NOT EXISTS "expires_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "tenant_quota_overrides" ADD COLUMN IF NOT EXISTS "set_by" uuid;
--> statement-breakpoint

-- Seed all 12 PLAN §6.1 quotas
INSERT INTO "quota_definitions" ("key", "description", "unit", "enforcement", "tier_xs", "tier_s", "tier_m", "tier_l")
VALUES
  ('products', 'Maximum active catalog products', 'count', 'hard', 50, 500, 5000, 25000),
  ('variants', 'Maximum product variants', 'count', 'hard', 200, 2000, 20000, 100000),
  ('staff_seats', 'Maximum active store staff seats', 'count', 'hard', 2, 5, 15, 50),
  ('storage_mb', 'Total media and file storage allowance (MB)', 'MB', 'hard', 1024, 5120, 25600, 102400),
  ('media_file_mb', 'Maximum individual upload file size (MB)', 'MB', 'hard', 5, 10, 20, 50),
  ('orders_month', 'Monthly order processing ceiling (warn & upsell, never blocks checkout)', 'orders', 'soft', 300, 3000, 20000, 1000000),
  ('emails_month', 'Transactional emails per month', 'emails', 'soft', 2000, 15000, 80000, 300000),
  ('uncached_storefront_rpm', 'Uncached storefront requests per minute', 'rpm', 'hard', 3000, 4500, 9000, 18000),
  ('admin_api_rpm', 'Admin and API requests per minute', 'rpm', 'hard', 600, 1200, 2400, 4800),
  ('custom_domains', 'Active custom domains connected to store', 'domains', 'hard', 0, 1, 3, 10),
  ('installed_apps', 'Installed platform apps and extensions', 'apps', 'hard', 3, 10, 25, 100),
  ('exports_day', 'Daily data and product export runs', 'exports', 'hard', 2, 5, 10, 20),
  ('job_concurrency', 'Background job concurrency ceiling per store', 'jobs', 'hard', 4, 6, 8, 16)
ON CONFLICT ("key") DO UPDATE SET
  "unit" = EXCLUDED."unit",
  "enforcement" = EXCLUDED."enforcement",
  "description" = EXCLUDED."description";
--> statement-breakpoint

-- 2. Quota Events table
CREATE TABLE IF NOT EXISTS "quota_events" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "quota_key" text NOT NULL,
  "level" text NOT NULL,
  "value" integer NOT NULL,
  "limit_value" integer NOT NULL,
  "notified_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quota_events" ADD CONSTRAINT "quota_events_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "quota_events" ADD CONSTRAINT "quota_events_quota_key_fk" FOREIGN KEY ("quota_key") REFERENCES "quota_definitions"("key") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quota_events_tenant_key_idx" ON "quota_events" ("tenant_id", "quota_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quota_events_level_idx" ON "quota_events" ("level");
--> statement-breakpoint

-- 3. Non-regression: Assign existing tenants to generous Tier L so nothing is blocked
INSERT INTO "tenant_size_tiers" ("tenant_id", "tier", "created_at", "updated_at")
SELECT "id", 'L', now(), now() FROM "tenants"
ON CONFLICT ("tenant_id") DO NOTHING;
--> statement-breakpoint

-- (Store #1 slug/hostname are deliberately NOT rewritten here: migrations never change existing tenant data.)

-- 5. Plans table
CREATE TABLE IF NOT EXISTS "plans" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "code" text NOT NULL UNIQUE,
  "name" text NOT NULL,
  "price_monthly_paise" bigint NOT NULL,
  "price_yearly_paise" bigint NOT NULL,
  "currency" char(3) DEFAULT 'INR' NOT NULL,
  "limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "features" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "is_public" boolean DEFAULT true NOT NULL,
  "sort" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

INSERT INTO "plans" ("code", "name", "price_monthly_paise", "price_yearly_paise", "currency", "limits", "features", "is_public", "sort")
VALUES
  (
    'starter',
    'Starter',
    99900,
    999000,
    'INR',
    '{"products": 500, "staff_seats": 2, "storage_mb": 5120, "orders_month": 300, "custom_domains": 1}'::jsonb,
    '{"remove_branding": false, "custom_domain": true}'::jsonb,
    true,
    1
  ),
  (
    'growth',
    'Growth',
    249900,
    2499000,
    'INR',
    '{"products": 5000, "staff_seats": 5, "storage_mb": 25600, "orders_month": 3000, "custom_domains": 3}'::jsonb,
    '{"remove_branding": true, "custom_domain": true}'::jsonb,
    true,
    2
  ),
  (
    'pro',
    'Pro',
    599900,
    5999000,
    'INR',
    '{"products": 25000, "staff_seats": 15, "storage_mb": 102400, "orders_month": 20000, "custom_domains": 10}'::jsonb,
    '{"remove_branding": true, "custom_domain": true}'::jsonb,
    true,
    3
  )
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "price_monthly_paise" = EXCLUDED."price_monthly_paise",
  "price_yearly_paise" = EXCLUDED."price_yearly_paise",
  "limits" = EXCLUDED."limits",
  "features" = EXCLUDED."features",
  "sort" = EXCLUDED."sort";
--> statement-breakpoint

-- 6. Subscriptions table
CREATE TABLE IF NOT EXISTS "subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "plan_id" uuid,
  "status" text DEFAULT 'trialing' NOT NULL,
  "interval" text DEFAULT 'monthly' NOT NULL,
  "current_period_start" timestamp with time zone,
  "current_period_end" timestamp with time zone,
  "provider" text DEFAULT 'razorpay' NOT NULL,
  "provider_subscription_id" text,
  "cancel_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscriptions_tenant_idx" ON "subscriptions" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscriptions_status_idx" ON "subscriptions" ("status");
--> statement-breakpoint

-- 7. Platform Invoices table
CREATE TABLE IF NOT EXISTS "platform_invoices" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "subscription_id" uuid,
  "number" text NOT NULL UNIQUE,
  "amount_paise" bigint NOT NULL,
  "tax_paise" bigint NOT NULL,
  "status" text DEFAULT 'issued' NOT NULL,
  "issued_at" timestamp with time zone DEFAULT now() NOT NULL,
  "paid_at" timestamp with time zone,
  "pdf_key" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_invoices" ADD CONSTRAINT "platform_invoices_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "platform_invoices" ADD CONSTRAINT "platform_invoices_subscription_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_invoices_tenant_idx" ON "platform_invoices" ("tenant_id");
--> statement-breakpoint

-- 8. Platform Audit Logs table
CREATE TABLE IF NOT EXISTS "platform_audit_logs" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "actor_user_id" uuid,
  "actor_type" text DEFAULT 'platform_staff' NOT NULL,
  "action" text NOT NULL,
  "target_type" text NOT NULL,
  "target_id" text NOT NULL,
  "tenant_id" uuid,
  "ip" text,
  "user_agent" text,
  "diff" jsonb,
  "request_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platform_audit_logs" ADD CONSTRAINT "platform_audit_logs_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_audit_logs_actor_idx" ON "platform_audit_logs" ("actor_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_audit_logs_tenant_idx" ON "platform_audit_logs" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_audit_logs_action_idx" ON "platform_audit_logs" ("action");
--> statement-breakpoint

-- 9. Theme Templates table + 3 Starter Themes
CREATE TABLE IF NOT EXISTS "theme_templates" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "code" text NOT NULL UNIQUE,
  "name" text NOT NULL,
  "industry" text NOT NULL,
  "preview_image_key" text,
  "default_tokens" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "default_pages" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

INSERT INTO "theme_templates" ("code", "name", "industry", "preview_image_key", "default_tokens", "default_pages", "version", "is_active")
VALUES
  (
    'starter-minimal',
    'Minimalist Essential',
    'general',
    'templates/starter-minimal.jpg',
    '{"colors": {"primary": "#0f172a", "accent": "#3b82f6", "background": "#ffffff", "surface": "#f8fafc", "text": "#0f172a"}, "typography": {"headingFont": "Inter", "bodyFont": "Inter", "scale": 1.0}, "shape": {"radius": "0.5rem", "buttonStyle": "rounded"}}'::jsonb,
    '{"home": [{"id": "b-hero-01", "type": "Hero", "version": 1, "props": {"title": "Welcome to Our Store", "subtitle": "Discover premium handcrafted products curated for you.", "buttonText": "Shop Collection", "buttonUrl": "/collections/all"}}, {"id": "b-grid-01", "type": "ProductGrid", "version": 1, "props": {"title": "Featured Products", "limit": 8}}]}'::jsonb,
    1,
    true
  ),
  (
    'fashion-editorial',
    'Modern Fashion & Apparel',
    'fashion',
    'templates/fashion-editorial.jpg',
    '{"colors": {"primary": "#18181b", "accent": "#d97706", "background": "#fafaf9", "surface": "#ffffff", "text": "#18181b"}, "typography": {"headingFont": "Playfair Display", "bodyFont": "Inter", "scale": 1.1}, "shape": {"radius": "0.25rem", "buttonStyle": "sharp"}}'::jsonb,
    '{"home": [{"id": "b-banner-01", "type": "Banner", "version": 1, "props": {"headline": "New Season Arrival", "text": "Explore bespoke garments and sustainable luxury collections.", "ctaText": "Explore Lookbook", "ctaUrl": "/collections/new"}}, {"id": "b-carousel-01", "type": "ProductCarousel", "version": 1, "props": {"title": "Trending Pieces", "limit": 6}}]}'::jsonb,
    1,
    true
  ),
  (
    'gourmet-artisan',
    'Artisan Food & Craft',
    'food',
    'templates/gourmet-artisan.jpg',
    '{"colors": {"primary": "#78350f", "accent": "#059669", "background": "#fffbeb", "surface": "#fef3c7", "text": "#451a03"}, "typography": {"headingFont": "Cinzel", "bodyFont": "Lora", "scale": 1.05}, "shape": {"radius": "0.75rem", "buttonStyle": "pill"}}'::jsonb,
    '{"home": [{"id": "b-hero-02", "type": "Hero", "version": 1, "props": {"title": "Farm to Table Delights", "subtitle": "Single-estate artisanal teas, spices, and preserves directly from regional farmers.", "buttonText": "Order Fresh", "buttonUrl": "/collections/fresh"}}, {"id": "b-grid-02", "type": "ProductGrid", "version": 1, "props": {"title": "Artisan Picks", "limit": 6}}]}'::jsonb,
    1,
    true
  )
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "industry" = EXCLUDED."industry",
  "default_tokens" = EXCLUDED."default_tokens",
  "default_pages" = EXCLUDED."default_pages";
--> statement-breakpoint

-- 10. Signup Leads table
CREATE TABLE IF NOT EXISTS "signup_leads" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "email" citext,
  "phone" text,
  "name" text,
  "business_name" text,
  "desired_slug" citext,
  "industry" text,
  "source" text,
  "utm" jsonb,
  "referral_code" text,
  "step" text DEFAULT 'started' NOT NULL,
  "ip_hash" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signup_leads_email_idx" ON "signup_leads" ("email");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signup_leads_step_idx" ON "signup_leads" ("step");
--> statement-breakpoint

-- 11. Slug Reservations table
CREATE TABLE IF NOT EXISTS "slug_reservations" (
  "slug" citext PRIMARY KEY NOT NULL,
  "lead_id" uuid,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "slug_reservations" ADD CONSTRAINT "slug_reservations_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "signup_leads"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "slug_reservations_expires_idx" ON "slug_reservations" ("expires_at");
--> statement-breakpoint

-- 12. Reserved Slugs table + System seeds
CREATE TABLE IF NOT EXISTS "reserved_slugs" (
  "slug" citext PRIMARY KEY NOT NULL,
  "reason" text DEFAULT 'system_reserved' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

INSERT INTO "reserved_slugs" ("slug", "reason")
VALUES
  ('admin', 'Reserved for Store Admin application'),
  ('platform', 'Reserved for Platform Super Admin API'),
  ('api', 'Reserved for central API routing'),
  ('mail', 'Reserved for mail services'),
  ('email', 'Reserved for transactional email routing'),
  ('webmail', 'Reserved for email routing'),
  ('shop', 'System reserved keyword'),
  ('store', 'System reserved keyword'),
  ('stores', 'Reserved for Cloudflare SaaS custom hostnames fallback CNAME target'),
  ('billing', 'Reserved for SaaS billing portal'),
  ('pay', 'Reserved for checkout payment links'),
  ('payment', 'Reserved for payment processing'),
  ('checkout', 'System reserved keyword'),
  ('cart', 'System reserved keyword'),
  ('login', 'Reserved for authentication entrypoints'),
  ('signup', 'Reserved for merchant registration pipeline'),
  ('auth', 'Reserved for Better Auth API routes'),
  ('app', 'Reserved for future application library'),
  ('www', 'Reserved apex alias'),
  ('root', 'System reserved keyword'),
  ('status', 'Reserved for uptime status page'),
  ('health', 'Reserved for system health check probes'),
  ('webhook', 'Reserved for inbound webhook ingress'),
  ('assets', 'Reserved for static CDN assets'),
  ('static', 'Reserved for static files'),
  ('support', 'Reserved for customer support and ticketing'),
  ('help', 'Reserved for merchant documentation'),
  ('docs', 'Reserved for developer and platform documentation')
ON CONFLICT ("slug") DO NOTHING;
--> statement-breakpoint

-- 13. Onboarding Progress table (Tenant Table with FORCE ROW LEVEL SECURITY)
CREATE TABLE IF NOT EXISTS "onboarding_progress" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "steps" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "completed_at" timestamp with time zone,
  "dismissed" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "onboarding_progress_tenant_id_uniq" UNIQUE("tenant_id", "id")
);
--> statement-breakpoint
ALTER TABLE "onboarding_progress" ADD CONSTRAINT "onboarding_progress_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "onboarding_progress_tenant_idx" ON "onboarding_progress" ("tenant_id");
--> statement-breakpoint
ALTER TABLE "onboarding_progress" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "onboarding_progress" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "onboarding_progress" AS PERMISSIVE FOR ALL TO public
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint

-- 14. Tenant Owner Invites table (Hashed, Single-Use, Expiring Tokens per PLAN §6)
CREATE TABLE IF NOT EXISTS "tenant_owner_invites" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "email" citext NOT NULL,
  "token_hash" text NOT NULL UNIQUE,
  "expires_at" timestamp with time zone NOT NULL,
  "used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_owner_invites" ADD CONSTRAINT "tenant_owner_invites_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_owner_invites_token_hash_idx" ON "tenant_owner_invites" ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_owner_invites_tenant_email_idx" ON "tenant_owner_invites" ("tenant_id", "email");
--> statement-breakpoint

-- 15. Role Grants for Application Roles
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "quota_events",
  "signup_leads",
  "slug_reservations",
  "onboarding_progress",
  "tenant_owner_invites",
  "subscriptions",
  "platform_invoices"
TO "app_rw";
--> statement-breakpoint

GRANT SELECT, INSERT ON TABLE
  "platform_audit_logs"
TO "app_rw";
--> statement-breakpoint

GRANT SELECT ON TABLE
  "plans",
  "theme_templates",
  "reserved_slugs"
TO "app_rw";
--> statement-breakpoint

GRANT ALL ON TABLE
  "quota_definitions",
  "tenant_size_tiers",
  "tenant_quota_overrides",
  "quota_events",
  "plans",
  "subscriptions",
  "platform_invoices",
  "platform_audit_logs",
  "theme_templates",
  "signup_leads",
  "slug_reservations",
  "reserved_slugs",
  "onboarding_progress",
  "tenant_owner_invites"
TO "app_platform";
