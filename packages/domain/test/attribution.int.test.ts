import { beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { STORE_PERMISSIONS } from "@bs/auth";
import {
  addToCart,
  createRuntime,
  getAnalyticsReport,
  getOrCreateCart,
  placeOrder,
  provisionTenant,
  recordAnalyticsEvent,
  resolveOrderAttribution,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";
import { createActiveProduct } from "./helpers/factories.ts";

const SECRET = "attribution-test-secret";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36";
const today = () => new Date().toISOString().slice(0, 10);
const RANGE = () => ({ from: today(), to: today() });

let env: TestDb;
let platform: Runtime;
let web: Runtime;
let ctx: TenantContext;
let other: TenantContext;
let variantId: string;

async function visit(t: TenantContext, ip: string, path: string, opts: { referrer?: string; search?: string; ua?: string } = {}) {
  const res = await recordAnalyticsEvent(
    web,
    t.tenantId,
    { type: "pageview", path, ip, userAgent: opts.ua ?? UA, referrer: opts.referrer, search: opts.search, ownHost: "shop.test" },
    { secret: SECRET },
  );
  expect(res).toBe("recorded");
}

/** Places a COD order the way the storefront route does: attribution resolved from the visitor's page views, then passed to placeOrder. */
async function order(t: TenantContext, ip: string, qty = 1) {
  const attribution = await resolveOrderAttribution(web, t.tenantId, { ip, userAgent: UA }, { secret: SECRET });
  const cart = await getOrCreateCart(web, t);
  await addToCart(web, t, { token: cart.token, variantId, quantity: qty });
  const r = await placeOrder(web, t, {
    attribution,
    cartToken: cart.token,
    email: `buyer-${ip}@attr.test`,
    phone: "9876543210",
    fullName: "Buyer",
    addressLine1: "1 Tea Lane",
    city: "Darjeeling",
    state: "WB",
    pincode: "734101",
    paymentMethod: "cod",
  });
  return { orderId: r.orderId, attribution };
}

const attributionOf = (t: TenantContext, orderId: string) =>
  withTenant(web._db.db, t.tenantId, async (tx) => (await tx.select().from(schema.orderAttribution).where(eq(schema.orderAttribution.orderId, orderId)))[0]);

beforeAll(async () => {
  env = await startTestDb();
  platform = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  web = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5 });
  const r = Math.random().toString(36).slice(2, 7);
  const mk = async (name: string): Promise<TenantContext> => {
    const t = await provisionTenant(platform, {
      storeName: `Attr ${name}`, slug: `attr-${name}-${r}`, owner: { email: `o-${name}-${r}@attr.test`, name }, planCode: "starter", source: "platform_admin",
    });
    return { tenantId: t.tenantId, storeStatus: "live", actor: { type: "staff", userId: t.ownerId }, roles: ["store_owner"], permissions: [...STORE_PERMISSIONS], requestId: `req-${name}` };
  };
  ctx = await mk("a");
  other = await mk("b");
  variantId = (await createActiveProduct(web, ctx, { title: "Darjeeling Tea", price: 50_000, sku: "TEA-50" })).variantId;
});

describe("order attribution (real database)", () => {
  it("credits the visitor's last visit from a referrer or campaign link, not a later direct page", async () => {
    await visit(ctx, "198.51.100.10", "/", { referrer: "https://www.google.com/search?q=tea" });
    await visit(ctx, "198.51.100.10", "/products/tea", { referrer: "https://www.instagram.com/p/1", search: "?utm_source=instagram&utm_medium=social&utm_campaign=Diwali" });
    await visit(ctx, "198.51.100.10", "/cart"); // direct page after the campaign visit
    const { orderId, attribution } = await order(ctx, "198.51.100.10");
    expect(attribution).toMatchObject({ referrerHost: "instagram.com", utmSource: "instagram", utmMedium: "social", utmCampaign: "diwali", landingPath: "/products/tea" });
    expect(await attributionOf(ctx, orderId)).toMatchObject({ referrerHost: "instagram.com", utmCampaign: "diwali" });
  });

  it("stores nothing for a direct visitor, a visitor never measured, or a bot", async () => {
    await visit(ctx, "198.51.100.11", "/"); // direct
    const direct = await order(ctx, "198.51.100.11");
    expect(direct.attribution).toBeNull();
    expect(await attributionOf(ctx, direct.orderId)).toBeUndefined();

    const unseen = await order(ctx, "198.51.100.12");
    expect(unseen.attribution).toBeNull();

    expect(await resolveOrderAttribution(web, ctx.tenantId, { ip: "198.51.100.10", userAgent: "Googlebot/2.1" }, { secret: SECRET })).toBeNull();
    expect(await resolveOrderAttribution(web, ctx.tenantId, { ip: "198.51.100.10", userAgent: UA, doNotTrack: true }, { secret: SECRET })).toBeNull();
  });

  it("does not link a different visitor, a different store, or a visit from another day", async () => {
    expect(await resolveOrderAttribution(web, other.tenantId, { ip: "198.51.100.10", userAgent: UA }, { secret: SECRET })).toBeNull();
    expect(await resolveOrderAttribution(web, ctx.tenantId, { ip: "198.51.100.99", userAgent: UA }, { secret: SECRET })).toBeNull();
    const tomorrow = new Date(Date.now() + 86_400_000);
    expect(await resolveOrderAttribution(web, ctx.tenantId, { ip: "198.51.100.10", userAgent: UA }, { secret: SECRET, now: tomorrow })).toBeNull();
  });

  it("sales by referrer, sales by campaign and items by referrer add up to the orders", async () => {
    await visit(ctx, "198.51.100.13", "/", { referrer: "https://www.google.com/" });
    await order(ctx, "198.51.100.13", 2);

    const byRef = await getAnalyticsReport(web, ctx, { ...RANGE(), id: "sales_by_referrer" });
    const row = (rows: typeof byRef.rows, key: string, value: string) => rows.find((r) => r[key] === value)!;
    expect(row(byRef.rows, "referrer", "instagram.com")).toMatchObject({ type: "Social", orders: 1 });
    expect(row(byRef.rows, "referrer", "google.com")).toMatchObject({ type: "Search", orders: 1 });
    expect(row(byRef.rows, "referrer", "(direct)")).toMatchObject({ type: "Direct", orders: 2 });
    expect(byRef.rows.reduce((s, r) => s + Number(r["orders"]), 0)).toBe(4);
    expect(byRef.note).toMatch(/same day/);

    // The three reports together account for exactly the order totals in the database.
    const totalRow = (
      await withTenant(web._db.db, ctx.tenantId, (tx) =>
        tx.execute<{ total: string }>(sql`SELECT COALESCE(sum(grand_total), 0) AS total FROM orders WHERE status <> 'cancelled' AND currency = 'INR'`),
      )
    ).rows[0];
    const total = totalRow?.total ?? "0";
    expect(byRef.rows.reduce((s, r) => s + Number(r["total"]), 0)).toBe(Number(total));

    const byCampaign = await getAnalyticsReport(web, ctx, { ...RANGE(), id: "sales_by_campaign" });
    expect(row(byCampaign.rows, "campaign", "diwali")).toMatchObject({ source: "instagram", medium: "social", orders: 1, total: Number(row(byRef.rows, "referrer", "instagram.com")["total"]) });
    expect(row(byCampaign.rows, "campaign", "(none)")).toMatchObject({ source: "(none)", orders: 3 });
    expect(byCampaign.rows.reduce((s, r) => s + Number(r["total"]), 0)).toBe(Number(total));

    const items = await getAnalyticsReport(web, ctx, { ...RANGE(), id: "items_sold_by_referrer" });
    expect(items.rows).toEqual(expect.arrayContaining([expect.objectContaining({ referrer: "google.com", product: "Darjeeling Tea", quantity: 2 })]));
  });

  it("another store sees none of it", async () => {
    const r = await getAnalyticsReport(web, other, { ...RANGE(), id: "sales_by_referrer" });
    expect(r.rows).toEqual([]);
  });

  it("visitors right now counts distinct visitors in the last 5 minutes and ignores the date range", async () => {
    await visit(ctx, "198.51.100.20", "/products/tea");
    await visit(ctx, "198.51.100.21", "/products/tea");
    await visit(ctx, "198.51.100.21", "/cart");
    const live = await getAnalyticsReport(web, ctx, { from: "2020-01-01", to: "2020-01-02", id: "visitors_right_now" });
    expect(live.rows.find((r) => r["page"] === "/products/tea")).toMatchObject({ visitors: expect.any(Number) });
    expect(Number(live.rows.find((r) => r["page"] === "/products/tea")!["visitors"])).toBeGreaterThanOrEqual(2);
    expect(live.note).toMatch(/visitors? in the last 5 minutes/);

    // An event older than 5 minutes no longer counts.
    await withTenant(web._db.db, ctx.tenantId, (tx) =>
      tx.execute(sql`UPDATE analytics_events SET occurred_at = now() - interval '10 minutes' WHERE visitor_hash IS NOT NULL`),
    );
    const quiet = await getAnalyticsReport(web, ctx, { ...RANGE(), id: "visitors_right_now" });
    expect(quiet.rows).toEqual([]);
    expect(quiet.note).toMatch(/^0 visitors/);
    expect((await getAnalyticsReport(web, other, { ...RANGE(), id: "visitors_right_now" })).rows).toEqual([]);
  });
});
