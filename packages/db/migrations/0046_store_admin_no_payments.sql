-- store_admin never holds payments.manage (owner decision 2026-10-04, ADR-020): the seeded role was created with the
-- full permission list, so Managers could change COD and credentials. Data fix only, no schema change.
-- roles is a tenant table under forced RLS, so visit each tenant under its own context.
DO $$
DECLARE
  t uuid;
BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', t::text, true);
    UPDATE roles
    SET permissions = array_remove(permissions, 'payments.manage'), updated_at = now()
    WHERE tenant_id = t AND name = 'store_admin' AND is_system = true AND 'payments.manage' = ANY (permissions);
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END $$;
