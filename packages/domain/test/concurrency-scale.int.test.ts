import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq, sql } from "drizzle-orm";
import { createDb, type DbHandle, schema, withTenant } from "@bs/db";
import { bootstrapRoles } from "@bs/db/bootstrap";
import { runMigrations } from "@bs/db/migrate";
import {
  createRuntime,
  type Runtime,
  type TenantContext,
  placeOrder,
  getOrCreateCart,
  addToCart,
  reserveInventory,
  InsufficientInventoryError,
  redeemDiscount,
  generateInvoice,
  withIdempotencyKey,
  acquireTenantJobSlot,
  releaseTenantJobSlot,
  refundAdminOrder,
} from "../src/index.ts";

const PW = { owner: "o_test", rw: "rw_test", platform: "p_test" };
let container: StartedPostgreSqlContainer | undefined;
let superUrl: string;
let rwDb: DbHandle;
let rt: Runtime;

function as(role: "app_owner" | "app_rw" | "app_platform", password: string): string {
  const u = new URL(superUrl);
  u.username = role;
  u.password = password;
  return u.toString();
}

// Unique fixture prefix for M7 concurrency tests: 0199a072
const orgId = "0199a072-0000-7000-8000-000000000000";
const tenantId = "0199a072-0000-7000-8000-000000000001";
const locationId = "0199a072-0000-7000-8000-000000000010";
const productId = "0199a072-0000-7000-8000-000000000020";
const variantId = "0199a072-0000-7000-8000-000000000030";

const staffCtx: TenantContext = {
  tenantId,
  roles: ["store_owner"],
  permissions: ["orders.read", "orders.write", "orders.refund", "discounts.read", "discounts.write"],
  actor: { type: "staff", userId: "0199a072-0000-7000-8000-000000000099" },
  requestId: "req_concurrency_test",
  storeStatus: "live",
};

const storefrontCtx: TenantContext = {
  tenantId,
  roles: ["anonymous"],
  permissions: [],
  actor: { type: "anonymous" },
  requestId: "req_storefront_concurrency",
  storeStatus: "live",
};

beforeAll(async () => {
  if (process.env.TEST_DATABASE_URL_SUPERUSER) {
    superUrl = process.env.TEST_DATABASE_URL_SUPERUSER;
  } else {
    container = await new PostgreSqlContainer("postgres:18").withReuse().start();
    superUrl = container.getConnectionUri();
  }
  await bootstrapRoles(superUrl, PW);
  await runMigrations(as("app_owner", PW.owner));
  rwDb = createDb(as("app_rw", PW.rw), { max: 40 });
  rt = createRuntime({ service: "web", databaseUrl: as("app_rw", PW.rw), poolMax: 40 });

  const pgClient = new (await import("pg")).default.Client({ connectionString: superUrl });
  await pgClient.connect();
  await pgClient.query("SET session_replication_role = 'replica'");
  await pgClient.query(`
    DELETE FROM discount_redemptions WHERE tenant_id = '${tenantId}';
    DELETE FROM discounts WHERE tenant_id = '${tenantId}';
    DELETE FROM invoices WHERE tenant_id = '${tenantId}';
    DELETE FROM refunds WHERE tenant_id = '${tenantId}';
    DELETE FROM payment_attempts WHERE tenant_id = '${tenantId}';
    DELETE FROM payment_intents WHERE tenant_id = '${tenantId}';
    DELETE FROM order_items WHERE tenant_id = '${tenantId}';
    DELETE FROM order_events WHERE tenant_id = '${tenantId}';
    DELETE FROM action_tokens WHERE tenant_id = '${tenantId}';
    DELETE FROM orders WHERE tenant_id = '${tenantId}';
    DELETE FROM number_sequences WHERE tenant_id = '${tenantId}';
    DELETE FROM inventory_reservations WHERE tenant_id = '${tenantId}';
    DELETE FROM inventory_movements WHERE tenant_id = '${tenantId}';
    DELETE FROM inventory_levels WHERE tenant_id = '${tenantId}';
    DELETE FROM idempotency_keys WHERE tenant_id = '${tenantId}';
    DELETE FROM rate_limit_counters WHERE key LIKE '%0199a072%';
    DELETE FROM tenant_active_jobs WHERE tenant_id = '${tenantId}';
  `);
  await pgClient.query("SET session_replication_role = 'origin'");
  await pgClient.query(`
    INSERT INTO organizations (id, name) VALUES ('${orgId}', 'Scale Concurrency Org') ON CONFLICT DO NOTHING;
    INSERT INTO tenants (id, organization_id, slug, name)
    VALUES ('${tenantId}', '${orgId}', 'scale-concurrency-store', 'Scale Concurrency Store')
    ON CONFLICT DO NOTHING;

    INSERT INTO store_status (tenant_id, mode)
    VALUES ('${tenantId}', 'live')
    ON CONFLICT (tenant_id) DO UPDATE SET mode = 'live';

    INSERT INTO locations (id, tenant_id, name, is_default)
    VALUES ('${locationId}', '${tenantId}', 'Primary Warehouse', true)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO products (id, tenant_id, title, slug, status)
    VALUES ('${productId}', '${tenantId}', 'High Demand Flash Sale Item', 'flash-sale-item', 'published')
    ON CONFLICT (id) DO UPDATE SET status = 'published';

    INSERT INTO variants (id, tenant_id, product_id, sku, title, price)
    VALUES ('${variantId}', '${tenantId}', '${productId}', 'FLASH-001', 'Default Variant', 10000)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO inventory_levels (id, tenant_id, variant_id, location_id, on_hand, reserved)
    VALUES ('0199a072-0000-7000-8000-000000000040', '${tenantId}', '${variantId}', '${locationId}', 50, 0)
    ON CONFLICT (tenant_id, variant_id, location_id) DO UPDATE SET on_hand = 50, reserved = 0;
  `);
  await pgClient.end();
}, 180_000);

afterAll(async () => {
  await rwDb?.close();
  await rt?.close();
  await container?.stop();
});

describe("PLAN §15 Concurrency Proofs at Scale (Milestone M7 Hardening)", () => {
  it("enforces zero-oversell and gapless sequences across 100 concurrent checkouts competing for 50 items", async () => {
    const totalShoppers = 100;
    const availableStock = 50;

    // 1. Prepare 100 independent shopper carts, each with 1 item of the flash sale product
    const carts = await Promise.all(
      Array.from({ length: totalShoppers }, async (_, i) => {
        const token = `scale_cart_${i}_${Date.now()}`;
        const cart = await getOrCreateCart(rt, storefrontCtx, token);
        await addToCart(rt, storefrontCtx, {
          token: cart.token,
          variantId,
          quantity: 1,
        });
        return { cartToken: cart.token, index: i };
      }),
    );

    // 2. Launch 100 simultaneous checkouts contending for the 50 inventory units
    const startTime = Date.now();
    const outcomes = await Promise.allSettled(
      carts.map(async ({ cartToken, index }) => {
        return await placeOrder(rt, storefrontCtx, {
          cartToken,
          idempotencyKey: `scale_checkout_${index}_${Date.now()}`,
          email: `shopper_${index}@example.com`,
          phone: `91980000${String(index).padStart(4, "0")}`,
          fullName: `Shopper ${index}`,
          addressLine1: `${index} Market Street`,
          city: "Bengaluru",
          state: "Karnataka",
          pincode: "560001",
          paymentMethod: "cod",
        });
      }),
    );
    const durationMs = Date.now() - startTime;

    const successful = outcomes.filter(
      (o): o is PromiseFulfilledResult<Awaited<ReturnType<typeof placeOrder>>> => o.status === "fulfilled",
    );
    const rejected = outcomes.filter(
      (o): o is PromiseRejectedResult => o.status === "rejected",
    );

    // Exact count verification: exactly 50 succeeded, exactly 50 failed
    expect(successful.length).toBe(availableStock);
    expect(rejected.length).toBe(totalShoppers - availableStock);

    // All rejections must be InsufficientInventoryError
    for (const fail of rejected) {
      expect(fail.reason).toBeInstanceOf(InsufficientInventoryError);
    }

    // Verify all 50 order numbers are unique and strictly sequential with no gaps
    const orderNumbers = successful.map((s) => s.value.orderNumber).sort();
    const uniqueOrderNumbers = new Set(orderNumbers);
    expect(uniqueOrderNumbers.size).toBe(50);

    // Verify order sequence is contiguous: ORD-00001 to ORD-00050
    expect(orderNumbers[0]).toBe("ORD-00001");
    expect(orderNumbers[49]).toBe("ORD-00050");

    // Verify DB inventory level: on_hand=50, reserved=50, available=0
    await withTenant(rwDb.db, tenantId, async (tx) => {
      const [inv] = await tx
        .select()
        .from(schema.inventoryLevels)
        .where(
          sql`${schema.inventoryLevels.variantId} = ${variantId} AND ${schema.inventoryLevels.locationId} = ${locationId}`,
        );
      expect(inv?.onHand).toBe(50);
      expect(inv?.reserved).toBe(50);
      expect(inv?.available).toBe(0);
    });

    // Log measured numbers
    console.log(
      `[MEASURED] 100 concurrent checkouts completed in ${durationMs}ms: ${successful.length} succeeded, ${rejected.length} safely rejected on stock exhaustion.`,
    );
  }, 90_000);

  it("safely resolves 25 simultaneous reservations on 1 unit remaining: exactly 1 succeeds, 24 rejected", async () => {
    const singleUnitVariantId = "0199a072-0000-7000-8000-000000000031";

    // Setup variant with exactly 1 unit on hand
    const pg = new (await import("pg")).default.Client({ connectionString: superUrl });
    await pg.connect();
    await pg.query(`
      INSERT INTO variants (id, tenant_id, product_id, sku, title, price)
      VALUES ('${singleUnitVariantId}', '${tenantId}', '${productId}', 'SINGLE-001', 'Single Unit Item', 5000)
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO inventory_levels (id, tenant_id, variant_id, location_id, on_hand, reserved)
      VALUES ('0199a072-0000-7000-8000-000000000041', '${tenantId}', '${singleUnitVariantId}', '${locationId}', 1, 0)
      ON CONFLICT (tenant_id, variant_id, location_id) DO UPDATE SET on_hand = 1, reserved = 0;
    `);
    await pg.end();

    const contenders = 25;
    const outcomes = await Promise.allSettled(
      Array.from({ length: contenders }, (_, i) =>
        reserveInventory(
          rwDb.db,
          tenantId,
          [{ variantId: singleUnitVariantId, locationId, qty: 1 }],
          { cartId: `0199a072-0000-7000-8000-${String(100 + i).padStart(12, "0")}` },
        ),
      ),
    );

    const succeeded = outcomes.filter((o) => o.status === "fulfilled");
    const failed = outcomes.filter(
      (o) => o.status === "rejected" && o.reason instanceof InsufficientInventoryError,
    );

    expect(succeeded.length).toBe(1);
    expect(failed.length).toBe(24);

    // Verify DB inventory state
    await withTenant(rwDb.db, tenantId, async (tx) => {
      const [inv] = await tx
        .select()
        .from(schema.inventoryLevels)
        .where(
          sql`${schema.inventoryLevels.variantId} = ${singleUnitVariantId} AND ${schema.inventoryLevels.locationId} = ${locationId}`,
        );
      expect(inv?.onHand).toBe(1);
      expect(inv?.reserved).toBe(1);
      expect(inv?.available).toBe(0);
    });
  });

  it("safely enforces coupon usage limit under 25 concurrent redemptions (usage limit = 5)", async () => {
    const discountId = "0199a072-0000-7000-8000-000000000050";
    const discountCode = "FLASH5";

    const pg = new (await import("pg")).default.Client({ connectionString: superUrl });
    await pg.connect();

    // Clean previous test state and pre-seed orders for the redemptions to attach to
    await pg.query(`
      DELETE FROM discount_redemptions WHERE discount_id = '${discountId}';
      DELETE FROM discounts WHERE id = '${discountId}';

      INSERT INTO discounts (id, tenant_id, code, title, type, value, usage_limit, used_count, status, starts_at, ends_at)
      VALUES ('${discountId}', '${tenantId}', '${discountCode}', 'Flash 5 Promo', 'percentage', 2000, 5, 0, 'active', now() - interval '1 hour', now() + interval '1 day')
      ON CONFLICT (id) DO UPDATE SET used_count = 0, usage_limit = 5, status = 'active';
    `);

    for (let i = 0; i < 25; i++) {
      const ordId = `0199a072-0000-7000-8000-${String(2000 + i).padStart(12, "0")}`;
      await pg.query(`
        INSERT INTO orders (id, tenant_id, number, email, phone, currency, status, payment_status, subtotal, grand_total, shipping_total, shipping_address)
        VALUES ('${ordId}', '${tenantId}', ${2000 + i}, 'buyer${i}@example.com', '919800000001', 'INR', 'confirmed', 'paid', 10000, 10000, 0, '{"city":"Bengaluru"}'::jsonb)
        ON CONFLICT (id) DO NOTHING;
      `);
    }
    await pg.end();

    const contenders = 25;
    const outcomes = await Promise.allSettled(
      Array.from({ length: contenders }, (_, i) =>
        redeemDiscount(rt, staffCtx, {
          discountId,
          orderId: `0199a072-0000-7000-8000-${String(2000 + i).padStart(12, "0")}`,
          amount: 2000,
        }),
      ),
    );

    const successful = outcomes.filter((o) => o.status === "fulfilled" && o.value.success === true);
    const rejected = outcomes.filter(
      (o) =>
        (o.status === "fulfilled" && o.value.success === false) ||
        o.status === "rejected",
    );

    expect(successful.length).toBe(5);
    expect(rejected.length).toBe(20);

    // Verify DB state: used_count is exactly 5 and exactly 5 redemptions recorded
    await withTenant(rwDb.db, tenantId, async (tx) => {
      const [disc] = await tx
        .select()
        .from(schema.discounts)
        .where(eq(schema.discounts.id, discountId));
      expect(disc?.usedCount).toBe(5);

      const redemptions = await tx
        .select()
        .from(schema.discountRedemptions)
        .where(eq(schema.discountRedemptions.discountId, discountId));
      expect(redemptions.length).toBe(5);
    });
  });

  it("allocates exactly 50 unique, gapless invoice numbers under 50 concurrent invocations", async () => {
    const count = 50;
    const orderIds: string[] = [];

    // Pre-insert 50 orders
    const pg = new (await import("pg")).default.Client({ connectionString: superUrl });
    await pg.connect();
    for (let i = 1; i <= count; i++) {
      const oId = `0199a072-0000-7000-8000-${String(3000 + i).padStart(12, "0")}`;
      orderIds.push(oId);
      await pg.query(`
        INSERT INTO orders (id, tenant_id, number, email, phone, currency, status, payment_status, subtotal, grand_total, shipping_total, shipping_address, place_of_supply_state)
        VALUES ('${oId}', '${tenantId}', ${3000 + i}, 'buyer${i}@example.com', '919800000001', 'INR', 'confirmed', 'captured', 10000, 10000, 0, '{"state":"Karnataka"}'::jsonb, 'Karnataka')
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO order_items (id, tenant_id, order_id, variant_id, product_title, quantity, unit_price, total, tax_rate_bps)
        VALUES ('0199a072-0000-7000-8000-${String(4000 + i).padStart(12, "0")}', '${tenantId}', '${oId}', '${variantId}', 'Item', 1, 10000, 10000, 1800)
        ON CONFLICT (id) DO NOTHING;
      `);
    }
    await pg.end();

    const invoices = await Promise.all(
      orderIds.map((orderId) =>
        generateInvoice(rt, staffCtx, {
          orderId,
          sellerState: "Karnataka",
          placeOfSupplyState: "Karnataka",
          pricesIncludeTax: true,
        }),
      ),
    );

    expect(invoices.length).toBe(50);
    const invoiceNumbers = invoices.map((inv) => inv.number);
    const uniqueNumbers = new Set(invoiceNumbers);
    expect(uniqueNumbers.size).toBe(50);

    // Extract sequence integer from each invoice number and assert contiguous 1..50
    const sequenceNums = invoiceNumbers
      .map((num) => {
        const parts = num.split("-");
        return parseInt(parts[parts.length - 1]!, 10);
      })
      .sort((a, b) => a - b);

    expect(sequenceNums[0]).toBe(1);
    expect(sequenceNums[49]).toBe(50);
    for (let i = 0; i < 50; i++) {
      expect(sequenceNums[i]).toBe(i + 1);
    }
  });

  it("handles 20 concurrent duplicate requests with identical idempotency key without double execution", async () => {
    let executions = 0;
    const idempotencyKey = "idemp_scale_test_01";
    const route = "/api/storefront/checkout/place-order";
    const payload = { cartId: "cart-scale-123", email: "shopper@example.com" };

    const outcomes = await Promise.all(
      Array.from({ length: 20 }, async () => {
        return await withIdempotencyKey(rwDb.db, tenantId, route, idempotencyKey, payload, async () => {
          executions++;
          // Small artificial delay to simulate order placement work
          await new Promise((r) => setTimeout(r, 40));
          return { status: 201, body: { orderId: "ord_scale_single", number: "ORD-SCALE-01" } };
        });
      }),
    );

    // Exactly 1 execution occurred
    expect(executions).toBe(1);

    // All 20 returned identical status and body
    for (const res of outcomes) {
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ orderId: "ord_scale_single", number: "ORD-SCALE-01" });
    }

    const cachedResponses = outcomes.filter((res) => res.cached);
    expect(cachedResponses.length).toBe(19);
  });

  it("enforces tenant background job concurrency ceilings (explicit ceiling of 1)", async () => {
    const pgc = new (await import("pg")).default.Client({ connectionString: superUrl });
    await pgc.connect();
    await pgc.query(`
      INSERT INTO tenant_quota_overrides (tenant_id, quota_key, value) VALUES ('${tenantId}', 'job_concurrency', 1)
      ON CONFLICT (tenant_id, quota_key) DO UPDATE SET value = 1;
      DELETE FROM tenant_active_jobs WHERE tenant_id = '${tenantId}';
    `);
    await pgc.end();
    // 10 concurrent requests trying to acquire the only slot (limit = 1)
    const outcomes = await Promise.all(
      Array.from({ length: 10 }, () => acquireTenantJobSlot(rwDb.db, tenantId)),
    );

    const acquired = outcomes.filter((success) => success === true);
    const denied = outcomes.filter((success) => success === false);

    expect(acquired.length).toBe(1);
    expect(denied.length).toBe(9);

    // Release the active slot
    await releaseTenantJobSlot(rwDb.db, tenantId);

    // After release, a new attempt immediately succeeds
    const nextSlot = await acquireTenantJobSlot(rwDb.db, tenantId);
    expect(nextSlot).toBe(true);

    await releaseTenantJobSlot(rwDb.db, tenantId);
  });

  it("prevents double refunds under concurrent refund requests on a captured order", async () => {
    const orderId = "0199a072-0000-7000-8000-000000000500";
    const intentId = "0199a072-0000-7000-8000-000000000510";

    const pg = new (await import("pg")).default.Client({ connectionString: superUrl });
    await pg.connect();
    await pg.query(`
      DELETE FROM refunds WHERE order_id = '${orderId}';
      DELETE FROM payment_intents WHERE order_id = '${orderId}';
      DELETE FROM orders WHERE id = '${orderId}';

      INSERT INTO orders (id, tenant_id, number, email, phone, currency, status, payment_status, subtotal, grand_total, shipping_total, shipping_address)
      VALUES ('${orderId}', '${tenantId}', 5001, 'refund_test@example.com', '919800000001', 'INR', 'confirmed', 'paid', 10000, 10000, 0, '{"city":"Mumbai"}'::jsonb);

      INSERT INTO payment_intents (id, tenant_id, order_id, provider, amount, status)
      VALUES ('${intentId}', '${tenantId}', '${orderId}', 'razorpay', 10000, 'captured');
    `);
    await pg.end();

    // 10 concurrent full-refund requests competing on the same order
    const outcomes = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        refundAdminOrder(rt, staffCtx, {
          id: orderId,
          amount: 10000,
          reason: `Concurrent refund test attempt ${i + 1}`,
        }),
      ),
    );

    const successful = outcomes.filter((o) => o.status === "fulfilled");
    const rejected = outcomes.filter((o) => o.status === "rejected");

    expect(successful.length).toBe(1);
    expect(rejected.length).toBe(9);

    // Verify DB state: total refunds recorded for this order is exactly 10000 (not 100000)
    await withTenant(rwDb.db, tenantId, async (tx) => {
      const refunds = await tx
        .select()
        .from(schema.refunds)
        .where(eq(schema.refunds.orderId, orderId));
      expect(refunds.length).toBe(1);
      expect(refunds[0]?.amount).toBe(10000);

      const [order] = await tx
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.id, orderId));
      expect(order?.paymentStatus).toBe("refunded");
    });
  });
});
