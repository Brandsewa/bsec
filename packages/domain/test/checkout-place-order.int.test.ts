import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import {
  createDb,
  type DbHandle,
  orders,
  orderItems,
  paymentIntents,
  actionTokens,
  inventoryLevels,
  withTenant,
} from "@bs/db";
import { bootstrapRoles } from "@bs/db/bootstrap";
import { runMigrations } from "@bs/db/migrate";
import { createRuntime, type Runtime, type TenantContext } from "../src/index.ts";
import { addToCart, getOrCreateCart } from "../src/storefront/cart.ts";
import { placeOrder } from "../src/orders/checkout.ts";

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

const orgId = "0199a000-0000-7000-8000-000000000000";
const tenantId = "0199a000-0000-7000-8000-000000000001";
const locationId = "0199a000-0000-7000-8000-000000000010";
const productId = "0199a000-0000-7000-8000-000000000020";
const variantId = "0199a000-0000-7000-8000-000000000030";

beforeAll(async () => {
  if (process.env.TEST_DATABASE_URL_SUPERUSER) {
    superUrl = process.env.TEST_DATABASE_URL_SUPERUSER;
  } else {
    container = await new PostgreSqlContainer("postgres:18").withReuse().start();
    superUrl = container.getConnectionUri();
  }
  await bootstrapRoles(superUrl, PW);
  await runMigrations(as("app_owner", PW.owner));
  rwDb = createDb(as("app_rw", PW.rw), { max: 10 });
  rt = createRuntime({ service: "web", databaseUrl: as("app_rw", PW.rw), poolMax: 10 });

  const pgClient = new (await import("pg")).default.Client({ connectionString: as("app_rw", PW.rw) });
  await pgClient.connect();
  await pgClient.query(`
    INSERT INTO organizations (id, name) VALUES ('${orgId}', 'Test Org') ON CONFLICT DO NOTHING;
    INSERT INTO tenants (id, organization_id, slug, name) VALUES ('${tenantId}', '${orgId}', 'test-store', 'Test Store') ON CONFLICT DO NOTHING;
    SELECT set_config('app.tenant_id', '${tenantId}', false);
    INSERT INTO locations (id, tenant_id, name, is_default) VALUES ('${locationId}', '${tenantId}', 'Main Warehouse', true) ON CONFLICT DO NOTHING;
    INSERT INTO products (id, tenant_id, title, slug, status) VALUES ('${productId}', '${tenantId}', 'Premium T-Shirt', 'premium-t-shirt', 'published') ON CONFLICT (tenant_id, slug) DO UPDATE SET status = 'published';
    INSERT INTO variants (id, tenant_id, product_id, sku, title, price) VALUES ('${variantId}', '${tenantId}', '${productId}', 'TSHIRT-BLK-M', 'Black / M', 149900) ON CONFLICT DO NOTHING;
    INSERT INTO inventory_levels (id, tenant_id, variant_id, location_id, on_hand, reserved)
    VALUES ('0199a000-0000-7000-8000-000000000040', '${tenantId}', '${variantId}', '${locationId}', 10, 0)
    ON CONFLICT (tenant_id, variant_id, location_id) DO UPDATE SET on_hand = 10, reserved = 0;
  `);
  await pgClient.end();
}, 180_000);

afterAll(async () => {
  await rwDb?.close();
  await rt?.close();
  await container?.stop();
});

describe("End-to-End Checkout Place Order", () => {
  const ctx: TenantContext = {
    tenantId,
    storeStatus: "live",
    actor: { type: "system" },
    roles: ["admin"],
    permissions: ["*"],
    requestId: "req_test",
  };

  it("places a COD order with inventory reservation, number sequence, action tokens, and idempotent replay", async () => {
    // 1. Create cart and add 2 units
    const cart = await getOrCreateCart(rt, ctx, "cart_cod_token_123");
    await addToCart(rt, ctx, {
      token: cart.token,
      variantId,
      quantity: 2,
    });

    const idempotencyKey = "checkout_cod_idemp_key_001";
    const checkoutInput = {
      cartToken: cart.token,
      idempotencyKey,
      email: "buyer@example.com",
      phone: "9876543210",
      fullName: "Rajesh Kumar",
      addressLine1: "123 Marine Drive",
      city: "Mumbai",
      state: "Maharashtra",
      pincode: "400020",
      paymentMethod: "cod" as const,
    };

    // 2. Place order
    const result1 = await placeOrder(rt, ctx, checkoutInput);

    expect(result1.success).toBe(true);
    expect(result1.orderNumber).toBe("ORD-00001");
    expect(result1.paymentMethod).toBe("cod");
    expect(result1.codToken).toBeDefined();
    expect(result1.orderToken).toBeDefined();
    expect(result1.redirectUrl).toContain(result1.orderToken);

    // Verify DB state: order exists
    await withTenant(rwDb.db, tenantId, async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, result1.orderId));
      expect(order).toBeDefined();
      expect(order?.number).toBe("ORD-00001");
      expect(order?.status).toBe("pending");
      expect(order?.paymentStatus).toBe("cod_pending");
      expect(order?.email).toBe("buyer@example.com");

      // Verify order items: 1 line item with qty 2
      const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, result1.orderId));
      expect(items.length).toBe(1);
      expect(items[0]?.quantity).toBe(2);

      // Verify inventory reservation: reserved = 2, available = 8
      const [inv] = await tx.select().from(inventoryLevels).where(eq(inventoryLevels.variantId, variantId));
      expect(inv?.reserved).toBe(2);
      expect(inv?.available).toBe(8);

      // Verify action tokens: cod_confirmation and order_view exist
      const tokens = await tx.select().from(actionTokens).where(eq(actionTokens.targetId, result1.orderId));
      expect(tokens.length).toBe(2);
      const purposes = tokens.map((t) => t.purpose);
      expect(purposes).toContain("cod_confirmation");
      expect(purposes).toContain("order_view");
    });

    // 3. Idempotent duplicate submit: returns exact same order, does NOT increment number, does NOT reserve more stock
    const result2 = await placeOrder(rt, ctx, checkoutInput);
    expect(result2.orderId).toBe(result1.orderId);
    expect(result2.orderNumber).toBe("ORD-00001");

    await withTenant(rwDb.db, tenantId, async (tx) => {
      const [inv] = await tx.select().from(inventoryLevels).where(eq(inventoryLevels.variantId, variantId));
      // Still 2 reserved, NOT 4!
      expect(inv?.reserved).toBe(2);
    });
  });

  it("places a Razorpay test order awaiting payment intent capture", async () => {
    // 1. Create new cart and add 1 unit
    const cart = await getOrCreateCart(rt, ctx, "cart_rzp_token_456");
    await addToCart(rt, ctx, {
      token: cart.token,
      variantId,
      quantity: 1,
    });

    const checkoutInput = {
      cartToken: cart.token,
      idempotencyKey: "checkout_rzp_idemp_key_002",
      email: "priya@example.com",
      phone: "9123456780",
      fullName: "Priya Sharma",
      addressLine1: "45 MG Road",
      city: "Bengaluru",
      state: "Karnataka",
      pincode: "560001",
      paymentMethod: "razorpay" as const,
    };

    const result = await placeOrder(rt, ctx, checkoutInput);

    expect(result.success).toBe(true);
    expect(result.orderNumber).toBe("ORD-00002");
    expect(result.paymentMethod).toBe("razorpay");
    expect(result.razorpay).toBeDefined();
    expect(result.razorpay?.amount).toBe(result.grandTotal);
    expect(result.razorpay?.orderId).toBeDefined();

    // Verify DB: payment intent created with provider razorpay
    await withTenant(rwDb.db, tenantId, async (tx) => {
      const [intent] = await tx
        .select()
        .from(paymentIntents)
        .where(eq(paymentIntents.orderId, result.orderId));
      expect(intent).toBeDefined();
      expect(intent?.provider).toBe("razorpay");
      expect(intent?.status).toBe("created");
    });
  });
});
