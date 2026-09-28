import type { Db } from "@bs/db";
import { schema } from "@bs/db";
import { and, eq } from "drizzle-orm";

/**
 * Resolves whether a feature flag is enabled for a specific tenant (PLAN §5.1, M1).
 * Resolution hierarchy:
 *  1. Kill switch on global feature_flags -> false
 *  2. Tenant-level override in tenant_feature_overrides -> override.enabled
 *  3. Global default_on in feature_flags -> flag.defaultOn
 *  4. Flag not found -> false
 */
export async function isFeatureEnabled(
  db: Db,
  tenantId: string,
  key: string,
): Promise<boolean> {
  let flag: { defaultOn: boolean; killSwitch: boolean } | undefined;

  if (db.query?.featureFlags) {
    flag = await db.query.featureFlags.findFirst({
      where: eq(schema.featureFlags.key, key),
    });
  } else {
    const rows = await db
      .select({
        defaultOn: schema.featureFlags.defaultOn,
        killSwitch: schema.featureFlags.killSwitch,
      })
      .from(schema.featureFlags)
      .where(eq(schema.featureFlags.key, key))
      .limit(1);
    flag = rows[0];
  }

  if (!flag || flag.killSwitch) {
    return false;
  }

  let override: { enabled: boolean } | undefined;
  if (db.query?.tenantFeatureOverrides) {
    override = await db.query.tenantFeatureOverrides.findFirst({
      where: and(
        eq(schema.tenantFeatureOverrides.tenantId, tenantId),
        eq(schema.tenantFeatureOverrides.key, key),
      ),
    });
  } else {
    const rows = await db
      .select({
        enabled: schema.tenantFeatureOverrides.enabled,
      })
      .from(schema.tenantFeatureOverrides)
      .where(
        and(
          eq(schema.tenantFeatureOverrides.tenantId, tenantId),
          eq(schema.tenantFeatureOverrides.key, key),
        ),
      )
      .limit(1);
    override = rows[0];
  }

  if (override !== undefined) {
    return override.enabled;
  }

  return flag.defaultOn;
}
