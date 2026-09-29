import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createDb, type DbHandle, schema, withTenant } from "@bs/db";
import { eq, inArray } from "drizzle-orm";
import { bootstrapRoles } from "@bs/db/bootstrap";
import { runMigrations } from "@bs/db/migrate";
import { pino } from "pino";
import type { Runtime } from "../src/runtime.ts";
import type { TenantContext } from "../src/context.ts";
import { isFeatureEnabled, FeatureDisabledError } from "../src/features.ts";
import { placeOrder } from "../src/orders/checkout.ts";
import { createAdminFulfillment } from "../src/admin/orders.ts";

const PW = { owner: "o_test_0199a065", rw: "rw_test_0199a065", platform: "p_test_0199a065" };
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

// Unique fixture prefix for M6 migration 0008 & error mapping tests: 0199a065
const orgId = "0199a065-0000-7000-8000-000000000000";
const tenantId = "0199a065-0000-7000-8000-000000000001";
const locationId = "0199a065-0000-7000-8000-000000000010";
const productId = "0199a065-0000-7000-8000-000000000020";
const variantId = "0199a065-0000-7000-8000-000000000021";
const cartId = "0199a065-0000-7000-8000-000000000030";
const orderId = "0199a065-0000-7000-8000-000000000040";

let rt: Runtime;
const ctx: TenantContext = {
  tenantId,
  roles: ["store_owner"],
  permissions: ["products.read", "products.write", "orders.read", "orders.write"],
  actor: { type: "staff", userId: "0199a065-0000-7000-8000-000000000099" },
  requestId: "req_m6_migration_0008",
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

  // Seed org, tenant, location, product, variant, inventory, order, cart
  // NOTE: We intentionally do NOT insert into feature_flags here to verify migration 0008 seeding
  await pgClient.query(`
    INSERT INTO organizations (id, name) VALUES ('${orgId}', 'Org 0199a065') ON CONFLICT DO NOTHING;
    INSERT INTO tenants (id, organization_id, slug, name) VALUES ('${tenantId}', '${orgId}', 'tenant-0199a065', 'Tenant 0199a065') ON CONFLICT DO NOTHING;

    SELECT set_config('app.tenant_id', '${tenantId}', false);

    INSERT INTO locations (id, tenant_id, name, is_default)
    VALUES ('${locationId}', '${tenantId}', 'Main Hub 0199a065', true)
    ON CONFLICT DO NOTHING;

    INSERT INTO products (id, tenant_id, title, slug, status)
    VALUES ('${productId}', '${tenantId}', 'M6 Migration Test Product', 'm6-migration-product', 'published')
    ON CONFLICT DO NOTHING;

    INSERT INTO variants (id, tenant_id, product_id, title, sku, price, track_inventory)
    VALUES ('${variantId}', '${tenantId}', '${productId}', 'Default Variant', 'SKU-0199a065-01', 50000, true)
    ON CONFLICT DO NOTHING;

    INSERT INTO inventory_levels (tenant_id, variant_id, location_id, on_hand, reserved)
    VALUES ('${tenantId}', '${variantId}', '${locationId}', 100, 0)
    ON CONFLICT DO NOTHING;

    INSERT INTO orders (id, tenant_id, number, email, phone, subtotal, grand_total, shipping_address)
    VALUES ('${orderId}', '${tenantId}', 'ORD-0199a065-1', 'buyer@example.com', '+919999900065', 50000, 50000, '{"city":"Bengaluru"}')
    ON CONFLICT DO NOTHING;

    INSERT INTO order_items (id, tenant_id, order_id, variant_id, product_title, quantity, unit_price, total)
    VALUES ('0199a065-0000-7000-8000-000000000041', '${tenantId}', '${orderId}', '${variantId}', 'M6 Migration Test Product', 1, 50000, 50000)
    ON CONFLICT DO NOTHING;

    INSERT INTO carts (id, tenant_id, token, email)
    VALUES ('${cartId}', '${tenantId}', 'cart_token_0199a065', 'buyer@example.com')
    ON CONFLICT DO NOTHING;

    INSERT INTO cart_items (id, tenant_id, cart_id, variant_id, quantity, unit_price_snapshot)
    VALUES ('0199a065-0000-7000-8000-000000000031', '${tenantId}', '${cartId}', '${variantId}', 1, 50000)
    ON CONFLICT DO NOTHING;
  `);

  await pgClient.end();
}, 180_000);

afterAll(async () => {
  // Restore kill switches if modified
  await rwDb.db
    .update(schema.featureFlags)
    .set({ killSwitch: false })
    .where(inArray(schema.featureFlags.key, ["catalog", "checkout", "fulfillment"]));
  await rwDb?.close();
  await container?.stop();
});

describe("Migration 0008 feature flags seeding & kill_switch verification", () => {
  it("migration 0008 seeded catalog, checkout, and fulfillment with default_on = true and kill_switch = false without self-seeding", async () => {
    const flags = await rwDb.db
      .select({
        key: schema.featureFlags.key,
        defaultOn: schema.featureFlags.defaultOn,
        killSwitch: schema.featureFlags.killSwitch,
      })
      .from(schema.featureFlags)
      .where(inArray(schema.featureFlags.key, ["catalog", "checkout", "fulfillment"]));

    const flagMap = new Map(flags.map((f) => [f.key, f]));

    expect(flagMap.has("catalog")).toBe(true);
    expect(flagMap.get("catalog")?.defaultOn).toBe(true);
    expect(flagMap.get("catalog")?.killSwitch).toBe(false);

    expect(flagMap.has("checkout")).toBe(true);
    expect(flagMap.get("checkout")?.defaultOn).toBe(true);
    expect(flagMap.get("checkout")?.killSwitch).toBe(false);

    expect(flagMap.has("fulfillment")).toBe(true);
    expect(flagMap.get("fulfillment")?.defaultOn).toBe(true);
    expect(flagMap.get("fulfillment")?.killSwitch).toBe(false);
  });

  it("kill_switch = true turns area off globally even when default_on is true and tenant override is true", async () => {
    // 1. Enable tenant override explicitly to true
    await withTenant(rwDb.db, tenantId, async (tx) => {
      await tx
        .insert(schema.tenantFeatureOverrides)
        .values({
          tenantId,
          key: "catalog",
          enabled: true,
          reason: "Explicit tenant opt-in",
        })
        .onConflictDoUpdate({
          target: [schema.tenantFeatureOverrides.tenantId, schema.tenantFeatureOverrides.key],
          set: { enabled: true },
        });
    });

    // Verify it is enabled initially
    const enabledBefore = await isFeatureEnabled(rwDb.db, tenantId, "catalog");
    expect(enabledBefore).toBe(true);

    // 2. Set kill_switch = true globally in feature_flags
    await rwDb.db
      .update(schema.featureFlags)
      .set({ killSwitch: true })
      .where(eq(schema.featureFlags.key, "catalog"));

    // 3. Verify isFeatureEnabled immediately returns false despite default_on=true and tenant override=true
    const enabledAfterKill = await isFeatureEnabled(rwDb.db, tenantId, "catalog");
    expect(enabledAfterKill).toBe(false);

    // 4. Restore kill_switch = false
    await rwDb.db
      .update(schema.featureFlags)
      .set({ killSwitch: false })
      .where(eq(schema.featureFlags.key, "catalog"));

    const restored = await isFeatureEnabled(rwDb.db, tenantId, "catalog");
    expect(restored).toBe(true);
  });

  describe("Gated flag error mapping", () => {
    it("placeOrder throws FeatureDisabledError with statusCode 503 when checkout flag is disabled", async () => {
      await withTenant(rwDb.db, tenantId, async (tx) => {
        await tx
          .insert(schema.tenantFeatureOverrides)
          .values({
            tenantId,
            key: "checkout",
            enabled: false,
            reason: "Checkout disabled test",
          })
          .onConflictDoUpdate({
            target: [schema.tenantFeatureOverrides.tenantId, schema.tenantFeatureOverrides.key],
            set: { enabled: false },
          });
      });

      let thrownError: unknown;
      try {
        await placeOrder(rt, ctx, {
          cartToken: "cart_token_0199a065",
          email: "buyer@example.com",
          phone: "9876543210",
          fullName: "Buyer 0199a065",
          addressLine1: "123 Street",
          city: "Bengaluru",
          state: "Karnataka",
          pincode: "560001",
          paymentMethod: "cod",
        });
      } catch (err) {
        thrownError = err;
      }

      expect(thrownError).toBeInstanceOf(FeatureDisabledError);
      expect((thrownError as FeatureDisabledError).statusCode).toBe(503);
      expect((thrownError as FeatureDisabledError).featureKey).toBe("checkout");
      expect((thrownError as Error).message).toMatch(/Checkout is currently disabled for this store/);
    });

    it("createAdminFulfillment throws FeatureDisabledError with statusCode 503 when fulfillment flag is disabled", async () => {
      await withTenant(rwDb.db, tenantId, async (tx) => {
        await tx
          .insert(schema.tenantFeatureOverrides)
          .values({
            tenantId,
            key: "fulfillment",
            enabled: false,
            reason: "Fulfillment disabled test",
          })
          .onConflictDoUpdate({
            target: [schema.tenantFeatureOverrides.tenantId, schema.tenantFeatureOverrides.key],
            set: { enabled: false },
          });
      });

      let thrownError: unknown;
      try {
        await createAdminFulfillment(rt, ctx, {
          id: orderId,
          locationId,
          carrier: "Shiprocket",
        });
      } catch (err) {
        thrownError = err;
      }

      expect(thrownError).toBeInstanceOf(FeatureDisabledError);
      expect((thrownError as FeatureDisabledError).statusCode).toBe(503);
      expect((thrownError as FeatureDisabledError).featureKey).toBe("fulfillment");
      expect((thrownError as Error).message).toMatch(/Fulfillment is currently disabled for this store/);
    });
  });
});
