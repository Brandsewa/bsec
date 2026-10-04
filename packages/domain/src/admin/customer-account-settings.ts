import { eq } from "drizzle-orm";
import { schema, withTenant, type Db } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";
import { invalidateCache } from "../cache-invalidation.ts";

export interface CustomerAccountSettingsRecord {
  id: string;
  showSignInLinks: boolean;
  emailPasswordEnabled: boolean;
  phoneOtpEnabled: boolean;
  allowSelfServeReturns: boolean;
  allowSelfServeCancellation: boolean;
  version: number;
  updatedAt: string;
  createdAt: string;
}

export interface UpdateCustomerAccountSettingsInput {
  showSignInLinks?: boolean | undefined;
  emailPasswordEnabled?: boolean | undefined;
  phoneOtpEnabled?: boolean | undefined;
  allowSelfServeReturns?: boolean | undefined;
  allowSelfServeCancellation?: boolean | undefined;
  expectedVersion?: number | undefined;
}

export const DEFAULT_CUSTOMER_ACCOUNT_SETTINGS = {
  showSignInLinks: true,
  emailPasswordEnabled: true,
  phoneOtpEnabled: true,
  allowSelfServeReturns: true,
  allowSelfServeCancellation: false,
  version: 1,
};

/**
 * Internal reader for customer account settings.
 * If no row exists yet for this store, falls back to defaults preserving today's behavior.
 */
export async function readCustomerAccountSettingsInternal(
  tx: Db,
  tenantId: string,
): Promise<CustomerAccountSettingsRecord> {
  return await withTenant(tx, tenantId, async (tenantTx) => {
    const [existing] = await tenantTx
      .select()
      .from(schema.customerAccountSettings)
      .where(eq(schema.customerAccountSettings.tenantId, tenantId))
      .limit(1);

    if (!existing) {
      const now = new Date().toISOString();
      return {
        id: "default",
        showSignInLinks: DEFAULT_CUSTOMER_ACCOUNT_SETTINGS.showSignInLinks,
        emailPasswordEnabled: DEFAULT_CUSTOMER_ACCOUNT_SETTINGS.emailPasswordEnabled,
        phoneOtpEnabled: DEFAULT_CUSTOMER_ACCOUNT_SETTINGS.phoneOtpEnabled,
        allowSelfServeReturns: DEFAULT_CUSTOMER_ACCOUNT_SETTINGS.allowSelfServeReturns,
        allowSelfServeCancellation: DEFAULT_CUSTOMER_ACCOUNT_SETTINGS.allowSelfServeCancellation,
        version: DEFAULT_CUSTOMER_ACCOUNT_SETTINGS.version,
        updatedAt: now,
        createdAt: now,
      };
    }

    return {
      id: existing.id,
      showSignInLinks: existing.showSignInLinks,
      emailPasswordEnabled: existing.emailPasswordEnabled,
      phoneOtpEnabled: existing.phoneOtpEnabled,
      allowSelfServeReturns: existing.allowSelfServeReturns,
      allowSelfServeCancellation: existing.allowSelfServeCancellation,
      version: existing.version,
      updatedAt: existing.updatedAt.toISOString(),
      createdAt: existing.createdAt.toISOString(),
    };
  });
}

/**
 * Gets customer account settings for the store.
 */
export async function getCustomerAccountSettings(
  rt: Runtime,
  ctx: TenantContext,
): Promise<CustomerAccountSettingsRecord> {
  assertPermission(ctx, "settings.read");
  return await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    return await readCustomerAccountSettingsInternal(tx, ctx.tenantId);
  });
}

/**
 * Updates customer account settings for the store.
 * Enforces:
 * 1. `checkout.manage` permission
 * 2. Optimistic concurrency (expectedVersion)
 * 3. Invariant: At least one sign-in method must remain enabled (emailPasswordEnabled OR phoneOtpEnabled)
 * 4. Audit logging with before/after diff
 */
export async function updateCustomerAccountSettings(
  rt: Runtime,
  ctx: TenantContext,
  input: UpdateCustomerAccountSettingsInput,
): Promise<CustomerAccountSettingsRecord> {
  assertPermission(ctx, "checkout.manage");

  const updatedRecord = await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const before = await readCustomerAccountSettingsInternal(tx, ctx.tenantId);

    // 1. Optimistic concurrency
    if (input.expectedVersion !== undefined && before.version !== input.expectedVersion) {
      throw new Error("Conflict: Customer account settings were updated by someone else. Please reload.");
    }

    // 2. Invariant: At least one sign-in method must remain enabled
    const newEmail = input.emailPasswordEnabled !== undefined ? input.emailPasswordEnabled : before.emailPasswordEnabled;
    const newOtp = input.phoneOtpEnabled !== undefined ? input.phoneOtpEnabled : before.phoneOtpEnabled;
    if (!newEmail && !newOtp) {
      throw new Error("Bad Request: At least one customer sign-in method (Email & Password or Phone OTP) must remain enabled.");
    }

    const nextVersion = before.version + 1;
    const now = new Date();

    const [existing] = await tx
      .select({ id: schema.customerAccountSettings.id })
      .from(schema.customerAccountSettings)
      .where(eq(schema.customerAccountSettings.tenantId, ctx.tenantId))
      .limit(1);

    let targetId = existing?.id;

    if (existing) {
      await tx
        .update(schema.customerAccountSettings)
        .set({
          showSignInLinks: input.showSignInLinks !== undefined ? input.showSignInLinks : before.showSignInLinks,
          emailPasswordEnabled: newEmail,
          phoneOtpEnabled: newOtp,
          allowSelfServeReturns:
            input.allowSelfServeReturns !== undefined ? input.allowSelfServeReturns : before.allowSelfServeReturns,
          allowSelfServeCancellation:
            input.allowSelfServeCancellation !== undefined
              ? input.allowSelfServeCancellation
              : before.allowSelfServeCancellation,
          version: nextVersion,
          updatedAt: now,
        })
        .where(eq(schema.customerAccountSettings.id, existing.id));
    } else {
      const [inserted] = await tx
        .insert(schema.customerAccountSettings)
        .values({
          tenantId: ctx.tenantId,
          showSignInLinks: input.showSignInLinks !== undefined ? input.showSignInLinks : before.showSignInLinks,
          emailPasswordEnabled: newEmail,
          phoneOtpEnabled: newOtp,
          allowSelfServeReturns:
            input.allowSelfServeReturns !== undefined ? input.allowSelfServeReturns : before.allowSelfServeReturns,
          allowSelfServeCancellation:
            input.allowSelfServeCancellation !== undefined
              ? input.allowSelfServeCancellation
              : before.allowSelfServeCancellation,
          version: nextVersion,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: schema.customerAccountSettings.id });
      targetId = inserted?.id;
    }

    // Build audit diff
    const diff: Record<string, { before: unknown; after: unknown }> = {};
    const fieldsToTrack = [
      "showSignInLinks",
      "emailPasswordEnabled",
      "phoneOtpEnabled",
      "allowSelfServeReturns",
      "allowSelfServeCancellation",
    ] as const;

    for (const f of fieldsToTrack) {
      if (input[f] !== undefined && input[f] !== before[f]) {
        diff[f] = { before: before[f], after: input[f] };
      }
    }

    if (Object.keys(diff).length > 0) {
      await tx.insert(schema.auditLogs).values({
        tenantId: ctx.tenantId,
        actorType: ctx.actor.type === "staff" ? "staff" : "system",
        actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
        action: "customer_account_settings.update",
        targetType: "customer_account_settings",
        targetId: targetId ?? ctx.tenantId,
        diff,
      });
    }

    return await readCustomerAccountSettingsInternal(tx, ctx.tenantId);
  });

  await invalidateCache(rt, ctx, { type: "store_or_seo_updated" });

  return updatedRecord;
}
