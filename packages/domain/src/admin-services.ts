import { schema, withTenant } from "@bs/db";
import type { Runtime } from "./runtime.ts";
import { assertPermission, type TenantContext } from "./context.ts";

export interface MembershipRecord {
  id: string;
  userId: string;
  roleId: string;
  status: string;
  createdAt?: string | undefined;
}

export interface StaffInvitationRecord {
  id: string;
  email: string;
  roleId: string;
  expiresAt?: string | undefined;
}

export interface StoreSettingsRecord {
  tenantId: string;
  storeName: string;
  currency: string;
  timezone: string;
}

export interface FeatureFlagItemRecord {
  key: string;
  enabled: boolean;
}

/**
 * Lists memberships for the current tenant (PLAN §4, §5.3).
 * Always executed within withTenant().
 */
export async function listMemberships(
  rt: Runtime,
  ctx: TenantContext,
): Promise<MembershipRecord[]> {
  assertPermission(ctx, "staff.manage");
  const db = rt._db.db;
  return withTenant(db, ctx.tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: schema.memberships.id,
        userId: schema.memberships.userId,
        roleId: schema.memberships.roleId,
        status: schema.memberships.status,
        createdAt: schema.memberships.createdAt,
      })
      .from(schema.memberships);

    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      roleId: r.roleId,
      status: r.status,
      createdAt: r.createdAt ? r.createdAt.toISOString() : undefined,
    }));
  });
}

/**
 * Creates a staff invitation for the current tenant (PLAN §5.3).
 * Always executed within withTenant().
 */
export async function inviteStaff(
  rt: Runtime,
  ctx: TenantContext,
  input: { email: string; roleId: string },
): Promise<StaffInvitationRecord> {
  assertPermission(ctx, "staff.manage");
  const db = rt._db.db;
  return withTenant(db, ctx.tenantId, async (tx) => {
    const tokenHash = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const [row] = await tx
      .insert(schema.staffInvitations)
      .values({
        tenantId: ctx.tenantId,
        email: input.email,
        roleId: input.roleId,
        tokenHash,
        expiresAt,
      })
      .returning();

    if (!row) {
      throw new Error("Failed to create staff invitation");
    }

    return {
      id: row.id,
      email: row.email,
      roleId: row.roleId,
      expiresAt: row.expiresAt ? row.expiresAt.toISOString() : undefined,
    };
  });
}

/**
 * Gets store settings for current tenant (PLAN §5.4).
 * Always executed within withTenant().
 */
export async function getStoreSettings(
  rt: Runtime,
  ctx: TenantContext,
): Promise<StoreSettingsRecord> {
  assertPermission(ctx, "settings.write");
  const db = rt._db.db;
  return withTenant(db, ctx.tenantId, async (tx) => {
    const rows = await tx
      .select({
        tenantId: schema.storeSettings.tenantId,
        storeName: schema.storeSettings.storeName,
        currency: schema.storeSettings.currency,
        timezone: schema.storeSettings.timezone,
      })
      .from(schema.storeSettings)
      .limit(1);

    const r = rows[0];
    if (!r) {
      return {
        tenantId: ctx.tenantId,
        storeName: "Default Store",
        currency: "NPR",
        timezone: "Asia/Kathmandu",
      };
    }

    return {
      tenantId: r.tenantId ?? ctx.tenantId,
      storeName: r.storeName,
      currency: r.currency,
      timezone: r.timezone,
    };
  });
}

/**
 * Updates or initializes store settings for current tenant (PLAN §5.4).
 * Always executed within withTenant().
 */
export async function updateStoreSettings(
  rt: Runtime,
  ctx: TenantContext,
  input: { storeName?: string | undefined; currency?: string | undefined; timezone?: string | undefined },
): Promise<StoreSettingsRecord> {
  assertPermission(ctx, "settings.write");
  const db = rt._db.db;
  return withTenant(db, ctx.tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(schema.storeSettings)
      .limit(1);

    if (rows.length === 0) {
      const [created] = await tx
        .insert(schema.storeSettings)
        .values({
          tenantId: ctx.tenantId,
          storeName: input.storeName ?? "Default Store",
          currency: input.currency ?? "NPR",
          timezone: input.timezone ?? "Asia/Kathmandu",
        })
        .returning();

      if (!created) {
        throw new Error("Failed to initialize store settings");
      }
      return {
        tenantId: created.tenantId ?? ctx.tenantId,
        storeName: created.storeName,
        currency: created.currency,
        timezone: created.timezone,
      };
    }

    const [updated] = await tx
      .update(schema.storeSettings)
      .set({
        ...(input.storeName ? { storeName: input.storeName } : {}),
        ...(input.currency ? { currency: input.currency } : {}),
        ...(input.timezone ? { timezone: input.timezone } : {}),
        updatedAt: new Date(),
      })
      .returning();

    if (!updated) {
      throw new Error("Failed to update store settings");
    }

    return {
      tenantId: updated.tenantId ?? ctx.tenantId,
      storeName: updated.storeName,
      currency: updated.currency,
      timezone: updated.timezone,
    };
  });
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
