import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { STORE_PERMISSIONS } from "@bs/auth";
import {
  createRuntime,
  provisionTenant,
  createAdminDraftOrder,
  cancelAdminOrder,
  archiveOrders,
  unarchiveOrders,
  deleteOrders,
  listAdminOrders,
  getAdminOrderStats,
  getAdminOrderDetail,
  createAdminOrderInvoice,
  createAdminFulfillment,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";
import { createActiveProduct, createDeliveredCodOrder } from "./helpers/factories.ts";

let env: TestDb;
let rt: Runtime;
let rtWeb: Runtime;
let ctxOwner: TenantContext;
let ctxRestricted: TenantContext;
let testVariantId: string;
let testLocationId: string;

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 10 });
  rtWeb = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 10 });

  const tenant = await provisionTenant(rt, {
    storeName: "Archive Delete Store",
    slug: "archive-delete-store",
    owner: { email: "owner@archive-del.test", name: "Archive Owner" },
    planCode: "starter",
    source: "platform_admin",
  });

  ctxOwner = {
    tenantId: tenant.tenantId,
    storeStatus: "live",
    actor: { type: "staff", userId: tenant.ownerId },
    roles: ["store_owner"],
    permissions: [...STORE_PERMISSIONS],
    requestId: "req-archive-owner",
  };

  ctxRestricted = {
    tenantId: tenant.tenantId,
    storeStatus: "live",
    actor: { type: "staff", userId: "staff-restricted-01" },
    roles: ["store_staff"],
    // Has orders.read and orders.write, but NOT orders.delete
    permissions: STORE_PERMISSIONS.filter((p) => p !== "orders.delete"),
    requestId: "req-archive-restricted",
  };

  const prod = await createActiveProduct(rtWeb, ctxOwner, {
    title: "Archive Test Item",
    stock: 1000,
    price: 5000,
  });
  testVariantId = prod.variantId;
  testLocationId = prod.locationId;
}, 180_000);

afterAll(async () => {
  await rt?.close();
  await rtWeb?.close();
  await env?.stop();
});

describe("Order Archiving & Unarchiving", () => {
  it("refuses to archive an open order", async () => {
    const draft = await createAdminDraftOrder(rtWeb, ctxOwner, {
      email: "archive-open@test.com",
      phone: "+919876543210",
      shippingAddress: { line1: "123 Main St", city: "Bengaluru", stateCode: "KA", pincode: "560001" },
      items: [{ variantId: testVariantId, quantity: 1 }],
    });

    const res = await archiveOrders(rtWeb, ctxOwner, { ids: [draft.orderId] });
    expect(res.successCount).toBe(0);
    expect(res.skippedCount).toBe(1);
    expect(res.results[0]!.ok).toBe(false);
    expect(res.results[0]!.reason).toContain("Order is still open");
  });

  it("archives a terminal order and reflects in listAdminOrders views and stats", async () => {
    const delivered = await createDeliveredCodOrder(rtWeb, ctxOwner, {
      variantId: testVariantId,
      quantity: 1,
      locationId: testLocationId,
    });

    const initialStats = await getAdminOrderStats(rtWeb, ctxOwner);
    const initialGstInvoices = await withTenant(rtWeb._db.db, ctxOwner.tenantId, (tx) =>
      tx.select().from(schema.invoices).where(eq(schema.invoices.orderId, delivered.orderId)),
    );
    const initialLedgerEntries = await withTenant(rtWeb._db.db, ctxOwner.tenantId, (tx) =>
      tx.select().from(schema.ledgerEntries).where(eq(schema.ledgerEntries.sourceId, delivered.orderId)),
    );

    // Archive the delivered order
    const archiveRes = await archiveOrders(rtWeb, ctxOwner, { ids: [delivered.orderId] });
    expect(archiveRes.successCount).toBe(1);
    expect(archiveRes.skippedCount).toBe(0);
    expect(archiveRes.results[0]!.ok).toBe(true);

    // Order detail shows archivedAt and archivedBy
    const detail = await getAdminOrderDetail(rtWeb, ctxOwner, { id: delivered.orderId });
    expect(detail.order.archivedAt).not.toBeNull();
    expect(detail.order.archivedBy).toBe(ctxOwner.actor.type === "staff" ? ctxOwner.actor.userId : null);

    // Order is excluded from default/open views
    const openOrders = await listAdminOrders(rtWeb, ctxOwner, { view: "open" });
    expect(openOrders.items.some((o) => o.id === delivered.orderId)).toBe(false);

    // Order appears in archived view
    const archivedOrders = await listAdminOrders(rtWeb, ctxOwner, { view: "archived" });
    const foundArchived = archivedOrders.items.find((o) => o.id === delivered.orderId);
    expect(foundArchived).toBeDefined();
    expect(foundArchived?.archivedAt).not.toBeNull();

    // Stats count active orders (archived_at is null) while preserving grandTotal revenue
    const updatedStats = await getAdminOrderStats(rtWeb, ctxOwner);
    expect(updatedStats.totalOrders).toBe(initialStats.totalOrders - 1);
    expect(updatedStats.totalRevenue).toBe(initialStats.totalRevenue);

    // GST invoice and financial ledger totals remain strictly intact
    const postGstInvoices = await withTenant(rtWeb._db.db, ctxOwner.tenantId, (tx) =>
      tx.select().from(schema.invoices).where(eq(schema.invoices.orderId, delivered.orderId)),
    );
    const postLedgerEntries = await withTenant(rtWeb._db.db, ctxOwner.tenantId, (tx) =>
      tx.select().from(schema.ledgerEntries).where(eq(schema.ledgerEntries.sourceId, delivered.orderId)),
    );
    expect(postGstInvoices.length).toBe(initialGstInvoices.length);
    expect(postLedgerEntries.length).toBe(initialLedgerEntries.length);

    // Unarchive restores the order
    const unarchiveRes = await unarchiveOrders(rtWeb, ctxOwner, { ids: [delivered.orderId] });
    expect(unarchiveRes.successCount).toBe(1);
    expect(unarchiveRes.skippedCount).toBe(0);

    const restoredDetail = await getAdminOrderDetail(rtWeb, ctxOwner, { id: delivered.orderId });
    expect(restoredDetail.order.archivedAt).toBeNull();
    expect(restoredDetail.order.archivedBy).toBeNull();

    const restoredClosed = await listAdminOrders(rtWeb, ctxOwner, { view: "closed" });
    expect(restoredClosed.items.some((o) => o.id === delivered.orderId)).toBe(true);
  });

  it("skips already archived order gracefully with reason", async () => {
    const draft = await createAdminDraftOrder(rtWeb, ctxOwner, {
      email: "dup-archive@test.com",
      phone: "+919876543210",
      shippingAddress: { line1: "123 Main St", city: "Bengaluru", stateCode: "KA", pincode: "560001" },
      items: [{ variantId: testVariantId, quantity: 1 }],
    });
    await cancelAdminOrder(rtWeb, ctxOwner, { id: draft.orderId, reason: "Cancel for archive" });

    await archiveOrders(rtWeb, ctxOwner, { ids: [draft.orderId] });

    // Attempt archive again
    const reArchive = await archiveOrders(rtWeb, ctxOwner, { ids: [draft.orderId] });
    expect(reArchive.successCount).toBe(0);
    expect(reArchive.skippedCount).toBe(1);
    expect(reArchive.results[0]!.ok).toBe(false);
    expect(reArchive.results[0]!.reason).toContain("already archived");
  });
});

describe("Order Deletion Refusal Checks", () => {
  it("refuses to delete order that is NOT archived", async () => {
    const draft = await createAdminDraftOrder(rtWeb, ctxOwner, {
      email: "not-archived@test.com",
      phone: "+919876543210",
      shippingAddress: { line1: "123 Main St", city: "Bengaluru", stateCode: "KA", pincode: "560001" },
      items: [{ variantId: testVariantId, quantity: 1 }],
    });
    await cancelAdminOrder(rtWeb, ctxOwner, { id: draft.orderId, reason: "Cancel test" });

    const delRes = await deleteOrders(rtWeb, ctxOwner, { ids: [draft.orderId] });
    expect(delRes.successCount).toBe(0);
    expect(delRes.skippedCount).toBe(1);
    expect(delRes.results[0]!.reason).toBe("Order must be archived before it can be deleted");
  });

  it("refuses to delete order that is NOT cancelled or draft (delivered)", async () => {
    const delivered = await createDeliveredCodOrder(rtWeb, ctxOwner, {
      variantId: testVariantId,
      quantity: 1,
      locationId: testLocationId,
    });
    // Archive the delivered order
    await archiveOrders(rtWeb, ctxOwner, { ids: [delivered.orderId] });

    const delRes = await deleteOrders(rtWeb, ctxOwner, { ids: [delivered.orderId] });
    expect(delRes.successCount).toBe(0);
    expect(delRes.skippedCount).toBe(1);
    expect(delRes.results[0]!.reason).toContain("Only cancelled or draft orders can be deleted");
  });

  it("refuses to delete order with paid / captured payment status", async () => {
    const draft = await createAdminDraftOrder(rtWeb, ctxOwner, {
      email: "paid-order@test.com",
      phone: "+919876543210",
      shippingAddress: { line1: "123 Main St", city: "Bengaluru", stateCode: "KA", pincode: "560001" },
      items: [{ variantId: testVariantId, quantity: 1 }],
      paymentOutcome: "paid",
    });
    await cancelAdminOrder(rtWeb, ctxOwner, { id: draft.orderId, reason: "Refund & Cancel" });
    await archiveOrders(rtWeb, ctxOwner, { ids: [draft.orderId] });

    const delRes = await deleteOrders(rtWeb, ctxOwner, { ids: [draft.orderId] });
    expect(delRes.successCount).toBe(0);
    expect(delRes.skippedCount).toBe(1);
    expect(delRes.results[0]!.reason).toContain("monetary transactions");
  });

  it("refuses to delete order with issued invoice", async () => {
    const draft = await createAdminDraftOrder(rtWeb, ctxOwner, {
      email: "invoiced-order@test.com",
      phone: "+919876543210",
      shippingAddress: { line1: "123 Main St", city: "Bengaluru", stateCode: "KA", pincode: "560001" },
      items: [{ variantId: testVariantId, quantity: 1 }],
    });
    await createAdminOrderInvoice(rtWeb, ctxOwner, { id: draft.orderId });
    await cancelAdminOrder(rtWeb, ctxOwner, { id: draft.orderId, reason: "Cancelled after invoice" });
    await archiveOrders(rtWeb, ctxOwner, { ids: [draft.orderId] });

    const delRes = await deleteOrders(rtWeb, ctxOwner, { ids: [draft.orderId] });
    expect(delRes.successCount).toBe(0);
    expect(delRes.skippedCount).toBe(1);
    expect(delRes.results[0]!.reason).toContain("issued invoice");
  });

  it("refuses to delete order with fulfillments / shipments", async () => {
    const draft = await createAdminDraftOrder(rtWeb, ctxOwner, {
      email: "fulfilled-order@test.com",
      phone: "+919876543210",
      shippingAddress: { line1: "123 Main St", city: "Bengaluru", stateCode: "KA", pincode: "560001" },
      items: [{ variantId: testVariantId, quantity: 1 }],
    });
    await createAdminFulfillment(rtWeb, ctxOwner, {
      id: draft.orderId,
      carrier: "Delhivery",
      awb: `AWB-${Date.now()}`,
    });
    await cancelAdminOrder(rtWeb, ctxOwner, { id: draft.orderId, reason: "Cancelled with shipment" });
    await archiveOrders(rtWeb, ctxOwner, { ids: [draft.orderId] });

    const delRes = await deleteOrders(rtWeb, ctxOwner, { ids: [draft.orderId] });
    expect(delRes.successCount).toBe(0);
    expect(delRes.skippedCount).toBe(1);
    expect(delRes.results[0]!.reason).toContain("fulfillment records");
  });

  it("refuses to delete order with return request or exchange link", async () => {
    const draft = await createAdminDraftOrder(rtWeb, ctxOwner, {
      email: "return-refusal@test.com",
      phone: "+919876543210",
      shippingAddress: { line1: "123 Main St", city: "Bengaluru", stateCode: "KA", pincode: "560001" },
      items: [{ variantId: testVariantId, quantity: 1 }],
    });
    await cancelAdminOrder(rtWeb, ctxOwner, { id: draft.orderId, reason: "Cancelled" });
    await archiveOrders(rtWeb, ctxOwner, { ids: [draft.orderId] });

    // Link a return to this order
    await withTenant(rtWeb._db.db, ctxOwner.tenantId, async (tx) => {
      await tx.insert(schema.returns).values({
        tenantId: ctxOwner.tenantId,
        orderId: draft.orderId,
        number: `RET-${Date.now()}`,
        status: "requested",
        reason: "Defective item",
        resolution: "refund",
      });
    });

    const delRes = await deleteOrders(rtWeb, ctxOwner, { ids: [draft.orderId] });
    expect(delRes.successCount).toBe(0);
    expect(delRes.skippedCount).toBe(1);
    expect(delRes.results[0]!.reason).toBe("Order has associated returns");
  });

  it("refuses to delete order with posted ledger entries", async () => {
    const draft = await createAdminDraftOrder(rtWeb, ctxOwner, {
      email: "ledger-order@test.com",
      phone: "+919876543210",
      shippingAddress: { line1: "123 Main St", city: "Bengaluru", stateCode: "KA", pincode: "560001" },
      items: [{ variantId: testVariantId, quantity: 1 }],
    });
    await cancelAdminOrder(rtWeb, ctxOwner, { id: draft.orderId, reason: "Cancelled" });
    await archiveOrders(rtWeb, ctxOwner, { ids: [draft.orderId] });

    // Manually insert a ledger entry pointing to this order
    await withTenant(rtWeb._db.db, ctxOwner.tenantId, async (tx) => {
      await tx.insert(schema.ledgerEntries).values({
        tenantId: ctxOwner.tenantId,
        date: new Date(),
        book: "own",
        debit: "cash_bank",
        credit: "product_revenue",
        amount: 1000,
        currency: "INR",
        sourceKind: "order",
        sourceId: draft.orderId,
        key: `order:ledger-test:${draft.orderId}`,
      });
    });

    const delRes = await deleteOrders(rtWeb, ctxOwner, { ids: [draft.orderId] });
    expect(delRes.successCount).toBe(0);
    expect(delRes.skippedCount).toBe(1);
    expect(delRes.results[0]!.reason).toBe("Order has posted finance ledger entries");
  });

  it("denies orders.delete to staff without orders.delete permission", async () => {
    const draft = await createAdminDraftOrder(rtWeb, ctxOwner, {
      email: "denied-delete@test.com",
      phone: "+919876543210",
      shippingAddress: { line1: "123 Main St", city: "Bengaluru", stateCode: "KA", pincode: "560001" },
      items: [{ variantId: testVariantId, quantity: 1 }],
    });
    await cancelAdminOrder(rtWeb, ctxOwner, { id: draft.orderId, reason: "Cancelled" });
    await archiveOrders(rtWeb, ctxOwner, { ids: [draft.orderId] });

    await expect(deleteOrders(rtWeb, ctxRestricted, { ids: [draft.orderId] })).rejects.toThrow(
      /Forbidden.*orders\.delete/,
    );
  });
});

describe("Order Deletion Success & Mixed Bulk Processing", () => {
  it("successfully deletes an eligible archived cancelled order and removes all traces", async () => {
    const draft = await createAdminDraftOrder(rtWeb, ctxOwner, {
      email: "clean-delete@test.com",
      phone: "+919876543210",
      shippingAddress: { line1: "123 Main St", city: "Bengaluru", stateCode: "KA", pincode: "560001" },
      items: [{ variantId: testVariantId, quantity: 1 }],
    });
    await cancelAdminOrder(rtWeb, ctxOwner, { id: draft.orderId, reason: "Wrong variant ordered" });
    await archiveOrders(rtWeb, ctxOwner, { ids: [draft.orderId] });

    const delRes = await deleteOrders(rtWeb, ctxOwner, { ids: [draft.orderId] });
    expect(delRes.successCount).toBe(1);
    expect(delRes.skippedCount).toBe(0);
    expect(delRes.results[0]!.ok).toBe(true);

    // Verify order row is gone
    await expect(getAdminOrderDetail(rtWeb, ctxOwner, { id: draft.orderId })).rejects.toThrow(
      /Order not found/,
    );

    // Verify audit log has order.deleted
    await withTenant(rtWeb._db.db, ctxOwner.tenantId, async (tx) => {
      const logs = await tx
        .select()
        .from(schema.auditLogs)
        .where(
          and(
            eq(schema.auditLogs.tenantId, ctxOwner.tenantId),
            eq(schema.auditLogs.action, "order.deleted"),
            eq(schema.auditLogs.targetId, draft.orderId),
          ),
        );
      expect(logs.length).toBe(1);
    });
  });

  it("handles mixed bulk deletion: deletes eligible orders while skipping ineligible with reasons", async () => {
    // Order 1: eligible (cancelled & archived)
    const d1 = await createAdminDraftOrder(rtWeb, ctxOwner, {
      email: "mixed-1@test.com",
      phone: "+919876543210",
      shippingAddress: { line1: "123 Main St", city: "Bengaluru", stateCode: "KA", pincode: "560001" },
      items: [{ variantId: testVariantId, quantity: 1 }],
    });
    await cancelAdminOrder(rtWeb, ctxOwner, { id: d1.orderId, reason: "Cancelled" });
    await archiveOrders(rtWeb, ctxOwner, { ids: [d1.orderId] });

    // Order 2: not archived (ineligible)
    const d2 = await createAdminDraftOrder(rtWeb, ctxOwner, {
      email: "mixed-2@test.com",
      phone: "+919876543210",
      shippingAddress: { line1: "123 Main St", city: "Bengaluru", stateCode: "KA", pincode: "560001" },
      items: [{ variantId: testVariantId, quantity: 1 }],
    });
    await cancelAdminOrder(rtWeb, ctxOwner, { id: d2.orderId, reason: "Cancelled" });

    // Order 3: eligible (cancelled & archived)
    const d3 = await createAdminDraftOrder(rtWeb, ctxOwner, {
      email: "mixed-3@test.com",
      phone: "+919876543210",
      shippingAddress: { line1: "123 Main St", city: "Bengaluru", stateCode: "KA", pincode: "560001" },
      items: [{ variantId: testVariantId, quantity: 1 }],
    });
    await cancelAdminOrder(rtWeb, ctxOwner, { id: d3.orderId, reason: "Cancelled" });
    await archiveOrders(rtWeb, ctxOwner, { ids: [d3.orderId] });

    const mixedRes = await deleteOrders(rtWeb, ctxOwner, { ids: [d1.orderId, d2.orderId, d3.orderId] });
    expect(mixedRes.successCount).toBe(2);
    expect(mixedRes.skippedCount).toBe(1);

    const r1 = mixedRes.results.find((r) => r.id === d1.orderId);
    const r2 = mixedRes.results.find((r) => r.id === d2.orderId);
    const r3 = mixedRes.results.find((r) => r.id === d3.orderId);

    expect(r1?.ok).toBe(true);
    expect(r2?.ok).toBe(false);
    expect(r2?.reason).toBe("Order must be archived before it can be deleted");
    expect(r3?.ok).toBe(true);
  });

  it("successfully deletes an archived cancelled order with discount redemptions and payment intents/attempts", async () => {
    const draft = await createAdminDraftOrder(rtWeb, ctxOwner, {
      email: "discount-payment-del@test.com",
      phone: "+919876543210",
      shippingAddress: { line1: "123 Main St", city: "Bengaluru", stateCode: "KA", pincode: "560001" },
      items: [{ variantId: testVariantId, quantity: 1 }],
    });
    await cancelAdminOrder(rtWeb, ctxOwner, { id: draft.orderId, reason: "Cancelled before payment" });

    let discountId = "";
    let intentId = "";

    await withTenant(rtWeb._db.db, ctxOwner.tenantId, async (tx) => {
      const [disc] = await tx
        .insert(schema.discounts)
        .values({
          tenantId: ctxOwner.tenantId,
          code: "TESTSAVE10",
          title: "Test 10 Off",
          type: "fixed",
          value: 1000,
        })
        .returning();
      discountId = disc!.id;

      await tx.insert(schema.discountRedemptions).values({
        tenantId: ctxOwner.tenantId,
        discountId,
        orderId: draft.orderId,
        amount: 1000,
      });

      const [intent] = await tx
        .insert(schema.paymentIntents)
        .values({
          tenantId: ctxOwner.tenantId,
          orderId: draft.orderId,
          provider: "razorpay",
          amount: 4000,
          status: "failed",
        })
        .returning();
      intentId = intent!.id;

      await tx
        .insert(schema.paymentAttempts)
        .values({
          tenantId: ctxOwner.tenantId,
          intentId,
          method: "card",
          status: "failed",
        });
    });

    await archiveOrders(rtWeb, ctxOwner, { ids: [draft.orderId] });

    const delRes = await deleteOrders(rtWeb, ctxOwner, { ids: [draft.orderId] });
    expect(delRes.successCount).toBe(1);
    expect(delRes.skippedCount).toBe(0);
    expect(delRes.results[0]!.ok).toBe(true);

    await expect(getAdminOrderDetail(rtWeb, ctxOwner, { id: draft.orderId })).rejects.toThrow(
      /Order not found/,
    );

    await withTenant(rtWeb._db.db, ctxOwner.tenantId, async (tx) => {
      const redemptions = await tx
        .select()
        .from(schema.discountRedemptions)
        .where(
          and(
            eq(schema.discountRedemptions.tenantId, ctxOwner.tenantId),
            eq(schema.discountRedemptions.orderId, draft.orderId),
          ),
        );
      expect(redemptions.length).toBe(0);

      const intents = await tx
        .select()
        .from(schema.paymentIntents)
        .where(
          and(
            eq(schema.paymentIntents.tenantId, ctxOwner.tenantId),
            eq(schema.paymentIntents.orderId, draft.orderId),
          ),
        );
      expect(intents.length).toBe(0);

      const attempts = await tx
        .select()
        .from(schema.paymentAttempts)
        .where(
          and(
            eq(schema.paymentAttempts.tenantId, ctxOwner.tenantId),
            eq(schema.paymentAttempts.intentId, intentId),
          ),
        );
      expect(attempts.length).toBe(0);
    });
  });
});

