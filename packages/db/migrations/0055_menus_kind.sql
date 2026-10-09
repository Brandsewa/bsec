ALTER TABLE "menus" ADD COLUMN "kind" text DEFAULT 'navigation' NOT NULL;
CREATE INDEX IF NOT EXISTS "menus_tenant_kind_idx" ON "menus" ("tenant_id", "kind");
