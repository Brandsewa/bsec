import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { primaryCategory } from "./helpers/primary-category.ts";
import { schema } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import {
  actOnReturn,
  adjustInventory,
  advanceAdminOrder,
  cancelAdminOrder,
  confirmAdminOrder,
  createProduct,
  createRuntime,
  listAdminReturns,
  listInventoryLevels,
  placeOrder,
  provisionTenant,
  requestReturn,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";
import { addToCart, getOrCreateCart } from "../src/storefront/cart.ts";

let env: TestDb;
let rt: Runtime;
let rtWeb: Runtime;
let ctx: TenantContext;
let variantId: string;
let n = 0;

const errorOf = async (p: Promise<unknown>) => (await p.then(() => null, (e: Error) => e))?.message ?? null;
const buyer = (cartToken: string) => ({
  cartToken,
  idempotencyKey: `idem_${cartToken}`,
  email: "b@life.example",
  phone: "9876543210",
  fullName: "Buyer",
  addressLine1: "1 St",
  city: "Pune",
  state: "Maharashtra",
  pincode: "411001",
  paymentMethod: "cod" as const,
});
async function place(qty = 2) {
  const cart = await getOrCreateCart(rtWeb, ctx, `tok-life-${++n}`);
  await addToCart(rtWeb, ctx, { token: cart.token, variantId, quantity: qty });
  return placeOrder(rtWeb, ctx, buyer(cart.token));
}
const orderRow = async (id: string) => (await rt._db.db.select().from(schema.orders).where(eq(schema.orders.id, id)))[0]!;
const stock = async () => (await listInventoryLevels(rtWeb, ctx, {})).items[0]!;

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  rtWeb = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5 });
  const t = await provisionTenant(rt, { storeName: "life-a", slug: "life-a", owner: { email: "o@life-a.test", name: "A" }, planCode: "starter", source: "platform_admin" });
  ctx = {
    tenantId: t.tenantId,
    storeStatus: "live",
    actor: { type: "staff", userId: t.ownerId },
    roles: ["store_owner"],
    permissions: ["products.read", "products.write", "orders.read", "orders.write", "orders.refund"],
    requestId: "r",
  };
  await createProduct(rtWeb, ctx, { title: "Pickle", status: "active", primaryCategoryId: await primaryCategory(rtWeb, ctx), variants: [{ sku: "L-1", title: "Default", price: 10000 }] });
  const row = (await listInventoryLevels(rtWeb, ctx, {})).items[0]!;
  variantId = row.variantId;
  await adjustInventory(rtWeb, ctx, { variantId, locationId: row.locationId, quantityDelta: 50, reason: "received" });
}, 180_000);

afterAll(async () => {
  await rt?.close();
  await rtWeb?.close();
  await env?.stop();
});

describe("hand-run order lifecycle", () => {
  it("confirm, ship and deliver a COD order: statuses, stock and cash collected all follow", async () => {
    const before = await stock();
    const placed = await place(2);
    expect((await stock()).reserved).toBe(before.reserved + 2);

    await confirmAdminOrder(rtWeb, ctx, { id: placed.orderId });
    let o = await orderRow(placed.orderId);
    expect(o.status).toBe("confirmed");
    const afterConfirm = await stock();
    expect(afterConfirm.reserved).toBe(before.reserved); // sold, no longer just held
    expect(afterConfirm.onHand).toBe(before.onHand - 2);

    await advanceAdminOrder(rtWeb, ctx, { id: placed.orderId, to: "shipped", carrier: "Local courier", awb: "LC-1" });
    o = await orderRow(placed.orderId);
    expect(o.status).toBe("fulfilled");
    expect(o.paymentStatus).toBe("cod_pending");
    const [f] = await rt._db.db.select().from(schema.fulfillments).where(eq(schema.fulfillments.orderId, placed.orderId));
    expect(f).toMatchObject({ status: "in_transit", carrier: "Local courier", awb: "LC-1" });

    await advanceAdminOrder(rtWeb, ctx, { id: placed.orderId, to: "delivered" });
    o = await orderRow(placed.orderId);
    expect(o.status).toBe("delivered");
    expect(o.paymentStatus).toBe("cod_collected");
  });

  it("goes straight from a fresh order to delivered in one call", async () => {
    const placed = await place(1);
    await advanceAdminOrder(rtWeb, ctx, { id: placed.orderId, to: "delivered" });
    expect(await orderRow(placed.orderId)).toMatchObject({ status: "delivered", paymentStatus: "cod_collected" });
  });

  it("refuses to confirm twice and to ship a cancelled order", async () => {
    const placed = await place(1);
    await confirmAdminOrder(rtWeb, ctx, { id: placed.orderId });
    expect(await errorOf(confirmAdminOrder(rtWeb, ctx, { id: placed.orderId }))).toMatch(/already confirmed/);
    const other = await place(1);
    await cancelAdminOrder(rtWeb, ctx, { id: other.orderId, reason: "test" });
    expect(await errorOf(advanceAdminOrder(rtWeb, ctx, { id: other.orderId, to: "shipped" }))).toMatch(/cancelled order can't be shipped/);
  });
});

describe("returns", () => {
  async function delivered(qty: number) {
    const placed = await place(qty);
    await advanceAdminOrder(rtWeb, ctx, { id: placed.orderId, to: "delivered" });
    const items = await rt._db.db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, placed.orderId));
    return { placed, item: items[0]! };
  }

  it("only delivered orders can be returned", async () => {
    const placed = await place(1);
    const [item] = await rt._db.db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, placed.orderId));
    expect(await errorOf(requestReturn(rtWeb, ctx, { orderId: placed.orderId, reason: "changed my mind", items: [{ orderItemId: item!.id, quantity: 1 }] }))).toMatch(/Only delivered orders/);
  });

  it("request -> approve -> pick up -> receive (restocked) -> refund -> close, with the right money", async () => {
    const { placed, item } = await delivered(3);
    const onHandBefore = (await stock()).onHand;

    const req = await requestReturn(rtWeb, ctx, { orderId: placed.orderId, reason: "Changed my mind", items: [{ orderItemId: item.id, quantity: 2 }] });
    expect(req.number).toMatch(/^RET-\d+$/);
    expect(await errorOf(requestReturn(rtWeb, ctx, { orderId: placed.orderId, reason: "Changed my mind", items: [{ orderItemId: item.id, quantity: 2 }] }))).toMatch(/at most 1/);

    const listResult = await listAdminReturns(rtWeb, ctx, { view: "needs_review" });
    const listed = listResult.items.find((r) => r.id === req.returnId)!;
    expect(listed).toMatchObject({ reason: "Changed my mind", items: [{ title: "Pickle", quantity: 2 }] });

    for (const action of ["approve", "pick_up", "receive"] as const) await actOnReturn(rtWeb, ctx, { id: req.returnId, action });
    expect((await stock()).onHand).toBe(onHandBefore + 2); // restocked
    const [oi] = await rt._db.db.select().from(schema.orderItems).where(eq(schema.orderItems.id, item.id));
    expect(oi?.returnedQty).toBe(2);

    await actOnReturn(rtWeb, ctx, { id: req.returnId, action: "refund" });
    const [refund] = await rt._db.db.select().from(schema.refunds).where(and(eq(schema.refunds.orderId, placed.orderId)));
    expect(refund).toMatchObject({ amount: Math.round((2 * item.total) / 3), status: "succeeded" });
    const done = await actOnReturn(rtWeb, ctx, { id: req.returnId, action: "close" });
    expect(done.status).toBe("closed");
  });

  it("a rejected return can't be refunded, and a new request is still possible", async () => {
    const { placed, item } = await delivered(1);
    const req = await requestReturn(rtWeb, ctx, { orderId: placed.orderId, reason: "Changed my mind", items: [{ orderItemId: item.id, quantity: 1 }] });
    await actOnReturn(rtWeb, ctx, { id: req.returnId, action: "reject", note: "Outside policy" });
    expect(await errorOf(actOnReturn(rtWeb, ctx, { id: req.returnId, action: "refund" }))).toMatch(/Invalid return transition/);
    const again = await requestReturn(rtWeb, ctx, { orderId: placed.orderId, reason: "Size or fit", items: [{ orderItemId: item.id, quantity: 1 }] });
    expect(again.number).not.toBe(req.number);
  });

  it("an item that isn't on the order or an empty request is refused", async () => {
    const { placed } = await delivered(1);
    expect(await errorOf(requestReturn(rtWeb, ctx, { orderId: placed.orderId, reason: "Changed my mind", items: [{ orderItemId: "01a0f000-0000-7000-8000-000000000000", quantity: 1 }] }))).toMatch(/isn't on this order/);
    expect(await errorOf(requestReturn(rtWeb, ctx, { orderId: placed.orderId, reason: "Changed my mind", items: [] }))).toMatch(/at least one/);
    expect(await errorOf(requestReturn(rtWeb, ctx, { orderId: placed.orderId, reason: "x", items: [] }))).toMatch(/why/);
  });
});
