-- Friendly ids (owner decision 2026-10-17): products show as BCPID-<n> (per store), stores as BCSID-<nnnn> (platform wide).
-- Expand only: both columns are additive. Numbers are assigned by the domain layer; existing rows are backfilled
-- in creation order here.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "product_number" integer;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "store_number" integer;
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS "tenants_store_number_seq";
--> statement-breakpoint
UPDATE "tenants" t SET "store_number" = n.rn FROM (SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn FROM "tenants") n WHERE t.id = n.id AND t."store_number" IS NULL;
--> statement-breakpoint
SELECT setval('tenants_store_number_seq', COALESCE((SELECT max("store_number") FROM "tenants"), 0) + 1, false);
--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "store_number" SET DEFAULT nextval('tenants_store_number_seq');
--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "store_number" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_store_number_uniq" UNIQUE ("store_number");
--> statement-breakpoint
DO $$
DECLARE r text;
BEGIN
  -- app_saas only exists where self-service signup is configured.
  FOREACH r IN ARRAY ARRAY['app_rw','app_platform','app_saas'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE tenants_store_number_seq TO %I', r);
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT id FROM "tenants" LOOP
    -- products is FORCE ROW LEVEL SECURITY: scope this transaction to one tenant at a time.
    PERFORM set_config('app.tenant_id', t.id::text, true);
    WITH n AS (
      SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn FROM "products" WHERE tenant_id = t.id
    )
    UPDATE "products" p SET "product_number" = n.rn FROM n WHERE p.id = n.id AND p."product_number" IS NULL;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "products_tenant_number_uniq" ON "products" ("tenant_id","product_number");
