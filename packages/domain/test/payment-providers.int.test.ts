import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { seedPlatformStaff } from "@bs/db/test-fixtures";
import { STORE_PERMISSIONS } from "@bs/auth";
import {
  createRuntime,
  provisionTenant,
  listPlatformPaymentProviders,
  updatePlatformPaymentProvider,
  listStorePaymentProviders,
  saveStripeCredentials,
  saveRazorpayCredentials,
  clearProviderCredentials,
  testPaymentProviderConnection,
  setPaymentProviderActive,
  getStorefrontPaymentOptions,
  getPlatformIntegrationsOverview,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";

// Phase 4 slice D (ADMIN-IMPROVEMENTS-PLAN 6.4): platform enablement gates store-side payment providers.
let env: TestDb;
let rtPlatform: Runtime;
let rtWeb: Runtime;
let adminId: string;
let ctxA: TenantContext;
let ctxB: TenantContext;
// Other heavy test files share this database in CI and may leave stripe enabled or hold their own keys, so reset the
// platform rows to their seed state and compare store counts against a baseline instead of absolute numbers.
let baseStripe = { connectedStores: 0, activeStores: 0 };

const SK_TEST = "sk_test_51Abcdefghij1234567890";
const SK_LIVE = "sk_live_51Abcdefghij1234567890";
const WHSEC = "whsec_abcdef123456";

const okFetch = (async () => new Response(JSON.stringify({ livemode: false }), { status: 200 })) as unknown as typeof fetch;
const badFetch = (async () =>
  new Response(JSON.stringify({ error: { message: "Invalid API Key provided" } }), { status: 401 })) as unknown as typeof fetch;

function ctxFor(t: { tenantId: string; ownerId: string }, label: string): TenantContext {
  return {
    tenantId: t.tenantId,
    storeStatus: "live",
    actor: { type: "staff", userId: t.ownerId },
    roles: ["store_owner"],
    permissions: [...STORE_PERMISSIONS],
    requestId: `req-pay-${label}`,
  };
}

async function setPlatform(provider: "razorpay" | "stripe", patch: { enabled?: boolean; liveModeAllowed?: boolean }) {
  await updatePlatformPaymentProvider(rtPlatform, adminId, { provider, ...patch });
}

beforeAll(async () => {
  env = await startTestDb();
  rtPlatform = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  rtWeb = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5 });
  adminId = (await seedPlatformStaff(rtPlatform._db.db, { email: "pay-admin@platform.test", role: "platform_admin" })).userId;
  await rtPlatform._db.db
    .update(schema.platformPaymentProviders)
    .set({ enabled: false, liveModeAllowed: false })
    .where(eq(schema.platformPaymentProviders.provider, "stripe"));
  await rtPlatform._db.db
    .update(schema.platformPaymentProviders)
    .set({ enabled: true, liveModeAllowed: false })
    .where(eq(schema.platformPaymentProviders.provider, "razorpay"));
  const baseList = await listPlatformPaymentProviders(rtPlatform, adminId);
  const bs = baseList.find((p) => p.provider === "stripe");
  baseStripe = { connectedStores: bs?.connectedStores ?? 0, activeStores: bs?.activeStores ?? 0 };
  const a = await provisionTenant(rtPlatform, {
    storeName: "Pay Store A",
    slug: "pay-store-a",
    owner: { email: "owner-a@pay.test", name: "A" },
    planCode: "starter",
    source: "platform_admin",
  });
  const b = await provisionTenant(rtPlatform, {
    storeName: "Pay Store B",
    slug: "pay-store-b",
    owner: { email: "owner-b@pay.test", name: "B" },
    planCode: "starter",
    source: "platform_admin",
  });
  ctxA = ctxFor(a, "a");
  ctxB = ctxFor(b, "b");
}, 180_000);

afterAll(async () => {
  await rtPlatform?.close();
  await rtWeb?.close();
  await env?.stop();
});

describe("platform payment providers (real DB)", () => {
  it("lists Razorpay and Stripe with live mode closed (after the seed reset in beforeAll)", async () => {
    const list = await listPlatformPaymentProviders(rtPlatform, adminId);
    expect(list.map((p) => [p.provider, p.enabled, p.liveModeAllowed])).toEqual([
      ["razorpay", true, false],
      ["stripe", false, false],
    ]);
  });

  it("a disabled provider blocks key save, test and activation, and is hidden from a store with no keys", async () => {
    await expect(saveStripeCredentials(rtWeb, ctxA, { secretKey: SK_TEST, webhookSecret: WHSEC })).rejects.toThrow(/not enabled/i);
    await expect(testPaymentProviderConnection(rtWeb, ctxA, "stripe", { fetchFn: okFetch })).rejects.toThrow(/not enabled/i);
    await expect(setPaymentProviderActive(rtWeb, ctxA, "stripe", true)).rejects.toThrow(/not enabled/i);
    const visible = await listStorePaymentProviders(rtWeb, ctxA);
    expect(visible.map((p) => p.provider)).toEqual(["razorpay"]);
  });

  it("requires platform_admin and writes an audit row for every change", async () => {
    const viewer = await seedPlatformStaff(rtPlatform._db.db, { email: "pay-viewer@platform.test", role: "platform_support" });
    await expect(updatePlatformPaymentProvider(rtPlatform, viewer.userId, { provider: "stripe", enabled: true })).rejects.toThrow();

    await setPlatform("stripe", { enabled: true });
    const logs = await rtPlatform._db.db
      .select()
      .from(schema.platformAuditLogs)
      .where(and(eq(schema.platformAuditLogs.targetType, "payment_provider"), eq(schema.platformAuditLogs.targetId, "stripe")));
    expect(logs.some((l) => l.action === "payment_provider.enabled")).toBe(true);
  });

  it("saves test keys encrypted, never returns them, and refuses live keys until live mode is allowed", async () => {
    await expect(saveStripeCredentials(rtWeb, ctxA, { secretKey: SK_LIVE, webhookSecret: WHSEC })).rejects.toThrow(/live keys are not allowed/i);
    await expect(saveStripeCredentials(rtWeb, ctxA, { secretKey: "not-a-key" })).rejects.toThrow(/sk_test/);

    const view = await saveStripeCredentials(rtWeb, ctxA, { secretKey: SK_TEST, webhookSecret: WHSEC });
    expect(view).toMatchObject({ provider: "stripe", state: "connected_test", mode: "test", hasWebhookSecret: true });
    expect(JSON.stringify(view)).not.toContain(SK_TEST);
    expect(JSON.stringify(view)).not.toContain(WHSEC);

    const rows = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) =>
      tx.select().from(schema.tenantSecrets).where(eq(schema.tenantSecrets.provider, "stripe")),
    );
    expect(rows.length).toBe(2);
    for (const r of rows) {
      expect(r.ciphertext).not.toContain(SK_TEST);
      expect(r.ciphertext).not.toContain(WHSEC);
    }
    const audit = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) =>
      tx.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "stripe_credentials.saved")),
    );
    expect(JSON.stringify(audit)).not.toContain(SK_TEST);
  });

  it("activation needs a passing connection test and the webhook secret; a failing test keeps it inactive", async () => {
    await expect(setPaymentProviderActive(rtWeb, ctxA, "stripe", true)).rejects.toThrow(/Test connection/i);

    const failed = await testPaymentProviderConnection(rtWeb, ctxA, "stripe", { fetchFn: badFetch });
    expect(failed.ok).toBe(false);
    expect(failed.error).not.toContain(SK_TEST);
    await expect(setPaymentProviderActive(rtWeb, ctxA, "stripe", true)).rejects.toThrow(/Test connection/i);

    const passed = await testPaymentProviderConnection(rtWeb, ctxA, "stripe", { fetchFn: okFetch });
    expect(passed.ok).toBe(true);
    const active = await setPaymentProviderActive(rtWeb, ctxA, "stripe", true);
    expect(active.state).toBe("active");
  });

  it("keeps stores isolated: store B sees Stripe as not connected", async () => {
    const forB = await listStorePaymentProviders(rtWeb, ctxB);
    expect(forB.find((p) => p.provider === "stripe")?.state).toBe("not_connected");
  });

  it("platform stats count connected and active stores", async () => {
    const list = await listPlatformPaymentProviders(rtPlatform, adminId);
    const stripe = list.find((p) => p.provider === "stripe")!;
    expect(stripe.connectedStores).toBe(baseStripe.connectedStores + 1);
    expect(stripe.activeStores).toBe(baseStripe.activeStores + 1);
  });

  it("disabling at platform level blocks new use but never strands the store", async () => {
    await setPlatform("stripe", { enabled: false });
    const view = (await listStorePaymentProviders(rtWeb, ctxA)).find((p) => p.provider === "stripe");
    expect(view).toMatchObject({ platformEnabled: false, hasWebhookSecret: true });

    await expect(saveStripeCredentials(rtWeb, ctxA, { secretKey: SK_TEST })).rejects.toThrow(/not enabled/i);
    const off = await setPaymentProviderActive(rtWeb, ctxA, "stripe", false);
    expect(off.state).toBe("connected_test");
    await expect(setPaymentProviderActive(rtWeb, ctxA, "stripe", true)).rejects.toThrow(/not enabled/i);

    const secrets = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) =>
      tx.select().from(schema.tenantSecrets).where(eq(schema.tenantSecrets.provider, "stripe")),
    );
    expect(secrets.length).toBe(2);

    // The store can still remove its own keys.
    await clearProviderCredentials(rtWeb, ctxA, "stripe");
    expect((await listStorePaymentProviders(rtWeb, ctxA)).some((p) => p.provider === "stripe")).toBe(false);
  });

  it("turning a provider off also closes live mode; live keys are accepted once live mode is allowed", async () => {
    await setPlatform("stripe", { enabled: true, liveModeAllowed: true });
    let list = await listPlatformPaymentProviders(rtPlatform, adminId);
    expect(list.find((p) => p.provider === "stripe")?.liveModeAllowed).toBe(true);
    const live = await saveStripeCredentials(rtWeb, ctxB, { secretKey: SK_LIVE, webhookSecret: WHSEC });
    expect(live.mode).toBe("live");
    expect(live.state).toBe("connected_test");

    await setPlatform("stripe", { enabled: false });
    list = await listPlatformPaymentProviders(rtPlatform, adminId);
    expect(list.find((p) => p.provider === "stripe")?.liveModeAllowed).toBe(false);
    // Back on, but live mode stays closed until the owner allows it again: the live keys are blocked.
    await setPlatform("stripe", { enabled: true });
    expect((await listStorePaymentProviders(rtWeb, ctxB)).find((p) => p.provider === "stripe")?.state).toBe("live_blocked");
    await clearProviderCredentials(rtWeb, ctxB, "stripe");
  });

  it("gates Razorpay key saves the same way and refuses live Razorpay keys", async () => {
    await expect(saveRazorpayCredentials(rtWeb, ctxA, { keyId: "rzp_live_ABCDEF123456", keySecret: "secret-value-123" })).rejects.toThrow(/live keys are not allowed/i);
    await setPlatform("razorpay", { enabled: false });
    await expect(saveRazorpayCredentials(rtWeb, ctxA, { keyId: "rzp_test_ABCDEF123456", keySecret: "secret-value-123" })).rejects.toThrow(/not enabled/i);
    await setPlatform("razorpay", { enabled: true });
    await saveRazorpayCredentials(rtWeb, ctxA, { keyId: "rzp_test_ABCDEF123456", keySecret: "secret-value-123" });
    const r = (await listStorePaymentProviders(rtWeb, ctxA)).find((p) => p.provider === "razorpay");
    expect(r).toMatchObject({ state: "connected_test", mode: "test" });
  });

  it("checkout does not offer online payment yet, whatever the platform and store settings say", async () => {
    const opts = await getStorefrontPaymentOptions(rtWeb, ctxA.tenantId);
    expect(opts.online.available).toBe(false);
  });

  it("hub overview lists the real enabled providers", async () => {
    const overview = await getPlatformIntegrationsOverview(rtPlatform, adminId);
    expect(overview.payments.enabledProviders).toContain("razorpay");
  });
});
