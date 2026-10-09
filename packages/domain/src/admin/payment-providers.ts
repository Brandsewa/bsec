import { and, eq } from "drizzle-orm";
import { schema, withTenant, type Db } from "@bs/db";
import { StripeProvider, decryptSecret, encryptSecret } from "@bs/payments";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";
import { invalidateCache } from "../cache-invalidation.ts";
import { getTenantPaymentSecrets } from "../payments/credentials.ts";

/**
 * Store-side payment provider connection (ADMIN-IMPROVEMENTS-PLAN §6.4, ADR-008).
 *
 * The platform decides which providers exist for stores (`platform_payment_providers`); each store then saves its own
 * keys (encrypted in tenant_secrets), tests the connection and activates the provider. The platform gate is enforced
 * here in the domain service, never only in the UI.
 *
 * Disabling a provider at platform level never strands money: saved keys, in-flight payments, webhooks for existing
 * intents and refunds are untouched. It only blocks new key saves, activations and new payment intents.
 */
export type OnlineProvider = "razorpay" | "stripe";
export const ONLINE_PROVIDERS: readonly OnlineProvider[] = ["razorpay", "stripe"];

export type ProviderState = "not_connected" | "connected_test" | "active" | "live_blocked";

export interface StorePaymentProviderView {
  provider: OnlineProvider;
  displayName: string;
  /** False when the platform has switched this provider off. The store still sees it if it has keys, read-only. */
  platformEnabled: boolean;
  liveModeAllowed: boolean;
  state: ProviderState;
  mode: "test" | "live" | null;
  keyHint: string | null;
  hasWebhookSecret: boolean;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestError: string | null;
  /** Path to paste in the provider dashboard; the UI prefixes the store's own domain. */
  webhookPath: string;
  tenantId: string;
  /**
   * Whether checkout will offer this provider to shoppers today. Online checkout is not wired to a provider yet
   * (see ONLINE_PAYMENT_AVAILABLE), so this is false and the UI says so.
   */
  checkoutLive: boolean;
}

const KEY_PATTERNS: Record<OnlineProvider, RegExp> = {
  razorpay: /^rzp_(test|live)_[A-Za-z0-9]{6,}$/,
  stripe: /^sk_(test|live)_[A-Za-z0-9]{10,}$/,
};

function modeOfKey(provider: OnlineProvider, key: string): "test" | "live" {
  return provider === "razorpay" ? (key.startsWith("rzp_live_") ? "live" : "test") : key.startsWith("sk_live_") ? "live" : "test";
}

async function readPlatformProvider(db: Db, provider: OnlineProvider) {
  const [row] = await db
    .select()
    .from(schema.platformPaymentProviders)
    .where(eq(schema.platformPaymentProviders.provider, provider))
    .limit(1);
  if (!row) throw new Error(`Not Found: unknown payment provider "${provider}"`);
  return row;
}

/** Throws unless the platform has enabled the provider. Used before saving keys, activating and creating intents. */
export async function assertPaymentProviderEnabled(db: Db, provider: OnlineProvider): Promise<{ liveModeAllowed: boolean }> {
  const row = await readPlatformProvider(db, provider);
  if (!row.enabled) {
    throw new Error(
      `Precondition: ${row.displayName} is not enabled for stores on this platform. Ask the platform team to enable it.`,
    );
  }
  return { liveModeAllowed: row.liveModeAllowed };
}

/** Whether the platform currently offers the provider to new payments (used by checkout). */
export async function isPaymentProviderEnabled(db: Db, provider: OnlineProvider): Promise<boolean> {
  const row = await readPlatformProvider(db, provider);
  return row.enabled;
}

async function loadStoreView(
  rt: Runtime,
  tenantId: string,
  platformRow: typeof schema.platformPaymentProviders.$inferSelect,
): Promise<StorePaymentProviderView | null> {
  const provider = platformRow.provider as OnlineProvider;
  return withTenant(rt._db.db, tenantId, async (tx) => {
    const secrets = await tx
      .select({ keyName: schema.tenantSecrets.keyName, ciphertext: schema.tenantSecrets.ciphertext, iv: schema.tenantSecrets.iv })
      .from(schema.tenantSecrets)
      .where(eq(schema.tenantSecrets.provider, provider));
    const byName = new Map(secrets.map((s) => [s.keyName, s]));
    const hasKeys = provider === "razorpay" ? byName.has("key_id") && byName.has("key_secret") : byName.has("key_secret");

    // A disabled provider is shown only to stores that already hold keys for it.
    if (!platformRow.enabled && !hasKeys) return null;

    const [method] = await tx
      .select()
      .from(schema.paymentMethods)
      .where(and(eq(schema.paymentMethods.tenantId, tenantId), eq(schema.paymentMethods.provider, provider)))
      .limit(1);

    let keyHint: string | null = null;
    let mode: "test" | "live" | null = null;
    const keyRow = provider === "razorpay" ? byName.get("key_id") : byName.get("key_secret");
    if (keyRow) {
      try {
        const plain = decryptSecret({ ciphertext: keyRow.ciphertext, iv: keyRow.iv });
        keyHint = `…${plain.slice(-4)}`;
        mode = modeOfKey(provider, plain);
      } catch {
        keyHint = null;
      }
    }

    const setup = (method?.setupState ?? {}) as Record<string, unknown>;
    let state: ProviderState = "not_connected";
    if (hasKeys) {
      if (mode === "live" && !platformRow.liveModeAllowed) state = "live_blocked";
      else if (method?.status === "active") state = "active";
      else state = "connected_test";
    }

    return {
      provider,
      displayName: platformRow.displayName,
      platformEnabled: platformRow.enabled,
      liveModeAllowed: platformRow.liveModeAllowed,
      state,
      mode,
      keyHint,
      hasWebhookSecret: byName.has("webhook_secret"),
      lastTestAt: typeof setup.lastTestAt === "string" ? setup.lastTestAt : null,
      lastTestOk: typeof setup.lastTestOk === "boolean" ? setup.lastTestOk : null,
      lastTestError: typeof setup.lastTestError === "string" ? setup.lastTestError : null,
      webhookPath: `/api/webhooks/${provider}?tenantId=${tenantId}`,
      tenantId,
      checkoutLive: false,
    };
  });
}

/** Providers this store may see: platform-enabled ones, plus disabled ones it already holds keys for. */
export async function listStorePaymentProviders(rt: Runtime, ctx: TenantContext): Promise<StorePaymentProviderView[]> {
  assertPermission(ctx, "settings.read");
  const rows = await rt._db.db.select().from(schema.platformPaymentProviders);
  rows.sort((a, b) => a.sort - b.sort);
  const out: StorePaymentProviderView[] = [];
  for (const row of rows) {
    if (!(ONLINE_PROVIDERS as readonly string[]).includes(row.provider)) continue;
    const view = await loadStoreView(rt, ctx.tenantId, row);
    if (view) out.push(view);
  }
  return out;
}

export async function getStorePaymentProvider(rt: Runtime, ctx: TenantContext, provider: OnlineProvider): Promise<StorePaymentProviderView> {
  const row = await readPlatformProvider(rt._db.db, provider);
  const view = await loadStoreView(rt, ctx.tenantId, row);
  if (!view) throw new Error(`Not Found: ${row.displayName} is not available for this store`);
  return view;
}

function encryptOrExplain(value: string) {
  try {
    return encryptSecret(value);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Encryption key not set")) {
      throw new Error(
        "Precondition: credentials cannot be saved yet because the server has no encryption key. Ask the platform operator to set TENANT_SECRETS_KEY.",
        { cause: err },
      );
    }
    throw err;
  }
}

/**
 * Saves the store's own Stripe keys. Razorpay keys keep their dedicated function (`saveRazorpayCredentials`), which
 * applies the same platform gate. Live keys are refused until the platform allows live mode for the provider.
 */
export async function saveStripeCredentials(
  rt: Runtime,
  ctx: TenantContext,
  input: { secretKey: string; webhookSecret?: string | undefined },
): Promise<StorePaymentProviderView> {
  assertPermission(ctx, "payments.manage");
  const { liveModeAllowed } = await assertPaymentProviderEnabled(rt._db.db, "stripe");
  if (!KEY_PATTERNS.stripe.test(input.secretKey)) {
    throw new Error("Bad Request: Stripe secret key should look like sk_test_XXXX or sk_live_XXXX");
  }
  if (input.webhookSecret !== undefined && !/^whsec_[A-Za-z0-9_]{8,}$/.test(input.webhookSecret)) {
    throw new Error("Bad Request: Stripe webhook signing secret should look like whsec_XXXX");
  }
  const mode = modeOfKey("stripe", input.secretKey);
  if (mode === "live" && !liveModeAllowed) {
    throw new Error("Precondition: live keys are not allowed yet. Use a test key (sk_test_...) until the platform allows live mode.");
  }
  const entries: Array<[string, string]> = [
    ["key_secret", input.secretKey],
    ...(input.webhookSecret ? ([["webhook_secret", input.webhookSecret]] as Array<[string, string]>) : []),
  ];
  const encrypted = entries.map(([keyName, value]) => ({ keyName, ...encryptOrExplain(value) }));
  const updatedBy = ctx.actor.type === "staff" ? ctx.actor.userId : null;

  await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    for (const e of encrypted) {
      await tx
        .insert(schema.tenantSecrets)
        .values({ tenantId: ctx.tenantId, provider: "stripe", keyName: e.keyName, ciphertext: e.ciphertext, iv: e.iv, keyVersion: e.keyVersion, updatedBy })
        .onConflictDoUpdate({
          target: [schema.tenantSecrets.tenantId, schema.tenantSecrets.provider, schema.tenantSecrets.keyName],
          set: { ciphertext: e.ciphertext, iv: e.iv, keyVersion: e.keyVersion, updatedBy, updatedAt: new Date() },
        });
    }
    // New keys invalidate the previous test and deactivate the method until it is tested and activated again.
    await upsertMethodRow(tx, ctx.tenantId, "stripe", "Stripe", { status: "pending_setup", mode, setup: { lastTestOk: null, lastTestAt: null, lastTestError: null } });
    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: "staff",
      actorId: updatedBy,
      action: "stripe_credentials.saved",
      targetType: "tenant_secrets",
      targetId: ctx.tenantId,
      diff: {
        mode: { before: null, after: mode },
        webhookConfigured: { before: null, after: Boolean(input.webhookSecret) },
      },
    });
  });
  return getStorePaymentProvider(rt, ctx, "stripe");
}

export async function clearProviderCredentials(rt: Runtime, ctx: TenantContext, provider: OnlineProvider): Promise<StorePaymentProviderView | null> {
  assertPermission(ctx, "payments.manage");
  await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    await tx
      .delete(schema.tenantSecrets)
      .where(and(eq(schema.tenantSecrets.tenantId, ctx.tenantId), eq(schema.tenantSecrets.provider, provider)));
    await tx
      .update(schema.paymentMethods)
      .set({ status: "disabled", disabledAt: new Date(), setupState: { v: 1, configured: false }, updatedAt: new Date() })
      .where(and(eq(schema.paymentMethods.tenantId, ctx.tenantId), eq(schema.paymentMethods.provider, provider)));
    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: "staff",
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: `${provider}_credentials.cleared`,
      targetType: "tenant_secrets",
      targetId: ctx.tenantId,
      diff: { credentials: { before: "set", after: "cleared" } },
    });
  });
  await invalidateCache(rt, ctx, { type: "store_or_seo_updated" });
  const row = await readPlatformProvider(rt._db.db, provider);
  return loadStoreView(rt, ctx.tenantId, row);
}

async function upsertMethodRow(
  tx: Db,
  tenantId: string,
  provider: OnlineProvider,
  displayName: string,
  next: { status: "pending_setup" | "active" | "disabled"; mode: "test" | "live" | null; setup?: Record<string, unknown> | undefined },
) {
  const [existing] = await tx
    .select()
    .from(schema.paymentMethods)
    .where(and(eq(schema.paymentMethods.tenantId, tenantId), eq(schema.paymentMethods.provider, provider)))
    .limit(1);
  const setupState = { v: 1, ...((existing?.setupState as Record<string, unknown>) ?? {}), configured: true, ...(next.setup ?? {}) };
  const now = new Date();
  if (existing) {
    await tx
      .update(schema.paymentMethods)
      .set({
        status: next.status,
        mode: next.mode,
        setupState,
        version: existing.version + 1,
        enabledAt: next.status === "active" ? (existing.enabledAt ?? now) : existing.enabledAt,
        disabledAt: next.status === "active" ? null : now,
        updatedAt: now,
      })
      .where(and(eq(schema.paymentMethods.tenantId, tenantId), eq(schema.paymentMethods.id, existing.id)));
  } else {
    await tx.insert(schema.paymentMethods).values({
      tenantId,
      provider,
      displayName,
      status: next.status,
      mode: next.mode,
      sortOrder: provider === "razorpay" ? 1 : 2,
      publicConfig: { v: 1 },
      setupState,
      version: 1,
      enabledAt: next.status === "active" ? now : null,
      disabledAt: next.status === "active" ? null : now,
    });
  }
}

export interface ConnectionTestResult {
  ok: boolean;
  mode?: "test" | "live" | undefined;
  error?: string | undefined;
}

/**
 * Checks the saved keys against the provider with a read-only call (Stripe `GET /v1/balance`, Razorpay
 * `GET /v1/payments?count=1`); no money moves. The result is stored so Activate can require a passing test.
 */
export async function testPaymentProviderConnection(
  rt: Runtime,
  ctx: TenantContext,
  provider: OnlineProvider,
  deps?: { fetchFn?: typeof fetch | undefined },
): Promise<ConnectionTestResult & { provider: StorePaymentProviderView }> {
  assertPermission(ctx, "payments.manage");
  await assertPaymentProviderEnabled(rt._db.db, provider);
  const fetchFn = deps?.fetchFn ?? globalThis.fetch;
  const creds = await getTenantPaymentSecrets(rt._db.db, ctx.tenantId, provider);

  let result: ConnectionTestResult;
  if (provider === "stripe") {
    if (!creds.keySecret) {
      result = { ok: false, error: "Save your Stripe secret key first." };
    } else {
      const r = await new StripeProvider({ secretKey: creds.keySecret, fetchFn }).testConnection();
      const declared = modeOfKey("stripe", creds.keySecret);
      result =
        r.ok && r.livemode !== undefined && (r.livemode ? "live" : "test") !== declared
          ? { ok: false, error: "The key's mode does not match what Stripe reports." }
          : { ok: r.ok, mode: r.ok ? declared : undefined, error: r.error };
    }
  } else if (!creds.keyId || !creds.keySecret) {
    result = { ok: false, error: "Save your Razorpay key id and secret first." };
  } else {
    try {
      const res = await fetchFn("https://api.razorpay.com/v1/payments?count=1", {
        headers: { Authorization: `Basic ${Buffer.from(`${creds.keyId}:${creds.keySecret}`).toString("base64")}` },
      });
      result = res.ok
        ? { ok: true, mode: modeOfKey("razorpay", creds.keyId) }
        : { ok: false, error: res.status === 401 ? "Razorpay rejected these keys." : `Razorpay returned HTTP ${res.status}.` };
    } catch {
      result = { ok: false, error: "Could not reach Razorpay. Try again." };
    }
  }

  await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [existing] = await tx
      .select({ status: schema.paymentMethods.status, mode: schema.paymentMethods.mode })
      .from(schema.paymentMethods)
      .where(and(eq(schema.paymentMethods.tenantId, ctx.tenantId), eq(schema.paymentMethods.provider, provider)))
      .limit(1);
    await upsertMethodRow(tx, ctx.tenantId, provider, provider === "stripe" ? "Stripe" : "Razorpay", {
      // A failing test also drops an active method back to pending so a broken key is not left "active".
      status: result.ok ? ((existing?.status === "active" ? "active" : "pending_setup") as "active" | "pending_setup") : "pending_setup",
      mode: result.mode ?? (existing?.mode as "test" | "live" | null) ?? null,
      setup: { lastTestAt: new Date().toISOString(), lastTestOk: result.ok, lastTestError: result.ok ? null : (result.error ?? "Connection test failed") },
    });
    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: "staff",
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: `${provider}_connection.tested`,
      targetType: "payment_methods",
      targetId: ctx.tenantId,
      diff: { ok: result.ok, mode: result.mode ?? null },
    });
  });
  return { ...result, provider: await getStorePaymentProvider(rt, ctx, provider) };
}

/**
 * Activates or deactivates a provider for the store. Activation requires: the platform has the provider enabled,
 * keys are saved, the latest connection test passed, and live keys only if the platform allows live mode.
 * Deactivation is always allowed (even if the platform disabled the provider).
 */
export async function setPaymentProviderActive(
  rt: Runtime,
  ctx: TenantContext,
  provider: OnlineProvider,
  active: boolean,
): Promise<StorePaymentProviderView> {
  assertPermission(ctx, "payments.manage");
  if (active) {
    const { liveModeAllowed } = await assertPaymentProviderEnabled(rt._db.db, provider);
    const view = await getStorePaymentProvider(rt, ctx, provider);
    if (view.state === "not_connected") throw new Error("Precondition: save your keys before activating.");
    if (view.mode === "live" && !liveModeAllowed) {
      throw new Error("Precondition: live keys are not allowed yet. Use test keys until the platform allows live mode.");
    }
    if (view.lastTestOk !== true) throw new Error("Precondition: run Test connection successfully before activating.");
    if (provider === "stripe" && !view.hasWebhookSecret) {
      throw new Error("Precondition: add the webhook signing secret from your Stripe dashboard before activating.");
    }
  }
  await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [existing] = await tx
      .select({ mode: schema.paymentMethods.mode })
      .from(schema.paymentMethods)
      .where(and(eq(schema.paymentMethods.tenantId, ctx.tenantId), eq(schema.paymentMethods.provider, provider)))
      .limit(1);
    await upsertMethodRow(tx, ctx.tenantId, provider, provider === "stripe" ? "Stripe" : "Razorpay", {
      status: active ? "active" : "disabled",
      mode: (existing?.mode as "test" | "live" | null) ?? null,
    });
    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: "staff",
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: active ? `${provider}.activated` : `${provider}.deactivated`,
      targetType: "payment_methods",
      targetId: ctx.tenantId,
      diff: { active: { before: !active, after: active } },
    });
  });
  await invalidateCache(rt, ctx, { type: "store_or_seo_updated" });
  return getStorePaymentProvider(rt, ctx, provider);
}
