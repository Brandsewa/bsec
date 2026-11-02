-- bcom.si's own content lives under one internal tenant (ADR-042). Expand step: a defaulted column, existing rows are stores.
ALTER TABLE "tenants" ADD COLUMN "kind" text DEFAULT 'store' NOT NULL;
--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_kind_check" CHECK ("kind" IN ('store', 'platform_site'));
--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_one_platform_site_uniq" ON "tenants" ("kind") WHERE "kind" = 'platform_site';
--> statement-breakpoint
INSERT INTO "reserved_slugs" ("slug", "reason") VALUES ('bcom-platform-site', 'Reserved for the platform website record') ON CONFLICT DO NOTHING;
