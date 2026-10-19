import { eq } from "drizzle-orm";
import { schema, type Db } from "@bs/db";
import { encryptSecret, decryptSecret, CashfreeProvider } from "@bs/payments";
import type { Runtime } from "../runtime.ts";
import { assertPlatformStaff, assertRoleAtLeast, writePlatformAudit, type AuditMeta } from "../platform-services.ts";

/**
 * Platform billing credentials (ADR-036): the platform's own Razorpay account for charging merchants. Separate from every
 * store's payment keys (ADR-014 points 2 and 3 still hold). Secrets are encrypted at rest and never returned.
 */

export type BillingMode = "test" | "live";
/** The gateway new subscriptions are created on (ADR-037). Subscriptions already created stay on their own gateway. */
export type BillingProviderId = "razorpay" | "cashfree";
export const BILLING_PROVIDER_IDS: readonly BillingProviderId[] = ["razorpay", "cashfree"];

type BillingRow = typeof schema.platformBillingSettings.$inferSelect;

export interface BillingKeySetView {
  keyId: string | null;
  secretConfigured: boolean;
  secretLastFour: string | null;
  webhookSecretConfigured: boolean;
}

export interface InvoiceProfile {
  legalName: string | null;
  address: string | null;
  /** The state the platform is registered in (decides CGST and SGST versus IGST). */
  state: string | null;
  gstin: string | null;
  /** Service accounting code, shown on the invoice when set. */
  sac: string | null;
  /** Tax rate in basis points (1800 = 18%). The plan price is quoted inclusive of it. */
  gstRateBps: number;
}

export interface PlatformBillingSettingsView {
  provider: BillingProviderId;
  mode: BillingMode;
  enabled: boolean;
  graceDays: number;
  test: BillingKeySetView;
  live: BillingKeySetView;
  /** Cashfree App ID and secret per mode (its webhooks are signed with the secret, so no webhook secret). */
  cashfree: { test: BillingKeySetView; live: BillingKeySetView };
  invoice: InvoiceProfile;
  /** Where Razorpay must send subscription events (set it in the Razorpay dashboard for the matching mode). */
  webhookUrl: string;
  /** Where Cashfree must send subscription events (Cashfree dashboard, Developers, Webhooks). */
  cashfreeWebhookUrl: string;
  /** True while the keys come from the server environment because none are saved here (ADR-014 fallback). */
  usingEnvFallback: boolean;
  lastTestAt: string | null;
  lastTestStatus: "success" | "failed" | null;
  lastTestError: string | null;
  updatedAt: string | null;
}

export interface BillingKeysInput {
  keyId?: string | undefined;
  keySecret?: string | undefined;
  webhookSecret?: string | undefined;
}

export interface UpdateInvoiceProfileInput {
  legalName?: string | undefined;
  address?: string | undefined;
  state?: string | undefined;
  gstin?: string | undefined;
  sac?: string | undefined;
  gstRateBps?: number | undefined;
}

export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export interface CashfreeKeysInput {
  clientId?: string | undefined;
  clientSecret?: string | undefined;
}

export interface UpdateBillingSettingsInput {
  provider?: BillingProviderId | undefined;
  cashfree?: { test?: CashfreeKeysInput | undefined; live?: CashfreeKeysInput | undefined } | undefined;
  invoice?: UpdateInvoiceProfileInput | undefined;
  mode?: BillingMode | undefined;
  enabled?: boolean | undefined;
  graceDays?: number | undefined;
  test?: BillingKeysInput | undefined;
  live?: BillingKeysInput | undefined;
}

export interface BillingCredentials {
  provider: BillingProviderId;
  /** Razorpay key id, or the Cashfree App ID. */
  keyId: string;
  keySecret: string;
  webhookSecret: string | null;
  mode: BillingMode;
  source: "database" | "env";
}

const KEY_PREFIX: Record<BillingMode, string> = { test: "rzp_test_", live: "rzp_live_" };

function webhookUrl(suffix = ""): string {
  const root = process.env.PLATFORM_DOMAIN?.trim() || "bcom.si";
  const local = root.includes("localhost") || root.includes("127.0.0.1");
  return `${local ? "http" : "https"}://${root}/api/webhooks/platform-billing${suffix}`;
}

/** Cashfree test secrets carry `_test_`, production ones `_prod_`; a secret of the wrong mode is refused on save. */
function cashfreeSecretMatchesMode(secret: string, mode: BillingMode): boolean {
  return mode === "live" ? !secret.includes("_test_") : !secret.includes("_prod_");
}

function safeDecrypt(ciphertext: string | null, iv: string | null): string | null {
  if (!ciphertext || !iv) return null;
  try {
    return decryptSecret({ ciphertext, iv });
  } catch {
    return null; // wrong or rotated encryption key: treated as not configured
  }
}

function keySet(row: BillingRow | undefined, mode: BillingMode): BillingKeySetView {
  const keyId = (mode === "test" ? row?.testKeyId : row?.liveKeyId) ?? null;
  const secret = mode === "test" ? safeDecrypt(row?.testSecretCiphertext ?? null, row?.testSecretIv ?? null) : safeDecrypt(row?.liveSecretCiphertext ?? null, row?.liveSecretIv ?? null);
  const hasWebhook = mode === "test" ? Boolean(row?.testWebhookCiphertext && row?.testWebhookIv) : Boolean(row?.liveWebhookCiphertext && row?.liveWebhookIv);
  return {
    keyId,
    secretConfigured: Boolean(secret),
    secretLastFour: secret && secret.length >= 4 ? secret.slice(-4) : null,
    webhookSecretConfigured: hasWebhook,
  };
}

function cashfreeKeySet(row: BillingRow | undefined, mode: BillingMode): BillingKeySetView {
  const keyId = (mode === "test" ? row?.cashfreeTestClientId : row?.cashfreeLiveClientId) ?? null;
  const secret = mode === "test" ? safeDecrypt(row?.cashfreeTestSecretCiphertext ?? null, row?.cashfreeTestSecretIv ?? null) : safeDecrypt(row?.cashfreeLiveSecretCiphertext ?? null, row?.cashfreeLiveSecretIv ?? null);
  return { keyId, secretConfigured: Boolean(secret), secretLastFour: secret && secret.length >= 4 ? secret.slice(-4) : null, webhookSecretConfigured: Boolean(secret) };
}

function activeProviderOf(row: BillingRow | undefined): BillingProviderId {
  return row?.provider === "cashfree" ? "cashfree" : "razorpay";
}

async function loadRow(db: Db): Promise<BillingRow | undefined> {
  const [row] = await db.select().from(schema.platformBillingSettings).where(eq(schema.platformBillingSettings.id, "default")).limit(1);
  return row;
}

/**
 * The credentials the billing code should use right now: the saved keys of the active mode when billing is enabled,
 * else the legacy env vars (ADR-014), else null (billing disabled, reported honestly by callers).
 */
export async function loadPlatformBillingCredentials(db: Db, provider?: BillingProviderId): Promise<BillingCredentials | null> {
  const row = await loadRow(db);
  const which = provider ?? activeProviderOf(row);
  if (row?.enabled) {
    const mode = row.mode === "live" ? "live" : "test";
    if (which === "cashfree") {
      const clientId = mode === "test" ? row.cashfreeTestClientId : row.cashfreeLiveClientId;
      const secret = mode === "test" ? safeDecrypt(row.cashfreeTestSecretCiphertext, row.cashfreeTestSecretIv) : safeDecrypt(row.cashfreeLiveSecretCiphertext, row.cashfreeLiveSecretIv);
      // Cashfree signs its webhooks with the client secret, so the secret doubles as the webhook secret.
      if (clientId && secret) return { provider: "cashfree", keyId: clientId, keySecret: secret, webhookSecret: secret, mode, source: "database" };
      return null;
    }
    const keyId = mode === "test" ? row.testKeyId : row.liveKeyId;
    const secret = mode === "test" ? safeDecrypt(row.testSecretCiphertext, row.testSecretIv) : safeDecrypt(row.liveSecretCiphertext, row.liveSecretIv);
    const webhook = mode === "test" ? safeDecrypt(row.testWebhookCiphertext, row.testWebhookIv) : safeDecrypt(row.liveWebhookCiphertext, row.liveWebhookIv);
    if (keyId && secret) return { provider: "razorpay", keyId, keySecret: secret, webhookSecret: webhook, mode, source: "database" };
  }
  if (which === "cashfree") return null;
  const envKeyId = process.env.RAZORPAY_PLATFORM_KEY_ID?.trim();
  const envSecret = process.env.RAZORPAY_PLATFORM_KEY_SECRET?.trim();
  if (envKeyId && envSecret) {
    return {
      provider: "razorpay",
      keyId: envKeyId,
      keySecret: envSecret,
      webhookSecret: process.env.RAZORPAY_PLATFORM_WEBHOOK_SECRET?.trim() || null,
      mode: envKeyId.startsWith("rzp_live_") ? "live" : "test",
      source: "env",
    };
  }
  return null;
}

function invoiceProfileOf(row: BillingRow | undefined): InvoiceProfile {
  return {
    legalName: row?.invoiceLegalName ?? null,
    address: row?.invoiceAddress ?? null,
    state: row?.invoiceState ?? null,
    gstin: row?.invoiceGstin ?? null,
    sac: row?.invoiceSac ?? null,
    gstRateBps: row?.gstRateBps ?? 1800,
  };
}

/** The platform's invoice issuer details and tax rate (read by the billing webhook and the invoice PDF). */
export async function loadInvoiceProfile(db: Db): Promise<InvoiceProfile> {
  return invoiceProfileOf(await loadRow(db));
}

export async function getPlatformBillingSettings(rt: Runtime, staffUserId: string): Promise<PlatformBillingSettingsView> {
  await assertPlatformStaff(rt, staffUserId);
  const row = await loadRow(rt._db.db);
  const creds = await loadPlatformBillingCredentials(rt._db.db, "razorpay");
  return {
    provider: activeProviderOf(row),
    mode: row?.mode === "live" ? "live" : "test",
    enabled: row?.enabled ?? false,
    graceDays: row?.graceDays ?? 7,
    test: keySet(row, "test"),
    live: keySet(row, "live"),
    cashfree: { test: cashfreeKeySet(row, "test"), live: cashfreeKeySet(row, "live") },
    invoice: invoiceProfileOf(row),
    webhookUrl: webhookUrl(),
    cashfreeWebhookUrl: webhookUrl("/cashfree"),
    usingEnvFallback: creds?.source === "env",
    lastTestAt: row?.lastTestAt ? row.lastTestAt.toISOString() : null,
    lastTestStatus: row?.lastTestStatus === "success" || row?.lastTestStatus === "failed" ? row.lastTestStatus : null,
    lastTestError: row?.lastTestError ?? null,
    updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
  };
}

type KeyColumns = {
  keyId: "testKeyId" | "liveKeyId";
  secretCt: "testSecretCiphertext" | "liveSecretCiphertext";
  secretIv: "testSecretIv" | "liveSecretIv";
  webhookCt: "testWebhookCiphertext" | "liveWebhookCiphertext";
  webhookIv: "testWebhookIv" | "liveWebhookIv";
};
type CashfreeColumns = {
  clientId: "cashfreeTestClientId" | "cashfreeLiveClientId";
  secretCt: "cashfreeTestSecretCiphertext" | "cashfreeLiveSecretCiphertext";
  secretIv: "cashfreeTestSecretIv" | "cashfreeLiveSecretIv";
};
const CASHFREE_COLUMNS: Record<BillingMode, CashfreeColumns> = {
  test: { clientId: "cashfreeTestClientId", secretCt: "cashfreeTestSecretCiphertext", secretIv: "cashfreeTestSecretIv" },
  live: { clientId: "cashfreeLiveClientId", secretCt: "cashfreeLiveSecretCiphertext", secretIv: "cashfreeLiveSecretIv" },
};
const COLUMNS: Record<BillingMode, KeyColumns> = {
  test: { keyId: "testKeyId", secretCt: "testSecretCiphertext", secretIv: "testSecretIv", webhookCt: "testWebhookCiphertext", webhookIv: "testWebhookIv" },
  live: { keyId: "liveKeyId", secretCt: "liveSecretCiphertext", secretIv: "liveSecretIv", webhookCt: "liveWebhookCiphertext", webhookIv: "liveWebhookIv" },
};

/**
 * Saves billing settings. Platform owner only (it moves money). Only field names are written to the audit log, never
 * values. Enabling billing or switching to live needs that mode's key id and secret to be saved first.
 */
export async function updatePlatformBillingSettings(
  rt: Runtime,
  staffUserId: string,
  input: UpdateBillingSettingsInput,
  meta?: AuditMeta,
): Promise<{ ok: true }> {
  const staff = await assertPlatformStaff(rt, staffUserId);
  assertRoleAtLeast(staff.role, "platform_owner", "change platform billing settings");

  if (input.graceDays !== undefined && (!Number.isInteger(input.graceDays) || input.graceDays < 0 || input.graceDays > 30)) {
    throw new Error("Bad Request: the grace period is 0 to 30 days");
  }

  return rt._db.db.transaction(async (tx) => {
    const [existing] = await tx.select().from(schema.platformBillingSettings).where(eq(schema.platformBillingSettings.id, "default")).for("update").limit(1);

    const values: Partial<typeof schema.platformBillingSettings.$inferInsert> = {};
    const changed: string[] = [];

    for (const mode of ["test", "live"] as const) {
      const keys = input[mode];
      if (!keys) continue;
      const col = COLUMNS[mode];
      if (keys.keyId !== undefined && keys.keyId.trim()) {
        const keyId = keys.keyId.trim();
        if (!keyId.startsWith(KEY_PREFIX[mode])) throw new Error(`Bad Request: a ${mode} key id starts with ${KEY_PREFIX[mode]}`);
        values[col.keyId] = keyId;
        changed.push(`${mode}.keyId`);
      }
      if (keys.keySecret !== undefined && keys.keySecret.trim()) {
        const enc = encryptSecret(keys.keySecret.trim());
        values[col.secretCt] = enc.ciphertext;
        values[col.secretIv] = enc.iv;
        changed.push(`${mode}.keySecret`);
      }
      if (keys.webhookSecret !== undefined && keys.webhookSecret.trim()) {
        const enc = encryptSecret(keys.webhookSecret.trim());
        values[col.webhookCt] = enc.ciphertext;
        values[col.webhookIv] = enc.iv;
        changed.push(`${mode}.webhookSecret`);
      }
    }
    for (const mode of ["test", "live"] as const) {
      const keys = input.cashfree?.[mode];
      if (!keys) continue;
      const cols = CASHFREE_COLUMNS[mode];
      if (keys.clientId !== undefined && keys.clientId.trim()) {
        values[cols.clientId] = keys.clientId.trim();
        changed.push(`cashfree.${mode}.clientId`);
      }
      if (keys.clientSecret !== undefined && keys.clientSecret.trim()) {
        const secret = keys.clientSecret.trim();
        if (!cashfreeSecretMatchesMode(secret, mode)) {
          throw new Error(`Bad Request: that looks like a ${mode === "live" ? "test" : "production"} secret. Put ${mode} secrets in the ${mode} box`);
        }
        const enc = encryptSecret(secret);
        values[cols.secretCt] = enc.ciphertext;
        values[cols.secretIv] = enc.iv;
        changed.push(`cashfree.${mode}.clientSecret`);
      }
    }
    if (input.graceDays !== undefined) {
      values.graceDays = input.graceDays;
      changed.push("graceDays");
    }
    if (input.invoice) {
      const inv = input.invoice;
      const text = (v: string | undefined, max: number) => (v === undefined ? undefined : v.trim().slice(0, max) || null);
      const legalName = text(inv.legalName, 200);
      const address = text(inv.address, 500);
      const state = text(inv.state, 80);
      const gstin = inv.gstin === undefined ? undefined : inv.gstin.trim().toUpperCase() || null;
      const sac = text(inv.sac, 12);
      if (gstin && !GSTIN_PATTERN.test(gstin)) throw new Error("Bad Request: that is not a valid GSTIN (15 characters, for example 27AAAAA0000A1Z5)");
      if (sac && !/^[0-9]{4,8}$/.test(sac)) throw new Error("Bad Request: the SAC is 4 to 8 digits");
      if (inv.gstRateBps !== undefined && (!Number.isInteger(inv.gstRateBps) || inv.gstRateBps < 0 || inv.gstRateBps > 2800)) {
        throw new Error("Bad Request: the tax rate is 0% to 28%");
      }
      if (legalName !== undefined) { values.invoiceLegalName = legalName; changed.push("invoice.legalName"); }
      if (address !== undefined) { values.invoiceAddress = address; changed.push("invoice.address"); }
      if (state !== undefined) { values.invoiceState = state; changed.push("invoice.state"); }
      if (gstin !== undefined) { values.invoiceGstin = gstin; changed.push("invoice.gstin"); }
      if (sac !== undefined) { values.invoiceSac = sac; changed.push("invoice.sac"); }
      if (inv.gstRateBps !== undefined) { values.gstRateBps = inv.gstRateBps; changed.push("invoice.gstRateBps"); }
    }

    const merged = { ...(existing ?? {}), ...values } as BillingRow;
    const mode = input.mode ?? (existing?.mode === "live" ? "live" : "test");
    const enabled = input.enabled ?? existing?.enabled ?? false;
    const provider = input.provider ?? activeProviderOf(existing);
    const col = COLUMNS[mode];
    const cf = CASHFREE_COLUMNS[mode];
    const hasKeys =
      provider === "cashfree"
        ? Boolean(merged[cf.clientId] && merged[cf.secretCt] && merged[cf.secretIv])
        : Boolean(merged[col.keyId] && merged[col.secretCt] && merged[col.secretIv]);
    const gateway = provider === "cashfree" ? "Cashfree" : "Razorpay";
    if ((enabled || input.mode === "live" || input.provider === "cashfree") && !hasKeys) {
      throw new Error(
        `Bad Request: save the ${provider === "cashfree" ? "Cashfree " : ""}${mode} ${provider === "cashfree" ? "App ID and secret" : "key id and secret"} before ${input.mode === "live" ? "switching to live mode" : input.provider !== undefined && input.provider !== activeProviderOf(existing) ? `switching to ${gateway}` : "enabling billing"}`,
      );
    }
    if (input.provider !== undefined && input.provider !== activeProviderOf(existing)) changed.push("provider");
    if (input.mode !== undefined && input.mode !== (existing?.mode ?? "test")) changed.push("mode");
    if (input.enabled !== undefined && input.enabled !== (existing?.enabled ?? false)) changed.push("enabled");

    await tx
      .insert(schema.platformBillingSettings)
      .values({ id: "default", ...values, provider, mode, enabled, updatedBy: staffUserId, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: schema.platformBillingSettings.id,
        set: { ...values, provider, mode, enabled, updatedBy: staffUserId, updatedAt: new Date() },
      });

    await writePlatformAudit(tx, staffUserId, "platform_billing.updated", "platform_billing", "default", null, { changedFields: changed, provider, mode, enabled }, meta);
    return { ok: true as const };
  });
}

export interface BillingConnectionTestResult {
  ok: boolean;
  mode: BillingMode;
  provider: BillingProviderId;
  error?: string | undefined;
}

/**
 * Checks the saved keys of a gateway and mode (read-only; no money moves). Records the result. The fetch is
 * injectable so tests never call the network.
 */
export async function testPlatformBillingConnection(
  rt: Runtime,
  staffUserId: string,
  input: { mode?: BillingMode | undefined; provider?: BillingProviderId | undefined } = {},
  meta?: AuditMeta,
  fetchImpl: typeof fetch = fetch,
): Promise<BillingConnectionTestResult> {
  const staff = await assertPlatformStaff(rt, staffUserId);
  assertRoleAtLeast(staff.role, "platform_owner", "test platform billing keys");
  const row = await loadRow(rt._db.db);
  const mode: BillingMode = input.mode ?? (row?.mode === "live" ? "live" : "test");
  const provider = input.provider ?? activeProviderOf(row);

  let result: BillingConnectionTestResult;
  if (provider === "cashfree") {
    const cols = CASHFREE_COLUMNS[mode];
    const clientId = row?.[cols.clientId] ?? null;
    const secret = safeDecrypt(row?.[cols.secretCt] ?? null, row?.[cols.secretIv] ?? null);
    if (!clientId || !secret) {
      result = { ok: false, mode, provider, error: `Save the Cashfree ${mode} App ID and secret first.` };
    } else {
      const r = await new CashfreeProvider({ clientId, clientSecret: secret, mode, fetchFn: fetchImpl }).testConnection();
      result = { ok: r.ok, mode, provider, ...(r.error ? { error: r.error } : {}) };
    }
  } else {
    const col = COLUMNS[mode];
    const keyId = row?.[col.keyId] ?? null;
    const secret = safeDecrypt(row?.[col.secretCt] ?? null, row?.[col.secretIv] ?? null);
    if (!keyId || !secret) {
      result = { ok: false, mode, provider, error: `Save the ${mode} key id and secret first.` };
    } else {
      try {
        const res = await fetchImpl("https://api.razorpay.com/v1/plans?count=1", {
          headers: { Authorization: `Basic ${Buffer.from(`${keyId}:${secret}`).toString("base64")}` },
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) result = { ok: true, mode, provider };
        else if (res.status === 401) result = { ok: false, mode, provider, error: "Razorpay rejected these keys (401). Check the key id and secret belong to the same mode and account." };
        else result = { ok: false, mode, provider, error: `Razorpay answered ${res.status}. Subscriptions may not be enabled on this account.` };
      } catch {
        result = { ok: false, mode, provider, error: "Could not reach Razorpay. Try again." };
      }
    }
  }

  await rt._db.db.transaction(async (tx) => {
    if (row) {
      await tx
        .update(schema.platformBillingSettings)
        .set({ lastTestAt: new Date(), lastTestStatus: result.ok ? "success" : "failed", lastTestError: result.error ?? null })
        .where(eq(schema.platformBillingSettings.id, "default"));
    }
    await writePlatformAudit(tx, staffUserId, "platform_billing.tested", "platform_billing", "default", null, { provider, mode, ok: result.ok }, meta);
  });
  return result;
}
