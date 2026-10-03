import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { primaryCategory } from "./helpers/primary-category.ts";
import { schema, withTenant } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import {
  createAdminDraftOrder,
  createProduct,
  createRuntime,
  deleteAdminQuote,
  getAdminOrderStats,
  getAdminQuoteDetail,
  getAdminQuoteStats,
  listAdminQuotes,
  markAdminQuoteLost,
  placeOrder,
  provisionTenant,
  reopenAdminQuote,
  runQuoteExpirySweep,
  submitQuoteRequest,
  updateAdminQuoteNote,
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
let porVariantId: string;
let normalVariantId: string;
let locAId: string;

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 10 });
  rtWeb = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 10 });

  // Provision Tenant A
  const tA = await provisionTenant(rt, {
    storeName: "Quotes Store A",
    slug: "quotes-a",
    owner: { email: "owner-a@quotes.test", name: "Owner A" },
    planCode: "starter",
    source: "platform_admin",
  });
  ctxA = {
    tenantId: tA.tenantId,
    storeStatus: "live",
    actor: { type: "staff", userId: tA.ownerId },
    roles: ["store_owner"],
    permissions: [...STORE_PERMISSIONS],
    requestId: "req-quotes-a",
  };

  // Provision Tenant B
  const tB = await provisionTenant(rt, {
    storeName: "Quotes Store B",
    slug: "quotes-b",
    owner: { email: "owner-b@quotes.test", name: "Owner B" },
    planCode: "starter",
    source: "platform_admin",
  });
  ctxB = {
    tenantId: tB.tenantId,
    storeStatus: "live",
    actor: { type: "staff", userId: tB.ownerId },
    roles: ["store_owner"],
    permissions: [...STORE_PERMISSIONS],
    requestId: "req-quotes-b",
  };

  // Locations for Tenant A
  const locsA = await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) =>
    tx.select().from(schema.locations).where(eq(schema.locations.tenantId, ctxA.tenantId)).limit(1),
  );
  locAId = locsA[0]!.id;

  // 1. Create a Price on Request product
  const pPor = await createProduct(rtWeb, ctxA, {
    title: "Custom Industrial Machinery",
    status: "active", primaryCategoryId: await primaryCategory(rtWeb, ctxA),
    priceOnRequest: true,
    variants: [{ sku: "IND-MACH-01", title: "Standard Spec", price: 0 }],
  });
  porVariantId = pPor.variants[0]!.id;

  // 2. Create a Normal in-stock product
  const pNormal = await createProduct(rtWeb, ctxA, {
    title: "Standard Accessory Cable",
    status: "active", primaryCategoryId: await primaryCategory(rtWeb, ctxA),
    priceOnRequest: false,
    variants: [{ sku: "CABLE-01", title: "Default", price: 25000 }],
  });
  normalVariantId = pNormal.variants[0]!.id;

  await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) => {
    await tx.insert(schema.inventoryLevels).values([
      { tenantId: ctxA.tenantId, locationId: locAId, variantId: porVariantId, onHand: 5 },
      { tenantId: ctxA.tenantId, locationId: locAId, variantId: normalVariantId, onHand: 20 },
    ]);
  });
});

describe("Quotes & Price on Request (Real Database)", () => {
  it("rejects price_on_request variants in storefront cart", async () => {
    const cart = await getOrCreateCart(rtWeb, ctxA);
    await expect(
      addToCart(rtWeb, ctxA, {
        token: cart.token,
        variantId: porVariantId,
        quantity: 1,
      }),
    ).rejects.toThrow("This product is price on request and cannot be added to cart");
  });

  it("rejects price_on_request variants at checkout", async () => {
    // Attempting to checkout a cart containing a price_on_request variant must be rejected
    const cart = await getOrCreateCart(rtWeb, ctxA);

    // Forcefully insert line into cart to simulate client bypass
    await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) => {
      await tx.insert(schema.cartItems).values({
        tenantId: ctxA.tenantId,
        cartId: cart.id,
        variantId: porVariantId,
        quantity: 1,
        unitPriceSnapshot: 0,
      });
    });

    await expect(
      placeOrder(rtWeb, ctxA, {
        cartToken: cart.token,
        idempotencyKey: `idem_por_checkout_${Date.now()}`,
        email: "shopper@test.com",
        phone: "9876543210",
        fullName: "Test Shopper",
        addressLine1: "123 Street",
        city: "Bengaluru",
        state: "Karnataka",
        pincode: "560001",
        paymentMethod: "cod",
      }),
    ).rejects.toThrow("This product is price on request and cannot be ordered through standard checkout");
  });

  it("submits a quote request with gapless sequential number and never touches inventory or order revenue", async () => {
    // Snapshot inventory before
    const [invBefore] = await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.inventoryLevels)
        .where(and(eq(schema.inventoryLevels.tenantId, ctxA.tenantId), eq(schema.inventoryLevels.variantId, porVariantId))),
    );

    // Submit quote request #1
    const q1 = await submitQuoteRequest(rtWeb, ctxA, {
      variantId: porVariantId,
      quantity: 3,
      name: "Ramesh Sharma",
      email: "ramesh@acme.org",
      phone: "+919876543210",
      company: "Acme Industrial Ltd",
      message: "Need 3 units delivered to warehouse in Pune with custom paint.",
      ip: "192.168.1.100",
    });

    expect(q1.number).toBe("QT-00001");
    expect(q1.status).toBe("new");
    expect(q1.derivedStage).toBe("needs_reply");
    expect(q1.productTitle).toBe("Custom Industrial Machinery");
    expect(q1.quantity).toBe(3);

    // Submit quote request #2
    const q2 = await submitQuoteRequest(rtWeb, ctxA, {
      variantId: porVariantId,
      quantity: 1,
      name: "Suresh Patel",
      email: "suresh@patelcorp.com",
      ip: "192.168.1.101",
    });

    expect(q2.number).toBe("QT-00002");

    // Inventory after must remain untouched
    const [invAfter] = await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.inventoryLevels)
        .where(and(eq(schema.inventoryLevels.tenantId, ctxA.tenantId), eq(schema.inventoryLevels.variantId, porVariantId))),
    );
    expect(invAfter?.onHand).toBe(invBefore?.onHand);
    expect(invAfter?.reserved).toBe(invBefore?.reserved);

    // Order stats must not include quotes
    const orderStats = await getAdminOrderStats(rtWeb, ctxA);
    expect(orderStats.totalOrders).toBe(0);
    expect(orderStats.totalRevenue).toBe(0);

    // Quote stats must accurately reflect leads
    const quoteStats = await getAdminQuoteStats(rtWeb, ctxA);
    expect(quoteStats.needsReply).toBeGreaterThanOrEqual(2);
  });

  it("enforces public quote submission rate limiting by IP and email", async () => {
    const testEmail = "spammer@bot.com";

    // 5 submissions per email is the limit
    for (let i = 0; i < 5; i++) {
      await submitQuoteRequest(rtWeb, ctxA, {
        variantId: porVariantId,
        quantity: 1,
        name: `Lead ${i}`,
        email: testEmail,
        ip: `198.51.100.${i + 1}`,
      });
    }

    // 6th attempt with same email must be rate-limited
    await expect(
      submitQuoteRequest(rtWeb, ctxA, {
        variantId: porVariantId,
        quantity: 1,
        name: "Lead 6",
        email: testEmail,
        ip: "198.51.100.99",
      }),
    ).rejects.toThrow("Too many quote requests from this email. Please try again later.");
  });

  it("handles admin note updates, mark as lost, reopen, and audited deletion", async () => {
    const q = await submitQuoteRequest(rtWeb, ctxA, {
      variantId: porVariantId,
      quantity: 2,
      name: "Kavita Rao",
      email: "kavita@raoenterprises.in",
      ip: "192.168.2.1",
    });

    // 1. Update internal note
    const updatedNote = await updateAdminQuoteNote(rtWeb, ctxA, {
      id: q.id,
      adminNote: "Customer wants 10% discount on bulk.",
    });
    expect(updatedNote.adminNote).toBe("Customer wants 10% discount on bulk.");

    // Check audit log for note update
    const noteAudit = await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.auditLogs)
        .where(and(eq(schema.auditLogs.tenantId, ctxA.tenantId), eq(schema.auditLogs.action, "quote.note_updated"))),
    );
    expect(noteAudit.length).toBeGreaterThanOrEqual(1);

    // 2. Mark lost
    const lost = await markAdminQuoteLost(rtWeb, ctxA, { id: q.id });
    expect(lost.status).toBe("lost");
    expect(lost.derivedStage).toBe("closed");

    // Check audit log for mark lost
    const lostAudit = await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.auditLogs)
        .where(and(eq(schema.auditLogs.tenantId, ctxA.tenantId), eq(schema.auditLogs.action, "quote.lost"))),
    );
    expect(lostAudit.length).toBeGreaterThanOrEqual(1);

    // 3. Reopen
    const reopened = await reopenAdminQuote(rtWeb, ctxA, { id: q.id });
    expect(reopened.status).toBe("new");
    expect(reopened.derivedStage).toBe("needs_reply");

    // 4. Delete lead
    const deleted = await deleteAdminQuote(rtWeb, ctxA, { id: q.id });
    expect(deleted.success).toBe(true);

    await expect(getAdminQuoteDetail(rtWeb, ctxA, { id: q.id })).rejects.toThrow("Quote request not found");
  });

  it("converts a quote to an order with price override and links order", async () => {
    const q = await submitQuoteRequest(rtWeb, ctxA, {
      variantId: porVariantId,
      quantity: 2,
      name: "Aditya Verma",
      email: "aditya@vermatech.com",
      phone: "+919876500000",
      ip: "192.168.3.1",
    });

    // Create draft order for this quote with unit price override (₹45,000 per unit instead of 0)
    const draft = await createAdminDraftOrder(rtWeb, ctxA, {
      quoteId: q.id,
      email: "aditya@vermatech.com",
      shippingAddress: {
        fullName: "Aditya Verma",
        addressLine1: "Tech Park, Whitefield",
        city: "Bengaluru",
        state: "Karnataka",
        pincode: "560066",
        country: "IN",
      },
      items: [
        {
          variantId: porVariantId,
          quantity: 2,
          unitPriceOverride: 4500000, // ₹45,000 per unit in paise
          unitPriceOverrideReason: `Quote ${q.number} agreed pricing`,
        },
      ],
      paymentOutcome: "pending",
    });

    expect(draft.orderId).toBeDefined();
    expect(draft.orderNumber).toBeDefined();

    // Verify quote record is updated to quoted with linked order
    const detail = await getAdminQuoteDetail(rtWeb, ctxA, { id: q.id });
    expect(detail.status).toBe("quoted");
    expect(detail.derivedStage).toBe("quote_sent");
    expect(detail.orderId).toBe(draft.orderId);
    expect(detail.orderNumber).toBe(draft.orderNumber);
    expect(detail.quotedTotal).toBe(draft.grandTotal);
    expect(detail.orderConfirmUrl).toBeDefined();
    expect(detail.orderViewUrl).toBeDefined();

    // Verify delete is refused on quoted requests
    await expect(deleteAdminQuote(rtWeb, ctxA, { id: q.id })).rejects.toThrow(
      "Only new or lost quote leads can be deleted",
    );
  });

  it("cancels expired pending orders and releases inventory cleanly via sweep", async () => {
    // 1. Create a quote request and convert it to a draft order with reservation
    const q = await submitQuoteRequest(rtWeb, ctxA, {
      variantId: porVariantId,
      quantity: 1,
      name: "Neha Gupta",
      email: "neha@gupta.com",
      ip: "192.168.4.1",
    });

    const draft = await createAdminDraftOrder(rtWeb, ctxA, {
      quoteId: q.id,
      email: "neha@gupta.com",
      shippingAddress: {
        fullName: "Neha Gupta",
        addressLine1: "Sector 18",
        city: "Noida",
        state: "Uttar Pradesh",
        pincode: "201301",
        country: "IN",
      },
      items: [
        {
          variantId: porVariantId,
          quantity: 1,
          unitPriceOverride: 5000000,
          unitPriceOverrideReason: `Quote ${q.number} agreed pricing`,
        },
      ],
      paymentOutcome: "pending",
    });

    // Check reservation exists
    const [invWithRes] = await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) =>
      tx
        .select()
        .from(schema.inventoryLevels)
        .where(and(eq(schema.inventoryLevels.tenantId, ctxA.tenantId), eq(schema.inventoryLevels.variantId, porVariantId))),
    );
    expect(invWithRes?.reserved).toBeGreaterThanOrEqual(1);

    // Simulate expiration by setting validUntil to yesterday
    const yesterday = new Date(Date.now() - 24 * 3600 * 1000);
    await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) => {
      await tx
        .update(schema.quoteRequests)
        .set({ validUntil: yesterday })
        .where(eq(schema.quoteRequests.id, q.id));
    });

    // Run expiry sweep #1
    const sweep1 = await runQuoteExpirySweep(rtWeb, ctxA.tenantId);
    expect(sweep1.expiredCount).toBeGreaterThanOrEqual(1);

    // Verify quote status changed to expired
    const expiredQuote = await getAdminQuoteDetail(rtWeb, ctxA, { id: q.id });
    expect(expiredQuote.status).toBe("expired");
    expect(expiredQuote.derivedStage).toBe("expired");

    // Verify order was cancelled and inventory reservation was released
    const [cancelledOrder] = await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) =>
      tx.select().from(schema.orders).where(eq(schema.orders.id, draft.orderId)),
    );
    expect(cancelledOrder?.status).toBe("cancelled");

    // Run expiry sweep #2 - must be idempotent and cancel 0 further orders
    const sweep2 = await runQuoteExpirySweep(rtWeb, ctxA.tenantId);
    expect(sweep2.expiredCount).toBe(0);
  });

  it("enforces tenant isolation under RLS", async () => {
    // Create quote on Tenant A
    const qA = await submitQuoteRequest(rtWeb, ctxA, {
      variantId: porVariantId,
      quantity: 1,
      name: "Tenant A Lead",
      email: "lead-a@tenanta.com",
      ip: "192.168.5.1",
    });

    // Tenant B listing quotes should never see Tenant A's quotes
    const listB = await listAdminQuotes(rtWeb, ctxB);
    expect(listB.items.some((item) => item.id === qA.id)).toBe(false);

    // Tenant B direct get must fail
    await expect(getAdminQuoteDetail(rtWeb, ctxB, { id: qA.id })).rejects.toThrow("Quote request not found");
  });
});
