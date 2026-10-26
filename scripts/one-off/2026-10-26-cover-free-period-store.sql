-- One-off data fix, second step after 2026-10-26-clear-payment-required.sql: a store that authorised its mandate under a free-months
-- coupon but was left `past_due` on the restricted XS tier (the zero-day trial lapsed). Puts it in the covered state the code now
-- produces: trialing until the coupon ends, past-due markers cleared, its plan's tier restored.
-- Run by hand after the owner's yes (interactive psql). Replace the store name; it only touches a store with an unexpired free_months coupon.
BEGIN;
SELECT t.slug, s.status, s.current_period_end, p.ends_at AS free_period_ends, pl.code AS plan, tst.tier
FROM tenants t JOIN subscriptions s ON s.tenant_id = t.id
JOIN tenant_promotions p ON p.tenant_id = t.id AND p.kind = 'free_months' AND p.status = 'active' AND p.ends_at > now()
LEFT JOIN plans pl ON pl.id = s.plan_id LEFT JOIN tenant_size_tiers tst ON tst.tenant_id = t.id
WHERE t.name = 'STORE NAME HERE' AND s.status = 'past_due' AND s.authorized_at IS NOT NULL;

UPDATE subscriptions s SET status = 'trialing', current_period_end = p.ends_at, past_due_since = NULL, dunning_stage = 0, payment_required = false, updated_at = now()
FROM tenants t, tenant_promotions p
WHERE s.tenant_id = t.id AND t.name = 'STORE NAME HERE' AND s.status = 'past_due' AND s.authorized_at IS NOT NULL
  AND p.tenant_id = t.id AND p.kind = 'free_months' AND p.status = 'active' AND p.ends_at > now();

UPDATE tenant_size_tiers tst SET tier = CASE pl.code WHEN 'pro' THEN 'L' WHEN 'growth' THEN 'M' ELSE 'S' END, updated_at = now()
FROM tenants t, subscriptions s, plans pl
WHERE tst.tenant_id = t.id AND t.name = 'STORE NAME HERE' AND s.tenant_id = t.id AND s.status = 'trialing' AND pl.id = s.plan_id;
-- Check the three results above, then COMMIT; (or ROLLBACK;).
