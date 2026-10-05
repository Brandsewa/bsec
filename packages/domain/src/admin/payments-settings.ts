import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import { decryptSecret, encryptSecret, isEncryptionKeyConfigured } from "@bs/payments";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";
import { readStoreConfig } from "./store-config.ts";
import {
  getTenantPaymentMethods,
  parseCodPublicConfig,
  hasEnabledPaymentAdapter,
} from "./payment-methods.ts";

export interface PaymentsStatusRecord {
  razorpay: { configured: boolean; keyIdHint: string | null; hasWebhookSecret: boolean };
  cod: { enabled: boolean; feePaise: number };
  encryptionKeyConfigured: boolean;
}

const RAZORPAY_KEY_ID = /^rzp_(test|live)_[A-Za-z0-9]{6,}$/;

/**
 * Whether shoppers can pay online. Creating a real Razorpay order at checkout is not built yet (the order gets a
 * placeholder id), so offering it would send a customer to a payment that cannot complete. Flip this to true when
 * checkout creates real Razorpay orders with the store's own keys.
 */
export const ONLINE_PAYMENT_AVAILABLE = false;

export interface StorefrontPaymentOptions {
  cod: {
    enabled: boolean;
    feePaise: number;
    minOrderPaise?: number | null | undefined;
    maxOrderPaise?: number | null | undefined;
  };
  online: { available: boolean };
}

/** The payment methods a shopper may choose at this store's checkout (no secrets, no permission needed). */
export async function getStorefrontPaymentOptions(rt: Runtime, tenantId: string): Promise<StorefrontPaymentOptions> {
  const methods = await withTenant(rt._db.db, tenantId, (tx) => getTenantPaymentMethods(tx, tenantId));
  const codMethod = methods.find((m) => m.provider === "cod");
  const codCfg = parseCodPublicConfig(codMethod?.publicConfig);
  const codEnabled = codMethod ? codMethod.status === "active" : true;

  // Online payment is available only if an active adapter exists in the registry AND the method is active
  const razorpayMethod = methods.find((m) => m.provider === "razorpay");
  const onlineAvailable = Boolean(razorpayMethod && razorpayMethod.status === "active" && hasEnabledPaymentAdapter("razorpay"));

  return {
    cod: {
      enabled: codEnabled,
      feePaise: codCfg.feePaise,
      minOrderPaise: codCfg.minOrderPaise,
      maxOrderPaise: codCfg.maxOrderPaise,
    },
    online: { available: onlineAvailable },
  };
}

/**
 * Payment setup as shown in Settings > Payments. Secrets are write-only: this returns whether they are
 * set and a short hint of the public key id, never the secret values.
 */
export async function getPaymentsStatus(rt: Runtime, ctx: TenantContext): Promise<PaymentsStatusRecord> {
  assertPermission(ctx, "settings.write");
  return withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const rows = await tx
      .select({ keyName: schema.tenantSecrets.keyName, ciphertext: schema.tenantSecrets.ciphertext, iv: schema.tenantSecrets.iv })
      .from(schema.tenantSecrets)
      .where(eq(schema.tenantSecrets.provider, "razorpay"));
    const byName = new Map(rows.map((r) => [r.keyName, r]));
    const keyRow = byName.get("key_id");
    let keyIdHint: string | null = null;
    if (keyRow) {
      try {
        const plain = decryptSecret({ ciphertext: keyRow.ciphertext, iv: keyRow.iv });
        keyIdHint = `…${plain.slice(-4)}`;
      } catch {
        keyIdHint = null;
      }
    }
    const cfg = await readStoreConfig(tx);
    return {
      razorpay: { configured: byName.has("key_id") && byName.has("key_secret"), keyIdHint, hasWebhookSecret: byName.has("webhook_secret") },
      cod: cfg.cod,
      encryptionKeyConfigured: isEncryptionKeyConfigured(),
    };
  });
}

/** Stores the store's own Razorpay credentials, encrypted (AES-256-GCM) in tenant_secrets. */
export async function saveRazorpayCredentials(
  rt: Runtime,
  ctx: TenantContext,
  input: { keyId: string; keySecret: string; webhookSecret?: string | undefined },
): Promise<PaymentsStatusRecord> {
  assertPermission(ctx, "payments.manage");
  if (!RAZORPAY_KEY_ID.test(input.keyId)) {
    throw new Error("Bad Request: Razorpay key id should look like rzp_test_XXXX or rzp_live_XXXX");
  }
  const entries: Array<[string, string]> = [
    ["key_id", input.keyId],
    ["key_secret", input.keySecret],
    ...(input.webhookSecret ? ([["webhook_secret", input.webhookSecret]] as Array<[string, string]>) : []),
  ];
  let encrypted: Array<{ keyName: string; ciphertext: string; iv: string; keyVersion: number }>;
  try {
    encrypted = entries.map(([keyName, value]) => ({ keyName, ...encryptSecret(value) }));
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Encryption key not set")) {
      throw new Error(
        "Precondition: credentials cannot be saved yet because the server has no encryption key. Ask the platform operator to set TENANT_SECRETS_KEY.",
        { cause: err },
      );
    }
    throw err;
  }
  const updatedBy = ctx.actor.type === "staff" ? ctx.actor.userId : null;
  await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    for (const e of encrypted) {
      await tx
        .insert(schema.tenantSecrets)
        .values({ tenantId: ctx.tenantId, provider: "razorpay", keyName: e.keyName, ciphertext: e.ciphertext, iv: e.iv, keyVersion: e.keyVersion, updatedBy })
        .onConflictDoUpdate({
          target: [schema.tenantSecrets.tenantId, schema.tenantSecrets.provider, schema.tenantSecrets.keyName],
          set: { ciphertext: e.ciphertext, iv: e.iv, keyVersion: e.keyVersion, updatedBy, updatedAt: new Date() },
        });
    }
    // Audit says that credentials changed and in which mode, never a value (AGENTS.md rule 7).
    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: "staff",
      actorId: updatedBy,
      action: "razorpay_credentials.saved",
      targetType: "tenant_secrets",
      targetId: ctx.tenantId,
      diff: {
        mode: { before: null, after: input.keyId.startsWith("rzp_live_") ? "live" : "test" },
        webhookConfigured: { before: null, after: Boolean(input.webhookSecret) },
      },
    });
  });
  return getPaymentsStatus(rt, ctx);
}

export async function clearRazorpayCredentials(rt: Runtime, ctx: TenantContext): Promise<PaymentsStatusRecord> {
  assertPermission(ctx, "payments.manage");
  await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    await tx
      .delete(schema.tenantSecrets)
      .where(and(eq(schema.tenantSecrets.tenantId, ctx.tenantId), eq(schema.tenantSecrets.provider, "razorpay")));
    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: "staff",
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "razorpay_credentials.cleared",
      targetType: "tenant_secrets",
      targetId: ctx.tenantId,
      diff: { credentials: { before: "set", after: "cleared" } },
    });
  });
  return getPaymentsStatus(rt, ctx);
}
