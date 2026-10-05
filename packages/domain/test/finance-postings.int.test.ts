import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDb, schema, withTenant, type DbHandle } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import {
  LEDGER_ACCOUNT,
  handleFinancePost,
  postOrderEvent,
  postRefundEvent,
  postRestockEvent,
} from "../src/finance/index.ts";

let env: TestDb;
let dbRw: DbHandle;

const tenantId = "0199a0e2-0000-7000-8000-000000000001";
const locationId = "0199a0e2-0000-7000-8000-000000000002";
const productId = "0199a0e2-0000-7000-8000-000000000003";
const variantId = "0199a0e2-0000-7000-8000-000000000004";

beforeAll(async () => {
  env = await startTestDb();
  dbRw = createDb(env.as("app_rw"), { applicationName: "bsec-test-rw" });

  // Seed baseline tenant, location, product, and variant with cost price
  await withTenant(dbRw.db, tenantId, async (tx) => {
    await tx.insert(schema.locations).values({
      id: locationId,
      tenantId,
      name: "Main Warehouse",
      isDefault: true,
    });

    await tx.insert(schema.products).values({
      id: productId,
      tenantId,
      title: "Handmade Silk Scarf",
      slug: "handmade-silk-scarf",
      status: "active",
    });

    await tx.insert(schema.variants).values({
      id: variantId,
      tenantId,
      productId,
      sku: "SILK-SCARF-01",
      title: "Crimson Red",
      price: 250000n, // ₹2,500
      costPrice: 100000n, // ₹1,000 cost snapshot
      trackInventory: true,
    });
  });
}, 120_000);

afterAll(async () => {
  await dbRw?.close();
});

describe("Finance Real Money Event Postings", () => {
  it("order money collected posts revenue + tax + shipping + codFee + COGS correctly", async () => {
    const orderId = "0199a0e2-0000-7000-8000-000000000010";

    await withTenant(dbRw.db, tenantId, async (tx) => {
      await tx.insert(schema.orders).values({
        id: orderId,
        tenantId,
        number: "ORD-POST-001",
        email: "shopper1@example.com",
        phone: "+919988776655",
        status: "delivered",
        paymentStatus: "cod_collected",
        fulfillmentStatus: "delivered",
        subtotal: 500000, // ₹5,000 (2 items @ ₹2,500)
        discountTotal: 50000, // -₹500 discount -> merchandise ₹4,500
        shippingTotal: 20000, // ₹200 shipping
        codFee: 5000, // ₹50 cod fee -> total shipping ₹250
        taxTotal: 45000, // ₹450 tax
        grandTotal: 520000, // ₹5,200
        currency: "INR",
        shippingAddress: { city: "Mumbai" },
      });

      await tx.insert(schema.paymentIntents).values({
        tenantId,
        orderId,
        provider: "cod",
        amount: 520000,
        currency: "INR",
        status: "cod_collected",
      });

      await tx.insert(schema.orderItems).values({
        tenantId,
        orderId,
        variantId,
        productTitle: "Handmade Silk Scarf",
        variantTitle: "Crimson Red",
        sku: "SILK-SCARF-01",
        quantity: 2,
        unitPrice: 250000,
        total: 500000,
        costPrice: 100000, // ₹1,000 * 2 = ₹2,000 COGS
      });

      const written = await handleFinancePost(tx, tenantId, {
        kind: "order",
        id: orderId,
      });
      expect(written).toBe(4); // revenue, tax, shipping, cogs
    });

    // Inspect ledger rows
    const entries = await withTenant(dbRw.db, tenantId, async (tx) => {
      return await tx
        .select()
        .from(schema.ledgerEntries)
        .where(
          and(
            eq(schema.ledgerEntries.tenantId, tenantId),
            eq(schema.ledgerEntries.sourceId, orderId),
          ),
        );
    });

    expect(entries.length).toBe(4);

    const rev = entries.find((e) => e.credit === LEDGER_ACCOUNT.PRODUCT_REVENUE);
    expect(rev).toBeDefined();
    expect(rev?.debit).toBe(LEDGER_ACCOUNT.CASH_ON_HAND); // COD sale
    expect(rev?.amount).toBe(450000); // 500000 - 50000

    const tax = entries.find((e) => e.credit === LEDGER_ACCOUNT.TAX_PAYABLE);
    expect(tax).toBeDefined();
    expect(tax?.debit).toBe(LEDGER_ACCOUNT.CASH_ON_HAND);
    expect(tax?.amount).toBe(45000);

    const ship = entries.find((e) => e.credit === LEDGER_ACCOUNT.SHIPPING_INCOME);
    expect(ship).toBeDefined();
    expect(ship?.debit).toBe(LEDGER_ACCOUNT.CASH_ON_HAND);
    expect(ship?.amount).toBe(25000); // shipping 20000 + codFee 5000

    const cogs = entries.find((e) => e.debit === LEDGER_ACCOUNT.COST_OF_GOODS);
    expect(cogs).toBeDefined();
    expect(cogs?.credit).toBe(LEDGER_ACCOUNT.INVENTORY);
    expect(cogs?.amount).toBe(200000); // 2 * 100000
  });

  it("handles two consecutive partial refunds and caps at remaining headroom", async () => {
    const orderId = "0199a0e2-0000-7000-8000-000000000020";
    const refundId1 = "0199a0e2-0000-7000-8000-000000000021";
    const refundId2 = "0199a0e2-0000-7000-8000-000000000022";

    await withTenant(dbRw.db, tenantId, async (tx) => {
      await tx.insert(schema.orders).values({
        id: orderId,
        tenantId,
        number: "ORD-POST-002",
        email: "shopper2@example.com",
        phone: "+919988776655",
        status: "delivered",
        paymentStatus: "paid",
        subtotal: 100000, // ₹1,000
        discountTotal: 0,
        shippingTotal: 10000, // ₹100
        taxTotal: 10000, // ₹100
        grandTotal: 120000, // ₹1,200
        currency: "INR",
        shippingAddress: { city: "Delhi" },
      });

      await tx.insert(schema.paymentIntents).values({
        tenantId,
        orderId,
        provider: "manual", // manual/bank
        amount: 120000,
        currency: "INR",
        status: "captured",
      });

      // Post initial sale
      await postOrderEvent(tx, tenantId, orderId);

      // Refund 1: ₹600 (half the order)
      await tx.insert(schema.refunds).values({
        id: refundId1,
        tenantId,
        orderId,
        amount: 60000,
        method: "bank_transfer",
        status: "succeeded",
      });

      const written1 = await postRefundEvent(tx, tenantId, refundId1);
      expect(written1).toBe(3); // refunds, tax_payable, shipping_income
    });

    // Inspect first refund entries
    const refund1Entries = await withTenant(dbRw.db, tenantId, async (tx) => {
      return await tx
        .select()
        .from(schema.ledgerEntries)
        .where(
          and(
            eq(schema.ledgerEntries.tenantId, tenantId),
            eq(schema.ledgerEntries.sourceId, refundId1),
          ),
        );
    });
    expect(refund1Entries.length).toBe(3);

    // Sum of first refund should be exactly 60000
    const sum1 = refund1Entries.reduce((s, e) => s + e.amount, 0);
    expect(sum1).toBe(60000);
    // Paid via bank transfer -> credits cash_bank, never cash_gateway
    expect(refund1Entries.every((e) => e.credit === LEDGER_ACCOUNT.CASH_BANK)).toBe(true);

    // Refund 2: ₹700 (which exceeds remaining 1200 - 600 = 600 headroom)
    await withTenant(dbRw.db, tenantId, async (tx) => {
      await tx.insert(schema.refunds).values({
        id: refundId2,
        tenantId,
        orderId,
        amount: 70000,
        method: "bank_transfer",
        status: "succeeded",
      });

      const written2 = await postRefundEvent(tx, tenantId, refundId2);
      expect(written2).toBe(3);
    });

    const refund2Entries = await withTenant(dbRw.db, tenantId, async (tx) => {
      return await tx
        .select()
        .from(schema.ledgerEntries)
        .where(
          and(
            eq(schema.ledgerEntries.tenantId, tenantId),
            eq(schema.ledgerEntries.sourceId, refundId2),
          ),
        );
    });
    // Refund 2 is capped at remaining 60000!
    const sum2 = refund2Entries.reduce((s, e) => s + e.amount, 0);
    expect(sum2).toBe(60000);
  });

  it("restock event posts inventory recovery against cost_of_goods", async () => {
    const orderId = "0199a0e2-0000-7000-8000-000000000030";
    const returnId = "0199a0e2-0000-7000-8000-000000000031";
    const orderItemId = "0199a0e2-0000-7000-8000-000000000032";

    await withTenant(dbRw.db, tenantId, async (tx) => {
      await tx.insert(schema.orders).values({
        id: orderId,
        tenantId,
        number: "ORD-POST-003",
        email: "shopper3@example.com",
        phone: "+919988776655",
        status: "delivered",
        paymentStatus: "paid",
        subtotal: 250000,
        grandTotal: 250000,
        shippingAddress: { city: "Kolkata" },
      });

      await tx.insert(schema.orderItems).values({
        id: orderItemId,
        tenantId,
        orderId,
        variantId,
        productTitle: "Handmade Silk Scarf",
        quantity: 1,
        unitPrice: 250000,
        total: 250000,
        costPrice: 100000, // ₹1,000 cost
      });

      await tx.insert(schema.returns).values({
        id: returnId,
        tenantId,
        orderId,
        number: "RET-POST-001",
        reason: "Defective item",
        status: "received",
      });

      await tx.insert(schema.returnItems).values({
        tenantId,
        returnId,
        orderItemId,
        quantity: 1,
        restock: true, // Restocked to inventory
      });

      const written = await postRestockEvent(tx, tenantId, returnId);
      expect(written).toBe(1);
    });

    const entries = await withTenant(dbRw.db, tenantId, async (tx) => {
      return await tx
        .select()
        .from(schema.ledgerEntries)
        .where(
          and(
            eq(schema.ledgerEntries.tenantId, tenantId),
            eq(schema.ledgerEntries.sourceId, returnId),
          ),
        );
    });

    expect(entries.length).toBe(1);
    expect(entries[0]?.debit).toBe(LEDGER_ACCOUNT.INVENTORY);
    expect(entries[0]?.credit).toBe(LEDGER_ACCOUNT.COST_OF_GOODS);
    expect(entries[0]?.amount).toBe(100000);
  });
});
