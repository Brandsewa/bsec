import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";
import { invalidateCache } from "../cache-invalidation.ts";
import { parseStoreConfig } from "./store-config.ts";
import {
  parseCheckoutSettings,
  type CheckoutSettingsConfig,
} from "./checkout-config.ts";
import { readCustomerAccountSettingsInternal } from "./customer-account-settings.ts";

export interface UpdateCheckoutSettingsInput {
  guestCheckout?: boolean | undefined;
  accountCreation?: "none" | "after_completed_order" | undefined;
  phoneRequired?: boolean | undefined;
  addressLine2?: "hidden" | "optional" | undefined;
  companyName?: "hidden" | "optional" | undefined;
  marketingEmail?: {
    enabled: boolean;
    label: string;
  } | undefined;
  termsConsent?: {
    enabled: boolean;
  } | undefined;
  abandoned?: {
    detectAfterMinutes: number;
    recoveryEnabled: boolean;
    steps: Array<{ delayHours: number }>;
  } | undefined;
  expectedUpdatedAt?: string | undefined;
}

/**
 * Gets checkout settings for the store.
 */
export async function getCheckoutSettings(
  rt: Runtime,
  ctx: TenantContext,
): Promise<CheckoutSettingsConfig> {
  assertPermission(ctx, "settings.read");
  return await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [row] = await tx
      .select({ checkout: schema.storeSettings.checkout, updatedAt: schema.storeSettings.updatedAt })
      .from(schema.storeSettings)
      .where(eq(schema.storeSettings.tenantId, ctx.tenantId))
      .limit(1);

    return parseCheckoutSettings(row?.checkout, row?.updatedAt);
  });
}

/**
 * Updates checkout settings for the store.
 * Enforces:
 * 1. `checkout.manage` permission
 * 2. Optimistic concurrency (expectedUpdatedAt)
 * 3. Invariant: Phone number is required when COD is enabled
 * 4. Invariant: Guest checkout cannot be disabled if all customer sign-in methods are disabled
 * 5. Preserves untouched `cod` and `tax` keys in `store_settings.checkout`
 * 6. Audit logging with before/after diff
 */
export async function updateCheckoutSettings(
  rt: Runtime,
  ctx: TenantContext,
  input: UpdateCheckoutSettingsInput,
): Promise<CheckoutSettingsConfig> {
  assertPermission(ctx, "checkout.manage");

  const updatedConfig = await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [row] = await tx
      .select({ id: schema.storeSettings.id, checkout: schema.storeSettings.checkout, updatedAt: schema.storeSettings.updatedAt })
      .from(schema.storeSettings)
      .where(eq(schema.storeSettings.tenantId, ctx.tenantId))
      .limit(1);

    if (!row) {
      throw new Error("Store settings not found for this tenant");
    }

    // 1. Optimistic concurrency
    if (input.expectedUpdatedAt && row.updatedAt.toISOString() !== input.expectedUpdatedAt) {
      throw new Error("Conflict: Checkout settings were updated by someone else. Please reload.");
    }

    const currentParsed = parseCheckoutSettings(row.checkout, row.updatedAt);
    const storeConfig = parseStoreConfig(row.checkout);

    // 2. Invariant: phoneRequired=false is forbidden when COD is enabled
    const effectivePhoneRequired = input.phoneRequired !== undefined ? input.phoneRequired : currentParsed.phoneRequired;
    if (!effectivePhoneRequired && storeConfig.cod.enabled) {
      throw new Error("Bad Request: Phone number is required when Cash on Delivery (COD) is enabled for delivery coordination.");
    }

    // 3. Invariant: guestCheckout=false requires at least one enabled customer sign-in method
    const effectiveGuestCheckout = input.guestCheckout !== undefined ? input.guestCheckout : currentParsed.guestCheckout;
    if (!effectiveGuestCheckout) {
      const acctSettings = await readCustomerAccountSettingsInternal(tx, ctx.tenantId);
      if (!acctSettings.emailPasswordEnabled && !acctSettings.phoneOtpEnabled) {
        throw new Error("Bad Request: Cannot disable guest checkout when all customer sign-in methods are disabled. Enable at least one sign-in method first.");
      }
    }

    // 4. Merge new values, preserving legacy `cod` and `tax` keys
    const rawCheckout = (row.checkout && typeof row.checkout === "object" ? row.checkout : {}) as Record<string, unknown>;

    const nextMarketing = input.marketingEmail
      ? {
          enabled: input.marketingEmail.enabled,
          label: input.marketingEmail.label.trim().slice(0, 120),
        }
      : currentParsed.marketingEmail;

    const nextAbandoned = input.abandoned
      ? {
          detectAfterMinutes: Math.max(15, Math.min(10080, Math.round(input.abandoned.detectAfterMinutes))),
          recoveryEnabled: input.abandoned.recoveryEnabled,
          steps: [...input.abandoned.steps]
            .filter((s) => s.delayHours >= 1 && s.delayHours <= 720)
            .sort((a, b) => a.delayHours - b.delayHours)
            .slice(0, 3)
            .map((s) => ({ delayHours: Math.round(s.delayHours) })),
        }
      : currentParsed.abandoned;

    const nextTermsConsent = input.termsConsent
      ? {
          enabled: input.termsConsent.enabled,
        }
      : currentParsed.termsConsent;

    // Allowed to enable terms consent only when terms policy is published
    if (nextTermsConsent?.enabled) {
      const [termsPolicy] = await tx
        .select({ publishedVersionId: schema.storePolicies.publishedVersionId })
        .from(schema.storePolicies)
        .where(
          and(
            eq(schema.storePolicies.tenantId, ctx.tenantId),
            eq(schema.storePolicies.handle, "terms"),
          ),
        )
        .limit(1);

      if (!termsPolicy?.publishedVersionId) {
        throw new Error(
          "Precondition: Cannot require Terms of Service agreement at checkout: No Terms of Service policy has been published yet. Please publish your Terms policy in Settings > Policies first.",
        );
      }
    }

    const mergedCheckout: Record<string, unknown> = {
      ...rawCheckout,
      v: 1,
      guestCheckout: effectiveGuestCheckout,
      accountCreation: input.accountCreation !== undefined ? input.accountCreation : currentParsed.accountCreation,
      phoneRequired: effectivePhoneRequired,
      addressLine2: input.addressLine2 !== undefined ? input.addressLine2 : currentParsed.addressLine2,
      companyName: input.companyName !== undefined ? input.companyName : currentParsed.companyName,
      marketingEmail: nextMarketing,
      termsConsent: nextTermsConsent,
      abandoned: nextAbandoned,
    };

    const now = new Date();

    await tx
      .update(schema.storeSettings)
      .set({
        checkout: mergedCheckout,
        updatedAt: now,
      })
      .where(eq(schema.storeSettings.id, row.id));

    // Build audit diff
    const diff: Record<string, { before: unknown; after: unknown }> = {};
    if (effectiveGuestCheckout !== currentParsed.guestCheckout) {
      diff.guestCheckout = { before: currentParsed.guestCheckout, after: effectiveGuestCheckout };
    }
    if (input.accountCreation !== undefined && input.accountCreation !== currentParsed.accountCreation) {
      diff.accountCreation = { before: currentParsed.accountCreation, after: input.accountCreation };
    }
    if (effectivePhoneRequired !== currentParsed.phoneRequired) {
      diff.phoneRequired = { before: currentParsed.phoneRequired, after: effectivePhoneRequired };
    }
    if (input.addressLine2 !== undefined && input.addressLine2 !== currentParsed.addressLine2) {
      diff.addressLine2 = { before: currentParsed.addressLine2, after: input.addressLine2 };
    }
    if (input.companyName !== undefined && input.companyName !== currentParsed.companyName) {
      diff.companyName = { before: currentParsed.companyName, after: input.companyName };
    }
    if (input.marketingEmail) {
      diff.marketingEmail = { before: currentParsed.marketingEmail, after: nextMarketing };
    }
    if (input.abandoned) {
      diff.abandoned = { before: currentParsed.abandoned, after: nextAbandoned };
    }

    if (Object.keys(diff).length > 0) {
      await tx.insert(schema.auditLogs).values({
        tenantId: ctx.tenantId,
        actorType: ctx.actor.type === "staff" ? "staff" : "system",
        actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
        action: "checkout_settings.update",
        targetType: "store_settings",
        targetId: row.id,
        diff,
      });
    }

    return parseCheckoutSettings(mergedCheckout, now);
  });

  await invalidateCache(rt, ctx, { type: "store_or_seo_updated" });

  return updatedConfig;
}

export interface StorefrontCheckoutConsent {
  /** The shopper must tick the terms box (it also covers order emails); the server refuses the order otherwise. */
  termsRequired: boolean;
  /** Optional, unticked-by-default marketing box; absent when the store has not turned it on. */
  marketing: { label: string } | null;
}

/** The consent options the checkout page shows, read by tenant id because shoppers have no staff context. */
export async function getStorefrontCheckoutConsent(rt: Runtime, tenantId: string): Promise<StorefrontCheckoutConsent> {
  return await withTenant(rt._db.db, tenantId, async (tx) => {
    const [row] = await tx
      .select({ checkout: schema.storeSettings.checkout })
      .from(schema.storeSettings)
      .where(eq(schema.storeSettings.tenantId, tenantId))
      .limit(1);
    const s = parseCheckoutSettings(row?.checkout);
    return {
      termsRequired: s.termsConsent?.enabled === true,
      marketing: s.marketingEmail.enabled ? { label: s.marketingEmail.label } : null,
    };
  });
}
