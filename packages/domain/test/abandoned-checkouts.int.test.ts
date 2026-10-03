import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import {
  createRuntime,
  getAdminAbandonedCheckoutStats,
  listAdminAbandonedCheckouts,
  placeOrder,
  provisionTenant,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";
import { addToCart, getOrCreateCart } from "../src/storefront/cart.ts";
import { STORE_PERMISSIONS } from "@bs/auth";

import { createActiveProduct } from "./helpers/factories.ts";

let env: TestDb;
let rt: Runtime;
let rtWeb: Runtime;
let ctxA: TenantContext;
let ctxB: TenantContext;
let tShirtVariantId: string;
let shoesVariantId: string;
let hatVariantBId: string;

let cart1Id: string;
let cart2Id: string;
let cart3Id: string;
let cart4Id: string;
let _cart5Id: string;
let cartB1Id: string;

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 10 });
  rtWeb = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 10 });

  const randA = Math.random().toString(36).slice(2, 7);
  const randB = Math.random().toString(36).slice(2, 7);

  // Provision Tenant A
  const tA = await provisionTenant(rt, {
    storeName: "Abandoned Store A",
    slug: `abandoned-a-${randA}`,
    owner: { email: `owner-a-${randA}@abandoned.test`, name: "Owner A" },
    planCode: "starter",
    source: "platform_admin",
  });
  ctxA = {
    tenantId: tA.tenantId,
    storeStatus: "live",
    actor: { type: "staff", userId: tA.ownerId },
    roles: ["store_owner"],
    permissions: [...STORE_PERMISSIONS],
    requestId: "req-abandoned-a",
  };

  // Provision Tenant B
  const tB = await provisionTenant(rt, {
    storeName: "Abandoned Store B",
    slug: `abandoned-b-${randB}`,
    owner: { email: `owner-b-${randB}@abandoned.test`, name: "Owner B" },
    planCode: "starter",
    source: "platform_admin",
  });
  ctxB = {
    tenantId: tB.tenantId,
    storeStatus: "live",
    actor: { type: "staff", userId: tB.ownerId },
    roles: ["store_owner"],
    permissions: [...STORE_PERMISSIONS],
    requestId: "req-abandoned-b",
  };

  // Products for Tenant A
  const p1 = await createActiveProduct(rtWeb, ctxA, {
    title: "Classic Cotton T-Shirt",
    sku: "TSHIRT-01",
    price: 50000,
    stock: 100,
  });
  tShirtVariantId = p1.variantId;

  const p2 = await createActiveProduct(rtWeb, ctxA, {
    title: "Urban Running Shoes",
    sku: "SHOES-01",
    price: 120000,
    stock: 50,
  });
  shoesVariantId = p2.variantId;

  // Product for Tenant B
  const pB = await createActiveProduct(rtWeb, ctxB, {
    title: "Store B Hat",
    sku: "HAT-01",
    price: 30000,
    stock: 20,
  });
  hatVariantBId = pB.variantId;

  // Seed Cart 1: Open, Not sent (Alice Smith, 2x T-Shirt = 100000 paise)
  const cart1 = await getOrCreateCart(rtWeb, ctxA);
  await addToCart(rtWeb, ctxA, { token: cart1.token, variantId: tShirtVariantId, quantity: 2 });
  await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) => {
    await tx
      .update(schema.carts)
      .set({
        status: "abandoned",
        email: "alice@example.com",
        phone: "+919876543210",
        shippingAddress: { fullName: "Alice Smith", addressLine1: "123 MG Road", city: "Bengaluru", state: "KA", pincode: "560001", country: "IN" },
        lastActivityAt: new Date(Date.now() - 3600 * 1000), // 1h ago
      })
      .where(eq(schema.carts.id, cart1.id));
  });
  cart1Id = cart1.id;

  // Seed Cart 2: Open, Sent (Bob Jones, 1x Shoes = 120000 paise)
  const cart2 = await getOrCreateCart(rtWeb, ctxA);
  await addToCart(rtWeb, ctxA, { token: cart2.token, variantId: shoesVariantId, quantity: 1 });
  await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) => {
    await tx
      .update(schema.carts)
      .set({
        status: "abandoned",
        email: "bob@example.com",
        recoverySentAt: new Date(Date.now() - 1800 * 1000), // sent 30m ago
        shippingAddress: { fullName: "Bob Jones", addressLine1: "456 Indiranagar", city: "Bengaluru", state: "KA", pincode: "560038", country: "IN" },
        lastActivityAt: new Date(Date.now() - 7200 * 1000), // 2h ago
      })
      .where(eq(schema.carts.id, cart2.id));
  });
  cart2Id = cart2.id;

  // Seed Cart 3: Recovered (Charlie Brown, 1x T-Shirt = 50000 paise, with linked order)
  const cart3 = await getOrCreateCart(rtWeb, ctxA);
  await addToCart(rtWeb, ctxA, { token: cart3.token, variantId: tShirtVariantId, quantity: 1 });
  const order3Id = crypto.randomUUID();
  await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) => {
    const abandonedTime = new Date(Date.now() - 10000 * 1000);
    const recoveredTime = new Date(Date.now() - 1000 * 1000);

    await tx
      .update(schema.carts)
      .set({
        status: "converted",
        email: "charlie@example.com",
        shippingAddress: { fullName: "Charlie Brown", city: "Mumbai", state: "MH", pincode: "400001", country: "IN" },
        lastActivityAt: abandonedTime,
        recoveredAt: recoveredTime,
      })
      .where(eq(schema.carts.id, cart3.id));

    // Linked Order
    await tx.insert(schema.orders).values({
      id: order3Id,
      tenantId: ctxA.tenantId,
      number: "ORD-00099",
      email: "charlie@example.com",
      phone: "+919123456780",
      status: "pending",
      paymentStatus: "paid",
      subtotal: 50000,
      grandTotal: 50000,
      shippingAddress: { fullName: "Charlie Brown", addressLine1: "Flat 1", city: "Mumbai", state: "MH", pincode: "400001", country: "IN" },
      cartId: cart3.id,
      placedAt: recoveredTime,
    });
  });
  cart3Id = cart3.id;

  // Seed Cart 4: Open, No email (Dave Guest, phone only, 1x T-Shirt = 50000 paise)
  const cart4 = await getOrCreateCart(rtWeb, ctxA);
  await addToCart(rtWeb, ctxA, { token: cart4.token, variantId: tShirtVariantId, quantity: 1 });
  await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) => {
    await tx
      .update(schema.carts)
      .set({
        status: "abandoned",
        email: null,
        phone: "+919999999999",
        shippingAddress: { fullName: "Dave Guest", city: "Delhi", state: "DL", pincode: "110001", country: "IN" },
        lastActivityAt: new Date(Date.now() - 5000 * 1000),
      })
      .where(eq(schema.carts.id, cart4.id));
  });
  cart4Id = cart4.id;

  // Seed Cart 5: Never reached checkout (No email, no phone, no shippingAddress)
  const cart5 = await getOrCreateCart(rtWeb, ctxA);
  await addToCart(rtWeb, ctxA, { token: cart5.token, variantId: tShirtVariantId, quantity: 1 });
  await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) => {
    await tx
      .update(schema.carts)
      .set({
        status: "abandoned",
        email: null,
        phone: null,
        shippingAddress: null,
        lastActivityAt: new Date(Date.now() - 15000 * 1000),
      })
      .where(eq(schema.carts.id, cart5.id));
  });
  _cart5Id = cart5.id;

  // Seed Cart B1 on Tenant B
  const cartB1 = await getOrCreateCart(rtWeb, ctxB);
  await addToCart(rtWeb, ctxB, { token: cartB1.token, variantId: hatVariantBId, quantity: 1 });
  await withTenant(rtWeb._db.db, ctxB.tenantId, async (tx) => {
    await tx
      .update(schema.carts)
      .set({
        status: "abandoned",
        email: "eve@example.com",
        shippingAddress: { fullName: "Eve Hacker", city: "Goa", state: "GA", pincode: "403001", country: "IN" },
        lastActivityAt: new Date(Date.now() - 3600 * 1000),
      })
      .where(eq(schema.carts.id, cartB1.id));
  });
  cartB1Id = cartB1.id;
}, 180_000);

describe("Abandoned Checkouts Domain Integration Suite", () => {
  it("computes all 5 KPI cards accurately matching the seeded set", async () => {
    const stats = await getAdminAbandonedCheckoutStats(rtWeb, ctxA);

    // Abandoned: Cart 1, 2, 3, 4 (Cart 5 excluded because never reached checkout)
    expect(stats.abandoned).toBe(4);
    // Open: Cart 1, 2, 4
    expect(stats.open).toBe(3);
    // Recovered: Cart 3
    expect(stats.recovered).toBe(1);
    // Recovery emails sent: Cart 2
    expect(stats.emailsSent).toBe(1);
    // Potential revenue: Cart 1 (100,000) + Cart 2 (120,000) + Cart 4 (50,000) = 270,000 paise
    expect(stats.potentialRevenue).toBe(270000);
  });

  it("partitions correctly across All, Open, and Recovered tabs", async () => {
    const all = await listAdminAbandonedCheckouts(rtWeb, ctxA, { view: "all" });
    expect(all.total).toBe(4);
    expect(all.items.map((i) => i.id).sort()).toEqual([cart1Id, cart2Id, cart3Id, cart4Id].sort());

    const open = await listAdminAbandonedCheckouts(rtWeb, ctxA, { view: "open" });
    expect(open.total).toBe(3);
    expect(open.items.map((i) => i.id).sort()).toEqual([cart1Id, cart2Id, cart4Id].sort());
    for (const item of open.items) {
      expect(item.recovered).toBe(false);
    }

    const recovered = await listAdminAbandonedCheckouts(rtWeb, ctxA, { view: "recovered" });
    expect(recovered.total).toBe(1);
    expect(recovered.items[0]?.id).toBe(cart3Id);
    expect(recovered.items[0]?.recovered).toBe(true);
    expect(recovered.items[0]?.customer.name).toBe("Charlie Brown");
    expect(recovered.items[0]?.total).toBe(50000);
  });

  it("filters correctly by email status (Sent, Not sent, No email)", async () => {
    const sent = await listAdminAbandonedCheckouts(rtWeb, ctxA, { emailStatus: "sent" });
    expect(sent.total).toBe(1);
    expect(sent.items[0]?.id).toBe(cart2Id);
    expect(sent.items[0]?.emailStatus).toBe("sent");

    const notSent = await listAdminAbandonedCheckouts(rtWeb, ctxA, { emailStatus: "not_sent" });
    expect(notSent.total).toBe(2);
    expect(notSent.items.map((i) => i.id).sort()).toEqual([cart1Id, cart3Id].sort());

    const noEmail = await listAdminAbandonedCheckouts(rtWeb, ctxA, { emailStatus: "not_applicable" });
    expect(noEmail.total).toBe(1);
    expect(noEmail.items[0]?.id).toBe(cart4Id);
    expect(noEmail.items[0]?.emailStatus).toBe("not_applicable");
  });

  it("searches across customer name, email, phone, and product title", async () => {
    // 1. By customer name
    const byName = await listAdminAbandonedCheckouts(rtWeb, ctxA, { search: "Alice" });
    expect(byName.total).toBe(1);
    expect(byName.items[0]?.id).toBe(cart1Id);

    // 2. By customer email
    const byEmail = await listAdminAbandonedCheckouts(rtWeb, ctxA, { search: "bob@example.com" });
    expect(byEmail.total).toBe(1);
    expect(byEmail.items[0]?.id).toBe(cart2Id);

    // 3. By customer phone
    const byPhone = await listAdminAbandonedCheckouts(rtWeb, ctxA, { search: "+919999999999" });
    expect(byPhone.total).toBe(1);
    expect(byPhone.items[0]?.id).toBe(cart4Id);

    // 4. By product title
    const byProduct = await listAdminAbandonedCheckouts(rtWeb, ctxA, { search: "Shoes" });
    expect(byProduct.total).toBe(1);
    expect(byProduct.items[0]?.id).toBe(cart2Id);
  });

  it("sorts correctly by total amount and abandoned date", async () => {
    const sortedDesc = await listAdminAbandonedCheckouts(rtWeb, ctxA, { sort: "total_desc" });
    expect(sortedDesc.items[0]?.total).toBe(120000); // Cart 2
    expect(sortedDesc.items[1]?.total).toBe(100000); // Cart 1

    const sortedAsc = await listAdminAbandonedCheckouts(rtWeb, ctxA, { sort: "total_asc" });
    expect(sortedAsc.items[0]?.total).toBe(50000);
    expect(sortedAsc.items[sortedAsc.items.length - 1]?.total).toBe(120000);
  });

  it("updates cart to converted and recovered upon checkout order placement", async () => {
    // Create an abandoned cart
    const cart = await getOrCreateCart(rtWeb, ctxA);
    await addToCart(rtWeb, ctxA, { token: cart.token, variantId: tShirtVariantId, quantity: 1 });

    await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) => {
      await tx
        .update(schema.carts)
        .set({
          status: "abandoned",
          email: "recoverme@example.com",
          shippingAddress: { fullName: "Recover Me", city: "Bengaluru", state: "KA", pincode: "560001", country: "IN" },
          lastActivityAt: new Date(Date.now() - 3600 * 1000),
        })
        .where(eq(schema.carts.id, cart.id));
    });

    // Check stats before recovery
    const statsBefore = await getAdminAbandonedCheckoutStats(rtWeb, ctxA);

    // Complete checkout order placement
    const orderRes = await placeOrder(rtWeb, ctxA, {
      cartToken: cart.token,
      email: "recoverme@example.com",
      phone: "+919876543210",
      fullName: "Recover Me",
      addressLine1: "123 Street",
      city: "Bengaluru",
      state: "KA",
      pincode: "560001",
      paymentMethod: "cod",
    });

    expect(orderRes.success).toBe(true);

    // Verify cart status in database
    const [updatedCart] = await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) =>
      tx.select().from(schema.carts).where(eq(schema.carts.id, cart.id)),
    );

    expect(updatedCart?.status).toBe("converted");
    expect(updatedCart?.recoveredAt).not.toBeNull();

    // Check stats after recovery: open decreased, recovered increased
    const statsAfter = await getAdminAbandonedCheckoutStats(rtWeb, ctxA);
    expect(statsAfter.recovered).toBe(statsBefore.recovered + 1);
  });

  it("enforces tenant isolation under RLS (Tenant A never sees Tenant B checkouts)", async () => {
    const listA = await listAdminAbandonedCheckouts(rtWeb, ctxA, { view: "all" });
    expect(listA.items.some((i) => i.id === cartB1Id)).toBe(false);

    const listB = await listAdminAbandonedCheckouts(rtWeb, ctxB, { view: "all" });
    expect(listB.total).toBe(1);
    expect(listB.items[0]?.id).toBe(cartB1Id);
    expect(listB.items.some((i) => i.id === cart1Id)).toBe(false);
  });

  it("enforces permission check: refuses orders.read without permission", async () => {
    const restrictedCtx: TenantContext = {
      tenantId: ctxA.tenantId,
      storeStatus: "live",
      actor: { type: "staff", userId: "restricted-staff" },
      roles: ["staff"],
      permissions: ["products.read"], // lacks orders.read
      requestId: "req-restricted",
    };

    await expect(getAdminAbandonedCheckoutStats(rtWeb, restrictedCtx)).rejects.toThrow(/orders\.read/);
    await expect(listAdminAbandonedCheckouts(rtWeb, restrictedCtx, {})).rejects.toThrow(/orders\.read/);
  });
});
