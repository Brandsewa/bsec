import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { seedPlatformStaff } from "@bs/db/test-fixtures";
import { STORE_PERMISSIONS } from "@bs/auth";
import {
  clearProviderCredentials,
  createRuntime,
  getStorefrontPaymentOptions,
  listStorePaymentProviders,
  provisionTenant,
  saveCashfreeCredentials,
  setPaymentProviderActive,
  testPaymentProviderConnection,
  updatePlatformPaymentProvider,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";

/** ADR-037: a store connects its own Cashfree account, the same way it connects Razorpay or Stripe. */
let env: TestDb;
let rtPlatform: Runtime;
let rtWeb: Runtime;
let adminId: string;
let ctxA: TenantContext;
let ctxB: TenantContext;

const APP_ID = "TEST10000001";
const SECRET_TEST = "cfsk_ma_test_store_secret_123456";
const SECRET_PROD = "cfsk_ma_prod_store_secret_123456";

const notFound = (async () => new Response(JSON.stringify({ message: "order not found", code: "order_not_found" }), { status: 404 })) as unknown as typeof fetch;
const rejected = (async () => new Response(JSON.stringify({ message: "authentication Failed" }), { status: 401 })) as unknown as typeof fetch;

function ctxFor(t: { tenantId: string; ownerId: string }, label: string): TenantContext {
  return { tenantId: t.tenantId, storeStatus: "live", actor: { type: "staff", userId: t.ownerId }, roles: ["store_owner"], permissions: [...STORE_PERMISSIONS], requestId: `req-cf-${label}` };
}
const setPlatform = (patch: { enabled?: boolean; liveModeAllowed?: boolean }) => updatePlatformPaymentProvider(rtPlatform, adminId, { provider: "cashfree", ...patch });

beforeAll(async () => {
  env = await startTestDb();
  rtPlatform = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  rtWeb = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5 });
  adminId = (await seedPlatformStaff(rtPlatform._db.db, { email: "cf-pay-admin@platform.test", role: "platform_admin" })).userId;
  await rtPlatform._db.db.update(schema.platformPaymentProviders).set({ enabled: false, liveModeAllowed: false }).where(eq(schema.platformPaymentProviders.provider, "cashfree"));
  const a = await provisionTenant(rtPlatform, { storeName: "CF A", slug: "cf-store-a", planCode: "starter", owner: { email: "cf-a@test.com", name: "A" }, source: "platform_admin" });
  const b = await provisionTenant(rtPlatform, { storeName: "CF B", slug: "cf-store-b", planCode: "starter", owner: { email: "cf-b@test.com", name: "B" }, source: "platform_admin" });
  ctxA = ctxFor(a, "a");
  ctxB = ctxFor(b, "b");
}, 180_000);

afterAll(async () => {
  await rtPlatform?.close();
  await rtWeb?.close();
  await env?.stop();
});

describe("Cashfree as a store payment provider (real DB)", () => {
  it("is off for stores until the platform enables it", async () => {
    expect((await listStorePaymentProviders(rtWeb, ctxA)).some((p) => p.provider === "cashfree")).toBe(false);
    await expect(saveCashfreeCredentials(rtWeb, ctxA, { appId: APP_ID, secretKey: SECRET_TEST })).rejects.toThrow(/not enabled/i);
    await setPlatform({ enabled: true });
    expect((await listStorePaymentProviders(rtWeb, ctxA)).find((p) => p.provider === "cashfree")).toMatchObject({ state: "not_connected", platformEnabled: true });
  });

  it("saves keys encrypted, never returns them, validates their shape, and refuses live keys until allowed", async () => {
    await expect(saveCashfreeCredentials(rtWeb, ctxA, { appId: "bad id!", secretKey: SECRET_TEST })).rejects.toThrow(/App ID/);
    await expect(saveCashfreeCredentials(rtWeb, ctxA, { appId: APP_ID, secretKey: "short" })).rejects.toThrow(/secret key/);
    await expect(saveCashfreeCredentials(rtWeb, ctxA, { appId: APP_ID, secretKey: SECRET_PROD })).rejects.toThrow(/live keys are not allowed/i);

    const view = await saveCashfreeCredentials(rtWeb, ctxA, { appId: APP_ID, secretKey: SECRET_TEST });
    expect(view).toMatchObject({ provider: "cashfree", displayName: "Cashfree", state: "connected_test", mode: "test", hasWebhookSecret: true, checkoutLive: false });
    expect(view.keyHint).toBe("…0001");
    expect(view.webhookPath).toBe(`/api/webhooks/cashfree?tenantId=${ctxA.tenantId}`);
    expect(JSON.stringify(view)).not.toContain(SECRET_TEST);

    const rows = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) => tx.select().from(schema.tenantSecrets).where(eq(schema.tenantSecrets.provider, "cashfree")));
    expect(rows.map((r) => r.keyName).sort()).toEqual(["key_id", "key_secret"]);
    for (const r of rows) {
      expect(r.ciphertext).not.toContain(SECRET_TEST);
      expect(r.ciphertext).not.toContain(APP_ID);
    }
    const audits = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) => tx.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "cashfree_credentials.saved")));
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits)).not.toContain(SECRET_TEST);
  });

  it("activates only after a passing connection test; a rejected key keeps it inactive", async () => {
    await expect(setPaymentProviderActive(rtWeb, ctxA, "cashfree", true)).rejects.toThrow(/Test connection/i);
    const failed = await testPaymentProviderConnection(rtWeb, ctxA, "cashfree", { fetchFn: rejected });
    expect(failed.ok).toBe(false);
    expect(failed.error).toMatch(/rejected/);
    await expect(setPaymentProviderActive(rtWeb, ctxA, "cashfree", true)).rejects.toThrow(/Test connection/i);

    const passed = await testPaymentProviderConnection(rtWeb, ctxA, "cashfree", { fetchFn: notFound });
    expect(passed).toMatchObject({ ok: true, mode: "test" });
    const active = await setPaymentProviderActive(rtWeb, ctxA, "cashfree", true);
    expect(active.state).toBe("active");
  });

  it("keeps stores isolated and checkout still does not offer online payment (not wired for any provider yet)", async () => {
    expect((await listStorePaymentProviders(rtWeb, ctxB)).find((p) => p.provider === "cashfree")?.state).toBe("not_connected");
    expect((await getStorefrontPaymentOptions(rtWeb, ctxA.tenantId)).online.available).toBe(false);
  });

  it("allows live keys once the platform opens live mode, then clears cleanly", async () => {
    await setPlatform({ enabled: true, liveModeAllowed: true });
    const live = await saveCashfreeCredentials(rtWeb, ctxA, { appId: "PRODAPP00001", secretKey: SECRET_PROD });
    expect(live.mode).toBe("live");
    await setPlatform({ liveModeAllowed: false });
    expect((await listStorePaymentProviders(rtWeb, ctxA)).find((p) => p.provider === "cashfree")?.state).toBe("live_blocked");
    await clearProviderCredentials(rtWeb, ctxA, "cashfree");
    await setPlatform({ enabled: false });
    expect((await listStorePaymentProviders(rtWeb, ctxA)).some((p) => p.provider === "cashfree")).toBe(false);
  });
});
