import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pino from "pino";
import { encryptSecret } from "@bs/payments";
import type { Transporter } from "nodemailer";
import { setPlatformEmailTransportFactory } from "../src/system/platform-mailer.ts";
import { handleFulfillmentShippedJob } from "../src/jobs.ts";
import { and, eq } from "drizzle-orm";
import { primaryCategory } from "./helpers/primary-category.ts";
import { schema, withTenant } from "@bs/db";
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
  lookupOrderForTracking,
  getOrderSettings,
  updateOrderSettings,
  readTrackingConfig,
  getOrderByActionToken,
  loadOrderTracking,
  listInventoryLevels,
  placeOrder,
  provisionTenant,
  requestReturn,
  shipAdminOrderItems,
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

const rwWebDb = () => rtWeb._db.db;
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

  it("ships an order in two parcels: partial first, then the rest, each with its own tracking", async () => {
    const placed = await place(5);
    const [line] = await rt._db.db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, placed.orderId));

    await shipAdminOrderItems(rtWeb, ctx, { id: placed.orderId, items: [{ orderItemId: line!.id, quantity: 4 }], carrier: "Bluedart", awb: "BD-1", trackingUrl: "https://track.example/BD-1" });
    let o = await orderRow(placed.orderId);
    expect(o).toMatchObject({ status: "partially_fulfilled", fulfillmentStatus: "partially_fulfilled" });
    expect((await rt._db.db.select().from(schema.orderItems).where(eq(schema.orderItems.id, line!.id)))[0]!.fulfilledQty).toBe(4);

    // only one unit is left, so asking for two is refused and changes nothing
    expect(await errorOf(shipAdminOrderItems(rtWeb, ctx, { id: placed.orderId, items: [{ orderItemId: line!.id, quantity: 2 }] }))).toMatch(/Only 1 of/);

    const second = await shipAdminOrderItems(rtWeb, ctx, { id: placed.orderId, items: [{ orderItemId: line!.id, quantity: 1 }], carrier: "India Post", awb: "IP-9", notify: true });
    expect(second.fullyShipped).toBe(true);
    o = await orderRow(placed.orderId);
    expect(o).toMatchObject({ status: "fulfilled", fulfillmentStatus: "fulfilled" });
    const fs = await rt._db.db.select().from(schema.fulfillments).where(eq(schema.fulfillments.orderId, placed.orderId));
    expect(fs.map((f) => f.awb).sort()).toEqual(["BD-1", "IP-9"]);
    expect(fs.find((f) => f.awb === "BD-1")?.trackingUrl).toBe("https://track.example/BD-1");
  });

  it("the shopper's tracking view lists each parcel, the items not shipped yet and a safe timeline", async () => {
    const placed = await place(3);
    const [line] = await rt._db.db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, placed.orderId));
    const view = () =>
      withTenant(rt._db.db, ctx.tenantId, async (tx) => {
        const o = await orderRow(placed.orderId);
        const rows = await tx.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, placed.orderId));
        return loadOrderTracking(tx, ctx.tenantId, placed.orderId, o.placedAt, rows);
      });

    let t = await view();
    expect(t.shipments).toHaveLength(0);
    expect(t.unshipped).toEqual([expect.objectContaining({ orderItemId: line!.id, quantity: 3 })]);
    expect(t.timeline.map((e) => e.label)).toEqual(["Order placed"]);

    await shipAdminOrderItems(rtWeb, ctx, { id: placed.orderId, items: [{ orderItemId: line!.id, quantity: 2 }], carrier: "Bluedart", awb: "BD-7", trackingUrl: "https://track.example/BD-7" });
    t = await view();
    expect(t.shipments).toHaveLength(1);
    expect(t.shipments[0]).toMatchObject({ carrier: "Bluedart", awb: "BD-7", trackingUrl: "https://track.example/BD-7", status: "in_transit" });
    expect(t.shipments[0]!.items).toEqual([expect.objectContaining({ quantity: 2 })]);
    expect(t.shipments[0]!.events.length).toBeGreaterThan(0);
    expect(t.unshipped).toEqual([expect.objectContaining({ quantity: 1 })]);
    // staff wording never leaks: every label comes from the fixed list
    expect(t.timeline.map((e) => e.label)).not.toContain("Order confirmed: Confirmed by the store");
    expect(t.timeline.at(-1)!.label).toBe("Order placed");

    await shipAdminOrderItems(rtWeb, ctx, { id: placed.orderId, items: [{ orderItemId: line!.id, quantity: 1 }], carrier: "India Post", awb: "IP-2" });
    t = await view();
    expect(t.shipments.map((s) => s.awb)).toEqual(["BD-7", "IP-2"]);
    expect(t.unshipped).toEqual([]);
  });

  it("public lookup: number plus the order's email or phone opens it, every failure looks the same, repeats are throttled", async () => {
    const placed = await place(1);
    const o = await orderRow(placed.orderId);
    const ip = `10.9.${++n}.1`;
    const db = rtWeb._db.db;

    const byEmail = await lookupOrderForTracking(db, ctx.tenantId, { number: ` ${o.number.toLowerCase()} `, contact: "B@LIFE.example", ip });
    expect(byEmail).toMatch(/^ord_/);
    expect((await getOrderByActionToken(db, ctx.tenantId, byEmail!))?.id).toBe(placed.orderId);
    const viaPhone = await lookupOrderForTracking(db, ctx.tenantId, { number: o.number, contact: "+91 98765-43210", ip });
    expect(viaPhone).toMatch(/^ord_/);
    expect(await lookupOrderForTracking(db, ctx.tenantId, { number: o.number.replace("#", ""), contact: "b@life.example", ip })).toMatch(/^ord_/); // typed without the #

    // wrong contact, unknown number, too-short phone: all just null
    expect(await lookupOrderForTracking(db, ctx.tenantId, { number: o.number, contact: "other@life.example", ip })).toBeNull();
    expect(await lookupOrderForTracking(db, ctx.tenantId, { number: o.number, contact: "9876543211", ip })).toBeNull();
    expect(await lookupOrderForTracking(db, ctx.tenantId, { number: "ORD-99999", contact: "b@life.example", ip })).toBeNull();
    expect(await lookupOrderForTracking(db, ctx.tenantId, { number: o.number, contact: "3210", ip })).toBeNull();

    // the same address keeps guessing: blocked after its limit
    const errs: string[] = [];
    for (let i = 0; i < 12; i++) {
      const e = await errorOf(lookupOrderForTracking(db, ctx.tenantId, { number: `ORD-9${i}`, contact: "x@y.example", ip }));
      if (e) errs.push(e);
    }
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]).toMatch(/Too many attempts/);
  });

  it("tracking settings are saved with the order settings, keep the numbering rules, and fill the carrier link and honour the lookup method", async () => {
    const sctx = { ...ctx, permissions: [...ctx.permissions, "settings.read", "orders.settings.manage"] };
    const before = await getOrderSettings(rtWeb, sctx);
    const saved = await updateOrderSettings(rtWeb, sctx, {
      tracking: { ...before.tracking, lookup: "email", estimatedDeliveryDays: 5, carriers: [{ name: "Bluedart", urlTemplate: "https://track.example/bd?n={awb}" }] },
    });
    expect(saved.tracking).toMatchObject({ lookup: "email", estimatedDeliveryDays: 5 });
    expect(saved.prefix).toBe(before.prefix);
    expect(saved.stockHoldMinutes).toBe(before.stockHoldMinutes);
    expect((await readTrackingConfig(rtWeb._db.db, ctx.tenantId)).carriers[0]?.name).toBe("Bluedart");
    // a later save of only the numbering must not wipe the tracking block
    await updateOrderSettings(rtWeb, sctx, { stockHoldMinutes: 31 });
    expect((await getOrderSettings(rtWeb, sctx)).tracking.lookup).toBe("email");

    const placed = await place(1);
    const o = await orderRow(placed.orderId);
    const [line] = await rt._db.db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, placed.orderId));
    await shipAdminOrderItems(rtWeb, ctx, { id: placed.orderId, items: [{ orderItemId: line!.id, quantity: 1 }], carrier: "bluedart", awb: "X 9" });
    const [f] = await rt._db.db.select().from(schema.fulfillments).where(eq(schema.fulfillments.orderId, placed.orderId));
    expect(f!.trackingUrl).toBe("https://track.example/bd?n=X%209");

    // email-only store: a correct phone number is just a miss
    const ip = `10.8.${++n}.1`;
    expect(await lookupOrderForTracking(rtWeb._db.db, ctx.tenantId, { number: o.number, contact: "9876543210", ip, method: "email" })).toBeNull();
    expect(await lookupOrderForTracking(rtWeb._db.db, ctx.tenantId, { number: o.number, contact: "b@life.example", ip, method: "email" })).toMatch(/^ord_/);

    await updateOrderSettings(rtWeb, sctx, { tracking: { ...before.tracking } }); // restore defaults for the other tests
  });

  it("the shipped email carries the parcel's carrier link, tracking number and contents, and one email per parcel", async () => {
    const sent: Array<{ html: string; text: string; subject: string }> = [];
    setPlatformEmailTransportFactory(() => ({ sendMail: async (m: { html: string; text: string; subject: string }) => (sent.push(m), { messageId: "m" }) }) as unknown as Transporter);
    const enc = encryptSecret("mock-token");
    await rt._db.db
      .insert(schema.platformEmailSettings)
      .values({ id: "default", passwordCiphertext: enc.ciphertext, passwordIv: enc.iv, keyVersion: 1, fromEmail: "no-reply@bcom.si", enabled: true })
      .onConflictDoUpdate({ target: schema.platformEmailSettings.id, set: { passwordCiphertext: enc.ciphertext, passwordIv: enc.iv, enabled: true } });

    const placed = await place(3);
    const [line] = await rt._db.db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, placed.orderId));
    const first = await shipAdminOrderItems(rtWeb, ctx, { id: placed.orderId, items: [{ orderItemId: line!.id, quantity: 2 }], carrier: "Bluedart", awb: "BD-55", trackingUrl: "https://track.example/BD-55" });
    await handleFulfillmentShippedJob(rwWebDb(), pino({ level: "silent" }), { tenantId: ctx.tenantId, orderId: placed.orderId, fulfillmentId: first.fulfillmentId });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain("Carrier: Bluedart.");
    expect(sent[0]!.text).toContain("Tracking number: BD-55.");
    expect(sent[0]!.text).toContain("Track with Bluedart: https://track.example/BD-55");
    expect(sent[0]!.text).toContain("x 2");
    expect(sent[0]!.html).toContain("/o/ord_"); // the order-status link
    setPlatformEmailTransportFactory(null);
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
