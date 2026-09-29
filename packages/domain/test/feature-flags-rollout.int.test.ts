import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createDb, type DbHandle, schema, withTenant } from "@bs/db";
import { eq } from "drizzle-orm";
import { bootstrapRoles } from "@bs/db/bootstrap";
import { runMigrations } from "@bs/db/migrate";
import { pino } from "pino";
import type { Runtime } from "../src/runtime.ts";
import type { TenantContext } from "../src/context.ts";
import { isFeatureEnabled } from "../src/features.ts";
import { getStorefrontProduct } from "../src/storefront/catalog.ts";
import { placeOrder } from "../src/orders/checkout.ts";
import { createAdminFulfillment } from "../src/admin/orders.ts";

const PW = { owner: "o_test", rw: "rw_test", platform: "p_test" };
let container: StartedPostgreSqlContainer | undefined;
let superUrl: string;
let rwDb: DbHandle;
const logger = pino({ level: "silent" });

function as(role: "app_owner" | "app_rw" | "app_platform", password: string): string {
  const u = new URL(superUrl);
  u.username = role;
  u.password = password;
  return u.toString();
}

// Unique fixture prefix for M6 feature flag rollout tests: 0199a061
const orgId = "0199a061-0000-7000-8000-000000000000";
const tenantId = "0199a061-0000-7000-8000-000000000001";
const locationId = "0199a061-0000-7000-8000-000000000010";
const productId = "0199a061-0000-7000-8000-000000000020";
const variantId = "0199a061-0000-7000-8000-000000000021";
const cartId = "0199a061-0000-7000-8000-000000000030";
const orderId = "0199a061-0000-7000-8000-000000000040";

let rt: Runtime;
const ctx: TenantContext = {
  tenantId,
  roles: ["store_owner"],
  permissions: ["products.read", "products.write", "orders.read", "orders.write"],
  actor: { type: "staff", userId: "0199a061-0000-7000-8000-000000000099" },
  requestId: "req_m6_test",
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
  rwDb = createDb(as("app_rw", PW.rw), { max: 10 });

  rt = {
    _db: rwDb,
    log: logger,
  } as unknown as Runtime;

  const pgClient = new (await import("pg")).default.Client({ connectionString: superUrl });
  await pgClient.connect();
  await pgClient.query("SET session_replication_role = 'replica'");
  await pgClient.query(`
    DELETE FROM tenant_feature_overrides WHERE tenant_id = '${tenantId}';
    DELETE FROM inventory_levels WHERE tenant_id = '${tenantId}';
    DELETE FROM variants WHERE tenant_id = '${tenantId}';
    DELETE FROM products WHERE tenant_id = '${tenantId}';
    DELETE FROM carts WHERE tenant_id = '${tenantId}';
    DELETE FROM orders WHERE tenant_id = '${tenantId}';
    DELETE FROM locations WHERE tenant_id = '${tenantId}';
    DELETE FROM tenants WHERE id = '${tenantId}';
    DELETE FROM organizations WHERE id = '${orgId}';
  `);
  await pgClient.query("SET session_replication_role = 'origin'");

  // Seed org, tenant, location, product, variant, inventory, and order
  await pgClient.query(`
    INSERT INTO organizations (id, name) VALUES ('${orgId}', 'Org 0199a061') ON CONFLICT DO NOTHING;
    INSERT INTO tenants (id, organization_id, slug, name) VALUES ('${tenantId}', '${orgId}', 'tenant-0199a061', 'Tenant 0199a061') ON CONFLICT DO NOTHING;

    INSERT INTO feature_flags (key, default_on)
    VALUES
      ('catalog', true),
      ('checkout', true),
      ('fulfillment', true)
    ON CONFLICT (key) DO UPDATE SET default_on = EXCLUDED.default_on;

    SELECT set_config('app.tenant_id', '${tenantId}', false);

    INSERT INTO locations (id, tenant_id, name, is_default)
    VALUES ('${locationId}', '${tenantId}', 'Main Hub', true)
    ON CONFLICT DO NOTHING;

    INSERT INTO products (id, tenant_id, title, slug, status)
    VALUES ('${productId}', '${tenantId}', 'M6 Test Product', 'm6-test-product', 'published')
    ON CONFLICT DO NOTHING;

    INSERT INTO variants (id, tenant_id, product_id, title, sku, price, track_inventory)
    VALUES ('${variantId}', '${tenantId}', '${productId}', 'Default Variant', 'SKU-M6-001', 50000, true)
    ON CONFLICT DO NOTHING;

    INSERT INTO inventory_levels (tenant_id, variant_id, location_id, on_hand, reserved)
    VALUES ('${tenantId}', '${variantId}', '${locationId}', 100, 0)
    ON CONFLICT DO NOTHING;

    INSERT INTO orders (id, tenant_id, number, email, phone, subtotal, grand_total, shipping_address)
    VALUES ('${orderId}', '${tenantId}', 'ORD-M6-101', 'm6-buyer@example.com', '+919999988888', 50000, 50000, '{"city":"Bengaluru"}')
    ON CONFLICT DO NOTHING;

    INSERT INTO order_items (id, tenant_id, order_id, variant_id, product_title, quantity, unit_price, total)
    VALUES ('0199a061-0000-7000-8000-000000000041', '${tenantId}', '${orderId}', '${variantId}', 'M6 Test Product', 1, 50000, 50000)
    ON CONFLICT DO NOTHING;
  `);

  await pgClient.end();
}, 180_000);

afterAll(async () => {
  await rwDb?.close();
  await container?.stop();
});

describe("Feature-flagged rollout & fallback without deploy (M6 / PLAN §5.1, §16)", () => {
  it("resolves default_on=true when no tenant override exists", async () => {
    const isCat = await isFeatureEnabled(rwDb.db, tenantId, "catalog");
    const isChk = await isFeatureEnabled(rwDb.db, tenantId, "checkout");
    const isFul = await isFeatureEnabled(rwDb.db, tenantId, "fulfillment");

    expect(isCat).toBe(true);
    expect(isChk).toBe(true);
    expect(isFul).toBe(true);
  });

  describe("Catalog area fallback", () => {
    it("serves storefront product when catalog flag is enabled", async () => {
      const product = await getStorefrontProduct(rt, ctx, "m6-test-product");
      expect(product).not.toBeNull();
      expect(product?.title).toBe("M6 Test Product");
    });

    it("falls back (returns null) without a deploy when catalog flag is overridden to false", async () => {
      // Flip flag OFF in database
      await withTenant(rwDb.db, tenantId, async (tx) => {
        await tx.insert(schema.tenantFeatureOverrides).values({
          tenantId,
          key: "catalog",
          enabled: false,
          reason: "Testing M6 catalog fallback",
        });
      });

      const enabled = await isFeatureEnabled(rwDb.db, tenantId, "catalog");
      expect(enabled).toBe(false);

      // Verify immediate fallback without code changes or restarts
      const product = await getStorefrontProduct(rt, ctx, "m6-test-product");
      expect(product).toBeNull();
    });

    it("restores catalog immediately when flag is flipped back to true", async () => {
      await withTenant(rwDb.db, tenantId, async (tx) => {
        await tx
          .delete(schema.tenantFeatureOverrides)
          .where(eq(schema.tenantFeatureOverrides.key, "catalog"));
      });

      const enabled = await isFeatureEnabled(rwDb.db, tenantId, "catalog");
      expect(enabled).toBe(true);

      const product = await getStorefrontProduct(rt, ctx, "m6-test-product");
      expect(product).not.toBeNull();
      expect(product?.title).toBe("M6 Test Product");
    });
  });

  describe("Checkout area fallback", () => {
    beforeAll(async () => {
      // Seed a test cart for checkout tests
      await withTenant(rwDb.db, tenantId, async (tx) => {
        await tx.insert(schema.carts).values({
          id: cartId,
          tenantId,
          token: "cart_token_m6_test",
          email: "m6-buyer@example.com",
        }).onConflictDoNothing();

        await tx.insert(schema.cartItems).values({
          id: "0199a061-0000-7000-8000-000000000031",
          tenantId,
          cartId,
          variantId,
          quantity: 1,
          unitPriceSnapshot: 50000,
        }).onConflictDoNothing();
      });
    });

    it("falls back with descriptive rejection without a deploy when checkout flag is overridden to false", async () => {
      // Flip checkout flag OFF
      await withTenant(rwDb.db, tenantId, async (tx) => {
        await tx.insert(schema.tenantFeatureOverrides).values({
          tenantId,
          key: "checkout",
          enabled: false,
          reason: "Emergency checkout fallback drill",
        });
      });

      const enabled = await isFeatureEnabled(rwDb.db, tenantId, "checkout");
      expect(enabled).toBe(false);

      // Attempt placing order
      await expect(
        placeOrder(rt, ctx, {
          cartToken: "cart_token_m6_test",
          email: "m6-buyer@example.com",
          phone: "9876543210",
          fullName: "M6 Buyer",
          addressLine1: "123 Main St",
          city: "Bengaluru",
          state: "Karnataka",
          pincode: "560001",
          paymentMethod: "cod",
        }),
      ).rejects.toThrowError(/Checkout is currently disabled for this store/);
    });

    it("permits order placement when checkout flag is flipped back on", async () => {
      // Flip checkout flag ON
      await withTenant(rwDb.db, tenantId, async (tx) => {
        await tx
          .update(schema.tenantFeatureOverrides)
          .set({ enabled: true })
          .where(eq(schema.tenantFeatureOverrides.key, "checkout"));
      });

      const enabled = await isFeatureEnabled(rwDb.db, tenantId, "checkout");
      expect(enabled).toBe(true);

      const result = await placeOrder(rt, ctx, {
        cartToken: "cart_token_m6_test",
        email: "m6-buyer@example.com",
        phone: "9876543210",
        fullName: "M6 Buyer",
        addressLine1: "123 Main St",
        city: "Bengaluru",
        state: "Karnataka",
        pincode: "560001",
        paymentMethod: "cod",
      });

      expect(result.success).toBe(true);
      expect(result.orderNumber).toBeDefined();
    });
  });

  describe("Fulfillment area fallback", () => {
    it("falls back with descriptive rejection without a deploy when fulfillment flag is overridden to false", async () => {
      // Flip fulfillment flag OFF
      await withTenant(rwDb.db, tenantId, async (tx) => {
        await tx.insert(schema.tenantFeatureOverrides).values({
          tenantId,
          key: "fulfillment",
          enabled: false,
          reason: "Carrier downtime fallback drill",
        });
      });

      const enabled = await isFeatureEnabled(rwDb.db, tenantId, "fulfillment");
      expect(enabled).toBe(false);

      await expect(
        createAdminFulfillment(rt, ctx, {
          id: orderId,
          locationId,
          carrier: "Shiprocket",
        }),
      ).rejects.toThrowError(/Fulfillment is currently disabled for this store/);
    });

    it("permits fulfillment creation when fulfillment flag is flipped back on", async () => {
      // Flip fulfillment flag back ON
      await withTenant(rwDb.db, tenantId, async (tx) => {
        await tx
          .update(schema.tenantFeatureOverrides)
          .set({ enabled: true })
          .where(eq(schema.tenantFeatureOverrides.key, "fulfillment"));
      });

      const enabled = await isFeatureEnabled(rwDb.db, tenantId, "fulfillment");
      expect(enabled).toBe(true);

      const result = await createAdminFulfillment(rt, ctx, {
        id: orderId,
        locationId,
        carrier: "Shiprocket",
        awb: "AWB-M6-9999",
      });

      expect(result.fulfillmentId).toBeDefined();
      expect(result.status).toBe("label_created");
    });
  });
});
