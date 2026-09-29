import { schema, withTenant } from "@bs/db";
import type { Runtime } from "./runtime.ts";
import { assertPermission, type TenantContext } from "./context.ts";

export interface FeatureFlagItemRecord {
  key: string;
  enabled: boolean;
}

/**
 * Lists effective feature flags for current tenant (PLAN §5.1).
 * Evaluates global defaults against tenant overrides within withTenant().
 */
export async function listStoreFeatureFlags(
  rt: Runtime,
  ctx: TenantContext,
): Promise<FeatureFlagItemRecord[]> {
  assertPermission(ctx, "settings.write");
  const db = rt._db.db;
  return withTenant(db, ctx.tenantId, async (tx) => {
    const globalFlags = await tx
      .select({
        key: schema.featureFlags.key,
        defaultOn: schema.featureFlags.defaultOn,
        killSwitch: schema.featureFlags.killSwitch,
      })
      .from(schema.featureFlags);

    const overrides = await tx
      .select({
        key: schema.tenantFeatureOverrides.key,
        enabled: schema.tenantFeatureOverrides.enabled,
      })
      .from(schema.tenantFeatureOverrides);

    const overrideMap = new Map(overrides.map((o) => [o.key, o.enabled]));

    return globalFlags.map((flag) => {
      if (flag.killSwitch) {
        return { key: flag.key, enabled: false };
      }
      if (overrideMap.has(flag.key)) {
        return {
          key: flag.key,
          enabled: overrideMap.get(flag.key) ?? false,
        };
      }
      return { key: flag.key, enabled: flag.defaultOn };
    });
  });
}
