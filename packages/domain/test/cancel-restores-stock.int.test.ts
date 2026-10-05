/**
 * Cancelling an order before anything shipped gives its stock back, whether the order was confirmed (COD)
 * or paid by hand, and the books return the cost of those goods (docs/adr/022-store-finance-ledger.md).
 *
 * Before the fix, confirming or paying an order committed its reservation (on_hand went down) and cancel
 * only released ACTIVE reservations, so the committed units never came back.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDb, schema, withTenant, type DbHandle } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { createRuntime, type Runtime } from "../src/runtime.ts";
import type { TenantContext } from "../src/context.ts";
import { provisionTenant } from "../src/saas/provisioning.ts";
import { cancelAdminOrder, confirmAdminOrder, createAdminDraftOrder } from "../src/index.ts";
import { handleFinancePost, reconcileTenant } from "../src/finance/index.ts";
import { restoreCommittedStock } from "../src/catalog/inventory-reservations.ts";

let env: TestDb;
let dbRw: DbHandle;
let rt: Runtime;
let tenantId: string;
let ctx: TenantContext;
let locationId: string;
const variantId = crypto.randomUUID();
const START = 50;

const address = { line1: "1 MG Road", city: "Pune", stateCode: "MH", pincode: "411001" };

async function levels() {
  const [lvl] = await withTenant(dbRw.db, tenantId, (tx) =>
    tx
      .select({ onHand: schema.inventoryLevels.onHand, reserved: schema.inventoryLevels.reserved })
      .from(schema.inventoryLevels)
      .where(and(eq(schema.inventoryLevels.variantId, variantId), eq(schema.inventoryLevels.locationId, locationId))),
  );
  return lvl!;
}

async function resetStock() {
  await withTenant(dbRw.db, tenantId, (tx) =>
    tx
      .update(schema.inventoryLevels)
      .set({ onHand: START, reserved: 0 })
      .where(and(eq(schema.inventoryLevels.variantId, variantId), eq(schema.inventoryLevels.locationId, locationId))),
  );
}

beforeAll(async () => {
  env = await startTestDb();
  dbRw = createDb(env.as("app_rw"), { applicationName: "bsec-test-rw" });
  rt = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5 });
  const rtPlatform = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  const rand = Math.random().toString(36).slice(2, 7);
  const t = await provisionTenant(rtPlatform, {
    storeName: "Cancel Stock Store",
    slug: `cancel-stock-${rand}`,
    owner: { email: `owner-${rand}@cancel-stock.test`, name: "Owner" },
    planCode: "starter",
    source: "platform_admin",
  });
  tenantId = t.tenantId;
  ctx = {
    tenantId,
    storeStatus: "live",
    actor: { type: "staff", userId: "0199a0e6-0000-7000-8000-000000000001" },
    roles: ["store_owner"],
    permissions: ["orders.read", "orders.write", "orders.refund", "products.read", "products.write", "finance.read", "finance.write"],
    requestId: "req-cancel-stock",
  } as unknown as TenantContext;

  await withTenant(dbRw.db, tenantId, async (tx) => {
    const [loc] = await tx.select({ id: schema.locations.id }).from(schema.locations).limit(1);
    locationId = loc!.id;
    const productId = crypto.randomUUID();
    await tx.insert(schema.products).values({ id: productId, tenantId, title: "Scarf", slug: "scarf", status: "active" });
    await tx.insert(schema.variants).values({
      id: variantId, tenantId, productId, sku: "SC-1", title: "Red", price: 250000n, costPrice: 100000n, trackInventory: true,
    });
    await tx.insert(schema.inventoryLevels).values({ tenantId, variantId, locationId, onHand: START });
  });
}, 180_000);

afterAll(async () => {
  await dbRw?.close();
  await rt?.close();
});

describe("Cancelling an order gives its stock back", () => {
  it("a confirmed COD order: confirm takes the stock, cancel returns it, with a movement per line", async () => {
    await resetStock();
    const draft = await createAdminDraftOrder(rt, ctx, {
      email: "cod@example.com", phone: "+919876543210", shippingAddress: address,
      items: [{ variantId, quantity: 3 }], paymentOutcome: "cod",
    });
    await confirmAdminOrder(rt, ctx, { id: draft.orderId });
    expect((await levels()).onHand).toBe(START - 3); // the committed reservation took the units

    await cancelAdminOrder(rt, ctx, { id: draft.orderId, reason: "Customer changed their mind" });
    expect(await levels()).toEqual({ onHand: START, reserved: 0 });

    const moves = await withTenant(dbRw.db, tenantId, (tx) =>
      tx.select().from(schema.inventoryMovements).where(eq(schema.inventoryMovements.referenceId, draft.orderId)),
    );
    expect(moves.map((m) => `${m.reason}:${m.delta}`).sort()).toEqual(["cancelled:3", "sold:-3"]);
    const reservations = await withTenant(dbRw.db, tenantId, (tx) =>
      tx.select().from(schema.inventoryReservations).where(eq(schema.inventoryReservations.orderId, draft.orderId)),
    );
    expect(reservations.every((r) => r.status === "returned_to_stock")).toBe(true);

    const events = await withTenant(dbRw.db, tenantId, (tx) =>
      tx.select().from(schema.orderEvents).where(eq(schema.orderEvents.orderId, draft.orderId)),
    );
    expect((events.find((e) => e.type === "order.cancel")?.data as Record<string, unknown>).stockRestoredUnits).toBe(3);
  });

  it("restoring twice does not add stock twice", async () => {
    await resetStock();
    const draft = await createAdminDraftOrder(rt, ctx, {
      email: "twice@example.com", phone: "+919876543210", shippingAddress: address,
      items: [{ variantId, quantity: 2 }], paymentOutcome: "cod",
    });
    await confirmAdminOrder(rt, ctx, { id: draft.orderId });
    await cancelAdminOrder(rt, ctx, { id: draft.orderId, reason: "dup" });
    expect((await levels()).onHand).toBe(START);
    const again = await restoreCommittedStock(dbRw.db, tenantId, { orderId: draft.orderId });
    expect(again).toEqual({ restoredLines: 0, restoredUnits: 0 });
    expect((await levels()).onHand).toBe(START);
  });

  it("an order that was never confirmed only releases its reservation (unchanged behaviour)", async () => {
    await resetStock();
    const draft = await createAdminDraftOrder(rt, ctx, {
      email: "pending@example.com", phone: "+919876543210", shippingAddress: address,
      items: [{ variantId, quantity: 4 }],
    });
    expect((await levels()).reserved).toBe(4);
    await cancelAdminOrder(rt, ctx, { id: draft.orderId, reason: "never mind" });
    expect(await levels()).toEqual({ onHand: START, reserved: 0 });
    const moves = await withTenant(dbRw.db, tenantId, (tx) =>
      tx.select().from(schema.inventoryMovements).where(and(eq(schema.inventoryMovements.referenceId, draft.orderId), eq(schema.inventoryMovements.reason, "cancelled"))),
    );
    expect(moves.length).toBe(0); // nothing had left the shelf, so nothing is restored
  });

  it("a paid order: stock returns, the refund is recorded, and the books return the cost of the goods", async () => {
    await resetStock();
    const draft = await createAdminDraftOrder(rt, ctx, {
      email: "paid@example.com", phone: "+919876543210", shippingAddress: address,
      items: [{ variantId, quantity: 2 }], paymentOutcome: "paid",
    });
    expect((await levels()).onHand).toBe(START - 2);
    await withTenant(dbRw.db, tenantId, (tx) => handleFinancePost(tx, tenantId, { kind: "order", id: draft.orderId }));

    await cancelAdminOrder(rt, ctx, { id: draft.orderId, reason: "Out of stock at supplier" });
    expect((await levels()).onHand).toBe(START);

    // The cancel queues finance.post for the cost-back (no queue in this test, so run it as the worker would).
    const posted = await withTenant(dbRw.db, tenantId, (tx) => handleFinancePost(tx, tenantId, { kind: "cancel_restock", id: draft.orderId }));
    expect(posted).toBe(1);
    const back = await withTenant(dbRw.db, tenantId, (tx) =>
      tx.select().from(schema.ledgerEntries).where(and(eq(schema.ledgerEntries.sourceId, draft.orderId), eq(schema.ledgerEntries.debit, "inventory"))),
    );
    expect(back.length).toBe(1);
    expect(back[0]?.credit).toBe("cost_of_goods");
    expect(back[0]?.amount).toBe(200000); // 2 x 1,000.00 cost snapshot, equal to the COGS posted on collection

    // Replay writes nothing more, and the reconcile pass agrees.
    expect(await withTenant(dbRw.db, tenantId, (tx) => handleFinancePost(tx, tenantId, { kind: "cancel_restock", id: draft.orderId }))).toBe(0);
    const rec = await reconcileTenant(dbRw.db, tenantId, { fullBackfill: true });
    expect(rec.written).toBeGreaterThanOrEqual(0);
    const after = await withTenant(dbRw.db, tenantId, (tx) =>
      tx.select().from(schema.ledgerEntries).where(and(eq(schema.ledgerEntries.sourceId, draft.orderId), eq(schema.ledgerEntries.debit, "inventory"))),
    );
    expect(after.length).toBe(1);
  });

  it("no cost-back is posted for an order whose stock was never restored (or whose COGS was never posted)", async () => {
    await resetStock();
    // COD order cancelled before collection: no COGS was ever posted, so there is nothing to return.
    const draft = await createAdminDraftOrder(rt, ctx, {
      email: "nocogs@example.com", phone: "+919876543210", shippingAddress: address,
      items: [{ variantId, quantity: 1 }], paymentOutcome: "cod",
    });
    await confirmAdminOrder(rt, ctx, { id: draft.orderId });
    await cancelAdminOrder(rt, ctx, { id: draft.orderId, reason: "changed mind" });
    expect(await withTenant(dbRw.db, tenantId, (tx) => handleFinancePost(tx, tenantId, { kind: "cancel_restock", id: draft.orderId }))).toBe(0);

    // An order with no stock-restore movement (cancelled before this fix) is never given an inventory asset.
    const legacy = crypto.randomUUID();
    await withTenant(dbRw.db, tenantId, async (tx) => {
      await tx.insert(schema.orders).values({
        id: legacy, tenantId, number: "LEG-1", email: "l@example.com", phone: "+919988776655", status: "cancelled",
        paymentStatus: "refunded", subtotal: 100000, grandTotal: 100000, shippingAddress: { city: "Pune" },
      } as never);
    });
    expect(await withTenant(dbRw.db, tenantId, (tx) => handleFinancePost(tx, tenantId, { kind: "cancel_restock", id: legacy }))).toBe(0);
  });
});
