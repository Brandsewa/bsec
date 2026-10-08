ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "archived_by" uuid;
CREATE INDEX IF NOT EXISTS "orders_tenant_archived_at_idx" ON "orders" USING btree ("tenant_id", "archived_at");
