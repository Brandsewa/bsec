import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { primaryCategory } from "./helpers/primary-category.ts";
import {
  adjustInventory,
  cancelAdminOrder,
  createProduct,
  createRuntime,
  listInventoryLevels,
  placeOrder,
  provisionTenant,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";
import { addToCart, getOrCreateCart } from "../src/storefront/cart.ts";
import { expireOldReservations } from "../src/catalog/inventory-reservations.ts";
import { eq } from "drizzle-orm";
import { schema } from "@bs/db";

let env: TestDb;
let rt: Runtime;
let rtWeb: Runtime;
let ctx: TenantContext;
let variantId: string;
let locationId: string;

const buyer = (cartToken: string) => ({
  cartToken,
  idempotencyKey: `idem_${cartToken}`,
  email: "buyer@cancel-test.example",
  phone: "9876543210",
  fullName: "Test Buyer",
  addressLine1: "1 Test Street",
  city: "Testville",
  state: "Karnataka",
  pincode: "560001",
  paymentMethod: "cod" as const,
});

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  rtWeb = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5 });
  const t = await provisionTenant(rt, { storeName: "cancel-a", slug: "cancel-a", owner: { email: "owner@cancel-a.test", name: "A" }, planCode: "starter", source: "platform_admin" });
  ctx = {
    tenantId: t.tenantId,
    storeStatus: "live",
    actor: { type: "staff", userId: t.ownerId },
    roles: ["store_owner"],
    permissions: ["products.read", "products.write", "orders.read", "orders.write", "settings.write"],
    requestId: "req-test",
  };
  await createProduct(rtWeb, ctx, { title: "Pickle", status: "active", primaryCategoryId: await primaryCategory(rtWeb, ctx), variants: [{ sku: "CANCEL-1", title: "Default", price: 10000 }] });
  const row = (await listInventoryLevels(rtWeb, ctx, {})).items[0]!;
  variantId = row.variantId;
  locationId = row.locationId;
  await adjustInventory(rtWeb, ctx, { variantId, locationId, quantityDelta: 10, reason: "received" });
}, 180_000);

afterAll(async () => {
  await rt?.close();
  await rtWeb?.close();
  await env?.stop();
});

const stock = async () => (await listInventoryLevels(rtWeb, ctx, {})).items[0]!;

describe("cancelling an order gives its stock back", () => {
  it("a placed COD order reserves stock, and cancelling releases it", async () => {
    const cart = await getOrCreateCart(rtWeb, ctx, "tok-cancel-1");
    await addToCart(rtWeb, ctx, { token: cart.token, variantId, quantity: 2 });
    const placed = await placeOrder(rtWeb, ctx, buyer(cart.token));

    expect(await stock()).toMatchObject({ onHand: 10, reserved: 2, available: 8 });

    await cancelAdminOrder(rtWeb, ctx, { id: placed.orderId, reason: "Cancelled by store staff" });

    expect(await stock()).toMatchObject({ onHand: 10, reserved: 0, available: 10 });
  });

  it("an unpaid COD order shows no payment due once cancelled", async () => {
    const cart = await getOrCreateCart(rtWeb, ctx, "tok-cancel-4");
    await addToCart(rtWeb, ctx, { token: cart.token, variantId, quantity: 1 });
    const placed = await placeOrder(rtWeb, ctx, buyer(cart.token));
    const before = await rt._db.db.select().from(schema.orders).where(eq(schema.orders.id, placed.orderId));
    expect(before[0]?.paymentStatus).toBe("cod_pending");

    await cancelAdminOrder(rtWeb, ctx, { id: placed.orderId, reason: "Cancelled by store staff" });

    const after = await rt._db.db.select().from(schema.orders).where(eq(schema.orders.id, placed.orderId));
    expect(after[0]).toMatchObject({ status: "cancelled", paymentStatus: "cancelled" });
    const intents = await rt._db.db.select().from(schema.paymentIntents).where(eq(schema.paymentIntents.orderId, placed.orderId));
    expect(intents.map((i) => i.status)).toEqual(["cancelled"]);
  });

  it("the stock is back exactly once (cancelling again is refused and changes nothing)", async () => {
    const cart = await getOrCreateCart(rtWeb, ctx, "tok-cancel-2");
    await addToCart(rtWeb, ctx, { token: cart.token, variantId, quantity: 1 });
    const placed = await placeOrder(rtWeb, ctx, buyer(cart.token));
    await cancelAdminOrder(rtWeb, ctx, { id: placed.orderId, reason: "first" });
    await expect(cancelAdminOrder(rtWeb, ctx, { id: placed.orderId, reason: "second" })).rejects.toThrow();
    expect(await stock()).toMatchObject({ reserved: 0, available: 10 });
  });

  it("the background sweep gives back stock still held by an order that was cancelled before this fix", async () => {
    const cart = await getOrCreateCart(rtWeb, ctx, "tok-cancel-3");
    await addToCart(rtWeb, ctx, { token: cart.token, variantId, quantity: 3 });
    const placed = await placeOrder(rtWeb, ctx, buyer(cart.token));
    expect(await stock()).toMatchObject({ reserved: 3 });

    // an order cancelled the old way: status flipped, reservation left active
    await rt._db.db.update(schema.orders).set({ status: "cancelled" }).where(eq(schema.orders.id, placed.orderId));
    expect(await stock()).toMatchObject({ reserved: 3 });

    const res = await expireOldReservations(rt._db.db, ctx.tenantId);
    expect(res.expiredCount).toBe(1);
    expect(await stock()).toMatchObject({ reserved: 0, available: 10 });

    // the same sweep also clears the stale "COD pending" payment on that cancelled order
    const healed = await rt._db.db.select().from(schema.orders).where(eq(schema.orders.id, placed.orderId));
    expect(healed[0]?.paymentStatus).toBe("cancelled");
    const intents = await rt._db.db.select().from(schema.paymentIntents).where(eq(schema.paymentIntents.orderId, placed.orderId));
    expect(intents.map((i) => i.status)).toEqual(["cancelled"]);

    // idempotent
    expect((await expireOldReservations(rt._db.db, ctx.tenantId)).expiredCount).toBe(0);
    expect(await stock()).toMatchObject({ reserved: 0, available: 10 });
  });
});
