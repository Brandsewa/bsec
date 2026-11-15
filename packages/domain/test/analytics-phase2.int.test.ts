import { beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { STORE_PERMISSIONS } from "@bs/auth";
import { createRuntime, getAnalyticsReport, provisionTenant, type Runtime, type TenantContext } from "../src/index.ts";
import { createActiveProduct } from "./helpers/factories.ts";

const MARCH = { from: "2026-03-01", to: "2026-03-31" };
const SINCE_JAN = { from: "2026-01-01", to: new Date().toISOString().slice(0, 10) };

let env: TestDb;
let platform: Runtime;
let web: Runtime;
let ctx: TenantContext;
let other: TenantContext;
let tea: string;
let mug: string;
let honey: string;
let teaItemInOrderX = "";

let n = 0;
interface Line { title: string; variantId: string; qty: number; unit: number; cost?: number; discount?: number }
async function order(
  t: TenantContext,
  o: { at: string; email: string; items?: Line[]; status?: string; cancelReason?: string; cancelledAt?: string; grand?: number },
): Promise<string> {
  n += 1;
  const items = o.items ?? [];
  const subtotal = items.reduce((s, i) => s + i.qty * i.unit, 0);
  const grand = o.grand ?? subtotal;
  return withTenant(web._db.db, t.tenantId, async (tx) => {
    const [row] = await tx
      .insert(schema.orders)
      .values({
        tenantId: t.tenantId, number: `P2-${n}`, email: o.email, phone: "9999999999", currency: "INR", status: o.status ?? "confirmed",
        subtotal, grandTotal: grand, shippingAddress: { state: "WB", city: "Darjeeling" }, source: "web", placedAt: new Date(o.at),
        ...(o.cancelReason !== undefined ? { cancelReason: o.cancelReason } : {}),
        ...(o.cancelledAt ? { cancelledAt: new Date(o.cancelledAt) } : {}),
      })
      .returning({ id: schema.orders.id });
    const orderId = row!.id;
    for (const i of items) {
      const [it] = await tx
        .insert(schema.orderItems)
        .values({
          tenantId: t.tenantId, orderId, variantId: i.variantId, productTitle: i.title, quantity: i.qty, unitPrice: i.unit,
          discountAmount: i.discount ?? 0, total: i.qty * i.unit, costPrice: i.cost ?? null,
        })
        .returning({ id: schema.orderItems.id });
      if (i.title === "Tea" && teaItemInOrderX === "" && o.email === "x@buyers.test") teaItemInOrderX = it!.id;
    }
    return orderId;
  });
}

const report = (id: Parameters<typeof getAnalyticsReport>[2]["id"], range: { from: string; to: string } = MARCH, t: TenantContext = ctx) =>
  getAnalyticsReport(web, t, { ...range, id });
const find = (rows: Array<Record<string, string | number | null>>, key: string, value: string) => rows.find((r) => r[key] === value);

beforeAll(async () => {
  env = await startTestDb();
  platform = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  web = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5 });
  const r = Math.random().toString(36).slice(2, 7);
  const mk = async (name: string): Promise<TenantContext> => {
    const t = await provisionTenant(platform, {
      storeName: `P2 ${name}`, slug: `p2-${name}-${r}`, owner: { email: `o-${name}-${r}@p2.test`, name }, planCode: "starter", source: "platform_admin",
    });
    return { tenantId: t.tenantId, storeStatus: "live", actor: { type: "staff", userId: t.ownerId }, roles: ["store_owner"], permissions: [...STORE_PERMISSIONS], requestId: `req-${name}` };
  };
  ctx = await mk("a");
  other = await mk("b");
  tea = (await createActiveProduct(web, ctx, { title: "Tea", price: 50_000, sku: "P2-TEA", stock: 100 })).variantId;
  mug = (await createActiveProduct(web, ctx, { title: "Mug", price: 20_000, sku: "P2-MUG", stock: 100 })).variantId;
  honey = (await createActiveProduct(web, ctx, { title: "Honey", price: 30_000, sku: "P2-HONEY", stock: 100 })).variantId;
  await withTenant(web._db.db, ctx.tenantId, async (tx) => {
    await tx.execute(sql`UPDATE variants SET cost_price = 30000 WHERE id = ${tea}`);
    await tx.execute(sql`UPDATE variants SET cost_price = 10000 WHERE id = ${mug}`);
  });

  // Cohorts: three January first-timers, two in February, one this month.
  const noon = (d: string) => `${d}T07:00:00Z`;
  for (const [email, d] of [["alice@c.test", "2026-01-10"], ["bob@c.test", "2026-01-15"], ["carol@c.test", "2026-01-20"], ["dave@c.test", "2026-02-03"], ["eve@c.test", "2026-02-09"],
    ["alice@c.test", "2026-02-12"], ["dave@c.test", "2026-03-03"], ["bob@c.test", "2026-03-05"], ["alice@c.test", "2026-04-01"]] as const) {
    await order(ctx, { at: noon(d), email, grand: 10_000 });
  }
  await order(ctx, { at: new Date().toISOString(), email: "frank@c.test", grand: 10_000 });

  // March product orders.
  const L = (title: string, variantId: string, qty: number, unit: number, cost?: number): Line => ({ title, variantId, qty, unit, ...(cost !== undefined ? { cost } : {}) });
  await order(ctx, { at: noon("2026-03-10"), email: "x@buyers.test", items: [L("Tea", tea, 2, 50_000, 30_000), L("Mug", mug, 1, 20_000)] });
  await order(ctx, { at: noon("2026-03-11"), email: "y@buyers.test", items: [L("Tea", tea, 1, 50_000, 30_000), L("Mug", mug, 1, 20_000)] });
  await order(ctx, { at: noon("2026-03-12"), email: "z@buyers.test", items: [L("Tea", tea, 1, 50_000, 30_000), L("Honey", honey, 1, 30_000)] });

  // Cancellations.
  await order(ctx, { at: noon("2026-03-02"), email: "c1@x.test", status: "cancelled", cancelReason: "Out of stock", cancelledAt: noon("2026-03-08"), grand: 10_000 });
  await order(ctx, { at: noon("2026-03-02"), email: "c2@x.test", status: "cancelled", cancelReason: "Out of stock", cancelledAt: noon("2026-03-09"), grand: 20_000 });
  await order(ctx, { at: noon("2026-03-02"), email: "c3@x.test", status: "cancelled", cancelReason: "Customer request", cancelledAt: noon("2026-03-12"), grand: 5_000 });
  await order(ctx, { at: noon("2026-03-02"), email: "c4@x.test", status: "cancelled", cancelReason: "", cancelledAt: noon("2026-03-15"), grand: 1_000 });

  // Returns: two units of Tea for "Too small"; a rejected return does not count.
  await withTenant(web._db.db, ctx.tenantId, async (tx) => {
    const [orderX] = await tx.select({ id: schema.orderItems.orderId }).from(schema.orderItems).where(eq(schema.orderItems.id, teaItemInOrderX));
    const mkReturn = async (num: string, status: string, reason: string) =>
      (await tx.insert(schema.returns).values({ tenantId: ctx.tenantId, orderId: orderX!.id, number: num, status, reason, createdAt: new Date(noon("2026-03-20")) }).returning({ id: schema.returns.id }))[0]!.id;
    const good = await mkReturn("RET-P2-1", "approved", "Too small");
    const bad = await mkReturn("RET-P2-2", "rejected", "Changed my mind");
    await tx.insert(schema.returnItems).values([
      { tenantId: ctx.tenantId, returnId: good, orderItemId: teaItemInOrderX, quantity: 2 },
      { tenantId: ctx.tenantId, returnId: bad, orderItemId: teaItemInOrderX, quantity: 1 },
    ]);
  });

  // Stock movements.
  await withTenant(web._db.db, ctx.tenantId, async (tx) => {
    const [lvl] = await tx.select({ loc: schema.inventoryLevels.locationId }).from(schema.inventoryLevels).where(eq(schema.inventoryLevels.variantId, tea));
    const m = (delta: number, reason: string) => ({ tenantId: ctx.tenantId, variantId: tea, locationId: lvl!.loc, delta, reason, createdAt: new Date(noon("2026-03-14")) });
    await tx.insert(schema.inventoryMovements).values([m(50, "received"), m(10, "received"), m(-2, "sold"), m(1, "return")]);
  });
});

describe("customers (real database)", () => {
  it("cohorts: share of first-time customers who ordered again, months not reached are blank", async () => {
    const r = await report("customer_cohorts", SINCE_JAN);
    const jan = find(r.rows, "cohort", "2026-01")!;
    expect(jan).toMatchObject({ customers: 3, m1: 33.3, m2: 33.3, m3: 33.3, m4: 0, m5: 0, m6: 0 });
    const feb = find(r.rows, "cohort", "2026-02")!;
    expect(feb).toMatchObject({ customers: 2, m1: 50, m2: 0 });
    const thisMonth = r.rows.find((row) => String(row["cohort"]) === new Date().toISOString().slice(0, 7));
    expect(thisMonth).toBeDefined();
    expect(thisMonth!["m1"]).toBeNull();
  });

  it("RFM: every customer is in exactly one segment", async () => {
    const r = await report("rfm_segments", SINCE_JAN);
    const total = r.rows.reduce((s, row) => s + Number(row["customers"]), 0);
    const distinct = await withTenant(web._db.db, ctx.tenantId, async (tx) =>
      Number(
        (await tx.execute<{ n: number }>(sql`SELECT count(DISTINCT lower(email::text))::int AS n FROM orders WHERE status <> 'cancelled' AND currency = 'INR'`)).rows[0]?.n,
      ),
    );
    expect(total).toBe(distinct);
    expect(Math.round(r.rows.reduce((s, row) => s + Number(row["share"]), 0))).toBeGreaterThanOrEqual(99);
    for (const row of r.rows) expect(["Champions", "Loyal customers", "Potential loyalists", "New customers", "At risk", "About to sleep", "Lost"]).toContain(row["segment"]);
  });
});

describe("orders (real database)", () => {
  it("cancellation reasons group by reason and count lost sales; an empty reason is (none given)", async () => {
    const r = await report("cancellation_reasons");
    expect(find(r.rows, "reason", "Out of stock")).toMatchObject({ orders: 2, total: 30_000 });
    expect(find(r.rows, "reason", "Customer request")).toMatchObject({ orders: 1, total: 5_000 });
    expect(find(r.rows, "reason", "(none given)")).toMatchObject({ orders: 1, total: 1_000 });
  });

  it("returned products with reasons count approved returns only", async () => {
    const r = await report("returned_products_reasons");
    expect(r.rows).toEqual([{ product: "Tea", reason: "Too small", items: 2, returns: 1 }]);
  });

  it("items bought together lists each pair once with the orders they share", async () => {
    const r = await report("items_bought_together");
    expect(find(r.rows, "product_a", "Mug")).toMatchObject({ product_b: "Tea", orders: 2 });
    expect(find(r.rows, "product_a", "Honey")).toMatchObject({ product_b: "Tea", orders: 1 });
    expect(r.rows).toHaveLength(2);
  });
});

describe("inventory (real database)", () => {
  it("sell-through is units sold over units sold plus on hand", async () => {
    const r = await report("inventory_sell_through");
    expect(find(r.rows, "product", "Tea")).toMatchObject({ sold: 4, on_hand: 100, rate: 3.8 });
    expect(find(r.rows, "product", "Honey")).toMatchObject({ sold: 1, on_hand: 100, rate: 1 });
  });

  it("ABC classes follow the 80 and 95 percent lines", async () => {
    const r = await report("inventory_abc");
    expect(find(r.rows, "product", "Tea")).toMatchObject({ sales: 200_000, class: "A" });
    expect(find(r.rows, "product", "Mug")).toMatchObject({ sales: 40_000, class: "A" });
    expect(find(r.rows, "product", "Honey")).toMatchObject({ sales: 30_000, class: "B" });
    expect(Number(r.rows.at(-1)!["cumulative"])).toBeCloseTo(100, 0);
  });

  it("movements are grouped by reason with units in, out and net", async () => {
    const r = await report("inventory_adjustments");
    expect(find(r.rows, "reason", "received")).toMatchObject({ movements: 2, units_in: 60, units_out: 0, net: 60 });
    expect(find(r.rows, "reason", "sold")).toMatchObject({ movements: 1, units_in: 0, units_out: 2, net: -2 });
    expect(find(r.rows, "reason", "return")).toMatchObject({ net: 1 });
  });

  it("inventory value is on hand times cost, and says which variants have no cost", async () => {
    const r = await report("inventory_value");
    expect(find(r.rows, "product", "Tea")).toMatchObject({ on_hand: 100, cost: 30_000, value: 3_000_000 });
    expect(find(r.rows, "product", "Mug")).toMatchObject({ value: 1_000_000 });
    expect(find(r.rows, "product", "Honey")!["value"]).toBeNull();
    expect(r.note).toMatch(/1 variant has no cost price/);
    expect(r.note).toMatch(/40,000/);
  });
});

describe("profit (real database)", () => {
  it("profit by product uses lines with a cost price and says how many were left out", async () => {
    const r = await report("profit_by_product");
    expect(r.rows).toEqual([{ product: "Tea", units: 4, sales: 200_000, cost: 120_000, profit: 80_000, margin: 40 }]);
    expect(r.note).toMatch(/3 order lines have no cost price/);
  });

  it("profit over time adds up to the same profit", async () => {
    const r = await report("profit_over_time");
    expect(r.rows.reduce((s, row) => s + Number(row["profit"]), 0)).toBe(80_000);
    expect(r.rows.reduce((s, row) => s + Number(row["sales"]), 0)).toBe(200_000);
  });
});

describe("isolation (real database)", () => {
  it("another store sees none of these", async () => {
    for (const id of ["customer_cohorts", "rfm_segments", "cancellation_reasons", "returned_products_reasons", "items_bought_together", "inventory_abc", "inventory_adjustments", "inventory_value", "profit_by_product", "profit_over_time"] as const) {
      const r = await report(id, SINCE_JAN, other);
      const withData = r.rows.filter((row) => Object.values(row).some((v) => typeof v === "number" && v > 0));
      expect(withData, id).toEqual([]);
    }
  });
});
