import { and, eq } from "drizzle-orm";
import { type Db, tenantSecrets, withTenant } from "@bs/db";
import { decryptSecret } from "@bs/payments";

export interface TenantPaymentCredentials {
  keyId?: string | undefined;
  keySecret?: string | undefined;
  webhookSecret?: string | undefined;
}

/**
 * Retrieves and decrypts payment credentials from tenant_secrets (PLAN §4, §11.5).
 * Falls back to environment variables when secrets are not yet configured in DB.
 */
export async function getTenantPaymentSecrets(
  db: Db,
  tenantId: string,
  provider: string,
): Promise<TenantPaymentCredentials> {
  const creds: TenantPaymentCredentials = {};

  try {
    const rows = await withTenant(db, tenantId, async (tx) => {
      return await tx
        .select({
          keyName: tenantSecrets.keyName,
          ciphertext: tenantSecrets.ciphertext,
          iv: tenantSecrets.iv,
        })
        .from(tenantSecrets)
        .where(
          and(
            eq(tenantSecrets.tenantId, tenantId),
            eq(tenantSecrets.provider, provider),
          ),
        );
    });

    for (const row of rows) {
      try {
        const decrypted = decryptSecret({ ciphertext: row.ciphertext, iv: row.iv });
        if (row.keyName === "key_id" || row.keyName === "keyId") {
          creds.keyId = decrypted;
        } else if (row.keyName === "key_secret" || row.keyName === "keySecret") {
          creds.keySecret = decrypted;
        } else if (row.keyName === "webhook_secret" || row.keyName === "webhookSecret") {
          creds.webhookSecret = decrypted;
        }
      } catch {
        // Skip un-decryptable or corrupted secret row
      }
    }
  } catch {
    // If table/tenant not found or error, proceed to fallback
  }

  // Fallbacks to environment variables if not present in DB
  if (provider === "razorpay") {
    if (!creds.keyId && process.env.RAZORPAY_KEY_ID) creds.keyId = process.env.RAZORPAY_KEY_ID;
    if (!creds.keySecret && process.env.RAZORPAY_KEY_SECRET) creds.keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!creds.webhookSecret && process.env.RAZORPAY_WEBHOOK_SECRET) creds.webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  } else if (provider === "cod") {
    if (!creds.webhookSecret && process.env.COD_WEBHOOK_SECRET) creds.webhookSecret = process.env.COD_WEBHOOK_SECRET;
  } else if (provider === "shiprocket") {
    if (!creds.keyId && process.env.SHIPROCKET_EMAIL) creds.keyId = process.env.SHIPROCKET_EMAIL;
    if (!creds.keySecret && process.env.SHIPROCKET_PASSWORD) creds.keySecret = process.env.SHIPROCKET_PASSWORD;
    if (!creds.webhookSecret && process.env.SHIPROCKET_WEBHOOK_SECRET) creds.webhookSecret = process.env.SHIPROCKET_WEBHOOK_SECRET;
  }

  return creds;
}
