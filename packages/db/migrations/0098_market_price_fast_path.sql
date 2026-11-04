-- market_variant_price is called per variant inside catalog queries (price filters, sorting, price facets, listings). When no
-- market and no state scope the request, it now returns the variant's own price straight away instead of running three
-- lookups per variant, which every store pays on every listing. Identical results; the scoped path is unchanged.
-- Expand-only (a function replaced by an equivalent one).
CREATE OR REPLACE FUNCTION market_variant_price(p_tenant uuid, p_variant uuid, p_base bigint) RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN nullif(current_setting('app.market_id', true), '') IS NULL
      AND nullif(current_setting('app.price_region', true), '') IS NULL THEN p_base
    ELSE coalesce(
      CASE WHEN nullif(current_setting('app.market_id', true), '') IS NULL
        OR EXISTS (SELECT 1 FROM markets m WHERE m.tenant_id = p_tenant AND m.id = nullif(current_setting('app.market_id', true), '')::uuid AND m.is_base)
        THEN (SELECT sp.price FROM state_prices sp
          WHERE sp.tenant_id = p_tenant AND sp.variant_id = p_variant
            AND sp.state_code = nullif(current_setting('app.price_region', true), ''))
      END,
      (SELECT mp.price FROM market_prices mp
        WHERE mp.tenant_id = p_tenant AND mp.variant_id = p_variant
          AND mp.market_id = nullif(current_setting('app.market_id', true), '')::uuid),
      p_base)
  END
$$;
