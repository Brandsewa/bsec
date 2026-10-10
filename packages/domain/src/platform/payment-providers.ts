import { asc, eq, sql } from "drizzle-orm";
import { schema } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import {
  assertPlatformStaff,
  assertRoleAtLeast,
  writePlatformAudit,
  type AuditMeta,
} from "../platform-services.ts";

export const PAYMENT_PROVIDER_IDS = ["razorpay", "stripe"] as const;
export type PaymentProviderId = (typeof PAYMENT_PROVIDER_IDS)[number];

export interface PlatformPaymentProviderView {
  provider: PaymentProviderId;
  displayName: string;
  enabled: boolean;
  liveModeAllowed: boolean;
  /** Stores that have saved keys for this provider. */
  connectedStores: number;
  /** Stores that have activated this provider. */
  activeStores: number;
  updatedAt: string;
}

/**
 * Lists the platform's payment providers with how many stores use each (ADMIN-IMPROVEMENTS-PLAN §6.4).
 * Platform tables are read with app_platform, which bypasses RLS, so the store counts span all tenants.
 */
export async function listPlatformPaymentProviders(
  rt: Runtime,
  platformStaffUserId: string,
): Promise<PlatformPaymentProviderView[]> {
  await assertPlatformStaff(rt, platformStaffUserId);
  const db = rt._db.db;
  const rows = await db
    .select()
    .from(schema.platformPaymentProviders)
    .orderBy(asc(schema.platformPaymentProviders.sort));

  const connected = await db.execute<{ provider: string; n: string }>(sql`
    SELECT provider, COUNT(DISTINCT tenant_id)::text AS n FROM tenant_secrets
    WHERE provider IN ('razorpay', 'stripe') GROUP BY provider;
  `);
  const active = await db.execute<{ provider: string; n: string }>(sql`
    SELECT provider, COUNT(DISTINCT tenant_id)::text AS n FROM payment_methods
    WHERE status = 'active' AND provider IN ('razorpay', 'stripe') GROUP BY provider;
  `);
  const connectedMap = new Map(connected.rows.map((r) => [r.provider, Number(r.n)]));
  const activeMap = new Map(active.rows.map((r) => [r.provider, Number(r.n)]));

  return rows.map((r) => ({
    provider: r.provider as PaymentProviderId,
    displayName: r.displayName,
    enabled: r.enabled,
    liveModeAllowed: r.liveModeAllowed,
    connectedStores: connectedMap.get(r.provider) ?? 0,
    activeStores: activeMap.get(r.provider) ?? 0,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

/**
 * Turns a provider on or off for the platform, and allows or blocks live mode for it.
 * Disabling never deletes store keys or touches in-flight payments: it only stops new connections,
 * activations and new payment intents (enforced in the store-side services).
 */
export async function updatePlatformPaymentProvider(
  rt: Runtime,
  platformStaffUserId: string,
  input: { provider: PaymentProviderId; enabled?: boolean | undefined; liveModeAllowed?: boolean | undefined },
  meta?: AuditMeta,
): Promise<{ ok: true }> {
  const staff = await assertPlatformStaff(rt, platformStaffUserId);
  assertRoleAtLeast(staff.role, "platform_admin", "change payment providers");

  return rt._db.db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(schema.platformPaymentProviders)
      .where(eq(schema.platformPaymentProviders.provider, input.provider))
      .for("update")
      .limit(1);
    if (!before) throw new Error(`Not Found: unknown payment provider "${input.provider}"`);

    const enabled = input.enabled ?? before.enabled;
    // Live mode only makes sense on an enabled provider; turning a provider off also closes the live switch.
    const liveModeAllowed = enabled ? (input.liveModeAllowed ?? before.liveModeAllowed) : false;

    await tx
      .update(schema.platformPaymentProviders)
      .set({ enabled, liveModeAllowed, updatedBy: platformStaffUserId, updatedAt: new Date() })
      .where(eq(schema.platformPaymentProviders.provider, input.provider));

    const action =
      enabled !== before.enabled
        ? enabled
          ? "payment_provider.enabled"
          : "payment_provider.disabled"
        : "payment_provider.live_mode_allowed";
    await writePlatformAudit(
      tx,
      platformStaffUserId,
      action,
      "payment_provider",
      input.provider,
      null,
      {
        before: { enabled: before.enabled, liveModeAllowed: before.liveModeAllowed },
        after: { enabled, liveModeAllowed },
      },
      meta,
    );
    return { ok: true as const };
  });
}
