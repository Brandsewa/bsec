import { beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import pino from "pino";
import { schema, withTenant } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { STORE_PERMISSIONS } from "@bs/auth";
import { DEFAULT_CONSENT_SETTINGS, type ConsentSettings } from "@bs/contracts";
import {
  clearConversionCredentials,
  createRuntime,
  getPrivacySettings,
  handleAnalyticsConversionJob,
  placeOrder,
  provisionTenant,
  pruneOrderTracking,
  saveConversionCredentials,
  updatePrivacySettings,
  addToCart,
  getOrCreateCart,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";
import { createActiveProduct } from "./helpers/factories.ts";

const log = pino({ level: "silent" });
const META_TOKEN = "EAAB-test-access-token-0123456789-secret";
const GA4_SECRET_VALUE = "ga4-secret-abcdef123456";

let env: TestDb;
let platform: Runtime;
let web: Runtime;
let ctx: TenantContext;
let other: TenantContext;
let variantId: string;

const consent = (over: Partial<ConsentSettings["integrations"]> = {}): ConsentSettings => ({
  ...DEFAULT_CONSENT_SETTINGS,
  enabled: true,
  integrations: { ga4MeasurementId: "G-TEST12345", metaPixelId: "1234567890123456", metaTestEventCode: null, ...over },
});

type Call = { url: string; body: Record<string, unknown> };
function fakeFetch(status: number | ((url: string) => number)) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
    const s = typeof status === "function" ? status(url) : status;
    return new Response(s === 204 ? null : "{}", { status: s });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

async function placeTracked(t: TenantContext, tracking: Parameters<typeof placeOrder>[2]["tracking"]) {
  const cart = await getOrCreateCart(web, t);
  await addToCart(web, t, { token: cart.token, variantId, quantity: 2 });
  const r = await placeOrder(web, t, {
    cartToken: cart.token,
    email: "Buyer@Example.com",
    phone: "9876543210",
    fullName: "Buyer",
    addressLine1: "1 Tea Lane",
    city: "Darjeeling",
    state: "WB",
    pincode: "734101",
    paymentMethod: "cod",
    tracking,
  });
  return r.orderId;
}

const trackingRow = {
  consentAnalytics: true, consentMarketing: true, clientIp: "203.0.113.7", userAgent: "Mozilla/5.0 Test", fbp: "fb.1.1700000000.123456789", fbc: null,
  gaClientId: "1234567890.1700000000", sourceUrl: "https://shop.test/checkout", metaStatus: "pending" as const, ga4Status: "pending" as const,
};
const readTracking = (t: TenantContext, orderId: string) =>
  withTenant(web._db.db, t.tenantId, async (tx) => {
    const [row] = await tx.select().from(schema.orderTracking).where(and(eq(schema.orderTracking.tenantId, t.tenantId), eq(schema.orderTracking.orderId, orderId)));
    return row;
  });

beforeAll(async () => {
  process.env.TENANT_SECRETS_KEY = "conversion-test-secret-key-32-chars!!";
  env = await startTestDb();
  platform = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  web = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5 });
  const r = Math.random().toString(36).slice(2, 7);
  const mk = async (name: string): Promise<TenantContext> => {
    const t = await provisionTenant(platform, {
      storeName: `Conv ${name}`,
      slug: `conv-${name}-${r}`,
      owner: { email: `o-${name}-${r}@conv.test`, name },
      planCode: "starter",
      source: "platform_admin",
    });
    return { tenantId: t.tenantId, storeStatus: "live", actor: { type: "staff", userId: t.ownerId }, roles: ["store_owner"], permissions: [...STORE_PERMISSIONS], requestId: `req-${name}` };
  };
  ctx = await mk("a");
  other = await mk("b");
  variantId = (await createActiveProduct(web, ctx, { title: "Darjeeling Tea", price: 62_450, sku: "TEA-50" })).variantId;
});

describe("server-side conversion credentials (real database)", () => {
  it("needs the matching id first, stores encrypted, and never returns the value", async () => {
    await expect(saveConversionCredentials(web, ctx, { metaAccessToken: META_TOKEN })).rejects.toThrow(/Pixel ID/);
    await updatePrivacySettings(web, ctx, { consent: consent() });
    const saved = await saveConversionCredentials(web, ctx, { metaAccessToken: META_TOKEN, ga4ApiSecret: GA4_SECRET_VALUE });
    expect(saved.conversionCredentials).toEqual({ metaAccessTokenSet: true, ga4ApiSecretSet: true });
    expect(JSON.stringify(await getPrivacySettings(web, ctx))).not.toMatch(/EAAB|ga4-secret/);

    const rows = await withTenant(web._db.db, ctx.tenantId, (tx) => tx.select().from(schema.tenantSecrets).where(sql`provider IN ('meta_capi', 'ga4_mp')`));
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(`${row.ciphertext}${row.iv}`).not.toMatch(/EAAB|ga4-secret/);
    const audit = await withTenant(web._db.db, ctx.tenantId, (tx) => tx.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "conversion_credentials.saved")));
    expect(JSON.stringify(audit)).not.toMatch(/EAAB|ga4-secret/);
  });

  it("is per store and needs privacy.manage", async () => {
    expect((await getPrivacySettings(web, other)).conversionCredentials).toEqual({ metaAccessTokenSet: false, ga4ApiSecretSet: false });
    const noPerm = { ...ctx, permissions: ["settings.read"] } as TenantContext;
    await expect(saveConversionCredentials(web, noPerm, { ga4ApiSecret: GA4_SECRET_VALUE })).rejects.toThrow(/Forbidden/);
    await expect(clearConversionCredentials(web, noPerm, "meta")).rejects.toThrow(/Forbidden/);
  });
});

describe("placing an order and the conversion job (real database)", () => {
  it("an order without a tracking row stores nothing", async () => {
    const orderId = await placeTracked(ctx, null);
    expect(await readTracking(ctx, orderId)).toBeUndefined();
    const f = fakeFetch(200);
    await handleAnalyticsConversionJob(web._db.db, log, { tenantId: ctx.tenantId, orderId }, { fetchFn: f.fn });
    expect(f.calls).toHaveLength(0);
  });

  it("sends Purchase to Meta and GA4 with matching ids, hashes the email, then clears the request details", async () => {
    await updatePrivacySettings(web, ctx, { consent: consent({ metaTestEventCode: "TEST12345" }) });
    const orderId = await placeTracked(ctx, trackingRow);
    expect(await readTracking(ctx, orderId)).toMatchObject({ metaStatus: "pending", ga4Status: "pending", clientIp: "203.0.113.7" });

    const f = fakeFetch(200);
    await handleAnalyticsConversionJob(web._db.db, log, { tenantId: ctx.tenantId, orderId }, { fetchFn: f.fn });
    expect(f.calls).toHaveLength(2);
    const meta = f.calls.find((c) => c.url.includes("graph.facebook.com"))!;
    const ga4 = f.calls.find((c) => c.url.includes("google-analytics.com"))!;
    expect(meta.url).toContain("/1234567890123456/events");
    expect(meta.url).not.toContain("EAAB");
    expect(meta.body["access_token"]).toBe(META_TOKEN);
    expect(meta.body["test_event_code"]).toBe("TEST12345");
    const event = (meta.body["data"] as Array<{ event_id: string; custom_data: Record<string, unknown>; user_data: { em: string[] } }>)[0]!;
    expect(event.event_id).toMatch(/^[A-Z#\-0-9]+$/);
    expect(event.custom_data).toMatchObject({ currency: "INR", num_items: 2, content_ids: ["TEA-50"] });
    expect(event.user_data.em).toHaveLength(1);
    expect(JSON.stringify(meta.body)).not.toMatch(/buyer@example\.com/i);
    expect(ga4.url).toContain("measurement_id=G-TEST12345");
    expect(ga4.body).toMatchObject({ client_id: "1234567890.1700000000", events: [{ name: "purchase", params: { transaction_id: event.event_id } }] });

    const done = await readTracking(ctx, orderId);
    expect(done).toMatchObject({ metaStatus: "sent", ga4Status: "sent", clientIp: null, userAgent: null, fbp: null, gaClientId: null });

    // Running the job again never sends twice.
    const again = fakeFetch(200);
    await handleAnalyticsConversionJob(web._db.db, log, { tenantId: ctx.tenantId, orderId }, { fetchFn: again.fn });
    expect(again.calls).toHaveLength(0);
  });

  it("retries on a server error (stays pending, keeps the details, throws) and finishes on the next run without re-sending what worked", async () => {
    const orderId = await placeTracked(ctx, trackingRow);
    const failMeta = fakeFetch((url) => (url.includes("facebook") ? 503 : 204));
    await expect(handleAnalyticsConversionJob(web._db.db, log, { tenantId: ctx.tenantId, orderId }, { fetchFn: failMeta.fn })).rejects.toThrow(/retrying/);
    expect(await readTracking(ctx, orderId)).toMatchObject({ metaStatus: "pending", ga4Status: "sent", clientIp: "203.0.113.7" });

    const second = fakeFetch(200);
    await handleAnalyticsConversionJob(web._db.db, log, { tenantId: ctx.tenantId, orderId }, { fetchFn: second.fn });
    expect(second.calls).toHaveLength(1);
    expect(second.calls[0]!.url).toContain("facebook");
    expect(await readTracking(ctx, orderId)).toMatchObject({ metaStatus: "sent", ga4Status: "sent", clientIp: null });
  });

  it("a rejected token fails for good without retrying and without recording the token", async () => {
    const orderId = await placeTracked(ctx, trackingRow);
    const f = fakeFetch((url) => (url.includes("facebook") ? 400 : 204));
    await handleAnalyticsConversionJob(web._db.db, log, { tenantId: ctx.tenantId, orderId }, { fetchFn: f.fn });
    const row = await readTracking(ctx, orderId);
    expect(row).toMatchObject({ metaStatus: "failed", ga4Status: "sent" });
    expect(JSON.stringify(row)).not.toContain("EAAB");
  });

  it("skips a cancelled order, and a platform whose credential was removed", async () => {
    const cancelled = await placeTracked(ctx, trackingRow);
    await withTenant(web._db.db, ctx.tenantId, (tx) => tx.update(schema.orders).set({ status: "cancelled" }).where(eq(schema.orders.id, cancelled)));
    const f = fakeFetch(200);
    await handleAnalyticsConversionJob(web._db.db, log, { tenantId: ctx.tenantId, orderId: cancelled }, { fetchFn: f.fn });
    expect(f.calls).toHaveLength(0);
    expect(await readTracking(ctx, cancelled)).toMatchObject({ metaStatus: "skipped", ga4Status: "skipped", clientIp: null });

    const orderId = await placeTracked(ctx, trackingRow);
    const after = await clearConversionCredentials(web, ctx, "meta");
    expect(after.conversionCredentials).toEqual({ metaAccessTokenSet: false, ga4ApiSecretSet: true });
    const g = fakeFetch(200);
    await handleAnalyticsConversionJob(web._db.db, log, { tenantId: ctx.tenantId, orderId }, { fetchFn: g.fn });
    expect(g.calls).toHaveLength(1);
    expect(g.calls[0]!.url).toContain("google-analytics.com");
    expect(await readTracking(ctx, orderId)).toMatchObject({ metaStatus: "skipped", ga4Status: "sent" });
  });

  it("stats count the last 7 days by outcome, per store", async () => {
    const s = (await getPrivacySettings(web, ctx)).conversionStats;
    expect(s.sent).toBeGreaterThanOrEqual(4);
    expect(s.failed).toBeGreaterThanOrEqual(1);
    expect((await getPrivacySettings(web, other)).conversionStats).toEqual({ sent: 0, failed: 0, pending: 0, skipped: 0 });
  });
});

describe("retention (real database)", () => {
  it("gives up on stale pending events, clears request details, and deletes old rows", async () => {
    await saveConversionCredentials(web, ctx, { metaAccessToken: META_TOKEN });
    const stale = await placeTracked(ctx, trackingRow);
    const old = await placeTracked(ctx, { ...trackingRow, metaStatus: "skipped", ga4Status: "skipped" });
    await withTenant(web._db.db, ctx.tenantId, async (tx) => {
      await tx.execute(sql`UPDATE order_tracking SET created_at = now() - interval '3 days' WHERE order_id = ${stale}`);
      await tx.execute(sql`UPDATE order_tracking SET created_at = now() - interval '40 days' WHERE order_id = ${old}`);
    });
    const res = await pruneOrderTracking(web._db.db, ctx.tenantId);
    expect(res.deleted).toBeGreaterThanOrEqual(1);
    expect(await readTracking(ctx, old)).toBeUndefined();
    expect(await readTracking(ctx, stale)).toMatchObject({ metaStatus: "failed", ga4Status: "failed", clientIp: null, fbp: null, gaClientId: null });
  });
});
