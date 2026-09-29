import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDb, invoices, staffInvitations, tenantSecrets, withTenant, type DbHandle } from "@bs/db";
import { bootstrapRoles } from "@bs/db/bootstrap";
import { runMigrations } from "@bs/db/migrate";
import { decryptSecret } from "@bs/payments";
import {
  acceptInvitation,
  clearRazorpayCredentials,
  createProduct,
  createRuntime,
  createStoreOwner,
  generateInvoice,
  getPaymentsStatus,
  getStoreSettings,
  inviteStaff,
  listMemberships,
  listProducts,
  listStoreRoles,
  placeOrder,
  removeMember,
  saveRazorpayCredentials,
  setMemberRole,
  updateStoreSettings,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";
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

const orgId = "0199a0a2-0000-7000-8000-000000000000";
const tenantId = "0199a0a2-0000-7000-8000-000000000001";
const locationId = "0199a0a2-0000-7000-8000-000000000010";
const productId = "0199a0a2-0000-7000-8000-000000000020";
const variantId = "0199a0a2-0000-7000-8000-000000000030";
const OWNER_EMAIL = "settings-owner@store-settings-test.example";

let ctx: TenantContext;

function buyer(state: string, cartToken: string, paymentMethod: "cod" | "razorpay" = "cod") {
  return {
    cartToken,
    idempotencyKey: `idem_${cartToken}`,
    email: "buyer@store-settings-test.example",
    phone: "9876543210",
    fullName: "Test Buyer",
    addressLine1: "1 Test Street",
    city: "Testville",
    state,
    pincode: "560001",
    paymentMethod,
  };
}

async function order(state: string, token: string) {
  const cart = await getOrCreateCart(rt, ctx, token);
  await addToCart(rt, ctx, { token: cart.token, variantId, quantity: 1 });
  return placeOrder(rt, ctx, buyer(state, cart.token));
}

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

  const pg = new (await import("pg")).default.Client({ connectionString: superUrl });
  await pg.connect();
  await pg.query(`
    INSERT INTO organizations (id, name) VALUES ('${orgId}', 'Settings Org') ON CONFLICT DO NOTHING;
    INSERT INTO tenants (id, organization_id, slug, name) VALUES ('${tenantId}', '${orgId}', 'store-settings-a2', 'Settings Test Store') ON CONFLICT DO NOTHING;
    SELECT set_config('app.tenant_id', '${tenantId}', false);
    INSERT INTO locations (id, tenant_id, name, is_default) VALUES ('${locationId}', '${tenantId}', 'Main Warehouse', true) ON CONFLICT DO NOTHING;
    INSERT INTO products (id, tenant_id, title, slug, status) VALUES ('${productId}', '${tenantId}', 'Settings Tee', 'settings-tee', 'published') ON CONFLICT (tenant_id, slug) DO UPDATE SET status = 'published';
    INSERT INTO variants (id, tenant_id, product_id, sku, title, price) VALUES ('${variantId}', '${tenantId}', '${productId}', 'SETTINGS-TEE', 'Default', 100000) ON CONFLICT DO NOTHING;
    INSERT INTO inventory_levels (id, tenant_id, variant_id, location_id, on_hand, reserved)
    VALUES ('0199a0a2-0000-7000-8000-000000000040', '${tenantId}', '${variantId}', '${locationId}', 500, 0)
    ON CONFLICT (tenant_id, variant_id, location_id) DO UPDATE SET on_hand = 500, reserved = 0;
    DELETE FROM users WHERE email LIKE '%@store-settings-test.example';
  `);
  await pg.end();

  const owner = await createStoreOwner(rwDb.db, {
    email: OWNER_EMAIL,
    name: "Settings Owner",
    password: "owner-password-long",
    tenantSlug: "store-settings-a2",
  });
  ctx = {
    tenantId,
    storeStatus: "live",
    actor: { type: "staff", userId: owner.userId },
    roles: ["store_owner"],
    permissions: ["settings.write", "staff.manage", "orders.read", "orders.write", "products.read", "products.write"],
    requestId: "req_settings",
  };
}, 180_000);

afterAll(async () => {
  await rwDb?.close();
  await rt?.close();
  await container?.stop();
});

describe("store settings", () => {
  it("defaults a store that has never saved settings to its own tenant values (India), not another country's", async () => {
    const s = await getStoreSettings(rt, ctx);
    expect(s.storeName).toBe("Settings Test Store");
    expect(s.currency).toBe("INR");
    expect(s.timezone).toBe("Asia/Kolkata");
    expect(s.cod).toEqual({ enabled: true, feePaise: 5000 });
    expect(s.tax).toEqual({ gstin: null, sellerState: null, pricesIncludeTax: true });
  });

  it("saves and returns every field", async () => {
    const saved = await updateStoreSettings(rt, ctx, {
      storeName: "Renamed Store",
      legalName: "Renamed Traders Pvt Ltd",
      supportEmail: "help@store-settings-test.example",
      supportPhone: "+919800000000",
      address: { line1: "12 MG Road", city: "Bengaluru", state: "Karnataka", pincode: "560001" },
      orderPrefix: "RN-",
      tax: { gstin: "29ABCDE1234F1Z5", sellerState: "Karnataka", pricesIncludeTax: true },
    });
    expect(saved.storeName).toBe("Renamed Store");
    const again = await getStoreSettings(rt, ctx);
    expect(again.legalName).toBe("Renamed Traders Pvt Ltd");
    expect(again.address).toMatchObject({ city: "Bengaluru", state: "Karnataka" });
    expect(again.orderPrefix).toBe("RN-");
    expect(again.tax.gstin).toBe("29ABCDE1234F1Z5");
  });

  it("partial updates keep the other fields", async () => {
    await updateStoreSettings(rt, ctx, { supportPhone: "+919811111111" });
    const s = await getStoreSettings(rt, ctx);
    expect(s.supportPhone).toBe("+919811111111");
    expect(s.legalName).toBe("Renamed Traders Pvt Ltd");
    expect(s.tax.sellerState).toBe("Karnataka");
  });
});

describe("Cash on Delivery settings are enforced at checkout", () => {
  it("charges the default fee until the store sets its own, then the configured fee", async () => {
    const withDefault = await order("Karnataka", "cart_fee_default");
    await updateStoreSettings(rt, ctx, { cod: { enabled: true, feePaise: 0 } });
    const noFee = await order("Karnataka", "cart_fee_zero");
    await updateStoreSettings(rt, ctx, { cod: { enabled: true, feePaise: 7500 } });
    const custom = await order("Karnataka", "cart_fee_custom");
    expect(withDefault.grandTotal - noFee.grandTotal).toBe(5000);
    expect(custom.grandTotal - noFee.grandTotal).toBe(7500);
  });

  it("refuses COD orders once the store turns COD off", async () => {
    await updateStoreSettings(rt, ctx, { cod: { enabled: false, feePaise: 5000 } });
    await expect(order("Karnataka", "cart_cod_off")).rejects.toThrow(/Cash on delivery is not available/);
    await updateStoreSettings(rt, ctx, { cod: { enabled: true, feePaise: 5000 } });
    await expect(order("Karnataka", "cart_cod_on_again")).resolves.toMatchObject({ success: true });
  });
});

describe("invoices use the store's own tax settings", () => {
  it("charges CGST+SGST for a buyer in the seller's state and IGST for another state, with the store GSTIN", async () => {
    await updateStoreSettings(rt, ctx, {
      tax: { gstin: "29ABCDE1234F1Z5", sellerState: "Karnataka", pricesIncludeTax: true },
    });
    const home = await order("Karnataka", "cart_inv_home");
    const away = await order("Maharashtra", "cart_inv_away");
    const invHome = await generateInvoice(rt, ctx, { orderId: home.orderId });
    const invAway = await generateInvoice(rt, ctx, { orderId: away.orderId });
    expect(invHome.totals.isInterState).toBe(false);
    expect(invAway.totals.isInterState).toBe(true);

    const rows = await withTenant(rwDb.db, tenantId, (tx) =>
      tx.select({ id: invoices.id, sellerGstin: invoices.sellerGstin }).from(invoices),
    );
    expect(rows.find((r) => r.id === invHome.invoiceId)?.sellerGstin).toBe("29ABCDE1234F1Z5");
  });
});

describe("payment credentials", () => {
  it("stores Razorpay keys encrypted, never returns the secret, and can clear them", async () => {
    const before = await getPaymentsStatus(rt, ctx);
    expect(before.razorpay.configured).toBe(false);

    const status = await saveRazorpayCredentials(rt, ctx, {
      keyId: "rzp_test_AbCdEf123456",
      keySecret: "super-secret-key-value",
      webhookSecret: "whsec-value-1234",
    });
    expect(status.razorpay).toEqual({ configured: true, keyIdHint: "…3456", hasWebhookSecret: true });
    expect(JSON.stringify(status)).not.toContain("super-secret-key-value");

    const rows = await withTenant(rwDb.db, tenantId, (tx) =>
      tx.select().from(tenantSecrets).where(eq(tenantSecrets.provider, "razorpay")),
    );
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.ciphertext).not.toContain("super-secret-key-value");
    }
    const secretRow = rows.find((r) => r.keyName === "key_secret")!;
    expect(decryptSecret({ ciphertext: secretRow.ciphertext, iv: secretRow.iv })).toBe("super-secret-key-value");

    await saveRazorpayCredentials(rt, ctx, { keyId: "rzp_test_ZzZzZz999999", keySecret: "rotated-secret-value" });
    const rotated = await getPaymentsStatus(rt, ctx);
    expect(rotated.razorpay.keyIdHint).toBe("…9999");

    const cleared = await clearRazorpayCredentials(rt, ctx);
    expect(cleared.razorpay.configured).toBe(false);
  });

  it("rejects a malformed Razorpay key id", async () => {
    await expect(saveRazorpayCredentials(rt, ctx, { keyId: "not-a-key", keySecret: "secret-value-long" })).rejects.toThrow(/rzp_/);
  });
});

describe("team management", () => {
  it("stores only a hash of the invite token, and the token works once", async () => {
    const roles = await listStoreRoles(rt, ctx);
    const admin = roles.find((r) => r.name === "store_admin")!;
    const invite = await inviteStaff(rt, ctx, { email: "newbie@store-settings-test.example", roleId: admin.id });
    expect(invite.token).toBeTruthy();

    const [row] = await withTenant(rwDb.db, tenantId, (tx) =>
      tx.select().from(staffInvitations).where(eq(staffInvitations.id, invite.id)),
    );
    expect(row?.tokenHash).not.toBe(invite.token);
    expect(row?.tokenHash).toBe(createHash("sha256").update(invite.token!).digest("hex"));

    await expect(
      acceptInvitation(rt, { storeId: tenantId, token: invite.token!, name: "Newbie", password: "newbie-password-long" }),
    ).resolves.toMatchObject({ ok: true, email: "newbie@store-settings-test.example" });
    await expect(
      acceptInvitation(rt, { storeId: tenantId, token: invite.token!, name: "Newbie", password: "newbie-password-long" }),
    ).rejects.toThrow(/invalid or has expired/);
    const members = await listMemberships(rt, ctx);
    expect(members.find((m) => m.email === "newbie@store-settings-test.example")?.roleName).toBe("store_admin");
  });

  it("refuses to invite someone who is already a member", async () => {
    const roles = await listStoreRoles(rt, ctx);
    await expect(inviteStaff(rt, ctx, { email: OWNER_EMAIL, roleId: roles[0]!.id })).rejects.toThrow(/already a member/);
  });

  it("never leaves a store without an owner, and you cannot remove yourself", async () => {
    const members = await listMemberships(rt, ctx);
    const me = members.find((m) => m.email === OWNER_EMAIL)!;
    const roles = await listStoreRoles(rt, ctx);
    const adminRole = roles.find((r) => r.name === "store_admin")!;
    await expect(setMemberRole(rt, ctx, { id: me.id, roleId: adminRole.id })).rejects.toThrow(/at least one owner/);
    await expect(removeMember(rt, ctx, { id: me.id })).rejects.toThrow(/cannot remove yourself/);
  });
});

describe("product list summaries", () => {
  it("returns the true total (not the page size) plus price range and stock per product", async () => {
    await createProduct(rt, ctx, {
      title: "Second Tee",
      variants: [
        { sku: "SETTINGS-TEE-2", title: "A", price: 50000 },
        { sku: "SETTINGS-TEE-3", title: "B", price: 90000 },
      ],
    });
    const page = await listProducts(rt, ctx, { limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(2);

    const all = await listProducts(rt, ctx, {});
    const second = all.items.find((p) => p.title === "Second Tee")!;
    expect(second.variantCount).toBe(2);
    expect(second.priceMin).toBe(50000);
    expect(second.priceMax).toBe(90000);
    expect(second.stock).toBe(0);
    const first = all.items.find((p) => p.title === "Settings Tee")!;
    expect(first.priceMin).toBe(100000);
    expect(first.stock).toBeGreaterThan(0);
  });
});
