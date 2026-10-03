import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import {
  createAdminDraftOrder,
  createProduct,
  createRuntime,
  getAdminOrderStats,
  getOrderSettings,
  listAdminOrders,
  placeOrder,
  provisionTenant,
  updateOrderSettings,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";
import { allocateOrderNumber } from "../src/admin/order-settings.ts";
import { addToCart, getOrCreateCart } from "../src/storefront/cart.ts";

import { STORE_PERMISSIONS } from "@bs/auth";

let env: TestDb;
let rt: Runtime;
let rtWeb: Runtime;
let ctxA: TenantContext;
let ctxB: TenantContext;
let variantAId: string;
let variantA2Id: string;
let variantBId: string;

const buyer = (cartToken: string) => ({
  cartToken,
  idempotencyKey: `idem_${cartToken}_${Date.now()}`,
  email: "buyer@orders-phase1.example",
  phone: "9876543210",
  fullName: "Phase1 Buyer",
  addressLine1: "123 MG Road",
  city: "Bengaluru",
  state: "Karnataka",
  pincode: "560001",
  paymentMethod: "cod" as const,
});

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 10 });
  rtWeb = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 10 });

  // Provision Tenant A
  const tA = await provisionTenant(rt, {
    storeName: "Orders A",
    slug: "orders-a",
    owner: { email: "owner-a@phase1.test", name: "Owner A" },
    planCode: "starter",
    source: "platform_admin",
  });
  ctxA = {
    tenantId: tA.tenantId,
    storeStatus: "live",
    actor: { type: "staff", userId: tA.ownerId },
    roles: ["store_owner"],
    permissions: [...STORE_PERMISSIONS],
    requestId: "req-a",
  };

  // Provision Tenant B for isolation test
  const tB = await provisionTenant(rt, {
    storeName: "Orders B",
    slug: "orders-b",
    owner: { email: "owner-b@phase1.test", name: "Owner B" },
    planCode: "starter",
    source: "platform_admin",
  });
  ctxB = {
    tenantId: tB.tenantId,
    storeStatus: "live",
    actor: { type: "staff", userId: tB.ownerId },
    roles: ["store_owner"],
    permissions: [...STORE_PERMISSIONS],
    requestId: "req-b",
  };

  // Create products in Tenant A
  const pA1 = await createProduct(rtWeb, ctxA, {
    title: "Phase One Cotton Shawl",
    status: "active",
    variants: [{ sku: "SCARF-RED", title: "Default", price: 150000 }],
  });
  variantAId = pA1.variants[0]!.id;

  const pA2 = await createProduct(rtWeb, ctxA, {
    title: "Wool Beanie",
    status: "active",
    variants: [{ sku: "BEANIE-BLU", title: "Default", price: 80000 }],
  });
  variantA2Id = pA2.variants[0]!.id;

  // Stock inventory for Tenant A
  // Stock inventory for Tenant A
  const locsA = await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) =>
    tx.select().from(schema.locations).where(eq(schema.locations.tenantId, ctxA.tenantId)).limit(1),
  );
  const locA = locsA[0]!;
  await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) => {
    await tx.insert(schema.inventoryLevels).values([
      { tenantId: ctxA.tenantId, locationId: locA.id, variantId: variantAId, onHand: 100 },
      { tenantId: ctxA.tenantId, locationId: locA.id, variantId: variantA2Id, onHand: 100 },
    ]);
  });

  // Create product in Tenant B
  const pB1 = await createProduct(rtWeb, ctxB, {
    title: "Cotton Shirt",
    status: "active",
    variants: [{ sku: "SHIRT-WHT", title: "Default", price: 120000 }],
  });
  variantBId = pB1.variants[0]!.id;

  const locsB = await withTenant(rtWeb._db.db, ctxB.tenantId, async (tx) =>
    tx.select().from(schema.locations).where(eq(schema.locations.tenantId, ctxB.tenantId)).limit(1),
  );
  const locB = locsB[0]!;
  await withTenant(rtWeb._db.db, ctxB.tenantId, async (tx) => {
    await tx.insert(schema.inventoryLevels).values([
      { tenantId: ctxB.tenantId, locationId: locB.id, variantId: variantBId, onHand: 50 },
    ]);
  });
}, 180_000);

afterAll(async () => {
  await rt?.close();
  await rtWeb?.close();
  await env?.stop();
});

describe("Orders Phase 1: Order Numbering and Settings (Step 0)", () => {
  it("defaults to storeSettings orderPrefix and 5 digits when no sequence row exists", async () => {
    const settings = await getOrderSettings(rtWeb, ctxA);
    expect(settings.prefix).toBe("#ORD-");
    expect(settings.padding).toBe(5);
    expect(settings.currentNextValue).toBe(1);
  });

  it("applies updated prefix, padding, and nextValue to subsequent checkout orders", async () => {
    // Initial checkout order with defaults
    const cart1 = await getOrCreateCart(rtWeb, ctxA, "cart-tok-init-1");
    await addToCart(rtWeb, ctxA, { token: cart1.token, variantId: variantAId, quantity: 1 });
    const order1 = await placeOrder(rtWeb, ctxA, buyer(cart1.token));
    expect(order1.orderNumber).toBe("#ORD-00001");

    // Update settings: prefix = 'PH1-', padding = 4, nextValue = 50
    await updateOrderSettings(rtWeb, ctxA, {
      prefix: "PH1-",
      padding: 4,
      nextValue: 50,
    });

    const updated = await getOrderSettings(rtWeb, ctxA);
    expect(updated.prefix).toBe("PH1-");
    expect(updated.padding).toBe(4);
    expect(updated.currentNextValue).toBe(50);

    // Next checkout order takes the new sequence
    const cart2 = await getOrCreateCart(rtWeb, ctxA, "cart-tok-init-2");
    await addToCart(rtWeb, ctxA, { token: cart2.token, variantId: variantAId, quantity: 1 });
    const order2 = await placeOrder(rtWeb, ctxA, buyer(cart2.token));
    expect(order2.orderNumber).toBe("PH1-0050");

    // Order 1 was not renumbered
    const [existing1] = await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) =>
      tx.select().from(schema.orders).where(eq(schema.orders.id, order1.orderId)),
    );
    expect(existing1?.number).toBe("#ORD-00001");
  });

  it("applies updated settings to admin draft order creation and sets source = 'admin'", async () => {
    const draft = await createAdminDraftOrder(rtWeb, ctxA, {
      email: "staff-cust@example.com",
      phone: "9876500000",
      shippingAddress: {
        line1: "Admin Order St",
        city: "Bengaluru",
        state: "Karnataka",
        pincode: "560001",
      },
      items: [{ variantId: variantA2Id, quantity: 1 }],
    });

    // Following order2 (which was 50), draft order should be 51
    expect(draft.orderNumber).toBe("PH1-0051");

    const [savedDraft] = await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) =>
      tx.select().from(schema.orders).where(eq(schema.orders.id, draft.orderId)),
    );
    expect(savedDraft?.source).toBe("admin");
  });

  it("refuses lowering the next number below the highest issued value", async () => {
    // Current next value is 52 (after 50 and 51 were used)
    const settings = await getOrderSettings(rtWeb, ctxA);
    expect(settings.currentNextValue).toBe(52);

    await expect(
      updateOrderSettings(rtWeb, ctxA, {
        prefix: "PH1-",
        padding: 4,
        nextValue: 30, // Lower than 52!
      }),
    ).rejects.toThrow(/cannot be lower than/i);
  });

  it("proves multi-tenant isolation: Tenant B sequence is untouched by Tenant A updates", async () => {
    const cartB = await getOrCreateCart(rtWeb, ctxB, "cart-tok-b-1");
    await addToCart(rtWeb, ctxB, { token: cartB.token, variantId: variantBId, quantity: 1 });
    const orderB = await placeOrder(rtWeb, ctxB, buyer(cartB.token));

    // Tenant B still has default prefix #ORD- (from slug orders-b) and started at 1
    expect(orderB.orderNumber).toBe("#ORD-00001");

    const settingsB = await getOrderSettings(rtWeb, ctxB);
    expect(settingsB.prefix).toBe("#ORD-");
    expect(settingsB.padding).toBe(5);
    expect(settingsB.currentNextValue).toBe(2);
  });

  it("prevents duplicate numbers under concurrent allocation", async () => {
    // Allocate 10 numbers concurrently
    const allocations = await Promise.all(
      Array.from({ length: 10 }).map(() =>
        withTenant(rtWeb._db.db, ctxA.tenantId, (tx) => allocateOrderNumber(tx, ctxA.tenantId)),
      ),
    );

    const formattedNumbers = allocations.map((a) => a.formatted);
    const unique = new Set(formattedNumbers);
    expect(unique.size).toBe(10);
    for (const num of formattedNumbers) {
      expect(num).toMatch(/^PH1-\d{4}$/);
    }
  });

  it("enforces assertPermission('settings.write') for order settings updates", async () => {
    const readOnlyCtx: TenantContext = {
      ...ctxA,
      permissions: ["settings.read"],
    };

    await expect(
      updateOrderSettings(rtWeb, readOnlyCtx, {
        prefix: "TEST-",
        padding: 4,
        nextValue: 100,
      }),
    ).rejects.toThrow(/missing required permission/i);
  });
});

describe("Orders Phase 1: All Orders Upgrades (Step 1)", () => {
  it("filters orders by source ('admin' vs 'web')", async () => {
    const adminOrders = await listAdminOrders(rtWeb, ctxA, { source: "admin" });
    expect(adminOrders.items.length).toBeGreaterThanOrEqual(1);
    for (const item of adminOrders.items) {
      // In the database these have source = 'admin'
      const [o] = await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) =>
        tx.select({ source: schema.orders.source }).from(schema.orders).where(eq(schema.orders.id, item.id)),
      );
      expect(o?.source).toBe("admin");
    }

    const webOrders = await listAdminOrders(rtWeb, ctxA, { source: "web" });
    expect(webOrders.items.length).toBeGreaterThanOrEqual(1);
    for (const item of webOrders.items) {
      const [o] = await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) =>
        tx.select({ source: schema.orders.source }).from(schema.orders).where(eq(schema.orders.id, item.id)),
      );
      expect(o?.source).toBe("web");
    }
  });

  it("partitions orders by view ('open' vs 'archived')", async () => {
    const openOrders = await listAdminOrders(rtWeb, ctxA, { view: "open" });
    for (const item of openOrders.items) {
      expect(["pending", "confirmed", "processing", "partially_fulfilled"]).toContain(item.status);
    }

    // Cancel one order to test archived view
    const toCancel = openOrders.items[0]!;
    await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) => {
      await tx.update(schema.orders).set({ status: "cancelled" }).where(eq(schema.orders.id, toCancel.id));
    });

    const archivedOrders = await listAdminOrders(rtWeb, ctxA, { view: "archived" });
    const cancelledFound = archivedOrders.items.find((o) => o.id === toCancel.id);
    expect(cancelledFound).toBeDefined();
    for (const item of archivedOrders.items) {
      expect(["delivered", "cancelled", "returned"]).toContain(item.status);
    }
  });

  it("returns firstItemTitle for orders in the list", async () => {
    const list = await listAdminOrders(rtWeb, ctxA, { limit: 10 });
    expect(list.items.length).toBeGreaterThan(0);
    const withItems = list.items.filter((item) => item.itemsCount > 0);
    expect(withItems.length).toBeGreaterThan(0);
    for (const item of withItems) {
      expect(item.firstItemTitle).toBeTruthy();
      expect(typeof item.firstItemTitle).toBe("string");
    }
  });

  it("calculates accurate stats in getAdminOrderStats", async () => {
    const stats = await getAdminOrderStats(rtWeb, ctxA);
    expect(stats.totalOrders).toBeGreaterThanOrEqual(2);
    expect(stats.openOrders).toBeGreaterThanOrEqual(1);
    expect(typeof stats.totalRevenue).toBe("number");
    expect(typeof stats.avgOrderValue).toBe("number");
    expect(stats.paidOrders).toBeGreaterThanOrEqual(0);
  });
});
