import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { primaryCategory } from "./helpers/primary-category.ts";
import { schema, withTenant } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import {
  advanceAdminOrder,
  changePreorderShipDate,
  confirmAdminOrder,
  createProduct,
  createRuntime,
  getPreorderStats,
  listPreorders,
  placeOrder,
  provisionTenant,
  releasePreorderNow,
  runPreorderReminderSweep,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";
import { addToCart, getOrCreateCart } from "../src/storefront/cart.ts";
import { STORE_PERMISSIONS } from "@bs/auth";

let env: TestDb;
let rt: Runtime;
let rtWeb: Runtime;
let ctxA: TenantContext;
let ctxB: TenantContext;
let normalVariantId: string;
let outOfStockNormalVariantId: string;
let preorderVariant1Id: string;
let preorderVariant2Id: string;
let tenantBVariantId: string;
let locAId: string;

const buyer = (cartToken: string) => ({
  cartToken,
  idempotencyKey: `idem_${cartToken}_${Date.now()}_${Math.random()}`,
  email: "buyer@preorders.test",
  phone: "9876543210",
  fullName: "Preorder Buyer",
  addressLine1: "456 Indiranagar",
  city: "Bengaluru",
  state: "Karnataka",
  pincode: "560038",
  paymentMethod: "cod" as const,
});

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 10 });
  rtWeb = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 10 });

  // Provision Tenant A
  const tA = await provisionTenant(rt, {
    storeName: "Preorder Store A",
    slug: "preorders-a",
    owner: { email: "owner-a@preorder.test", name: "Owner A" },
    planCode: "starter",
    source: "platform_admin",
  });
  ctxA = {
    tenantId: tA.tenantId,
    storeStatus: "live",
    actor: { type: "staff", userId: tA.ownerId },
    roles: ["store_owner"],
    permissions: [...STORE_PERMISSIONS],
    requestId: "req-preorder-a",
  };

  // Provision Tenant B
  const tB = await provisionTenant(rt, {
    storeName: "Preorder Store B",
    slug: "preorders-b",
    owner: { email: "owner-b@preorder.test", name: "Owner B" },
    planCode: "starter",
    source: "platform_admin",
  });
  ctxB = {
    tenantId: tB.tenantId,
    storeStatus: "live",
    actor: { type: "staff", userId: tB.ownerId },
    roles: ["store_owner"],
    permissions: [...STORE_PERMISSIONS],
    requestId: "req-preorder-b",
  };

  // Get locations for Tenant A
  const locsA = await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) =>
    tx.select().from(schema.locations).where(eq(schema.locations.tenantId, ctxA.tenantId)).limit(1),
  );
  locAId = locsA[0]!.id;

  // 1. Normal product with stock
  const pNormal = await createProduct(rtWeb, ctxA, {
    title: "Normal In-Stock Mug",
    status: "active", primaryCategoryId: await primaryCategory(rtWeb, ctxA),
    variants: [{ sku: "MUG-01", title: "Default", price: 50000 }],
  });
  normalVariantId = pNormal.variants[0]!.id;
  await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) => {
    await tx.insert(schema.inventoryLevels).values([
      { tenantId: ctxA.tenantId, locationId: locAId, variantId: normalVariantId, onHand: 10 },
    ]);
  });

  // 2. Normal product with 0 stock
  const pOutOfStock = await createProduct(rtWeb, ctxA, {
    title: "Normal Zero Stock Plate",
    status: "active", primaryCategoryId: await primaryCategory(rtWeb, ctxA),
    variants: [{ sku: "PLATE-01", title: "Default", price: 60000 }],
  });
  outOfStockNormalVariantId = pOutOfStock.variants[0]!.id;
  // 0 stock: no inventory level or 0 onHand

  // 3. Preorder product 1 (ships 2026-12-01)
  const pPreorder1 = await createProduct(rtWeb, ctxA, {
    title: "Artisan Ceramic Bowl (Pre-order)",
    status: "active", primaryCategoryId: await primaryCategory(rtWeb, ctxA),
    variants: [
      {
        sku: "BOWL-PRE-1",
        title: "Blue Glaze",
        price: 120000,
        preorderEnabled: true,
        preorderShipsOn: "2026-12-01",
        preorderMessage: "Crafted in small batches",
      },
    ],
  });
  preorderVariant1Id = pPreorder1.variants[0]!.id;

  // 4. Preorder product 2 (ships 2026-12-15)
  const pPreorder2 = await createProduct(rtWeb, ctxA, {
    title: "Handmade Teapot (Pre-order)",
    status: "active", primaryCategoryId: await primaryCategory(rtWeb, ctxA),
    variants: [
      {
        sku: "TEAPOT-PRE-2",
        title: "Clay",
        price: 250000,
        preorderEnabled: true,
        preorderShipsOn: "2026-12-15",
        preorderMessage: "Fired in wood kiln",
      },
    ],
  });
  preorderVariant2Id = pPreorder2.variants[0]!.id;

  // Create product in Tenant B
  const pTenantB = await createProduct(rtWeb, ctxB, {
    title: "Tenant B Product",
    status: "active", primaryCategoryId: await primaryCategory(rtWeb, ctxB),
    variants: [
      {
        sku: "TB-01",
        title: "Default",
        price: 100000,
        preorderEnabled: true,
        preorderShipsOn: "2026-12-01",
      },
    ],
  });
  tenantBVariantId = pTenantB.variants[0]!.id;
}, 180_000);

afterAll(async () => {
  await rt?.close();
  await rtWeb?.close();
  await env?.stop();
});

describe("Pre-orders: Simple Dispatch Model", () => {
  it("refuses zero-stock checkout for normal variants but allows for preorder variants", async () => {
    // Zero-stock normal variant throws InsufficientInventoryError
    const cart1 = await getOrCreateCart(rtWeb, ctxA, "cart_tok_zero_normal");
    await addToCart(rtWeb, ctxA, { token: cart1.token, variantId: outOfStockNormalVariantId, quantity: 1 });
    await expect(placeOrder(rtWeb, ctxA, buyer(cart1.token))).rejects.toThrow(/insufficient inventory/i);

    // Preorder variant at 0 stock succeeds and snapshots ships_on
    const cart2 = await getOrCreateCart(rtWeb, ctxA, "cart_tok_preorder_single");
    await addToCart(rtWeb, ctxA, { token: cart2.token, variantId: preorderVariant1Id, quantity: 2 });
    const placed = await placeOrder(rtWeb, ctxA, buyer(cart2.token));

    expect(placed.orderId).toBeDefined();

    // Verify order.shipsOn snapshot and order_items.shipsOn snapshot
    const [order] = await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) =>
      tx.select().from(schema.orders).where(eq(schema.orders.id, placed.orderId)),
    );
    expect(order!.shipsOn).toBe("2026-12-01");
    expect(order!.preorderReleasedAt).toBeNull();

    const items = await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) =>
      tx.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, placed.orderId)),
    );
    expect(items.length).toBe(1);
    expect(items[0]!.shipsOn).toBe("2026-12-01");
  });

  it("handles mixed cart: order ships on latest date and reserves only normal stock", async () => {
    // Initial normal variant onHand is 10
    const [levelBefore] = await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.inventoryLevels)
        .where(
          and(
            eq(schema.inventoryLevels.tenantId, ctxA.tenantId),
            eq(schema.inventoryLevels.variantId, normalVariantId),
          ),
        ),
    );
    const initialOnHand = levelBefore!.onHand;

    // Mixed cart: 1 Normal Mug + 1 Preorder Bowl (2026-12-01) + 1 Preorder Teapot (2026-12-15)
    const cart = await getOrCreateCart(rtWeb, ctxA, "cart_tok_mixed_1");
    await addToCart(rtWeb, ctxA, { token: cart.token, variantId: normalVariantId, quantity: 1 });
    await addToCart(rtWeb, ctxA, { token: cart.token, variantId: preorderVariant1Id, quantity: 1 });
    await addToCart(rtWeb, ctxA, { token: cart.token, variantId: preorderVariant2Id, quantity: 1 });

    const placed = await placeOrder(rtWeb, ctxA, buyer(cart.token));

    // Order ships_on must be the latest date: 2026-12-15
    const [order] = await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) =>
      tx.select().from(schema.orders).where(eq(schema.orders.id, placed.orderId)),
    );
    expect(order!.shipsOn).toBe("2026-12-15");

    // Line items snapshots
    const items = await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) =>
      tx.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, placed.orderId)),
    );
    expect(items.length).toBe(3);

    const normalItem = items.find((i) => i.variantId === normalVariantId)!;
    const p1Item = items.find((i) => i.variantId === preorderVariant1Id)!;
    const p2Item = items.find((i) => i.variantId === preorderVariant2Id)!;

    expect(normalItem.shipsOn).toBeNull();
    expect(p1Item.shipsOn).toBe("2026-12-01");
    expect(p2Item.shipsOn).toBe("2026-12-15");

    // Check inventory reservation: normal variant was reserved (held)
    const [levelAfter] = await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.inventoryLevels)
        .where(
          and(
            eq(schema.inventoryLevels.tenantId, ctxA.tenantId),
            eq(schema.inventoryLevels.variantId, normalVariantId),
          ),
        ),
    );
    expect(levelAfter!.reserved).toBe(levelBefore!.reserved + 1);
    expect(levelAfter!.onHand).toBe(initialOnHand);
  });

  it("enforces preorder hold: shipping is blocked before promised date unless released early", async () => {
    const cart = await getOrCreateCart(rtWeb, ctxA, "cart_tok_hold_test");
    await addToCart(rtWeb, ctxA, { token: cart.token, variantId: preorderVariant2Id, quantity: 1 });
    const placed = await placeOrder(rtWeb, ctxA, buyer(cart.token));

    await confirmAdminOrder(rtWeb, ctxA, { id: placed.orderId });

    // Attempting to advance to shipped should be blocked by preorder hold
    await expect(
      advanceAdminOrder(rtWeb, ctxA, {
        id: placed.orderId,
        to: "shipped",
        carrier: "Blue Dart",
        awb: "BD-12345",
      }),
    ).rejects.toThrow(/pre-order/i);

    // Release early via releasePreorderNow
    const releaseRes = await releasePreorderNow(rtWeb, ctxA, { id: placed.orderId });
    expect(releaseRes.success).toBe(true);

    // Verify order timeline and audit log
    const events = await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.orderEvents)
        .where(
          and(
            eq(schema.orderEvents.tenantId, ctxA.tenantId),
            eq(schema.orderEvents.orderId, placed.orderId),
            eq(schema.orderEvents.type, "order.preorder_released"),
          ),
        ),
    );
    expect(events.length).toBe(1);

    const auditLogs = await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.auditLogs)
        .where(
          and(
            eq(schema.auditLogs.tenantId, ctxA.tenantId),
            eq(schema.auditLogs.targetId, placed.orderId),
            eq(schema.auditLogs.action, "order.preorder_released"),
          ),
        ),
    );
    expect(auditLogs.length).toBe(1);

    // Now advancing to shipped succeeds
    await advanceAdminOrder(rtWeb, ctxA, {
      id: placed.orderId,
      to: "shipped",
      carrier: "Blue Dart",
      awb: "BD-12345",
    });

    const [updatedOrder] = await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) =>
      tx.select().from(schema.orders).where(eq(schema.orders.id, placed.orderId)),
    );
    expect(updatedOrder!.status).toBe("fulfilled");
  });

  it("lists preorders and aggregates stats correctly", async () => {
    const listRes = await listPreorders(rtWeb, ctxA, { view: "all" });
    expect(listRes.total).toBeGreaterThanOrEqual(2);
    expect(listRes.items.length).toBeGreaterThanOrEqual(2);
    expect(listRes.items[0]!.shipsOn).toBeDefined();

    const stats = await getPreorderStats(rtWeb, ctxA);
    expect(stats.openPreorders).toBeGreaterThanOrEqual(1);
  });

  it("changes ship date for preorders with timeline event and audit logging", async () => {
    const cart = await getOrCreateCart(rtWeb, ctxA, "cart_tok_change_date");
    await addToCart(rtWeb, ctxA, { token: cart.token, variantId: preorderVariant1Id, quantity: 1 });
    const placed = await placeOrder(rtWeb, ctxA, buyer(cart.token));

    const newDate = "2026-12-25";
    const changeRes = await changePreorderShipDate(rtWeb, ctxA, {
      orderIds: [placed.orderId],
      shipsOn: newDate,
      reason: "Artisan supplier delay",
    });

    expect(changeRes.updatedCount).toBe(1);
    expect(changeRes.skippedCount).toBe(0);

    // Verify order and item updated
    const [order] = await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) =>
      tx.select().from(schema.orders).where(eq(schema.orders.id, placed.orderId)),
    );
    expect(order!.shipsOn).toBe(newDate);

    const items = await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) =>
      tx.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, placed.orderId)),
    );
    expect(items[0]!.shipsOn).toBe(newDate);

    // Verify timeline event
    const events = await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.orderEvents)
        .where(
          and(
            eq(schema.orderEvents.tenantId, ctxA.tenantId),
            eq(schema.orderEvents.orderId, placed.orderId),
            eq(schema.orderEvents.type, "order.preorder_date_changed"),
          ),
        ),
    );
    expect(events.length).toBe(1);
    expect(events[0]!.message).toContain("Artisan supplier delay");
  });

  it("runs preorder reminder sweep idempotently 2 days before dispatch date", async () => {
    // Target date for sweep is today + 2 days
    const targetDateObj = new Date();
    targetDateObj.setDate(targetDateObj.getDate() + 2);
    const targetDate = targetDateObj.toISOString().slice(0, 10);

    // Create an order scheduled on targetDate
    const cart = await getOrCreateCart(rtWeb, ctxA, "cart_tok_sweep_test");
    await addToCart(rtWeb, ctxA, { token: cart.token, variantId: preorderVariant1Id, quantity: 1 });
    const placed = await placeOrder(rtWeb, ctxA, buyer(cart.token));

    // Force shipsOn to targetDate
    await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) => {
      await tx
        .update(schema.orders)
        .set({ shipsOn: targetDate })
        .where(and(eq(schema.orders.tenantId, ctxA.tenantId), eq(schema.orders.id, placed.orderId)));
    });

    // Run sweep 1: sends reminder
    const res1 = await runPreorderReminderSweep(rtWeb._db.db, undefined, ctxA.tenantId);
    expect(res1.remindersSent).toBeGreaterThanOrEqual(1);

    // Check order event was logged
    const events = await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.orderEvents)
        .where(
          and(
            eq(schema.orderEvents.tenantId, ctxA.tenantId),
            eq(schema.orderEvents.orderId, placed.orderId),
            eq(schema.orderEvents.type, "order.preorder_reminder_sent"),
          ),
        ),
    );
    expect(events.length).toBe(1);

    // Run sweep 2 immediately: idempotent, 0 additional reminders sent for this order
    const res2 = await runPreorderReminderSweep(rtWeb._db.db, undefined, ctxA.tenantId);
    expect(res2.remindersSent).toBe(0);
  });

  it("preserves strict tenant isolation", async () => {
    // Cart in Tenant B
    const cartB = await getOrCreateCart(rtWeb, ctxB, "cart_tok_tenant_b");
    await addToCart(rtWeb, ctxB, { token: cartB.token, variantId: tenantBVariantId, quantity: 1 });
    const placedB = await placeOrder(rtWeb, ctxB, buyer(cartB.token));

    // Tenant A listing should NOT contain Tenant B's order
    const listA = await listPreorders(rtWeb, ctxA, { view: "all" });
    const orderBInA = listA.items.find((i) => i.id === placedB.orderId);
    expect(orderBInA).toBeUndefined();

    // Tenant A cannot release Tenant B's order
    await expect(releasePreorderNow(rtWeb, ctxA, { id: placedB.orderId })).rejects.toThrow();

    // Tenant A cannot change ship date on Tenant B's order
    const changeRes = await changePreorderShipDate(rtWeb, ctxA, {
      orderIds: [placedB.orderId],
      shipsOn: "2026-12-30",
    });
    expect(changeRes.updatedCount).toBe(0);
  });
});
