-- Phase F: Primary category flag on product_categories with partial unique index per product
ALTER TABLE "product_categories" ADD COLUMN "is_primary" boolean DEFAULT false NOT NULL;

-- Backfill: the earliest-position row per product becomes primary
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY tenant_id, product_id ORDER BY position ASC, created_at ASC) as rn
  FROM "product_categories"
)
UPDATE "product_categories"
SET "is_primary" = true
WHERE id IN (SELECT id FROM ranked WHERE rn = 1);

-- Unique index ensuring at most one primary category per product per tenant
CREATE UNIQUE INDEX "product_categories_tenant_prod_primary_uniq" ON "product_categories" ("tenant_id", "product_id") WHERE "is_primary" = true;
