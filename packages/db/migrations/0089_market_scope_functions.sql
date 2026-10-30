-- Market scope for storefront reads (ADR-040). The storefront sets the transaction-local setting app.market_id (never the
-- admin), and these functions let any SQL read the market's price and respect the market's catalog without every query
-- being rewritten. With the setting empty (admin, worker, the base market) they return the variant's own price and every
-- product, so nothing changes for existing paths.
CREATE OR REPLACE FUNCTION market_variant_price(p_tenant uuid, p_variant uuid, p_base bigint) RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    (SELECT mp.price FROM market_prices mp
      WHERE mp.tenant_id = p_tenant AND mp.variant_id = p_variant
        AND mp.market_id = nullif(current_setting('app.market_id', true), '')::uuid),
    p_base)
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION market_product_visible(p_tenant uuid, p_product uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN nullif(current_setting('app.market_id', true), '') IS NULL THEN true
    ELSE NOT (
      (
        (SELECT m.catalog_mode FROM markets m
          WHERE m.tenant_id = p_tenant AND m.id = nullif(current_setting('app.market_id', true), '')::uuid) = 'selected'
        AND NOT EXISTS (SELECT 1 FROM market_products mp
          WHERE mp.tenant_id = p_tenant AND mp.market_id = nullif(current_setting('app.market_id', true), '')::uuid
            AND mp.product_id = p_product AND mp.published)
      )
      OR EXISTS (SELECT 1 FROM market_products mp
          WHERE mp.tenant_id = p_tenant AND mp.market_id = nullif(current_setting('app.market_id', true), '')::uuid
            AND mp.product_id = p_product AND NOT mp.published)
    )
  END
$$;
--> statement-breakpoint
-- A product hidden from the shopper's market is invisible to every storefront query in that transaction.
CREATE POLICY "market_visibility" ON "products" AS RESTRICTIVE FOR SELECT TO public USING (market_product_visible(tenant_id, id));
