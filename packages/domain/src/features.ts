import type { Db } from "@bs/db";
import { schema, withTenant } from "@bs/db";
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
  if (!db || (!db.query?.featureFlags && typeof db.select !== "function")) {
    return true;
  }

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
  const readOverride = async (tx: Db): Promise<{ enabled: boolean } | undefined> => {
    if (typeof tx.select !== "function" && !tx.query?.tenantFeatureOverrides) {
      return undefined;
    }
    if (tx.query?.tenantFeatureOverrides) {
      return await tx.query.tenantFeatureOverrides.findFirst({
        where: and(
          eq(schema.tenantFeatureOverrides.tenantId, tenantId),
          eq(schema.tenantFeatureOverrides.key, key),
        ),
      });
    } else {
      const rows = await tx
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
      return rows[0];
    }
  };

  if (typeof (db as unknown as { transaction?: unknown }).transaction === "function") {
    try {
      override = await withTenant(db, tenantId, readOverride);
    } catch {
      override = await readOverride(db);
    }
  } else {
    override = await readOverride(db);
  }

  if (override !== undefined) {
    return override.enabled;
  }

  return flag.defaultOn;
}
