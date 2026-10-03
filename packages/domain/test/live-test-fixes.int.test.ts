import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import {
  advanceAdminOrder,
  cancelAdminOrder,
  createAdminDraftOrder,
  createAdminFulfillment,
  createProduct,
  createRuntime,
  listAdminOrders,
  provisionTenant,
  updateProduct,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";
import { STORE_PERMISSIONS } from "@bs/auth";
import { primaryCategory } from "./helpers/primary-category.ts";

/**
 * Defects found by driving the live admin and storefront, each pinned by a test:
 *  - an order created in the admin as cash on delivery never became "COD collected" when delivered;
 *  - an order with every unit shipped read "Partially fulfilled";
 *  - the Unfulfilled view listed cancelled orders;
 *  - switching "price on request" on overwrote every variant price with 0, for good.
 */

let env: TestDb;
let rt: Runtime;
let ctx: TenantContext;
let variantAId: string;
let variantBId: string;

const address = { fullName: "Live Test", line1: "12 Test Road", city: "Bengaluru", state: "Karnataka", pincode: "560001" };

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 10 });
  const run = Math.random().toString(36).slice(2, 7);
  const t = await provisionTenant(rt, {
    storeName: `Live Fixes ${run}`,
    slug: `live-fixes-${run}`,
    owner: { email: `owner-${run}@livefixes.test`, name: "Owner" },
    planCode: "starter",
    source: "platform_admin",
  });
  ctx = {
    tenantId: t.tenantId,
    storeStatus: "live",
    actor: { type: "staff", userId: t.ownerId },
    roles: ["store_owner"],
    permissions: [...STORE_PERMISSIONS],
    requestId: "req-live-fixes",
  };

  const a = await createProduct(rt, ctx, { title: "Pickle Powder", status: "active", primaryCategoryId: await primaryCategory(rt, ctx), variants: [{ sku: "PICK-1", title: "Default", price: 10000 }] });
  const b = await createProduct(rt, ctx, { title: "Spice Mix", status: "active", primaryCategoryId: await primaryCategory(rt, ctx), variants: [{ sku: "SPICE-1", title: "Default", price: 20000 }] });
  variantAId = a.variants[0]!.id;
  variantBId = b.variants[0]!.id;

  const loc = (await withTenant(rt._db.db, ctx.tenantId, (tx) => tx.select().from(schema.locations).where(eq(schema.locations.tenantId, ctx.tenantId)).limit(1)))[0]!;
  await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    await tx.insert(schema.inventoryLevels).values([
      { tenantId: ctx.tenantId, locationId: loc.id, variantId: variantAId, onHand: 50 },
      { tenantId: ctx.tenantId, locationId: loc.id, variantId: variantBId, onHand: 50 },
    ]);
  });
}, 180_000);

async function codOrder(variantIds: string[] = [variantAId]) {
  return createAdminDraftOrder(rt, ctx, {
    email: "cod@livefixes.test",
    phone: "9800000001",
    shippingAddress: address,
    items: variantIds.map((variantId) => ({ variantId, quantity: 1 })),
    paymentOutcome: "cod",
  });
}

async function orderRow(orderId: string) {
  return (await withTenant(rt._db.db, ctx.tenantId, (tx) => tx.select().from(schema.orders).where(eq(schema.orders.id, orderId))))[0]!;
}

describe("admin COD orders collect their cash on delivery", () => {
  it("records the payment as cod_pending, like a storefront checkout", async () => {
    const o = await codOrder();
    const [intent] = await withTenant(rt._db.db, ctx.tenantId, (tx) =>
      tx.select().from(schema.paymentIntents).where(and(eq(schema.paymentIntents.orderId, o.orderId), eq(schema.paymentIntents.provider, "cod"))),
    );
    expect(intent?.status).toBe("cod_pending");
  });

  it("marking it delivered collects the cash: payment becomes cod_collected", async () => {
    const o = await codOrder();
    await advanceAdminOrder(rt, ctx, { id: o.orderId, to: "delivered" });
    const row = await orderRow(o.orderId);
    expect(row.status).toBe("delivered");
    expect(row.paymentStatus).toBe("cod_collected");
  });

  it("also collects for orders already stuck with a COD payment recorded as 'created' (made before the fix)", async () => {
    const o = await codOrder();
    await withTenant(rt._db.db, ctx.tenantId, (tx) =>
      tx.update(schema.paymentIntents).set({ status: "created" }).where(and(eq(schema.paymentIntents.orderId, o.orderId), eq(schema.paymentIntents.provider, "cod"))),
    );
    await advanceAdminOrder(rt, ctx, { id: o.orderId, to: "delivered" });
    expect((await orderRow(o.orderId)).paymentStatus).toBe("cod_collected");
    const [intent] = await withTenant(rt._db.db, ctx.tenantId, (tx) =>
      tx.select().from(schema.paymentIntents).where(eq(schema.paymentIntents.orderId, o.orderId)),
    );
    expect(intent?.status).toBe("cod_collected");
  });
});

describe("fulfillment status", () => {
  it("an order whose every unit is shipped reads fulfilled, not partially fulfilled", async () => {
    const o = await codOrder();
    await advanceAdminOrder(rt, ctx, { id: o.orderId, to: "shipped" });
    expect((await orderRow(o.orderId)).fulfillmentStatus).toBe("fulfilled");
    await advanceAdminOrder(rt, ctx, { id: o.orderId, to: "delivered" });
    expect((await orderRow(o.orderId)).fulfillmentStatus).toBe("delivered");
  });

  it("stays partially fulfilled while some units have not been shipped", async () => {
    const o = await codOrder([variantAId, variantBId]);
    const items = await withTenant(rt._db.db, ctx.tenantId, (tx) => tx.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, o.orderId)));
    await createAdminFulfillment(rt, ctx, { id: o.orderId, carrier: "TestCourier", items: [{ orderItemId: items[0]!.id, quantity: items[0]!.quantity }] });
    await advanceAdminOrder(rt, ctx, { id: o.orderId, to: "shipped" });
    expect((await orderRow(o.orderId)).fulfillmentStatus).toBe("partially_fulfilled");
  });
});

describe("order views", () => {
  it("the Unfulfilled view does not list a cancelled order", async () => {
    const o = await codOrder();
    const before = await listAdminOrders(rt, ctx, { view: "unfulfilled", limit: 100 });
    expect(before.items.some((x) => x.id === o.orderId)).toBe(true);

    await cancelAdminOrder(rt, ctx, { id: o.orderId, reason: "test" });
    const after = await listAdminOrders(rt, ctx, { view: "unfulfilled", limit: 100 });
    expect(after.items.some((x) => x.id === o.orderId)).toBe(false);
  });
});

describe("price on request", () => {
  it("is the flag alone: switching it on and off leaves the variant price untouched", async () => {
    const p = await createProduct(rt, ctx, { title: "Quote Only Item", status: "active", primaryCategoryId: await primaryCategory(rt, ctx), variants: [{ sku: "QUOTE-1", title: "Default", price: 45000 }] });
    const variantId = p.variants[0]!.id;
    const price = async () =>
      (await withTenant(rt._db.db, ctx.tenantId, (tx) => tx.select({ price: schema.variants.price }).from(schema.variants).where(eq(schema.variants.id, variantId))))[0]!.price;

    await updateProduct(rt, ctx, { id: p.id, priceOnRequest: true });
    expect(await price()).toBe(45000n);
    await updateProduct(rt, ctx, { id: p.id, priceOnRequest: false });
    expect(await price()).toBe(45000n);
  });

  it("creating a product as price on request keeps the price it was given", async () => {
    const p = await createProduct(rt, ctx, { title: "Quote Only New", status: "active", primaryCategoryId: await primaryCategory(rt, ctx), priceOnRequest: true, variants: [{ sku: "QUOTE-2", title: "Default", price: 30000 }] });
    const [v] = await withTenant(rt._db.db, ctx.tenantId, (tx) => tx.select({ price: schema.variants.price }).from(schema.variants).where(eq(schema.variants.id, p.variants[0]!.id)));
    expect(v?.price).toBe(30000n);
  });
});
