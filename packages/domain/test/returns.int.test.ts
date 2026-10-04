import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { primaryCategory } from "./helpers/primary-category.ts";
import { schema, withTenant } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import {
  createProduct,
  createRuntime,
  placeOrder,
  provisionTenant,
  requestReturn,
  cancelReturn,
  actOnReturn,
  getAdminReturnStats,
  listAdminReturns,
  getAdminReturnDetail,
  getReturnSettings,
  updateReturnSettings,
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
let variantA1Id: string;
let variantA2NonReturnableId: string;
let variantBId: string;
let locAId: string;

const buyer = (cartToken: string, email = "buyer@returns.example") => ({
  cartToken,
  idempotencyKey: `idem_${cartToken}_${Date.now()}`,
  email,
  phone: "9876543210",
  fullName: "Return Test Buyer",
  addressLine1: "123 Indiranagar",
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
    storeName: "Returns Store A",
    slug: "returns-store-a",
    owner: { email: "owner-a@returns.test", name: "Owner A" },
    planCode: "starter",
    source: "platform_admin",
  });
  ctxA = {
    tenantId: tA.tenantId,
    storeStatus: "live",
    actor: { type: "staff", userId: tA.ownerId },
    roles: ["store_owner"],
    permissions: [...STORE_PERMISSIONS],
    requestId: "req-ret-a",
  };

  // Provision Tenant B
  const tB = await provisionTenant(rt, {
    storeName: "Returns Store B",
    slug: "returns-store-b",
    owner: { email: "owner-b@returns.test", name: "Owner B" },
    planCode: "starter",
    source: "platform_admin",
  });
  ctxB = {
    tenantId: tB.tenantId,
    storeStatus: "live",
    actor: { type: "staff", userId: tB.ownerId },
    roles: ["store_owner"],
    permissions: [...STORE_PERMISSIONS],
    requestId: "req-ret-b",
  };

  // Create products in Tenant A
  const pA1 = await createProduct(rtWeb, ctxA, {
    title: "Returnable Jacket",
    status: "active", primaryCategoryId: await primaryCategory(rtWeb, ctxA),
    variants: [{ sku: "JKT-001", title: "Default", price: 500000 }], // ₹5000.00
  });
  variantA1Id = pA1.variants[0]!.id;

  const pA2 = await createProduct(rtWeb, ctxA, {
    title: "Final Sale Socks",
    status: "active", primaryCategoryId: await primaryCategory(rtWeb, ctxA),
    returnable: false,
    variants: [{ sku: "SOX-001", title: "Default", price: 30000 }], // ₹300.00
  });
  variantA2NonReturnableId = pA2.variants[0]!.id;

  // Stock inventory for Tenant A
  const locsA = await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) =>
    tx.select().from(schema.locations).where(eq(schema.locations.tenantId, ctxA.tenantId)).limit(1),
  );
  locAId = locsA[0]!.id;
  await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) => {
    await tx.insert(schema.inventoryLevels).values([
      { tenantId: ctxA.tenantId, locationId: locAId, variantId: variantA1Id, onHand: 50 },
      { tenantId: ctxA.tenantId, locationId: locAId, variantId: variantA2NonReturnableId, onHand: 50 },
    ]);
  });

  // Create product in Tenant B
  const pB = await createProduct(rtWeb, ctxB, {
    title: "Tenant B Item",
    status: "active", primaryCategoryId: await primaryCategory(rtWeb, ctxB),
    variants: [{ sku: "B-ITEM", title: "Default", price: 200000 }],
  });
  variantBId = pB.variants[0]!.id;
  const locsB = await withTenant(rtWeb._db.db, ctxB.tenantId, async (tx) =>
    tx.select().from(schema.locations).where(eq(schema.locations.tenantId, ctxB.tenantId)).limit(1),
  );
  await withTenant(rtWeb._db.db, ctxB.tenantId, async (tx) => {
    await tx.insert(schema.inventoryLevels).values([
      { tenantId: ctxB.tenantId, locationId: locsB[0]!.id, variantId: variantBId, onHand: 50 },
    ]);
  });
}, 180_000);

afterAll(async () => {
  await rt?.close();
  await rtWeb?.close();
  await env?.stop();
});

async function createDeliveredOrder(ctx: TenantContext, variantId: string, quantity = 1) {
  const cart = await getOrCreateCart(rtWeb, ctx, undefined);
  await addToCart(rtWeb, ctx, { token: cart.token, variantId, quantity });
  const placed = await placeOrder(rtWeb, ctx, buyer(cart.token));

  await withTenant(rtWeb._db.db, ctx.tenantId, async (tx) => {
    await tx.update(schema.orders).set({ status: "delivered" }).where(eq(schema.orders.id, placed.orderId));
    await tx.insert(schema.fulfillments).values({
      tenantId: ctx.tenantId,
      orderId: placed.orderId,
      locationId: locAId,
      status: "delivered",
      deliveredAt: new Date(),
    });
  });

  const [orderItem] = await withTenant(rtWeb._db.db, ctx.tenantId, async (tx) =>
    tx.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, placed.orderId)),
  );

  return {
    orderId: placed.orderId,
    orderNumber: placed.orderNumber,
    orderItemId: orderItem!.id,
    grandTotal: placed.grandTotal,
  };
}

describe("Returns Test Suite: End-to-End & Boundary Verification", () => {
  it("enforces returnable = false (final sale) products cannot be returned", async () => {
    const delivered = await createDeliveredOrder(ctxA, variantA2NonReturnableId, 1);

    await expect(
      requestReturn(rtWeb, ctxA, {
        orderId: delivered.orderId,
        reason: "Changed my mind",
        resolution: "refund",
        items: [{ orderItemId: delivered.orderItemId, quantity: 1 }],
      }),
    ).rejects.toThrow(/marked final sale and cannot be returned/i);
  });

  it("enforces return window and acceptReturns configuration from settings", async () => {
    const delivered = await createDeliveredOrder(ctxA, variantA1Id, 1);

    // Disable returns in store settings
    await updateReturnSettings(rtWeb, ctxA, { acceptReturns: false });

    await expect(
      requestReturn(rtWeb, ctxA, {
        orderId: delivered.orderId,
        reason: "Changed my mind",
        resolution: "refund",
        items: [{ orderItemId: delivered.orderItemId, quantity: 1 }],
      }),
    ).rejects.toThrow(/not accepted by this store/i);

    // Re-enable returns, but set return window to 1 day and simulate old delivery date (10 days ago)
    await updateReturnSettings(rtWeb, ctxA, { acceptReturns: true, returnWindowDays: 1 });
    await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) => {
      await tx
        .update(schema.fulfillments)
        .set({ deliveredAt: new Date(Date.now() - 10 * 86_400_000) })
        .where(eq(schema.fulfillments.orderId, delivered.orderId));
    });

    await expect(
      requestReturn(rtWeb, ctxA, {
        orderId: delivered.orderId,
        reason: "Changed my mind",
        resolution: "refund",
        items: [{ orderItemId: delivered.orderItemId, quantity: 1 }],
      }),
    ).rejects.toThrow(/return window has passed/i);

    // Reset settings to default
    await updateReturnSettings(rtWeb, ctxA, { acceptReturns: true, returnWindowDays: 30, allowExchanges: true });
  });

  it("allows customer to cancel return while status is requested", async () => {
    const delivered = await createDeliveredOrder(ctxA, variantA1Id, 1);

    const ret = await requestReturn(rtWeb, ctxA, {
      orderId: delivered.orderId,
      reason: "Changed my mind",
      resolution: "refund",
      items: [{ orderItemId: delivered.orderItemId, quantity: 1 }],
    });

    // Cancel while requested
    const cancelRes = await cancelReturn(rtWeb, ctxA, {
      returnId: ret.returnId,
      reason: "Customer changed mind about returning",
    });
    expect(cancelRes.status).toBe("cancelled");

    // Cannot cancel again or act on cancelled return inappropriately
    await expect(
      cancelReturn(rtWeb, ctxA, { returnId: ret.returnId }),
    ).rejects.toThrow(/Only requested returns can be cancelled/i);
  });

  it("enforces legal status ladder and rejects invalid transitions", async () => {
    const delivered = await createDeliveredOrder(ctxA, variantA1Id, 2);

    const ret = await requestReturn(rtWeb, ctxA, {
      orderId: delivered.orderId,
      reason: "Size or fit",
      resolution: "refund",
      items: [{ orderItemId: delivered.orderItemId, quantity: 1 }],
    });

    // Illegal: requested -> received directly without approval
    await expect(
      actOnReturn(rtWeb, ctxA, { id: ret.returnId, action: "receive" }),
    ).rejects.toThrow(/Invalid return transition/i);

    // Legal: requested -> approved
    const appRes = await actOnReturn(rtWeb, ctxA, {
      id: ret.returnId,
      action: "approve",
      decisionMessage: "Please ship the item back to our Indiranagar hub.",
    });
    expect(appRes.status).toBe("approved");

    // Legal: approved -> pick_up
    const pickupRes = await actOnReturn(rtWeb, ctxA, { id: ret.returnId, action: "pick_up" });
    expect(pickupRes.status).toBe("picked_up");

    // Illegal: picked_up -> approve
    await expect(
      actOnReturn(rtWeb, ctxA, { id: ret.returnId, action: "approve" }),
    ).rejects.toThrow(/Invalid return transition/i);

    // Legal: picked_up -> receive
    const recRes = await actOnReturn(rtWeb, ctxA, { id: ret.returnId, action: "receive", restock: true });
    expect(recRes.status).toBe("received");
  });

  it("handles restock tickbox and updates inventory accordingly on receive", async () => {
    const delivered = await createDeliveredOrder(ctxA, variantA1Id, 2);

    const [invBefore] = await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) =>
      tx.select().from(schema.inventoryLevels).where(and(eq(schema.inventoryLevels.tenantId, ctxA.tenantId), eq(schema.inventoryLevels.variantId, variantA1Id))),
    );
    const onHandBefore = invBefore!.onHand;

    const ret = await requestReturn(rtWeb, ctxA, {
      orderId: delivered.orderId,
      reason: "Size or fit",
      resolution: "refund",
      items: [{ orderItemId: delivered.orderItemId, quantity: 2 }],
    });

    await actOnReturn(rtWeb, ctxA, { id: ret.returnId, action: "approve" });

    // Receive with restock = true
    await actOnReturn(rtWeb, ctxA, { id: ret.returnId, action: "receive", restock: true });

    const [invAfter] = await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) =>
      tx.select().from(schema.inventoryLevels).where(and(eq(schema.inventoryLevels.tenantId, ctxA.tenantId), eq(schema.inventoryLevels.variantId, variantA1Id))),
    );
    expect(invAfter!.onHand).toBe(onHandBefore + 2);

    // Verify inventory movement row was written
    const movements = await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) =>
      tx.select().from(schema.inventoryMovements).where(and(eq(schema.inventoryMovements.tenantId, ctxA.tenantId), eq(schema.inventoryMovements.variantId, variantA1Id), eq(schema.inventoryMovements.reason, "return"))),
    );
    expect(movements.length).toBeGreaterThan(0);
  });

  it("enforces refund permission (orders.refund) and max refundable cap", async () => {
    const delivered = await createDeliveredOrder(ctxA, variantA1Id, 1);

    const ret = await requestReturn(rtWeb, ctxA, {
      orderId: delivered.orderId,
      reason: "Changed my mind",
      resolution: "refund",
      items: [{ orderItemId: delivered.orderItemId, quantity: 1 }],
    });

    await actOnReturn(rtWeb, ctxA, { id: ret.returnId, action: "approve" });
    await actOnReturn(rtWeb, ctxA, { id: ret.returnId, action: "receive" });

    // Try to refund without orders.refund permission
    const staffWithoutRefundPerm: TenantContext = {
      ...ctxA,
      permissions: ctxA.permissions.filter((p) => p !== "orders.refund"),
    };

    await expect(
      actOnReturn(rtWeb, staffWithoutRefundPerm, {
        id: ret.returnId,
        action: "refund",
        refundAmount: 100000,
        refundMethod: "bank_transfer",
        refundReference: "REF12345",
      }),
    ).rejects.toThrow(/missing required permission 'orders.refund'/i);

    // Try to refund more than order grandTotal (delivered.grandTotal is around ₹5000)
    await expect(
      actOnReturn(rtWeb, ctxA, {
        id: ret.returnId,
        action: "refund",
        refundAmount: delivered.grandTotal + 100000, // Exceeds cap
        refundMethod: "manual",
        refundReference: "REF-OVER",
      }),
    ).rejects.toThrow(/exceeds maximum refundable amount/i);

    // Successful refund recording (COD order with no payment intent)
    const refundRes = await actOnReturn(rtWeb, ctxA, {
      id: ret.returnId,
      action: "refund",
      refundAmount: delivered.grandTotal,
      refundMethod: "upi",
      refundReference: "UPI-RET-999",
      note: "Refunded via UPI transfer",
    });
    expect(refundRes.status).toBe("refunded");

    // Close return
    const closeRes = await actOnReturn(rtWeb, ctxA, { id: ret.returnId, action: "close", note: "Case completed" });
    expect(closeRes.status).toBe("closed");
  });

  it("records replacement / exchange and tracks exchange details", async () => {
    const delivered = await createDeliveredOrder(ctxA, variantA1Id, 1);
    const exchangeOrder = await createDeliveredOrder(ctxA, variantA1Id, 1);
    const exchangeOrderId = exchangeOrder.orderId;

    const ret = await requestReturn(rtWeb, ctxA, {
      orderId: delivered.orderId,
      reason: "Size or fit",
      resolution: "replacement",
      exchangeRequest: "Please send size L instead of M",
      items: [{ orderItemId: delivered.orderItemId, quantity: 1 }],
    });

    await actOnReturn(rtWeb, ctxA, { id: ret.returnId, action: "approve", resolution: "replacement" });
    await actOnReturn(rtWeb, ctxA, { id: ret.returnId, action: "receive" });

    const replaceRes = await actOnReturn(rtWeb, ctxA, {
      id: ret.returnId,
      action: "replace",
      exchangeNote: "Sent replacement Size L parcel via BlueDart",
      exchangeOrderId,
    });
    expect(replaceRes.status).toBe("replaced");

    const detail = await getAdminReturnDetail(rtWeb, ctxA, { id: ret.returnId });
    expect(detail.status).toBe("replaced");
    expect(detail.resolution).toBe("replacement");
    expect(detail.exchangeNote).toBe("Sent replacement Size L parcel via BlueDart");
    expect(detail.exchangeOrderId).toBe(exchangeOrderId);
  });

  it("writes audit log rows for every staff action", async () => {
    const delivered = await createDeliveredOrder(ctxA, variantA1Id, 1);

    const ret = await requestReturn(rtWeb, ctxA, {
      orderId: delivered.orderId,
      reason: "Changed my mind",
      resolution: "refund",
      items: [{ orderItemId: delivered.orderItemId, quantity: 1 }],
    });

    await actOnReturn(rtWeb, ctxA, { id: ret.returnId, action: "approve" });
    await actOnReturn(rtWeb, ctxA, { id: ret.returnId, action: "receive" });
    await actOnReturn(rtWeb, ctxA, {
      id: ret.returnId,
      action: "refund",
      refundAmount: 50000,
      refundMethod: "cash",
      refundReference: "CASH-REF",
    });

    // Query audit_logs
    const logs = await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.auditLogs)
        .where(and(eq(schema.auditLogs.tenantId, ctxA.tenantId), eq(schema.auditLogs.targetId, ret.returnId))),
    );

    const actions = logs.map((l) => l.action);
    expect(actions).toContain("returns.approve");
    expect(actions).toContain("returns.receive");
    expect(actions).toContain("returns.refund");
  });

  it("proves tenant isolation for returns, stats, and return settings", async () => {
    // Tenant A return settings update
    await updateReturnSettings(rtWeb, ctxA, { returnWindowDays: 14, instructions: "Tenant A instructions" });

    // Tenant B return settings should remain default / independent
    const settingsB = await getReturnSettings(rtWeb, ctxB);
    expect(settingsB.returnWindowDays).not.toBe(14);
    expect(settingsB.instructions).not.toBe("Tenant A instructions");

    // Tenant A return list & stats
    const statsA = await getAdminReturnStats(rtWeb, ctxA);
    const listA = await listAdminReturns(rtWeb, ctxA);
    expect(statsA.needsReview).toBeGreaterThanOrEqual(0);

    // Tenant B return list & stats
    const statsB = await getAdminReturnStats(rtWeb, ctxB);
    const listB = await listAdminReturns(rtWeb, ctxB);

    expect(listB.items.length).toBe(0);
    expect(statsB.needsReview).toBe(0);

    // Cross-tenant getAdminReturnDetail throws Not Found
    if (listA.items.length > 0) {
      const returnAId = listA.items[0]!.id;
      await expect(
        getAdminReturnDetail(rtWeb, ctxB, { id: returnAId }),
      ).rejects.toThrow(/Return not found/i);
    }
  });
});
