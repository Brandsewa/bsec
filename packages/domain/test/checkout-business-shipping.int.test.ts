import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq, sql } from "drizzle-orm";
import { createDb, type DbHandle, orders, withTenant } from "@bs/db";
import { bootstrapRoles } from "@bs/db/bootstrap";
import { runMigrations } from "@bs/db/migrate";
import { createRuntime, type Runtime, type TenantContext } from "../src/index.ts";
import { addToCart, getOrCreateCart } from "../src/storefront/cart.ts";
import { placeOrder, checkoutContactProblem, type PlaceOrderInput } from "../src/orders/checkout.ts";

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

const orgId = "0199a0c9-0000-7000-8000-000000000000";
const tenantId = "0199a0c9-0000-7000-8000-000000000001";
const locationId = "0199a0c9-0000-7000-8000-000000000010";
const productId = "0199a0c9-0000-7000-8000-000000000020";
const variantId = "0199a0c9-0000-7000-8000-000000000030";

const ctx: TenantContext = { tenantId, storeStatus: "live", actor: { type: "system" }, roles: ["admin"], permissions: ["*"], requestId: "req_biz" };

const base = {
  email: "buyer@example.com",
  phone: "9876543210",
  fullName: "Rajesh Kumar",
  addressLine1: "123 Marine Drive",
  city: "Mumbai",
  state: "Maharashtra",
  pincode: "400020",
  paymentMethod: "cod" as const,
};

let seq = 0;
async function newCartToken(): Promise<string> {
  const cart = await getOrCreateCart(rt, ctx, `cart_biz_${++seq}_${Date.now()}`);
  await addToCart(rt, ctx, { token: cart.token, variantId, quantity: 1 });
  return cart.token;
}
async function orderRow(orderId: string) {
  return withTenant(rwDb.db, tenantId, async (tx) => (await tx.select().from(orders).where(eq(orders.id, orderId)))[0]);
}
async function orderCount(): Promise<number> {
  return withTenant(rwDb.db, tenantId, async (tx) => Number((await tx.execute<{ n: number }>(sql`select count(*)::int as n from orders`)).rows[0]?.n ?? 0));
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
    INSERT INTO organizations (id, name) VALUES ('${orgId}', 'Biz Org') ON CONFLICT DO NOTHING;
    INSERT INTO tenants (id, organization_id, slug, name) VALUES ('${tenantId}', '${orgId}', 'biz-store-c9', 'Biz Store') ON CONFLICT DO NOTHING;
    SELECT set_config('app.tenant_id', '${tenantId}', false);
    INSERT INTO locations (id, tenant_id, name, is_default) VALUES ('${locationId}', '${tenantId}', 'Main Warehouse', true) ON CONFLICT DO NOTHING;
    INSERT INTO products (id, tenant_id, title, slug, status) VALUES ('${productId}', '${tenantId}', 'Desk Lamp', 'desk-lamp', 'published') ON CONFLICT (tenant_id, slug) DO UPDATE SET status = 'published';
    INSERT INTO variants (id, tenant_id, product_id, sku, title, price) VALUES ('${variantId}', '${tenantId}', '${productId}', 'LAMP-1', 'Default', 99900) ON CONFLICT DO NOTHING;
    INSERT INTO inventory_levels (id, tenant_id, variant_id, location_id, on_hand, reserved)
    VALUES ('0199a0c9-0000-7000-8000-000000000040', '${tenantId}', '${variantId}', '${locationId}', 50, 0)
    ON CONFLICT (tenant_id, variant_id, location_id) DO UPDATE SET on_hand = 50, reserved = 0;
  `);
  await pg.end();
}, 180_000);

afterAll(async () => {
  await rwDb?.close();
  await rt?.close();
  await container?.stop();
});

describe("checkoutContactProblem (pure)", () => {
  const ship = { fullName: "Asha", phone: "9123456780", addressLine1: "5 Park Road", city: "Pune", state: "Maharashtra", pincode: "411001" };
  const problem = (p: Pick<PlaceOrderInput, "businessOrder" | "shipTo">) => checkoutContactProblem(p);

  it("accepts nothing extra, a company with or without a GSTIN, and a complete delivery address", () => {
    expect(problem({})).toBeNull();
    expect(problem({ businessOrder: { companyName: "Sharma Traders" } })).toBeNull();
    expect(problem({ businessOrder: { companyName: "Sharma Traders", taxId: "27AAPFU0939F1ZV" } })).toBeNull();
    expect(problem({ shipTo: ship })).toBeNull();
    expect(problem({ shipTo: { ...ship, email: "asha@example.com" } })).toBeNull();
  });

  it("rejects a missing company name, a malformed GSTIN, and an incomplete or invalid delivery address", () => {
    expect(problem({ businessOrder: { companyName: "  " } })).toMatch(/Company name is required/);
    expect(problem({ businessOrder: { companyName: "x".repeat(121) } })).toMatch(/too long/);
    expect(problem({ businessOrder: { companyName: "Acme", taxId: "NOTAGSTIN" } })).toMatch(/Tax ID/);
    expect(problem({ shipTo: { ...ship, fullName: "" } })).toMatch(/Shipping name/);
    expect(problem({ shipTo: { ...ship, city: "" } })).toMatch(/incomplete/);
    expect(problem({ shipTo: { ...ship, pincode: "12345" } })).toMatch(/pincode/);
    expect(problem({ shipTo: { ...ship, phone: "12345" } })).toMatch(/mobile number/);
    expect(problem({ shipTo: { ...ship, email: "not-an-email" } })).toMatch(/email/);
  });
});

describe("placing orders with a business buyer and a separate delivery address", () => {
  it("keeps the company and GSTIN on the billing address only, and ships to the billing address when none is given", async () => {
    const res = await placeOrder(rt, ctx, { ...base, cartToken: await newCartToken(), businessOrder: { companyName: "  Sharma Traders Pvt Ltd ", taxId: "27aapfu0939f1zv" } });
    const o = await orderRow(res.orderId);
    const billing = o?.billingAddress as Record<string, string>;
    const shipping = o?.shippingAddress as Record<string, string>;
    expect(billing).toMatchObject({ companyName: "Sharma Traders Pvt Ltd", taxId: "27AAPFU0939F1ZV", fullName: "Rajesh Kumar", state: "Maharashtra" });
    expect(shipping["companyName"]).toBeUndefined();
    expect(shipping["taxId"]).toBeUndefined();
    expect(shipping).toMatchObject({ fullName: "Rajesh Kumar", addressLine1: "123 Marine Drive", pincode: "400020" });
    expect(o?.placeOfSupplyState).toBe("Maharashtra");
  });

  it("delivers to the other address with its own contact, keeps the buyer's email and phone on the order, and takes the place of supply from the delivery state", async () => {
    const res = await placeOrder(rt, ctx, {
      ...base,
      cartToken: await newCartToken(),
      shipTo: { fullName: "Asha Patil", email: "Asha@Example.com", phone: "91234 56780", addressLine1: "5 Park Road", city: "Bengaluru", state: "Karnataka", pincode: "560001" },
    });
    const o = await orderRow(res.orderId);
    const billing = o?.billingAddress as Record<string, string>;
    const shipping = o?.shippingAddress as Record<string, string>;
    expect(billing).toMatchObject({ fullName: "Rajesh Kumar", city: "Mumbai", state: "Maharashtra" });
    expect(shipping).toMatchObject({ fullName: "Asha Patil", city: "Bengaluru", state: "Karnataka", pincode: "560001", phone: "9123456780", email: "asha@example.com" });
    expect(o?.email).toBe("buyer@example.com");
    expect(o?.phone).toBe("9876543210");
    expect(o?.placeOfSupplyState).toBe("Karnataka");
  });

  it("refuses bad business or delivery details without creating an order or using up a number", async () => {
    const before = await orderCount();
    const token = await newCartToken();
    await expect(placeOrder(rt, ctx, { ...base, cartToken: token, businessOrder: { companyName: "" } })).rejects.toThrow(/Company name is required/);
    await expect(placeOrder(rt, ctx, { ...base, cartToken: token, businessOrder: { companyName: "Acme", taxId: "123" } })).rejects.toThrow(/Tax ID/);
    await expect(placeOrder(rt, ctx, { ...base, cartToken: token, shipTo: { fullName: "A", phone: "123", addressLine1: "x", city: "y", state: "Goa", pincode: "403001" } })).rejects.toThrow(/mobile number/);
    expect(await orderCount()).toBe(before);
  });

  it("another store never sees these orders", async () => {
    const other = "0199a0c9-0000-7000-8000-0000000000ff";
    const n = await withTenant(rwDb.db, other, async (tx) => Number((await tx.execute<{ n: number }>(sql`select count(*)::int as n from orders`)).rows[0]?.n ?? 0));
    expect(n).toBe(0);
  });
});
