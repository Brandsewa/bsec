-- One-off data fix: a store that authorised its payment mandate while a free-months coupon covered it, but is stuck on
-- "Activate your store" because payment_required was never cleared (fixed in code by fix/activation-free-period).
-- Run as app_owner, by hand, after the owner's yes. Usage (interactive psql):
--   psql "$DATABASE_URL_OWNER" -v store_name='<exact store name>'   then   \i scripts/one-off/2026-10-26-clear-payment-required.sql
BEGIN;

-- Preview: exactly one row must come back, with authorized_at set and an unexpired free_months promotion.
SELECT t.id AS tenant_id, t.slug, s.id AS subscription_id, s.status, s.payment_required, s.authorized_at, p.ends_at AS free_period_ends
FROM tenants t
JOIN subscriptions s ON s.tenant_id = t.id
LEFT JOIN tenant_promotions p ON p.tenant_id = t.id AND p.kind = 'free_months' AND p.status = 'active' AND p.ends_at > now()
WHERE t.name = :'store_name' AND s.payment_required = true AND s.authorized_at IS NOT NULL;

WITH target AS (
  SELECT s.id
  FROM tenants t
  JOIN subscriptions s ON s.tenant_id = t.id
  WHERE t.name = :'store_name' AND s.payment_required = true AND s.authorized_at IS NOT NULL
    AND EXISTS (SELECT 1 FROM tenant_promotions p WHERE p.tenant_id = t.id AND p.kind = 'free_months' AND p.status = 'active' AND p.ends_at > now())
), upd AS (
  UPDATE subscriptions SET payment_required = false, updated_at = now() WHERE id IN (SELECT id FROM target) RETURNING id
)
SELECT count(*) AS rows_updated FROM upd;

-- Deliberately no COMMIT: run this file in an interactive psql session (\i), read rows_updated, then type COMMIT; if it is 1,
-- or ROLLBACK; if not. Run non-interactively with -f it rolls back and changes nothing.
