/**
 * Storefront checkout writes the variant's cost onto each order line (docs/FINANCE-PLAN.md section 3.2, D3).
 * Later cost edits must not rewrite what an old sale cost, so the snapshot is taken at placement.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, schema, withTenant, type DbHandle } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { createRuntime, type Runtime, type TenantContext } from "../src/index.ts";
import { provisionTenant } from "../src/saas/provisioning.ts";
import { addToCart, getOrCreateCart } from "../src/storefront/cart.ts";
import { placeOrder } from "../src/orders/checkout.ts";
import { handleFinancePost } from "../src/finance/index.ts";

let env: TestDb;
let dbRw: DbHandle;
let rt: Runtime;
let tenantId: string;
let ctx: TenantContext;
const productId = crypto.randomUUID();
const variantId = crypto.randomUUID();

beforeAll(async () => {
  env = await startTestDb();
  dbRw = createDb(env.as("app_rw"), { applicationName: "bsec-test-rw" });
  rt = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5 });
  const rtPlatform = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  const rand = Math.random().toString(36).slice(2, 7);
  const t = await provisionTenant(rtPlatform, {
    storeName: "Checkout Cost Store",
    slug: `fin-chk-${rand}`,
    owner: { email: `owner-${rand}@finance-checkout.test`, name: "Owner" },
    planCode: "starter",
    source: "platform_admin",
  });
  tenantId = t.tenantId;
  ctx = { tenantId, storeStatus: "live", actor: { type: "system" }, roles: ["admin"], permissions: ["*"], requestId: "req_fin_chk" } as TenantContext;

  await withTenant(dbRw.db, tenantId, async (tx) => {
    const [loc] = await tx.select({ id: schema.locations.id }).from(schema.locations).limit(1);
    await tx.insert(schema.products).values({ id: productId, tenantId, title: "Cost Tee", slug: "cost-tee", status: "published" });
    await tx.insert(schema.variants).values({ id: variantId, tenantId, productId, sku: "TEE-1", title: "Black / M", price: 149900n, costPrice: 60000n });
    await tx.insert(schema.inventoryLevels).values({ tenantId, variantId, locationId: loc!.id, onHand: 20 });
  });
}, 180_000);

afterAll(async () => {
  await dbRw?.close();
  await rt?.close();
});

describe("Storefront checkout cost snapshot", () => {
  it("snapshots the variant cost on the order line, and a later cost edit does not change the old sale", async () => {
    const cart = await getOrCreateCart(rt, ctx, "cart_cost_snapshot_1");
    await addToCart(rt, ctx, { token: cart.token, variantId, quantity: 2 });
    const placed = await placeOrder(rt, ctx, {
      cartToken: cart.token,
      idempotencyKey: "checkout_cost_snapshot_1",
      email: "buyer@example.com",
      phone: "9876543210",
      fullName: "Rajesh Kumar",
      addressLine1: "123 Marine Drive",
      city: "Mumbai",
      state: "Maharashtra",
      pincode: "400020",
      paymentMethod: "cod" as const,
    });
    expect(placed.success).toBe(true);

    const lines = await withTenant(dbRw.db, tenantId, (tx) =>
      tx.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, placed.orderId)),
    );
    expect(lines.length).toBe(1);
    expect(Number(lines[0]?.costPrice)).toBe(60000);

    // Merchant raises the cost later: the stored sale keeps what it cost then.
    await withTenant(dbRw.db, tenantId, (tx) =>
      tx.update(schema.variants).set({ costPrice: 90000n }).where(eq(schema.variants.id, variantId)),
    );
    const after = await withTenant(dbRw.db, tenantId, (tx) =>
      tx.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, placed.orderId)),
    );
    expect(Number(after[0]?.costPrice)).toBe(60000);

    // Once the COD is collected, COGS posts from the snapshot: 2 x 600.00.
    await withTenant(dbRw.db, tenantId, async (tx) => {
      await tx.update(schema.orders).set({ status: "delivered", paymentStatus: "cod_collected" }).where(eq(schema.orders.id, placed.orderId));
      await tx.update(schema.paymentIntents).set({ status: "cod_collected" }).where(eq(schema.paymentIntents.orderId, placed.orderId));
      await handleFinancePost(tx, tenantId, { kind: "order", id: placed.orderId });
    });
    const cogs = await withTenant(dbRw.db, tenantId, (tx) =>
      tx.select().from(schema.ledgerEntries).where(eq(schema.ledgerEntries.sourceId, placed.orderId)),
    );
    expect(cogs.find((e) => e.debit === "cost_of_goods")?.amount).toBe(120000);
  });
});
