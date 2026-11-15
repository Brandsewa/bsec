import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { STORE_PERMISSIONS } from "@bs/auth";
import { ANALYTICS_REPORTS } from "@bs/contracts";
import {
  createRuntime,
  getAnalyticsOverview,
  getAnalyticsReport,
  provisionTenant,
  recordAnalyticsEvent,
  rollupTrafficForTenant,
  runAnalyticsMaintenance,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";

const SECRET = "test-secret";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36";
const RANGE = { from: "2026-03-01", to: "2026-03-31" };

let env: TestDb;
let platform: Runtime;
let web: Runtime;
let ctxA: TenantContext;
let ctxB: TenantContext;

let n = 0;
async function order(
  tenantId: string,
  o: { placedAt: string; subtotal: number; discount?: number; shipping?: number; status?: string; currency?: string; email?: string; source?: string },
) {
  n += 1;
  const discount = o.discount ?? 0;
  const shipping = o.shipping ?? 0;
  await withTenant(web._db.db, tenantId, (tx) =>
    tx.insert(schema.orders).values({
      tenantId,
      number: `T${n}`,
      email: o.email ?? `buyer${n}@analytics.test`,
      phone: "9999999999",
      currency: o.currency ?? "INR",
      status: o.status ?? "confirmed",
      subtotal: o.subtotal,
      discountTotal: discount,
      shippingTotal: shipping,
      grandTotal: o.subtotal - discount + shipping,
      shippingAddress: { state: "West Bengal", city: "Darjeeling" },
      source: o.source ?? "web",
      placedAt: new Date(o.placedAt),
    }),
  );
}

async function event(tenantId: string, ip: string, type: string, path: string, at: string, referrer?: string) {
  const res = await recordAnalyticsEvent(web, tenantId, { type, path, ip, userAgent: UA, referrer, ownHost: "shop.test" }, { secret: SECRET, now: new Date(at) });
  expect(res).toBe("recorded");
}

beforeAll(async () => {
  env = await startTestDb();
  platform = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  web = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5 });
  const r = Math.random().toString(36).slice(2, 7);
  const mk = async (name: string): Promise<TenantContext> => {
    const t = await provisionTenant(platform, {
      storeName: `Reports ${name}`,
      slug: `rep-${name}-${r}`,
      owner: { email: `o-${name}-${r}@reports.test`, name },
      planCode: "starter",
      source: "platform_admin",
    });
    return { tenantId: t.tenantId, storeStatus: "live", actor: { type: "staff", userId: t.ownerId }, roles: ["store_owner"], permissions: [...STORE_PERMISSIONS], requestId: `req-${name}` };
  };
  ctxA = await mk("a");
  ctxB = await mk("b");

  // Store A, timezone Asia/Kolkata (the default). Amounts in paise.
  await order(ctxA.tenantId, { placedAt: "2026-02-10T06:00:00Z", subtotal: 50_000, email: "repeat@analytics.test" }); // before the range
  await order(ctxA.tenantId, { placedAt: "2026-03-05T06:00:00Z", subtotal: 100_000, discount: 10_000, shipping: 5_000, email: "repeat@analytics.test" });
  await order(ctxA.tenantId, { placedAt: "2026-03-05T08:00:00Z", subtotal: 40_000, email: "new@analytics.test" });
  // 20:00 UTC on 31 March is 1 April in India: must fall outside March.
  await order(ctxA.tenantId, { placedAt: "2026-03-31T20:00:00Z", subtotal: 70_000 });
  // 20:00 UTC on 28 February is 1 March in India: must fall inside March.
  await order(ctxA.tenantId, { placedAt: "2026-02-28T20:00:00Z", subtotal: 30_000, source: "admin" });
  await order(ctxA.tenantId, { placedAt: "2026-03-10T06:00:00Z", subtotal: 999_000, status: "cancelled" });
  await order(ctxA.tenantId, { placedAt: "2026-03-12T06:00:00Z", subtotal: 20_000, currency: "USD" });
  await order(ctxB.tenantId, { placedAt: "2026-03-05T06:00:00Z", subtotal: 777_000 });

  // Traffic on 5 March (India): visitor 1 lands from Instagram, views a product, adds to cart, reaches checkout; visitor 2 bounces.
  await event(ctxA.tenantId, "198.51.100.1", "pageview", "/", "2026-03-05T05:00:00Z", "https://instagram.com/p/1");
  await event(ctxA.tenantId, "198.51.100.1", "pageview", "/products/tea", "2026-03-05T05:01:00Z");
  await event(ctxA.tenantId, "198.51.100.1", "add_to_cart", "/products/tea", "2026-03-05T05:02:00Z");
  await event(ctxA.tenantId, "198.51.100.1", "pageview", "/checkout", "2026-03-05T05:03:00Z");
  await event(ctxA.tenantId, "198.51.100.2", "pageview", "/collections/all", "2026-03-05T07:00:00Z");
  await event(ctxB.tenantId, "198.51.100.3", "pageview", "/", "2026-03-05T07:00:00Z");
  await rollupTrafficForTenant(web._db.db, ctxA.tenantId, RANGE);
  await rollupTrafficForTenant(web._db.db, ctxB.tenantId, RANGE);
});

describe("analytics overview (real database)", () => {
  it("totals match the orders: store timezone, no cancelled orders, one currency, comparison range", async () => {
    const o = await getAnalyticsOverview(web, ctxA, { ...RANGE, compareFrom: "2026-02-01", compareTo: "2026-02-28" });
    expect(o.currency).toBe("INR");
    expect(o.timezone).toBe("Asia/Kolkata");
    expect(o.currencies).toEqual(["INR", "USD"]);
    // March in India: 100000 + 40000 + 30000 (28 Feb 20:00 UTC). Not the 31 March 20:00 UTC order, the cancelled one or the USD one.
    expect(o.kpis.orders).toEqual({ value: 3, previous: 1 });
    expect(o.breakdown.grossSales.value).toBe(170_000);
    expect(o.breakdown.discounts.value).toBe(10_000);
    expect(o.breakdown.shipping.value).toBe(5_000);
    expect(o.breakdown.netSales.value).toBe(160_000);
    expect(o.kpis.totalSales).toEqual({ value: 165_000, previous: 50_000 });
    expect(o.kpis.averageOrderValue.value).toBe(55_000);
    // Three customers bought in March; one had bought before.
    expect(o.kpis.returningCustomerRate.value).toBeCloseTo(33.3, 1);
    expect(o.kpis.sessions.value).toBe(2);
    // Three web orders in any currency (the admin one is not a storefront conversion) over two measured visits.
    expect(o.kpis.conversionRate.value).toBe(150);
    expect(o.series.reduce((s, p) => s + p.total, 0)).toBe(165_000);
    expect(o.series.find((p) => p.bucket === "2026-03-05")).toMatchObject({ orders: 2, total: 135_000, sessions: 2 });
    expect(o.previousSeries).toHaveLength(o.series.length);
    expect(o.byChannel).toEqual([
      { channel: "web", total: 135_000, orders: 2 },
      { channel: "admin", total: 30_000, orders: 1 },
    ]);
    expect(o.byMarket.map((m) => m.currency).sort()).toEqual(["INR", "USD"]);
  });

  it("equals a direct SQL sum over orders for the same range and timezone", async () => {
    const o = await getAnalyticsOverview(web, ctxA, RANGE);
    const res = await withTenant(web._db.db, ctxA.tenantId, (tx) =>
      tx.execute<{ total: string }>(sql`
        SELECT COALESCE(sum(grand_total), 0) AS total FROM orders
        WHERE status <> 'cancelled' AND currency = 'INR'
          AND (placed_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN '2026-03-01' AND '2026-03-31'`),
    );
    expect(o.kpis.totalSales.value).toBe(Number(res.rows[0]!.total));
  });

  it("another store sees only its own numbers", async () => {
    const o = await getAnalyticsOverview(web, ctxB, RANGE);
    expect(o.kpis.orders.value).toBe(1);
    expect(o.kpis.totalSales.value).toBe(777_000);
    expect(o.kpis.sessions.value).toBe(1);
  });

  it("refuses staff without analytics.read, and bad ranges", async () => {
    const noPerm = { ...ctxA, permissions: ["orders.read"] } as TenantContext;
    await expect(getAnalyticsOverview(web, noPerm, RANGE)).rejects.toThrow(/Forbidden/);
    await expect(getAnalyticsReport(web, noPerm, { ...RANGE, id: "sales_over_time" })).rejects.toThrow(/Forbidden/);
    await expect(getAnalyticsOverview(web, ctxA, { from: "2026-03-31", to: "2026-03-01" })).rejects.toThrow(/Bad Request/);
    await expect(getAnalyticsOverview(web, ctxA, { from: "2020-01-01", to: "2026-03-01" })).rejects.toThrow(/Bad Request/);
  });
});

describe("analytics reports (real database)", () => {
  it("every report in the catalogue runs and returns rows that match its columns", async () => {
    for (const meta of ANALYTICS_REPORTS) {
      const r = await getAnalyticsReport(web, ctxA, { ...RANGE, id: meta.id });
      expect(r.id).toBe(meta.id);
      expect(r.columns.length).toBeGreaterThan(0);
      for (const row of r.rows) expect(Object.keys(row).sort()).toEqual(r.columns.map((c) => c.key).sort());
      if (r.chart) expect(r.columns.map((c) => c.key)).toEqual(expect.arrayContaining([r.chart.x, ...r.chart.series]));
    }
  });

  it("traffic: referrer, landing page and the funnel come from the rollup", async () => {
    const ref = await getAnalyticsReport(web, ctxA, { ...RANGE, id: "sessions_by_referrer" });
    expect(ref.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "instagram.com", type: "Social", sessions: 1, carts: 1, checkouts: 1 }),
        expect.objectContaining({ key: "(direct)", type: "Direct", sessions: 1 }),
      ]),
    );
    const landing = await getAnalyticsReport(web, ctxA, { ...RANGE, id: "sessions_by_landing" });
    expect(landing.rows.map((r) => r.key).sort()).toEqual(["/", "/collections/all"]);
    const funnel = await getAnalyticsReport(web, ctxA, { ...RANGE, id: "conversion_funnel" });
    expect(funnel.rows.map((r) => r.sessions)).toEqual([2, 1, 1, 1, 3]);
    const bounce = await getAnalyticsReport(web, ctxA, { ...RANGE, id: "bounce_rate_over_time" });
    expect(bounce.rows.find((r) => r.bucket === "2026-03-05")).toMatchObject({ sessions: 2, bounces: 1, rate: 50 });
  });

  it("new vs returning sales and location", async () => {
    const nvr = await getAnalyticsReport(web, ctxA, { ...RANGE, id: "sales_new_vs_returning" });
    expect(nvr.rows).toEqual([
      { customer_type: "New", orders: 2, total: 70_000 },
      { customer_type: "Returning", orders: 1, total: 95_000 },
    ]);
    const loc = await getAnalyticsReport(web, ctxA, { ...RANGE, id: "orders_by_location" });
    expect(loc.rows[0]).toMatchObject({ state: "West Bengal", city: "Darjeeling", orders: 3 });
  });

  it("the rollup is idempotent, and maintenance prunes old raw events while rollups stay", async () => {
    const again = await rollupTrafficForTenant(web._db.db, ctxA.tenantId, RANGE);
    expect(again.rows).toBeGreaterThan(0);
    expect((await getAnalyticsOverview(web, ctxA, RANGE)).kpis.sessions.value).toBe(2);
    await withTenant(web._db.db, ctxA.tenantId, (tx) =>
      tx.execute(sql`UPDATE analytics_events SET occurred_at = now() - interval '200 days' WHERE tenant_id = ${ctxA.tenantId}`),
    );
    const res = await runAnalyticsMaintenance(web._db.db);
    expect(res.failed).toBe(0);
    expect(res.prunedEvents).toBeGreaterThanOrEqual(5);
    const left = await withTenant(web._db.db, ctxA.tenantId, (tx) => tx.select().from(schema.analyticsEvents));
    expect(left).toHaveLength(0);
    expect((await getAnalyticsOverview(web, ctxA, RANGE)).kpis.sessions.value).toBe(2);
  });
});
