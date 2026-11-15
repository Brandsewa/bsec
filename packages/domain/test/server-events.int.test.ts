import { beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import pino from "pino";
import { schema, withTenant } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { STORE_PERMISSIONS } from "@bs/auth";
import { DEFAULT_CONSENT_SETTINGS } from "@bs/contracts";
import {
  clearConversionCredentials,
  createRuntime,
  getPrivacySettings,
  getStorefrontConsentConfig,
  handleServerEventJob,
  provisionTenant,
  pruneOrderTracking,
  recordServerEvent,
  saveConversionCredentials,
  updatePrivacySettings,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";

const log = pino({ level: "silent" });
const TOKEN = "EAAB-server-events-token-0123456789";

let env: TestDb;
let platform: Runtime;
let web: Runtime;
let ctx: TenantContext;
let other: TenantContext;
let rev: string;
const sent: Array<{ queue: string; data: object }> = [];
let rt: Runtime;

const req = (consent: string) => ({
  cookieHeader: `bs_consent=${consent}; _fbp=fb.1.1700000000.123456789`,
  ip: "203.0.113.7",
  userAgent: "Mozilla/5.0 Test",
  sourceUrl: "https://shop.test/products/tea",
});
const item = { id: "TEA-50", quantity: 2, price: 1199 };
const ev = (id: string, over: Partial<Parameters<typeof recordServerEvent>[2]> = {}) => ({
  name: "AddToCart" as const, eventId: id, currency: "INR", value: 2398, items: [item], req: req(`${rev}.11`), ...over,
});
const rows = (t: TenantContext) => withTenant(web._db.db, t.tenantId, (tx) => tx.select().from(schema.conversionEvents).where(eq(schema.conversionEvents.tenantId, t.tenantId)));
const rowFor = async (t: TenantContext, id: string) => (await rows(t)).find((r) => r.eventId === id);

function fakeFetch(status: number) {
  type Body = { access_token: string; test_event_code?: string; data: Array<{ event_name: string; event_id: string; custom_data: Record<string, unknown> }> };
  const calls: Array<{ url: string; body: Body }> = [];
  const fn = vi.fn(async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body ?? "{}")) });
    return new Response("{}", { status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

beforeAll(async () => {
  process.env.TENANT_SECRETS_KEY = "server-events-test-secret-key-32-chars!!";
  env = await startTestDb();
  platform = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  web = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5 });
  rt = { ...web, _jobs: { isRunning: () => true, stop: async () => undefined, send: async (queue: string, data: object) => { sent.push({ queue, data }); return "job"; } } } as Runtime;
  const r = Math.random().toString(36).slice(2, 7);
  const mk = async (name: string): Promise<TenantContext> => {
    const t = await provisionTenant(platform, {
      storeName: `Events ${name}`, slug: `evt-${name}-${r}`, owner: { email: `o-${name}-${r}@events.test`, name }, planCode: "starter", source: "platform_admin",
    });
    return { tenantId: t.tenantId, storeStatus: "live", actor: { type: "staff", userId: t.ownerId }, roles: ["store_owner"], permissions: [...STORE_PERMISSIONS], requestId: `req-${name}` };
  };
  ctx = await mk("a");
  other = await mk("b");
  await updatePrivacySettings(web, ctx, { consent: { ...DEFAULT_CONSENT_SETTINGS, enabled: true, integrations: { ga4MeasurementId: null, metaPixelId: "1234567890123456", metaTestEventCode: "TEST999" } } });
  rev = (await getStorefrontConsentConfig(web, ctx.tenantId))!.rev;
});

describe("recording and sending add to cart / begin checkout (real database)", () => {
  it("records nothing without a saved token, without marketing consent, or for a store with no banner", async () => {
    expect(await recordServerEvent(rt, ctx.tenantId, ev("atc_notoken"))).toBeNull();
    await saveConversionCredentials(web, ctx, { metaAccessToken: TOKEN });
    expect(await recordServerEvent(rt, ctx.tenantId, ev("atc_analyticsonly", { req: req(`${rev}.10`) }))).toBeNull();
    expect(await recordServerEvent(rt, ctx.tenantId, ev("atc_stale", { req: req("old00000.11") }))).toBeNull();
    expect(await recordServerEvent(rt, other.tenantId, ev("atc_otherstore"))).toBeNull();
    expect(await recordServerEvent(rt, ctx.tenantId, ev("atc_empty", { items: [] }))).toBeNull();
    expect(await rows(ctx)).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it("records, queues one job, returns the id for the browser, and ignores a repeat of the same event", async () => {
    expect(await recordServerEvent(rt, ctx.tenantId, ev("atc_1"))).toBe("atc_1");
    expect(await rowFor(ctx, "atc_1")).toMatchObject({ eventName: "AddToCart", metaStatus: "pending", clientIp: "203.0.113.7", value: "2398.00" });
    expect(sent).toHaveLength(1);
    expect(await recordServerEvent(rt, ctx.tenantId, ev("atc_1"))).toBe("atc_1");
    expect((await rows(ctx)).filter((r) => r.eventId === "atc_1")).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  it("the job sends the event with the shared id and test code, then clears the request details; running again does nothing", async () => {
    const row = (await rowFor(ctx, "atc_1"))!;
    const f = fakeFetch(200);
    await handleServerEventJob(web._db.db, log, { tenantId: ctx.tenantId, id: row.id }, { fetchFn: f.fn });
    expect(f.calls).toHaveLength(1);
    const call = f.calls[0]!;
    expect(call.url).toContain("graph.facebook.com");
    expect(call.url).toContain("/1234567890123456/events");
    expect(call.url).not.toContain("EAAB");
    expect(call.body.access_token).toBe(TOKEN);
    expect(call.body.test_event_code).toBe("TEST999");
    expect(call.body.data[0]).toMatchObject({ event_name: "AddToCart", event_id: "atc_1", custom_data: { currency: "INR", content_ids: ["TEA-50"], num_items: 2 } });
    expect(JSON.stringify(call.body.data)).not.toMatch(/"em"|"ph"/);
    expect(await rowFor(ctx, "atc_1")).toMatchObject({ metaStatus: "sent", clientIp: null, userAgent: null, fbp: null });
    const again = fakeFetch(200);
    await handleServerEventJob(web._db.db, log, { tenantId: ctx.tenantId, id: row.id }, { fetchFn: again.fn });
    expect(again.calls).toHaveLength(0);
  });

  it("a server error stays pending, keeps details and retries; a rejected token fails for good; a removed token is skipped", async () => {
    await recordServerEvent(rt, ctx.tenantId, ev("ic_2", { name: "InitiateCheckout" }));
    const retry = (await rowFor(ctx, "ic_2"))!;
    await expect(handleServerEventJob(web._db.db, log, { tenantId: ctx.tenantId, id: retry.id }, { fetchFn: fakeFetch(503).fn })).rejects.toThrow(/retrying/);
    expect(await rowFor(ctx, "ic_2")).toMatchObject({ metaStatus: "pending", clientIp: "203.0.113.7", attempts: 1 });
    const ok = fakeFetch(200);
    await handleServerEventJob(web._db.db, log, { tenantId: ctx.tenantId, id: retry.id }, { fetchFn: ok.fn });
    expect(ok.calls[0]!.body.data[0]!.event_name).toBe("InitiateCheckout");
    expect(await rowFor(ctx, "ic_2")).toMatchObject({ metaStatus: "sent", clientIp: null });

    await recordServerEvent(rt, ctx.tenantId, ev("atc_bad"));
    const bad = (await rowFor(ctx, "atc_bad"))!;
    await handleServerEventJob(web._db.db, log, { tenantId: ctx.tenantId, id: bad.id }, { fetchFn: fakeFetch(400).fn });
    const failed = await rowFor(ctx, "atc_bad");
    expect(failed).toMatchObject({ metaStatus: "failed" });
    expect(JSON.stringify(failed)).not.toContain("EAAB");

    await recordServerEvent(rt, ctx.tenantId, ev("atc_removed"));
    const removed = (await rowFor(ctx, "atc_removed"))!;
    await clearConversionCredentials(web, ctx, "meta");
    const none = fakeFetch(200);
    await handleServerEventJob(web._db.db, log, { tenantId: ctx.tenantId, id: removed.id }, { fetchFn: none.fn });
    expect(none.calls).toHaveLength(0);
    expect(await rowFor(ctx, "atc_removed")).toMatchObject({ metaStatus: "skipped", clientIp: null });
    expect(await recordServerEvent(rt, ctx.tenantId, ev("atc_after_removal"))).toBeNull();
  });

  it("stats include these events, per store", async () => {
    const s = (await getPrivacySettings(web, ctx)).conversionStats;
    expect(s.sent).toBeGreaterThanOrEqual(2);
    expect(s.failed).toBeGreaterThanOrEqual(1);
    expect((await getPrivacySettings(web, other)).conversionStats).toEqual({ sent: 0, failed: 0, pending: 0, skipped: 0 });
    expect(await rows(other)).toHaveLength(0);
  });

  it("retention gives up on stale pending events and deletes old ones", async () => {
    await saveConversionCredentials(web, ctx, { metaAccessToken: TOKEN });
    await recordServerEvent(rt, ctx.tenantId, ev("atc_stale_pending"));
    await recordServerEvent(rt, ctx.tenantId, ev("atc_ancient"));
    await withTenant(web._db.db, ctx.tenantId, async (tx) => {
      await tx.execute(sql`UPDATE conversion_events SET created_at = now() - interval '3 days' WHERE event_id = 'atc_stale_pending'`);
      await tx.execute(sql`UPDATE conversion_events SET created_at = now() - interval '9 days' WHERE event_id = 'atc_ancient'`);
    });
    await pruneOrderTracking(web._db.db, ctx.tenantId);
    expect(await rowFor(ctx, "atc_ancient")).toBeUndefined();
    expect(await rowFor(ctx, "atc_stale_pending")).toMatchObject({ metaStatus: "failed", clientIp: null, fbp: null });
    const keep = await withTenant(web._db.db, ctx.tenantId, (tx) => tx.select().from(schema.conversionEvents).where(and(eq(schema.conversionEvents.tenantId, ctx.tenantId), eq(schema.conversionEvents.eventId, "atc_1"))));
    expect(keep).toHaveLength(1);
  });
});
