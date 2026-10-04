import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { primaryCategory } from "./helpers/primary-category.ts";
import { schema, withTenant } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import {
  createAdminCustomer,
  createAdminDraftOrder,
  createProduct,
  createRuntime,
  estimateAdminDraftOrder,
  getAdminCustomerDetail,
  getAdminOrderDetail,
  listAdminOrders,
  provisionTenant,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";
import { STORE_PERMISSIONS } from "@bs/auth";

let env: TestDb;
let rt: Runtime;
let rtWeb: Runtime;
let ctxA: TenantContext;
let ctxB: TenantContext;
let variantA1Id: string;
let variantA2Id: string;
let variantBId: string;
let customerAId: string;

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 10 });
  rtWeb = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 10 });

  const runId = Math.random().toString(36).slice(2, 7);

  // Provision Tenant A
  const tA = await provisionTenant(rt, {
    storeName: `Phase2 Store A ${runId}`,
    slug: `p2-store-a-${runId}`,
    owner: { email: `owner-a-${runId}@phase2.test`, name: "Owner A" },
    planCode: "starter",
    source: "platform_admin",
  });
  ctxA = {
    tenantId: tA.tenantId,
    storeStatus: "live",
    actor: { type: "staff", userId: tA.ownerId },
    roles: ["store_owner"],
    permissions: [...STORE_PERMISSIONS],
    requestId: "req-p2-a",
  };

  // Provision Tenant B for isolation
  const tB = await provisionTenant(rt, {
    storeName: `Phase2 Store B ${runId}`,
    slug: `p2-store-b-${runId}`,
    owner: { email: `owner-b-${runId}@phase2.test`, name: "Owner B" },
    planCode: "starter",
    source: "platform_admin",
  });
  ctxB = {
    tenantId: tB.tenantId,
    storeStatus: "live",
    actor: { type: "staff", userId: tB.ownerId },
    roles: ["store_owner"],
    permissions: [...STORE_PERMISSIONS],
    requestId: "req-p2-b",
  };

  // Create products in Tenant A
  const pA1 = await createProduct(rtWeb, ctxA, {
    title: "Handmade Linen Shirt",
    status: "active", primaryCategoryId: await primaryCategory(rtWeb, ctxA),
    variants: [{ sku: "SHIRT-LINEN", title: "Medium", price: 200000 }], // ₹2,000
  });
  variantA1Id = pA1.variants[0]!.id;

  const pA2 = await createProduct(rtWeb, ctxA, {
    title: "Cotton Chinos",
    status: "active", primaryCategoryId: await primaryCategory(rtWeb, ctxA),
    variants: [{ sku: "CHINO-NAVY", title: "32", price: 150000 }], // ₹1,500
  });
  variantA2Id = pA2.variants[0]!.id;

  // Create product in Tenant B
  const pB = await createProduct(rtWeb, ctxB, {
    title: "Tenant B Item",
    status: "active", primaryCategoryId: await primaryCategory(rtWeb, ctxB),
    variants: [{ sku: "ITEM-B", title: "Default", price: 50000 }],
  });
  variantBId = pB.variants[0]!.id;

  // Stock inventory for Tenant A
  const locsA = await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) =>
    tx.select().from(schema.locations).where(eq(schema.locations.tenantId, ctxA.tenantId)).limit(1),
  );
  const locA = locsA[0]!;
  await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) => {
    await tx.insert(schema.inventoryLevels).values([
      { tenantId: ctxA.tenantId, locationId: locA.id, variantId: variantA1Id, onHand: 100 },
      { tenantId: ctxA.tenantId, locationId: locA.id, variantId: variantA2Id, onHand: 10 },
    ]);
  });

  // Create a customer in Tenant A via createAdminCustomer (D6)
  const custRes = await createAdminCustomer(rtWeb, ctxA, {
    name: "Vikram Malhotra",
    email: "vikram@malhotra.in",
    phone: "9876543210",
    tags: ["vip", "b2b"],
    note: "Prefers phone orders",
    address: {
      name: "Vikram Malhotra",
      phone: "9876543210",
      line1: "42 Park Street",
      city: "Kolkata",
      stateCode: "West Bengal",
      pincode: "700016",
    },
  });
  customerAId = custRes.customer.id;
}, 180_000);

describe("Orders Phase 2 (Create Order Parity: D1 to D7)", () => {
  it("D6: Customer creation and uniqueness validation", async () => {
    expect(customerAId).toBeDefined();

    // Duplicate email in same tenant fails
    await expect(
      createAdminCustomer(rtWeb, ctxA, {
        name: "Vikram Duplicate",
        email: "vikram@malhotra.in",
      }),
    ).rejects.toThrow(/already exists/i);

    // Duplicate phone in same tenant fails
    await expect(
      createAdminCustomer(rtWeb, ctxA, {
        name: "Another Customer",
        email: "other@malhotra.in",
        phone: "9876543210",
      }),
    ).rejects.toThrow(/already exists/i);

    // Same email in different tenant succeeds (tenant isolation)
    const custB = await createAdminCustomer(rtWeb, ctxB, {
      name: "Vikram Tenant B",
      email: "vikram@malhotra.in",
    });
    expect(custB.customer.id).toBeDefined();
    expect(custB.customer.id).not.toBe(customerAId);
  });

  it("D1: Live estimation calculates GST intra-state vs inter-state", async () => {
    // Delhi is default store origin state.
    // Inter-state shipping to West Bengal -> IGST
    const estInter = await estimateAdminDraftOrder(rtWeb, ctxA, {
      items: [{ variantId: variantA1Id, quantity: 1 }],
      shippingAddress: { state: "West Bengal", pincode: "700016" },
    });

    expect(estInter.subtotal).toBe(200000);
    expect(estInter.tax.isInterState).toBe(true);
    expect(estInter.tax.igst).toBeGreaterThan(0);
    expect(estInter.tax.cgst).toBe(0);
    expect(estInter.tax.sgst).toBe(0);

    // Intra-state shipping to Delhi -> CGST + SGST
    const estIntra = await estimateAdminDraftOrder(rtWeb, ctxA, {
      items: [{ variantId: variantA1Id, quantity: 1 }],
      shippingAddress: { state: "Delhi", pincode: "110001" },
    });

    expect(estIntra.tax.isInterState).toBe(false);
    expect(estIntra.tax.igst).toBe(0);
    expect(estIntra.tax.cgst).toBeGreaterThan(0);
    expect(estIntra.tax.sgst).toBeGreaterThan(0);
    expect(estIntra.tax.cgst + estIntra.tax.sgst).toBe(estIntra.tax.totalTax);
  });

  it("D2: Shipping override requires reason and enforces ₹10,000 cap", async () => {
    // Missing reason
    await expect(
      createAdminDraftOrder(rtWeb, ctxA, {
        email: "test@override.in",
        phone: "9876543210",
        shippingAddress: { fullName: "Test", line1: "Street 1", city: "Delhi", state: "Delhi", pincode: "110001" },
        items: [{ variantId: variantA1Id, quantity: 1 }],
        shippingOverride: { amount: 50000, reason: "" },
      }),
    ).rejects.toThrow(/shipping override requires a reason/i);

    // Exceeding ₹10,000 (1,000,000 paise)
    await expect(
      createAdminDraftOrder(rtWeb, ctxA, {
        email: "test@override.in",
        phone: "9876543210",
        shippingAddress: { fullName: "Test", line1: "Street 1", city: "Delhi", state: "Delhi", pincode: "110001" },
        items: [{ variantId: variantA1Id, quantity: 1 }],
        shippingOverride: { amount: 1000001, reason: "Excessive fee" },
      }),
    ).rejects.toThrow(/cannot exceed ₹10,000/i);
  });

  it("D3: Manual discount and line price overrides require reason and are audited", async () => {
    // Manual discount missing reason
    await expect(
      createAdminDraftOrder(rtWeb, ctxA, {
        email: "test@disc.in",
        phone: "9876543210",
        shippingAddress: { fullName: "Test", line1: "Street 1", city: "Delhi", state: "Delhi", pincode: "110001" },
        items: [{ variantId: variantA1Id, quantity: 1 }],
        manualDiscount: { type: "flat", value: 50000, reason: "" },
      }),
    ).rejects.toThrow(/manual discount requires a reason/i);

    // Unit price override missing reason
    await expect(
      createAdminDraftOrder(rtWeb, ctxA, {
        email: "test@price.in",
        phone: "9876543210",
        shippingAddress: { fullName: "Test", line1: "Street 1", city: "Delhi", state: "Delhi", pincode: "110001" },
        items: [{ variantId: variantA1Id, quantity: 1, unitPriceOverride: 120000, unitPriceOverrideReason: "" }],
      }),
    ).rejects.toThrow(/unit price override requires a reason/i);

    // Valid discount and price override creates order with audit logs
    const order = await createAdminDraftOrder(rtWeb, ctxA, {
      email: "discounted@test.in",
      phone: "9876543210",
      shippingAddress: { fullName: "Test Customer", line1: "Street 1", city: "Delhi", state: "Delhi", pincode: "110001" },
      items: [
        {
          variantId: variantA1Id,
          quantity: 1,
          unitPriceOverride: 180000,
          unitPriceOverrideReason: "Clearance discount",
        },
      ],
      manualDiscount: {
        type: "flat",
        value: 30000,
        reason: "Manager courtesy",
      },
      shippingOverride: {
        amount: 5000,
        reason: "Express surcharge waiver",
      },
    });

    expect(order.subtotal).toBe(180000);
    expect(order.discountTotal).toBe(30000);
    expect(order.shippingTotal).toBe(5000);

    // Verify audit logs were written
    const audits = await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) => {
      return await tx
        .select()
        .from(schema.auditLogs)
        .where(and(eq(schema.auditLogs.tenantId, ctxA.tenantId), eq(schema.auditLogs.targetId, order.orderId)));
    });

    const actions = audits.map((a) => a.action);
    expect(actions).toContain("order.draft_created");
    expect(actions).toContain("order.discount_applied");
    expect(actions).toContain("order.shipping_override");
    expect(actions).toContain("order.item_price_override");
  });

  it("D4 & D7: 'Payment received' commits inventory, confirms order, and updates customer spend", async () => {
    // Initial customer spend
    const [custBefore] = await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) => {
      return await tx.select().from(schema.customers).where(eq(schema.customers.id, customerAId));
    });
    const initialSpent = Number(custBefore?.totalSpent ?? 0);
    const initialOrders = Number(custBefore?.ordersCount ?? 0);

    const paidOrder = await createAdminDraftOrder(rtWeb, ctxA, {
      customerId: customerAId,
      email: "vikram@malhotra.in",
      phone: "9876543210",
      shippingAddress: { fullName: "Vikram Malhotra", line1: "42 Park St", city: "Kolkata", state: "West Bengal", pincode: "700016" },
      items: [{ variantId: variantA1Id, quantity: 2 }],
      paymentOutcome: "paid",
      paymentReference: "UPI-UTR-998877",
      tags: ["b2b", "urgent"],
    });

    expect(paidOrder.status).toBe("confirmed");
    expect(paidOrder.paymentStatus).toBe("paid");

    // Verify customer spend updated (via truthful metrics query)
    const custDetail = await getAdminCustomerDetail(rtWeb, ctxA, { id: customerAId });
    expect(Number(custDetail.customer.ordersCount)).toBe(initialOrders + 1);
    expect(Number(custDetail.customer.totalSpent)).toBe(initialSpent + paidOrder.grandTotal);

    // Verify payment intent is captured
    const [paymentIntent] = await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) => {
      return await tx.select().from(schema.paymentIntents).where(eq(schema.paymentIntents.orderId, paidOrder.orderId));
    });
    expect(paymentIntent?.provider).toBe("manual");
    expect(paymentIntent?.status).toBe("captured");
    expect(paymentIntent?.providerOrderId).toBe("UPI-UTR-998877");

    // Verify reservation was committed (inventory movements row 'sold')
    const movements = await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) => {
      return await tx.select().from(schema.inventoryMovements).where(eq(schema.inventoryMovements.variantId, variantA1Id));
    });
    expect(movements.some((m) => m.reason === "sold" && m.delta === -2)).toBe(true);
  });

  it("D4: 'Payment pending' holds active inventory reservation without marking paid", async () => {
    const pendingOrder = await createAdminDraftOrder(rtWeb, ctxA, {
      email: "pending@test.in",
      phone: "9876543210",
      shippingAddress: { fullName: "Pending Buyer", line1: "Street 2", city: "Delhi", state: "Delhi", pincode: "110001" },
      items: [{ variantId: variantA2Id, quantity: 1 }],
      paymentOutcome: "pending",
      tags: ["inquiry"],
    });

    expect(pendingOrder.status).toBe("pending");
    expect(pendingOrder.paymentStatus).toBe("pending");

    // Reservation is active
    const reservations = await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) => {
      return await tx
        .select()
        .from(schema.inventoryReservations)
        .where(and(eq(schema.inventoryReservations.orderId, pendingOrder.orderId), eq(schema.inventoryReservations.status, "active")));
    });
    expect(reservations.length).toBe(1);
    expect(reservations[0]?.qty).toBe(1);
  });

  it("D5: Order tags are saved and filterable in listAdminOrders", async () => {
    const orderWithSpecialTag = await createAdminDraftOrder(rtWeb, ctxA, {
      email: "tagged@test.in",
      phone: "9876543210",
      shippingAddress: { fullName: "Tagged Buyer", line1: "Street 3", city: "Delhi", state: "Delhi", pincode: "110001" },
      items: [{ variantId: variantA1Id, quantity: 1 }],
      tags: ["wholesale-q3", "exclusive"],
    });

    // Detail includes tags
    const detail = await getAdminOrderDetail(rtWeb, ctxA, { id: orderWithSpecialTag.orderId });
    expect(detail.order.tags).toContain("wholesale-q3");
    expect(detail.order.tags).toContain("exclusive");

    // List filtered by tag
    const listMatching = await listAdminOrders(rtWeb, ctxA, { tag: "wholesale-q3" });
    expect(listMatching.items.some((i) => i.id === orderWithSpecialTag.orderId)).toBe(true);

    const listNonMatching = await listAdminOrders(rtWeb, ctxA, { tag: "non-existent-tag" });
    expect(listNonMatching.items.some((i) => i.id === orderWithSpecialTag.orderId)).toBe(false);
  });

  it("D7: Shortage returns 'Some selected items do not have enough stock'", async () => {
    // Variant A2 has only 10 on hand (minus 1 reserved from previous test = 9 available)
    await expect(
      createAdminDraftOrder(rtWeb, ctxA, {
        email: "shortage@test.in",
        phone: "9876543210",
        shippingAddress: { fullName: "Overbuyer", line1: "Street 4", city: "Delhi", state: "Delhi", pincode: "110001" },
        items: [{ variantId: variantA2Id, quantity: 100 }],
      }),
    ).rejects.toThrow("Some selected items do not have enough stock");
  });

  it("Tenant isolation: Tenant B cannot list or view Tenant A orders or customers", async () => {
    const listB = await listAdminOrders(rtWeb, ctxB, {});
    // None of Tenant A's orders should be visible
    expect(listB.items.every((i) => i.customerEmail !== "vikram@malhotra.in")).toBe(true);

    // Tenant B cannot access Tenant A customer
    const [custInB] = await withTenant(rtWeb._db.db, ctxB.tenantId, async (tx) => {
      return await tx.select().from(schema.customers).where(eq(schema.customers.id, customerAId));
    });
    expect(custInB).toBeUndefined();

    // Tenant A cannot create draft order with Tenant B variant
    await expect(
      createAdminDraftOrder(rtWeb, ctxA, {
        email: "isolation@test.in",
        phone: "9876543210",
        shippingAddress: { fullName: "Isolation Buyer", line1: "Street 5", city: "Delhi", state: "Delhi", pincode: "110001" },
        items: [{ variantId: variantBId, quantity: 1 }],
      }),
    ).rejects.toThrow();
  });
});
