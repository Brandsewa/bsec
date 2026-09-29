import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import {
  createDb,
  type DbHandle,
  orders,
  withTenant,
} from "@bs/db";
import { bootstrapRoles } from "@bs/db/bootstrap";
import { runMigrations } from "@bs/db/migrate";
import { createRuntime, type Runtime, type TenantContext } from "../src/index.ts";
import {
  requestCustomerOtp,
  verifyCustomerOtp,
} from "../src/customers/otp.ts";
import {
  getCustomerAddresses,
  createCustomerAddress,
  deleteCustomerAddress,
} from "../src/customers/addresses.ts";
import {
  getWishlist,
  addToWishlist,
  removeFromWishlist,
} from "../src/customers/wishlist.ts";
import {
  getCustomerOrders,
  getOrderByActionToken,
} from "../src/customers/orders.ts";
import { confirmCodOrder } from "../src/orders/actions.ts";
import { placeOrder } from "../src/orders/checkout.ts";
import { addToCart, getOrCreateCart } from "../src/storefront/cart.ts";

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

const orgId = "0199a0c2-0000-7000-8000-000000000000";
const tenantId = "0199a0c2-0000-7000-8000-000000000001";
const locationId = "0199a0c2-0000-7000-8000-000000000010";
const productId = "0199a0c2-0000-7000-8000-000000000020";
const variantId = "0199a0c2-0000-7000-8000-000000000030";

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

  const pgClient = new (await import("pg")).default.Client({ connectionString: superUrl });
  await pgClient.connect();
  await pgClient.query("SET session_replication_role = 'replica'");
  await pgClient.query(`
    DELETE FROM customer_otps WHERE tenant_id = '${tenantId}';
    DELETE FROM customer_sessions WHERE tenant_id = '${tenantId}';
    DELETE FROM customer_addresses WHERE tenant_id = '${tenantId}';
    DELETE FROM wishlist_items WHERE tenant_id = '${tenantId}';
    DELETE FROM action_tokens WHERE tenant_id = '${tenantId}';
    DELETE FROM order_items WHERE tenant_id = '${tenantId}';
    DELETE FROM orders WHERE tenant_id = '${tenantId}';
    DELETE FROM cart_items WHERE tenant_id = '${tenantId}';
    DELETE FROM carts WHERE tenant_id = '${tenantId}';
    DELETE FROM customers WHERE tenant_id = '${tenantId}';
  `);
  await pgClient.query("SET session_replication_role = 'origin'");
  await pgClient.query(`
    INSERT INTO organizations (id, name) VALUES ('${orgId}', 'Test Org') ON CONFLICT DO NOTHING;
    INSERT INTO tenants (id, organization_id, slug, name) VALUES ('${tenantId}', '${orgId}', 'test-store-c2', 'Test Store') ON CONFLICT DO NOTHING;
    SELECT set_config('app.tenant_id', '${tenantId}', false);
    INSERT INTO locations (id, tenant_id, name, is_default) VALUES ('${locationId}', '${tenantId}', 'Main Warehouse', true) ON CONFLICT DO NOTHING;
    INSERT INTO products (id, tenant_id, title, slug, status) VALUES ('${productId}', '${tenantId}', 'Premium T-Shirt', 'premium-t-shirt', 'published') ON CONFLICT (tenant_id, slug) DO UPDATE SET status = 'published';
    INSERT INTO variants (id, tenant_id, product_id, sku, title, price) VALUES ('${variantId}', '${tenantId}', '${productId}', 'TSHIRT-BLK-M', 'Black / M', 149900) ON CONFLICT DO NOTHING;
    INSERT INTO inventory_levels (id, tenant_id, variant_id, location_id, on_hand, reserved)
    VALUES ('0199a0c2-0000-7000-8000-000000000040', '${tenantId}', '${variantId}', '${locationId}', 25, 0)
    ON CONFLICT (tenant_id, variant_id, location_id) DO UPDATE SET on_hand = 25, reserved = 0;
  `);
  await pgClient.end();
}, 180_000);

afterAll(async () => {
  await rwDb?.close();
  await rt?.close();
  await container?.stop();
});

describe("Customer Accounts & Order Actions", () => {
  const ctx: TenantContext = {
    tenantId,
    storeStatus: "live",
    actor: { type: "system" },
    roles: ["admin"],
    permissions: ["*"],
    requestId: "req_test",
  };

  it("handles customer OTP login flow", async () => {
    const phone = "9876543210";
    const otpRes = await requestCustomerOtp(rwDb.db, tenantId, phone);
    expect(otpRes.success).toBe(true);
    expect(otpRes.devOtp).toBeDefined();

    // Verify invalid OTP rejection
    await expect(verifyCustomerOtp(rwDb.db, tenantId, phone, "000000")).rejects.toThrow(/Invalid/);

    // Verify valid OTP login
    const loginRes = await verifyCustomerOtp(rwDb.db, tenantId, phone, otpRes.devOtp!);
    expect(loginRes.success).toBe(true);
    expect(loginRes.customer.phone).toBe(phone);
    expect(loginRes.token).toBeDefined();
  });

  it("manages customer addresses", async () => {
    const phone = "9876543211";
    const otpRes = await requestCustomerOtp(rwDb.db, tenantId, phone);
    const { customer } = await verifyCustomerOtp(rwDb.db, tenantId, phone, otpRes.devOtp!);

    const newAddr = await createCustomerAddress(rwDb.db, tenantId, customer.id, {
      name: "Suresh",
      phone: "9876543211",
      line1: "Flat 101, Blue Towers",
      city: "Pune",
      stateCode: "MH",
      pincode: "411001",
      type: "home",
      isDefault: true,
    });
    expect(newAddr.id).toBeDefined();
    expect(newAddr.city).toBe("Pune");

    const addresses = await getCustomerAddresses(rwDb.db, tenantId, customer.id);
    expect(addresses.length).toBe(1);
    expect(addresses[0]?.city).toBe("Pune");

    await deleteCustomerAddress(rwDb.db, tenantId, customer.id, newAddr.id);
    const afterDelete = await getCustomerAddresses(rwDb.db, tenantId, customer.id);
    expect(afterDelete.length).toBe(0);

    const ordersList = await getCustomerOrders(rwDb.db, tenantId, customer.id);
    expect(ordersList).toEqual([]);
  });

  it("manages customer wishlist", async () => {
    const phone = "9876543212";
    const otpRes = await requestCustomerOtp(rwDb.db, tenantId, phone);
    const { customer } = await verifyCustomerOtp(rwDb.db, tenantId, phone, otpRes.devOtp!);

    await addToWishlist(rwDb.db, tenantId, customer.id, variantId, productId);
    const wishlist = await getWishlist(rwDb.db, tenantId, customer.id);
    expect(wishlist.length).toBe(1);
    expect(wishlist[0]?.variantId).toBe(variantId);

    await removeFromWishlist(rwDb.db, tenantId, customer.id, variantId);
    const emptyWishlist = await getWishlist(rwDb.db, tenantId, customer.id);
    expect(emptyWishlist.length).toBe(0);
  });

  it("confirms COD order via action token and retrieves guest order via order_view token", async () => {
    // 1. Create cart and place COD order
    const cart = await getOrCreateCart(rt, ctx, "cart_action_token_test");
    await addToCart(rt, ctx, { token: cart.token, variantId, quantity: 1 });

    const orderRes = await placeOrder(rt, ctx, {
      cartToken: cart.token,
      email: "cod_buyer@example.com",
      phone: "9876543219",
      fullName: "Anand Verma",
      addressLine1: "Connaught Place",
      city: "Delhi",
      state: "Delhi",
      pincode: "110001",
      paymentMethod: "cod",
    });

    expect(orderRes.codToken).toBeDefined();
    expect(orderRes.orderToken).toBeDefined();

    // 2. Guest view order details via order_view action token
    const guestOrder = await getOrderByActionToken(rwDb.db, tenantId, orderRes.orderToken);
    expect(guestOrder).toBeDefined();
    expect(guestOrder?.number).toBe(orderRes.orderNumber);
    expect(guestOrder?.status).toBe("pending");

    // 3. Confirm COD order via cod_confirmation action token
    const confirmRes = await confirmCodOrder(rt, ctx, orderRes.codToken!);
    expect(confirmRes.success).toBe(true);

    // Verify order is now confirmed
    await withTenant(rwDb.db, tenantId, async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, orderRes.orderId));
      expect(order?.status).toBe("confirmed");
    });
  });
});
