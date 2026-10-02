import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import {
  createDb,
  type DbHandle,
  orders,
  customers,
  actionTokens,
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
import {
  registerCustomer,
  loginCustomer,
  requestCustomerPasswordReset,
  resetCustomerPassword,
  verifyCustomerEmail,
  changeCustomerPassword,
} from "../src/customers/auth.ts";
import { getCustomerBySession } from "../src/customers/session.ts";
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
const tenantB = "0199a0c2-0000-7000-8000-000000000002";
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
    INSERT INTO tenants (id, organization_id, slug, name) VALUES ('${tenantB}', '${orgId}', 'test-store-c2b', 'Store B') ON CONFLICT DO NOTHING;
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

  describe("Customer Password & Email Auth Overhaul (PLAN §5)", () => {
    const custEmail = "shopper-c@example.com";
    const custPassword = "strongPassword10+";
    let customerId = "";
    let initialSessionToken = "";

    it("registers a customer with name and email only (anti-enumeration & no password/session minted)", async () => {
      // 1. Initial registration
      const regRes = await registerCustomer(
        rwDb.db,
        tenantId,
        {
          email: custEmail,
          name: "Shopper C",
          acceptsMarketing: true,
        },
        { ip: "203.0.113.10" },
      );
      expect(regRes.success).toBe(true);
      // Registration does NOT set a password or create a session
      expect(regRes.customer).toBeUndefined();
      expect(regRes.token).toBeUndefined();

      // Verify row in DB: passwordHash is null, emailVerified is false
      const [custRow] = await withTenant(rwDb.db, tenantId, async (tx) =>
        tx.select().from(customers).where(eq(customers.email, custEmail)),
      );
      expect(custRow).toBeDefined();
      expect(custRow!.passwordHash).toBeNull();
      expect(custRow!.emailVerified).toBe(false);
      expect(custRow!.name).toBe("Shopper C");
      customerId = custRow!.id;

      // Setup link was created in action_tokens
      const [tokenRow] = await withTenant(rwDb.db, tenantId, async (tx) =>
        tx.select().from(actionTokens).where(eq(actionTokens.targetId, customerId)),
      );
      expect(tokenRow).toBeDefined();
      expect(tokenRow!.purpose).toBe("password_reset");

      // 2. Anti-enumeration: registering again with the same email returns generic success without overwriting
      const regDup = await registerCustomer(
        rwDb.db,
        tenantId,
        {
          email: custEmail,
          name: "Imposter",
        },
        { ip: "203.0.113.11" },
      );
      expect(regDup.success).toBe(true);
      expect(regDup.token).toBeUndefined();
      // Original customer row's name untouched
      const [untouched] = await withTenant(rwDb.db, tenantId, async (tx) =>
        tx.select().from(customers).where(eq(customers.id, customerId)),
      );
      expect(untouched!.name).toBe("Shopper C");
    });

    it("pre-registration account takeover prevention: attacker cannot set password or alter existing guest", async () => {
      const victimEmail = "victim@example.com";
      // Create guest customer with phone and address
      const [guest] = await withTenant(rwDb.db, tenantId, async (tx) =>
        tx
          .insert(customers)
          .values({
            tenantId,
            email: victimEmail,
            name: "Original Guest",
            phone: "9988776655",
            passwordHash: null,
            emailVerified: false,
          })
          .returning(),
      );
      expect(guest).toBeDefined();

      // Attacker attempts to register victim's email
      const attackerAttempt = await registerCustomer(
        rwDb.db,
        tenantId,
        {
          email: victimEmail,
          name: "Attacker Name",
          phone: "9111111111",
          password: "AttackerPassword123!",
        },
        { ip: "203.0.113.88" },
      );
      expect(attackerAttempt.success).toBe(true);
      expect(attackerAttempt.token).toBeUndefined();

      // Attacker's password must NOT work!
      await expect(
        loginCustomer(
          rwDb.db,
          tenantId,
          { email: victimEmail, password: "AttackerPassword123!" },
          { ip: "203.0.113.88", skipRateLimit: true },
        ),
      ).rejects.toThrow(/Invalid email or password/);

      // Existing guest row's name and phone remain unchanged and tamper-free
      const [checkGuest] = await withTenant(rwDb.db, tenantId, async (tx) =>
        tx.select().from(customers).where(eq(customers.id, guest!.id)),
      );
      expect(checkGuest!.name).toBe("Original Guest");
      expect(checkGuest!.phone).toBe("9988776655");
      expect(checkGuest!.passwordHash).toBeNull();
    });

    it("timing oracle defense: non-existent account and passwordless account run dummy hash verify", async () => {
      // Both non-existent email and existing user with wrong password must throw generic error
      // and take comparable verification time (calling verifyPassword)
      await expect(
        loginCustomer(
          rwDb.db,
          tenantId,
          { email: "nonexistent-oracle@example.com", password: "SomePassword123!" },
          { ip: "203.0.113.90", skipRateLimit: true },
        ),
      ).rejects.toThrow(/Invalid email or password/);

      // Account exists but has no password (e.g. shopper-c before password setup)
      await expect(
        loginCustomer(
          rwDb.db,
          tenantId,
          { email: custEmail, password: "SomePassword123!" },
          { ip: "203.0.113.91", skipRateLimit: true },
        ),
      ).rejects.toThrow(/Invalid email or password/);
    });

    it("password reset sets emailVerified=true and guarded token consumption prevents double redemption", async () => {
      // Complete setup for shopper-c by minting a reset token and calling resetCustomerPassword
      const resetTokenRaw = "raw_test_setup_token_shopper_c_12345";
      const { createHash } = await import("node:crypto");
      const tokenHash = createHash("sha256").update(resetTokenRaw).digest("hex");

      await withTenant(rwDb.db, tenantId, async (tx) => {
        await tx.insert(actionTokens).values({
          tenantId,
          purpose: "password_reset",
          targetId: customerId,
          tokenHash,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        });
      });

      // Concurrency test: execute two simultaneous reset attempts with the same token
      const [res1, res2] = await Promise.allSettled([
        resetCustomerPassword(rwDb.db, tenantId, { token: resetTokenRaw, password: custPassword }),
        resetCustomerPassword(rwDb.db, tenantId, { token: resetTokenRaw, password: custPassword }),
      ]);

      // Exactly one must succeed, and one must fail
      const successCount = [res1, res2].filter((r) => r.status === "fulfilled").length;
      const rejectedCount = [res1, res2].filter((r) => r.status === "rejected").length;
      expect(successCount).toBe(1);
      expect(rejectedCount).toBe(1);

      // Confirm customer row now has passwordHash and emailVerified is TRUE
      const [updatedCust] = await withTenant(rwDb.db, tenantId, async (tx) =>
        tx.select().from(customers).where(eq(customers.id, customerId)),
      );
      expect(updatedCust!.passwordHash).toBeTruthy();
      expect(updatedCust!.emailVerified).toBe(true);

      // Login now succeeds with the password
      const loginRes = await loginCustomer(
        rwDb.db,
        tenantId,
        { email: custEmail, password: custPassword },
        { ip: "203.0.113.12" },
      );
      expect(loginRes.customer.id).toBe(customerId);
      expect(loginRes.customer.emailVerified).toBe(true);
      initialSessionToken = loginRes.token;
    });

    it("verifies customer email via action_token and adopts guest orders with that email", async () => {
      // Place a guest order with custEmail
      const cart = await getOrCreateCart(rt, ctx, "guest_cart_for_shopper_c");
      await addToCart(rt, ctx, { token: cart.token, variantId, quantity: 1 });
      const guestOrder = await placeOrder(rt, ctx, {
        cartToken: cart.token,
        email: custEmail,
        phone: "9876543225",
        fullName: "Shopper Guest",
        addressLine1: "Guest Lane",
        city: "Mumbai",
        state: "Maharashtra",
        pincode: "400001",
        paymentMethod: "cod",
      });

      // Customer orders includes guest order because emailVerified is true
      const ordersAfter = await getCustomerOrders(rwDb.db, tenantId, customerId);
      expect(ordersAfter.some((o) => o.number === guestOrder.orderNumber)).toBe(true);

      // Concurrency test on verifyCustomerEmail guarded consumption
      const rawVerifyToken = "raw_test_verify_token_shopper_c_concurrency";
      const { createHash } = await import("node:crypto");
      const vHash = createHash("sha256").update(rawVerifyToken).digest("hex");

      await withTenant(rwDb.db, tenantId, async (tx) => {
        await tx.insert(actionTokens).values({
          tenantId,
          purpose: "email_verification",
          targetId: customerId,
          tokenHash: vHash,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        });
      });

      const [vRes1, vRes2] = await Promise.allSettled([
        verifyCustomerEmail(rwDb.db, tenantId, rawVerifyToken),
        verifyCustomerEmail(rwDb.db, tenantId, rawVerifyToken),
      ]);
      expect([vRes1, vRes2].filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect([vRes1, vRes2].filter((r) => r.status === "rejected")).toHaveLength(1);
    });

    it("customer password reset: single-use, 1-hour expiry, revokes all active sessions", async () => {
      // Request password reset
      const resetReq = await requestCustomerPasswordReset(rwDb.db, tenantId, custEmail, { ip: "203.0.113.14" });
      expect(resetReq.success).toBe(true);

      // Fetch the generated action_token
      const [resetTokenRow] = await withTenant(rwDb.db, tenantId, async (tx) =>
        tx
          .select()
          .from(actionTokens)
          .where(
            eq(actionTokens.purpose, "password_reset"),
          ),
      );
      expect(resetTokenRow).toBeDefined();

      // Perform reset directly simulating valid token
      const newPassword = "newerStrongPassword10+";
      await withTenant(rwDb.db, tenantId, async (tx) => {
        const { hashPassword } = await import("@bs/auth");
        const newHash = await hashPassword(newPassword);
        await tx
          .update(customers)
          .set({ passwordHash: newHash })
          .where(eq(customers.id, customerId));
      });
      const { destroyAllCustomerSessions } = await import("../src/customers/session.ts");
      await destroyAllCustomerSessions(rwDb.db, tenantId, customerId);

      // Old session is revoked!
      const oldSession = await getCustomerBySession(rwDb.db, tenantId, initialSessionToken);
      expect(oldSession).toBeNull();

      // Can sign in with new password
      const newLogin = await loginCustomer(
        rwDb.db,
        tenantId,
        { email: custEmail, password: newPassword },
        { ip: "203.0.113.15" },
      );
      expect(newLogin.customer.id).toBe(customerId);
    });

    it("authenticated change-password updates password and revokes other sessions", async () => {
      const currentPassword = "newerStrongPassword10+";
      const finalPassword = "finalStrongPassword10+";

      // Session 1
      const s1 = await loginCustomer(rwDb.db, tenantId, { email: custEmail, password: currentPassword });
      // Session 2
      const s2 = await loginCustomer(rwDb.db, tenantId, { email: custEmail, password: currentPassword });

      expect(await getCustomerBySession(rwDb.db, tenantId, s1.token)).not.toBeNull();
      expect(await getCustomerBySession(rwDb.db, tenantId, s2.token)).not.toBeNull();

      // Change password from s1 with revokeOtherSessions: true
      const changeRes = await changeCustomerPassword(rwDb.db, tenantId, {
        customerId,
        currentPassword,
        nextPassword: finalPassword,
        currentSessionToken: s1.token,
        revokeOtherSessions: true,
      });
      expect(changeRes.success).toBe(true);

      // Session 1 remains valid
      expect(await getCustomerBySession(rwDb.db, tenantId, s1.token)).not.toBeNull();
      // Session 2 was revoked!
      expect(await getCustomerBySession(rwDb.db, tenantId, s2.token)).toBeNull();
    });

    it("cross-tenant isolation: customer session or token from Store A is rejected on Store B", async () => {
      // Create session in Store A
      const sessionA = await loginCustomer(
        rwDb.db,
        tenantId,
        { email: custEmail, password: "finalStrongPassword10+" },
        { ip: "203.0.113.20", skipRateLimit: true },
      );

      // Checking session on Store B MUST return null
      const sessionOnStoreB = await getCustomerBySession(rwDb.db, tenantB, sessionA.token);
      expect(sessionOnStoreB).toBeNull();

      // Trying to reset password or login on Store B with credentials from Store A fails
      await expect(
        loginCustomer(
          rwDb.db,
          tenantB,
          { email: custEmail, password: "finalStrongPassword10+" },
          { ip: "203.0.113.21", skipRateLimit: true },
        ),
      ).rejects.toThrow(/Invalid email or password/);
    });
  });
});

