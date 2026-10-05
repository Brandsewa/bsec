import { schema, type Db } from "@bs/db";

/**
 * Turns settings-rebuild flags on for one test tenant (they seed default-off, ADR-011). Needs a connection that
 * can write the tenant table without a tenant context: the platform role, or a superuser.
 */
export async function enableTenantFlags(db: Db, tenantId: string, keys: readonly string[]): Promise<void> {
  for (const key of keys) {
    await db
      .insert(schema.tenantFeatureOverrides)
      .values({ tenantId, key, enabled: true, reason: "test" })
      .onConflictDoUpdate({
        target: [schema.tenantFeatureOverrides.tenantId, schema.tenantFeatureOverrides.key],
        set: { enabled: true },
      });
  }
}
