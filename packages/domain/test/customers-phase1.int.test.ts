import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { STORE_PERMISSIONS } from "@bs/auth";
import {
  createRuntime,
  provisionTenant,
  placeOrder,
  transitionOrder,
  listAdminCustomers,
  getAdminCustomerDetail,
  getAdminCustomerStats,
  updateAdminCustomer,
  setAdminCustomerConsent,
  addAdminCustomerAddress,
  updateAdminCustomerAddress,
  deleteAdminCustomerAddress,
  listAdminCustomerOrders,
  getAdminCustomerActivity,
  listCustomerNotes,
  addCustomerNote,
  deleteCustomerNote,
  previewCustomerImport,
  commitCustomerImport,
  deleteAdminCustomer,
  listAdminCustomerTags,
  setAdminCustomerStatus,
  setAdminCustomerTags,
  setMarketingConsent,
  requestCustomerOtp,
  verifyCustomerOtp,
  createProduct,
  adjustInventory,
  listInventoryLevels,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";
import { addToCart, getOrCreateCart } from "../src/storefront/cart.ts";
import { primaryCategory } from "./helpers/primary-category.ts";

let env: TestDb;
let rtPlatform: Runtime;
let rtWeb: Runtime;
let ctxA: TenantContext;
let ctxB: TenantContext;
let ctxLimited: TenantContext;
let variantAId: string;
let variantBId: string;

// Seeded fixtures (ids resolved in beforeAll)
let acct1: string; // account, subscribed, 1 collected order, tag VIP, address in KA
let acct2: string; // account, not subscribed, 2 collected orders (repeat), spends more
let guest1: string; // guest, no orders, tag VIP, address in MH, marketing invalid
let blocked1: string; // blocked account
let old1: string; // created last month

const paise = (rupees: number) => rupees * 100;

beforeAll(async () => {
  env = await startTestDb();
  rtPlatform = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 10 });
  rtWeb = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 10 });

  const tA = await provisionTenant(rtPlatform, {
    storeName: "Customers Phase 1 Store A",
    slug: `cust-p1-a-${Date.now()}`,
    owner: { email: "owner-a@custp1.test", name: "Owner A" },
    planCode: "starter",
    source: "platform_admin",
  });
  ctxA = {
    tenantId: tA.tenantId,
    storeStatus: "live",
    actor: { type: "staff", userId: tA.ownerId },
    roles: ["store_owner"],
    permissions: [...STORE_PERMISSIONS],
    requestId: "req-cust-p1-a",
  };
  ctxLimited = { ...ctxA, permissions: ["analytics.read"] };

  const tB = await provisionTenant(rtPlatform, {
    storeName: "Customers Phase 1 Store B",
    slug: `cust-p1-b-${Date.now()}`,
    owner: { email: "owner-b@custp1.test", name: "Owner B" },
    planCode: "starter",
    source: "platform_admin",
  });
  ctxB = {
    tenantId: tB.tenantId,
    storeStatus: "live",
    actor: { type: "staff", userId: tB.ownerId },
    roles: ["store_owner"],
    permissions: [...STORE_PERMISSIONS],
    requestId: "req-cust-p1-b",
  };

  const catA = await primaryCategory(rtWeb, ctxA);
  const pA = await createProduct(rtWeb, ctxA, {
    title: "Product A",
    slug: "product-a",
    status: "active",
    primaryCategoryId: catA,
    variants: [{ title: "Default", sku: "SKU-P1-A", price: paise(1000), trackInventory: true }],
  });
  variantAId = pA.variants[0]!.id;
  const locA = (await listInventoryLevels(rtWeb, ctxA, {})).items[0]!;
  await adjustInventory(rtWeb, ctxA, { variantId: variantAId, locationId: locA.locationId, quantityDelta: 100, reason: "received" });

  const catB = await primaryCategory(rtWeb, ctxB);
  const pB = await createProduct(rtWeb, ctxB, {
    title: "Product B",
    slug: "product-b",
    status: "active",
    primaryCategoryId: catB,
    variants: [{ title: "Default", sku: "SKU-P1-B", price: paise(1000), trackInventory: true }],
  });
  variantBId = pB.variants[0]!.id;
  const locB = (await listInventoryLevels(rtWeb, ctxB, {})).items[0]!;
  await adjustInventory(rtWeb, ctxB, { variantId: variantBId, locationId: locB.locationId, quantityDelta: 100, reason: "received" });

  // ---- seed customers -----------------------------------------------------
  const insert = async (values: Partial<typeof schema.customers.$inferInsert> & { email: string }) => {
    const [row] = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) =>
      tx
        .insert(schema.customers)
        .values({ tenantId: ctxA.tenantId, isGuest: false, ...values })
        .returning(),
    );
    return row!;
  };

  const acct1Row = await insert({ email: "acct-1@phase1.test", name: "Ada Account", phone: "9600000001", tags: ["VIP"] });
  acct1 = acct1Row.id;
  const acct2Row = await insert({ email: "acct-2@phase1.test", name: "Ben Repeat", phone: "9600000002" });
  acct2 = acct2Row.id;
  const guest1Row = await insert({ email: "guest-1@phase1.test", name: "Gia Guest", isGuest: true, tags: ["VIP"], marketingState: "invalid" });
  guest1 = guest1Row.id;
  const blocked1Row = await insert({ email: "blocked-1@phase1.test", name: "Bob Blocked", status: "blocked" });
  blocked1 = blocked1Row.id;
  const old1Row = await insert({ email: "old-1@phase1.test", name: "Ola Old", createdAt: new Date(Date.now() - 40 * 86_400_000) });
  old1 = old1Row.id;
  await insert({ email: "deleted-1@phase1.test", name: "Dan Deleted", deletedAt: new Date() });

  // Addresses (location filter options and filter)
  await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) => {
    await tx.insert(schema.customerAddresses).values([
      { tenantId: ctxA.tenantId, customerId: acct1, name: "Ada", phone: "9600000001", line1: "1 MG Road", city: "Bengaluru", stateCode: "KA", pincode: "560001", isDefault: true },
      { tenantId: ctxA.tenantId, customerId: guest1, name: "Gia", phone: "9600000003", line1: "2 FC Road", city: "Pune", stateCode: "MH", pincode: "411001", isDefault: true },
    ]);
  });

  // Marketing consent through the single writer
  await setMarketingConsent(rtWeb, ctxA, { customerId: acct1, state: "subscribed", source: "admin", actorType: "staff", actorId: tA.ownerId });

  // Orders: one product at ₹1000; acct1 has one collected order, acct2 has two (repeat)
  const codOrder = async (email: string, phone: string, variantId: string) => {
    const cart = await getOrCreateCart(rtWeb, ctxA);
    await addToCart(rtWeb, ctxA, { token: cart.token, variantId, quantity: 1 });
    const placed = await placeOrder(rtWeb, ctxA, {
      cartToken: cart.token,
      idempotencyKey: `idem-p1-${email}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      email,
      phone,
      fullName: "Phase 1 Shopper",
      addressLine1: "1 Test Road",
      city: "Bengaluru",
      state: "Karnataka",
      pincode: "560001",
      paymentMethod: "cod",
    });
    const [pi] = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) =>
      tx.select().from(schema.paymentIntents).where(eq(schema.paymentIntents.orderId, placed.orderId)),
    );
    await transitionOrder(rtWeb, ctxA, placed.orderId, { type: "payment.cod_collect", intentId: pi!.id });
    return placed.orderId;
  };

  await codOrder("acct-1@phase1.test", "9600000001", variantAId);
  await codOrder("acct-2@phase1.test", "9600000002", variantAId);
  await codOrder("acct-2@phase1.test", "9600000002", variantAId);
}, 120_000);

afterAll(async () => {
  await rtPlatform?.close();
  await rtWeb?.close();
  await env?.stop();
});

const idsOf = (r: Awaited<ReturnType<typeof listAdminCustomers>>) => r.items.map((c) => c.id);

describe("Phase 1A: customers list filters, tabs and sorts", () => {
  it("tabs All / Customers / Guests / Blocked slice the list, and deleted customers are hidden", async () => {
    const all = await listAdminCustomers(rtWeb, ctxA, { limit: 100 });
    expect(idsOf(all).sort()).toEqual([acct1, acct2, blocked1, guest1, old1].sort());

    const accounts = await listAdminCustomers(rtWeb, ctxA, { view: "accounts", limit: 100 });
    expect(idsOf(accounts).sort()).toEqual([acct1, acct2, blocked1, old1].sort());

    const guests = await listAdminCustomers(rtWeb, ctxA, { view: "guests", limit: 100 });
    expect(idsOf(guests)).toEqual([guest1]);

    const blocked = await listAdminCustomers(rtWeb, ctxA, { view: "blocked", limit: 100 });
    expect(idsOf(blocked)).toEqual([blocked1]);
  });

  it("filters by marketing state, tag, location, repeat and joined range", async () => {
    const subscribed = await listAdminCustomers(rtWeb, ctxA, { marketingState: "subscribed", limit: 100 });
    expect(idsOf(subscribed)).toEqual([acct1]);

    const invalid = await listAdminCustomers(rtWeb, ctxA, { marketingState: "invalid", limit: 100 });
    expect(idsOf(invalid)).toEqual([guest1]);

    const vip = await listAdminCustomers(rtWeb, ctxA, { tag: "VIP", limit: 100 });
    expect(idsOf(vip).sort()).toEqual([acct1, guest1].sort());

    const ka = await listAdminCustomers(rtWeb, ctxA, { location: "KA", limit: 100 });
    expect(idsOf(ka)).toEqual([acct1]);
    const mh = await listAdminCustomers(rtWeb, ctxA, { location: "MH", limit: 100 });
    expect(idsOf(mh)).toEqual([guest1]);

    const repeat = await listAdminCustomers(rtWeb, ctxA, { repeat: true, limit: 100 });
    expect(idsOf(repeat)).toEqual([acct2]);

    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const joinedFuture = await listAdminCustomers(rtWeb, ctxA, { createdFrom: tomorrow, limit: 100 });
    expect(joinedFuture.items).toEqual([]);

    const fortyDays = new Date(Date.now() - 40 * 86_400_000).toISOString().slice(0, 10);
    const joinedAll = await listAdminCustomers(rtWeb, ctxA, { createdFrom: fortyDays, limit: 100 });
    expect(idsOf(joinedAll).sort()).toEqual([acct1, acct2, blocked1, guest1, old1].sort());
  });

  it("searches name, email and phone, and sorts by metrics from the Phase 0 fragment", async () => {
    const byEmail = await listAdminCustomers(rtWeb, ctxA, { search: "acct-1", limit: 100 });
    expect(idsOf(byEmail)).toEqual([acct1]);
    const byName = await listAdminCustomers(rtWeb, ctxA, { search: "gia", limit: 100 });
    expect(idsOf(byName)).toEqual([guest1]);
    const byPhone = await listAdminCustomers(rtWeb, ctxA, { search: "9600000002", limit: 100 });
    expect(idsOf(byPhone)).toEqual([acct2]);

    const spentDesc = await listAdminCustomers(rtWeb, ctxA, { sort: "spent_desc", limit: 100 });
    expect(idsOf(spentDesc).slice(0, 2)).toEqual([acct2, acct1]); // ₹2000 then ₹1000
    expect(spentDesc.items[0]).toMatchObject({ ordersCount: 2, totalSpent: paise(2000) });

    const ordersDesc = await listAdminCustomers(rtWeb, ctxA, { sort: "orders_desc", limit: 100 });
    expect(idsOf(ordersDesc)[0]).toBe(acct2);

    const nameAsc = await listAdminCustomers(rtWeb, ctxA, { sort: "name_asc", limit: 100 });
    expect(idsOf(nameAsc)).toEqual([acct1, acct2, blocked1, guest1, old1]); // Ada, Ben, Bob, Gia, Ola
  });

  it("exposes truthful metrics on the rows, never the cached columns", async () => {
    const rows = await listAdminCustomers(rtWeb, ctxA, { limit: 100 });
    const acct2Row = rows.items.find((c) => c.id === acct2)!;
    expect(acct2Row.ordersCount).toBe(2);
    expect(acct2Row.totalSpent).toBe(paise(2000));
    expect(acct2Row.lastOrderAt).toBeTruthy();
    expect(acct2Row.isGuest).toBe(false);
    expect(acct2Row.marketingState).toBe("not_subscribed");

    const guestRow = rows.items.find((c) => c.id === guest1)!;
    expect(guestRow.isGuest).toBe(true);
    expect(guestRow.ordersCount).toBe(0);
    expect(guestRow.lastOrderAt).toBeNull();
  });
});

describe("Phase 1A: stats strip and store-wide filter options", () => {
  it("computes the stat strip from the metrics fragment", async () => {
    const stats = await getAdminCustomerStats(rtWeb, ctxA);
    expect(stats.total).toBe(5);
    expect(stats.newThisMonth).toBe(4); // old1 was created 40 days ago
    expect(stats.repeat).toBe(1);
    expect(stats.subscribers).toBe(1);
    expect(stats.totalSpend).toBe(paise(3000));
    expect(stats.averageOrderValue).toBe(Math.floor(paise(3000) / 3));
  });

  it("lists every tag and address state in the store, not only those on the current page", async () => {
    const options = await listAdminCustomerTags(rtWeb, ctxA);
    expect(options.tags).toContain("VIP");
    expect(options.locationStates).toEqual(expect.arrayContaining(["KA", "MH"]));
  });
});

describe("Phase 1A: status and tag mutations", () => {
  it("blocks and unblocks with an audit row; a no-op change writes nothing", async () => {
    await setAdminCustomerStatus(rtWeb, ctxA, { id: old1, status: "blocked" });
    let [row] = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) =>
      tx.select().from(schema.customers).where(eq(schema.customers.id, old1)),
    );
    expect(row?.status).toBe("blocked");

    let audits = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) =>
      tx.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.action, "customer.status_changed"), eq(schema.auditLogs.targetId, old1))),
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actorType).toBe("staff");
    expect(audits[0]?.diff).toMatchObject({ from: "active", to: "blocked" });

    // No-op: same status again must not write a second audit row
    await setAdminCustomerStatus(rtWeb, ctxA, { id: old1, status: "blocked" });
    audits = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) =>
      tx.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.action, "customer.status_changed"), eq(schema.auditLogs.targetId, old1))),
    );
    expect(audits).toHaveLength(1);

    await setAdminCustomerStatus(rtWeb, ctxA, { id: old1, status: "active" });
    [row] = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) => tx.select().from(schema.customers).where(eq(schema.customers.id, old1)));
    expect(row?.status).toBe("active");
  });

  it("sets tags with normalisation, dedup and an audit diff", async () => {
    const result = await setAdminCustomerTags(rtWeb, ctxA, { id: old1, tags: ["  wholesale ", "VIP", "wholesale", ""] });
    expect(result.tags).toEqual(["wholesale", "VIP"]);

    const audits = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) =>
      tx.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.action, "customer.tags_changed"), eq(schema.auditLogs.targetId, old1))),
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]?.diff).toMatchObject({ added: ["wholesale", "VIP"], removed: [] });

    // Removing one tag
    await setAdminCustomerTags(rtWeb, ctxA, { id: old1, tags: ["VIP"] });
    const [row] = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) => tx.select().from(schema.customers).where(eq(schema.customers.id, old1)));
    expect(row?.tags).toEqual(["VIP"]);
  });

  it("refuses a read-only staff member and keeps stores isolated", async () => {
    await expect(listAdminCustomers(rtWeb, ctxLimited, {})).rejects.toThrow(/permission/i);
    await expect(getAdminCustomerStats(rtWeb, ctxLimited)).rejects.toThrow(/permission/i);
    await expect(setAdminCustomerStatus(rtWeb, ctxLimited, { id: acct1, status: "blocked" })).rejects.toThrow(/permission/i);
    await expect(setAdminCustomerTags(rtWeb, ctxLimited, { id: acct1, tags: [] })).rejects.toThrow(/permission/i);

    // Store B cannot see or change store A's customers (RLS + tenant scoping)
    await expect(setAdminCustomerStatus(rtWeb, ctxB, { id: acct1, status: "blocked" })).rejects.toThrow(/not found/i);
    await expect(setAdminCustomerTags(rtWeb, ctxB, { id: acct1, tags: ["hacked"] })).rejects.toThrow(/not found/i);
    const fromB = await listAdminCustomers(rtWeb, ctxB, { limit: 100 });
    expect(idsOf(fromB)).not.toContain(acct1);
  });
});

describe("Blocked customers cannot sign in or check out", () => {
  it("refuses phone OTP login for a blocked customer with the same message as a wrong code, and recovers after unblocking", async () => {
    const phone = "9611100222";
    const email = "otp-blocked@phase1.test";
    const [row] = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) =>
      tx.insert(schema.customers).values({ tenantId: ctxA.tenantId, email, phone, name: "Otp Blocked" }).returning(),
    );
    const customerId = row!.id;

    const block = async (status: "active" | "blocked") => setAdminCustomerStatus(rtWeb, ctxA, { id: customerId, status });
    await block("blocked");

    // A blocked customer's valid code fails with exactly the wrong-code error.
    const denied = await requestCustomerOtp(rtWeb._db.db, ctxA.tenantId, phone);
    await expect(verifyCustomerOtp(rtWeb._db.db, ctxA.tenantId, phone, denied.devOtp!)).rejects.toThrow(/invalid or expired/i);
    // No session was created for the blocked customer.
    const [sessions] = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) =>
      tx.select({ n: sql<number>`count(*)::int` }).from(schema.customerSessions).where(eq(schema.customerSessions.userId, customerId)),
    );
    expect(sessions?.n).toBe(0);

    // After unblocking, a fresh code signs them in.
    await block("active");
    const allowed = await requestCustomerOtp(rtWeb._db.db, ctxA.tenantId, phone);
    const ok = await verifyCustomerOtp(rtWeb._db.db, ctxA.tenantId, phone, allowed.devOtp!);
    expect(ok.success).toBe(true);
    expect(ok.customer.id).toBe(customerId);
  });

  it("refuses checkout for a blocked customer's email with a neutral message, while other stores stay unaffected", async () => {
    const blockedEmail = "blocked-checkout@phase1.test";
    const [row] = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) =>
      tx.insert(schema.customers).values({ tenantId: ctxA.tenantId, email: blockedEmail, name: "Blocked Shopper" }).returning(),
    );
    await setAdminCustomerStatus(rtWeb, ctxA, { id: row!.id, status: "blocked" });

    const cart = await getOrCreateCart(rtWeb, ctxA);
    await addToCart(rtWeb, ctxA, { token: cart.token, variantId: variantAId, quantity: 1 });
    await expect(
      placeOrder(rtWeb, ctxA, {
        cartToken: cart.token,
        idempotencyKey: `idem-blocked-${Date.now()}`,
        email: blockedEmail,
        phone: "9611100333",
        fullName: "Blocked Shopper",
        addressLine1: "1 Test Road",
        city: "Bengaluru",
        state: "Karnataka",
        pincode: "560001",
        paymentMethod: "cod",
      }),
    ).rejects.toThrow(/could not be completed/i);

    // The refusal left no order behind.
    const orders = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) =>
      tx.select().from(schema.orders).where(eq(schema.orders.email, blockedEmail)),
    );
    expect(orders).toHaveLength(0);

    // The same email is welcome in store B: blocking is per store.
    const cartB = await getOrCreateCart(rtWeb, ctxB);
    await addToCart(rtWeb, ctxB, { token: cartB.token, variantId: variantBId, quantity: 1 });
    const inB = await placeOrder(rtWeb, ctxB, {
      cartToken: cartB.token,
      idempotencyKey: `idem-blocked-b-${Date.now()}`,
      email: blockedEmail,
      phone: "9611100444",
      fullName: "Blocked Shopper",
      addressLine1: "2 Park Street",
      city: "Kolkata",
      state: "West Bengal",
      pincode: "700016",
      paymentMethod: "cod",
    });
    expect(inB.orderId).toBeDefined();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Phase 1B: detail and edit
// ---------------------------------------------------------------------------------------------------------------

describe("Phase 1B: profile update", () => {
  it("updates name and phone with an audit row, and refuses duplicate contact details", async () => {
    const result = await updateAdminCustomer(rtWeb, ctxA, { id: old1, name: "  Ola Updated  ", phone: "9600000099" });
    expect(result).toMatchObject({ id: old1, name: "Ola Updated", phone: "9600000099", emailVerified: false });

    const audits = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) =>
      tx.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.action, "customer.updated"), eq(schema.auditLogs.targetId, old1))),
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]?.diff).toMatchObject({ name: { from: "Ola Old", to: "Ola Updated" }, phone: { to: "9600000099" } });

    await expect(updateAdminCustomer(rtWeb, ctxA, { id: old1, phone: "9600000001" })).rejects.toThrow(/already exists/);
    await expect(updateAdminCustomer(rtWeb, ctxA, { id: old1, email: "acct-1@phase1.test" })).rejects.toThrow(/already exists/);
  });

  it("lets staff fix a guest's email but clears verification; a verified account's email is staff-immutable", async () => {
    const [guest] = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) =>
      tx.insert(schema.customers).values({ tenantId: ctxA.tenantId, email: "guest-edit@phase1.test", name: "Edit Guest", isGuest: true, emailVerified: true }).returning(),
    );
    const changed = await updateAdminCustomer(rtWeb, ctxA, { id: guest!.id, email: "guest-fixed@phase1.test" });
    expect(changed.email).toBe("guest-fixed@phase1.test");
    expect(changed.emailVerified).toBe(false);

    // A verified, non-guest account's email is not staff-editable
    const [verified] = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) =>
      tx
        .insert(schema.customers)
        .values({ tenantId: ctxA.tenantId, email: "verified-immutable@phase1.test", name: "Verified Account", emailVerified: true })
        .returning(),
    );
    await expect(updateAdminCustomer(rtWeb, ctxA, { id: verified!.id, email: "acct-1-new@phase1.test" })).rejects.toThrow(/verified/i);

    // Store isolation: store B cannot edit store A's customer
    await expect(updateAdminCustomer(rtWeb, ctxB, { id: old1, name: "Hacked" })).rejects.toThrow(/not found/i);
  });
});

describe("Phase 1B: consent switch", () => {
  it("subscribes through the single writer with source admin, history and audit; SMS is refused", async () => {
    const result = await setAdminCustomerConsent(rtWeb, ctxA, { id: old1, state: "subscribed" });
    expect(result).toMatchObject({ id: old1, marketingState: "subscribed", acceptsMarketing: true });

    const events = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) =>
      tx.select().from(schema.customerConsentEvents).where(eq(schema.customerConsentEvents.customerId, old1)),
    );
    expect(events.filter((e) => e.source === "admin").length).toBeGreaterThanOrEqual(1);

    await expect(setMarketingConsent(rtWeb, ctxA, { customerId: old1, state: "subscribed", source: "admin", channel: "sms" })).rejects.toThrow(/channel/i);
  });
});

describe("Phase 1B: staff addresses", () => {
  it("adds, updates and deletes addresses with audit rows", async () => {
    const added = await addAdminCustomerAddress(rtWeb, ctxA, {
      customerId: old1,
      address: { name: "Staff Added", phone: "9600000077", line1: "9 Note Road", city: "Bengaluru", stateCode: "KA", pincode: "560002", isDefault: true },
    });
    expect(added.id).toBeDefined();

    const [afterAdd] = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) =>
      tx.select().from(schema.customerAddresses).where(eq(schema.customerAddresses.id, added.id)),
    );
    expect(afterAdd?.isDefault).toBe(true);

    await updateAdminCustomerAddress(rtWeb, ctxA, {
      customerId: old1,
      addressId: added.id,
      address: { name: "Staff Updated", phone: "9600000077", line1: "9 Note Road", city: "Bengaluru", stateCode: "KA", pincode: "560002", type: "work" },
    });
    const [afterUpdate] = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) =>
      tx.select().from(schema.customerAddresses).where(eq(schema.customerAddresses.id, added.id)),
    );
    expect(afterUpdate?.name).toBe("Staff Updated");
    expect(afterUpdate?.type).toBe("work");

    await deleteAdminCustomerAddress(rtWeb, ctxA, { customerId: old1, addressId: added.id });
    const [gone] = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) =>
      tx.select().from(schema.customerAddresses).where(eq(schema.customerAddresses.id, added.id)),
    );
    expect(gone).toBeUndefined();

    const audits = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) =>
      tx.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.targetId, old1), sql`${schema.auditLogs.action} LIKE 'customer.address%'`)),
    );
    expect(audits.map((a) => a.action).sort()).toEqual(["customer.address_added", "customer.address_deleted", "customer.address_updated"]);

    await expect(deleteAdminCustomerAddress(rtWeb, ctxA, { customerId: old1, addressId: added.id })).rejects.toThrow(/not found/i);
    await expect(
      addAdminCustomerAddress(rtWeb, ctxB, { customerId: old1, address: { name: "X", phone: "1", line1: "1", city: "C", stateCode: "KA", pincode: "1" } }),
    ).rejects.toThrow(/not found/i);
  });
});

describe("Phase 1B: staff notes timeline", () => {
  it("adds notes with author and audit, orders newest first, and enforces the author-or-owner delete rule", async () => {
    const added = await addCustomerNote(rtWeb, ctxA, { customerId: old1, body: "First note" });
    expect(added.id).toBeDefined();

    const list = await listCustomerNotes(rtWeb, ctxA, { customerId: old1 });
    expect(list.items[0]?.body).toBe("First note");

    // A second staff member (neither author nor owner) may not delete it
    const staff2: TenantContext = { ...ctxA, actor: { type: "staff", userId: "0199a000-0000-7000-8000-beef00000099" }, roles: ["store_admin"] };
    await expect(deleteCustomerNote(rtWeb, staff2, { id: added.id })).rejects.toThrow(/author or the store owner/i);

    // The owner can delete anyone's note
    await deleteCustomerNote(rtWeb, ctxA, { id: added.id });
    const after = await listCustomerNotes(rtWeb, ctxA, { customerId: old1 });
    expect(after.items.find((n) => n.id === added.id)).toBeUndefined();

    await expect(addCustomerNote(rtWeb, ctxA, { customerId: old1, body: "" })).rejects.toThrow(/empty/i);
    await expect(addCustomerNote(rtWeb, ctxA, { customerId: old1, body: "x".repeat(1001) })).rejects.toThrow(/1000/i);
    await expect(addCustomerNote(rtWeb, ctxB, { customerId: old1, body: "cross-store" })).rejects.toThrow(/not found/i);
  });

  it("migrates the legacy single note into the first note, idempotently", async () => {
    const [leg] = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) =>
      tx
        .insert(schema.customers)
        .values({ tenantId: ctxA.tenantId, email: `legacy-note-${Date.now()}@phase1.test`, name: "Legacy Note", note: "Prefers evening calls" })
        .returning(),
    );

    const { readFileSync } = await import("node:fs");
    const file = readFileSync(new URL("../../db/migrations/0029_customers_phase1.sql", import.meta.url), "utf8");
    const start = file.indexOf('INSERT INTO "customer_notes"');
    expect(start).toBeGreaterThan(-1);
    const statement = file.slice(start);

    await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) => tx.execute(sql.raw(statement)));
    let notes = await listCustomerNotes(rtWeb, ctxA, { customerId: leg!.id });
    expect(notes.items).toHaveLength(1);
    expect(notes.items[0]?.body).toBe("Prefers evening calls");
    expect(notes.items[0]?.authorId).toBeNull();

    // Running the migration statement a second time must not duplicate the note
    await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) => tx.execute(sql.raw(statement)));
    notes = await listCustomerNotes(rtWeb, ctxA, { customerId: leg!.id });
    expect(notes.items).toHaveLength(1);
  });
});

describe("Phase 1B: orders history and activity timeline", () => {
  it("lists the customer's orders with status filter and merges an ordered activity timeline", async () => {
    const history = await listAdminCustomerOrders(rtWeb, ctxA, { customerId: acct1 });
    expect(history.total).toBe(1);
    expect(history.items[0]).toMatchObject({ paymentStatus: "cod_collected" });

    const cancelledOnly = await listAdminCustomerOrders(rtWeb, ctxA, { customerId: acct1, status: "cancelled" });
    expect(cancelledOnly.items).toHaveLength(0);

    const activity = await getAdminCustomerActivity(rtWeb, ctxA, { customerId: acct1 });
    const kinds = activity.items.map((i) => i.kind);
    expect(kinds).toContain("order");
    expect(kinds).toContain("consent");
    // Newest first
    const times = activity.items.map((i) => i.at);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it("returns the full detail payload including consent history", async () => {
    const detail = await getAdminCustomerDetail(rtWeb, ctxA, { id: acct1 });
    expect(detail.customer).toMatchObject({ emailVerified: false, isGuest: false, status: "active", marketingState: "subscribed" });
    expect(detail.customer.averageOrderValue).toBeGreaterThan(0);
    expect(detail.consentHistory.length).toBeGreaterThanOrEqual(1);
    expect(detail.recentOrders).toHaveLength(1);
  });
});

describe("Phase 1C: CSV import", () => {
  const rowsFor = (stamp: number) => [
    { name: "Import One", email: `imp-one-${stamp}@phase1.test`, phone: "9620000001", tags: ["imported", "retail"], marketingConsent: "yes" },
    { name: "Import Two", email: `imp-two-${stamp}@phase1.test`, marketingConsent: "SUBSCRIBED" },
    { name: "Import Three", email: `imp-three-${stamp}@phase1.test`, marketingConsent: "" },
    { name: "Import Four", email: `imp-one-${stamp}@phase1.test`, marketingConsent: "true" }, // duplicate in file
    { name: "Import Five", email: "not-an-email", marketingConsent: "yes" }, // invalid
    { name: "Import Six", email: "", marketingConsent: "yes" }, // missing email
  ];

  it("previews counts and issues without writing anything", async () => {
    const stamp = Date.now();
    const preview = await previewCustomerImport(rtWeb, ctxA, { rows: rowsFor(stamp) });
    expect(preview.total).toBe(6);
    expect(preview.created).toBe(3);
    expect(preview.updated).toBe(0);
    expect(preview.duplicatesInFile).toBe(1);
    expect(preview.subscribeCount).toBe(2); // yes and SUBSCRIBED; the duplicate row is skipped entirely
    expect(preview.invalid.map((i) => i.error)).toEqual(
      expect.arrayContaining([expect.stringMatching(/duplicate/), expect.stringMatching(/not a valid email/), expect.stringMatching(/email is required/)]),
    );

    // Dry run wrote nothing
    const rows = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) =>
      tx.select().from(schema.customers).where(sql`${schema.customers.email} LIKE ${"imp-%-" + stamp + "%@phase1.test"}`),
    );
    expect(rows).toHaveLength(0);
  });

  it("commits exactly what the preview promised, subscribes only rows that say so, and never overwrites consent or phone of existing customers", async () => {
    const stamp = Date.now();
    const preview = await previewCustomerImport(rtWeb, ctxA, { rows: rowsFor(stamp) });
    const result = await commitCustomerImport(rtWeb, ctxA, { rows: rowsFor(stamp) });
    if ("queued" in result) throw new Error("small import should not be queued");
    expect(result.created).toBe(preview.created);
    expect(result.errors.map((e) => e.error)).toEqual(preview.invalid.map((i) => i.error));

    const [one] = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) =>
      tx.select().from(schema.customers).where(eq(schema.customers.email, `imp-one-${stamp}@phase1.test`)),
    );
    expect(one?.marketingState).toBe("subscribed");
    expect(one?.acceptsMarketing).toBe(true);
    expect(one?.marketingSource).toBe("import");
    expect(one?.phone).toBe("9620000001");
    expect(one?.tags).toEqual(expect.arrayContaining(["imported", "retail"]));

    const [three] = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) =>
      tx.select().from(schema.customers).where(eq(schema.customers.email, `imp-three-${stamp}@phase1.test`)),
    );
    expect(three?.marketingState).toBe("not_subscribed");
    expect(three?.acceptsMarketing).toBe(false);

    // An existing customer: name/tags merged, consent untouched unless the row says so
    await commitCustomerImport(rtWeb, ctxA, {
      rows: [{ name: "Ada Renamed", email: "acct-1@phase1.test", phone: "9999999999", tags: ["imported"], marketingConsent: "" }],
    });
    const [ada] = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) => tx.select().from(schema.customers).where(eq(schema.customers.id, acct1)));
    expect(ada?.name).toBe("Ada Renamed");
    expect(ada?.tags).toContain("imported");
    expect(ada?.tags).toContain("VIP"); // existing tags kept
    expect(ada?.phone).toBe("9600000001"); // phone never overwritten from a file
    expect(ada?.marketingState).toBe("subscribed"); // unchanged

    // Consent history only has admin/import rows from earlier steps, no new one for this commit
    const events = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) =>
      tx.select().from(schema.customerConsentEvents).where(eq(schema.customerConsentEvents.customerId, acct1)),
    );
    expect(events.filter((e) => e.source === "import")).toHaveLength(0);

    // Second commit of the same file: no new rows, no duplicate keys
    const again = await commitCustomerImport(rtWeb, ctxA, { rows: rowsFor(stamp) });
    if ("queued" in again) throw new Error("small import should not be queued");
    expect(again.created).toBe(0);
    expect(again.updated).toBe(3);
  });

  it("refuses more than 10,000 rows and reports phone collisions per row", async () => {
    const tooMany = Array.from({ length: 10_001 }, (_, i) => ({ email: `bulk-${i}@phase1.test` }));
    await expect(previewCustomerImport(rtWeb, ctxA, { rows: tooMany })).rejects.toThrow(/10,000/);
    await expect(commitCustomerImport(rtWeb, ctxA, { rows: tooMany })).rejects.toThrow(/10,000/);

    const result = await commitCustomerImport(rtWeb, ctxA, {
      rows: [
        { name: "Phone A", email: `phone-a-${Date.now()}@phase1.test`, phone: "9630000001" },
        { name: "Phone B", email: `phone-b-${Date.now()}@phase1.test`, phone: "9630000001" },
      ],
    });
    if ("queued" in result) throw new Error("small import should not be queued");
    expect(result.created).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.error).toMatch(/already belongs to another customer/);
  });

  it("refuses a read-only staff member and keeps stores isolated", async () => {
    await expect(previewCustomerImport(rtWeb, ctxLimited, { rows: [{ email: "x@y.test" }] })).rejects.toThrow(/permission/i);
    await expect(commitCustomerImport(rtWeb, ctxLimited, { rows: [{ email: "x@y.test" }] })).rejects.toThrow(/permission/i);
    // Store B's import never touches store A rows with the same email
    const stamp = Date.now();
    await commitCustomerImport(rtWeb, ctxA, { rows: [{ name: "Store A", email: `cross-${stamp}@phase1.test` }] });
    await commitCustomerImport(rtWeb, ctxB, { rows: [{ name: "Store B", email: `cross-${stamp}@phase1.test` }] });
    const [a] = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) => tx.select().from(schema.customers).where(eq(schema.customers.email, `cross-${stamp}@phase1.test`)));
    const [b] = await withTenant(rtWeb._db.db, ctxB.tenantId, (tx) => tx.select().from(schema.customers).where(eq(schema.customers.email, `cross-${stamp}@phase1.test`)));
    expect(a?.name).toBe("Store A");
    expect(b?.name).toBe("Store B");
    expect(a?.id).not.toBe(b?.id);
  });
});

describe("Phase 1C: delete and anonymise", () => {
  it("hard-deletes a customer without orders, cascading their addresses, notes and sessions", async () => {
    const [row] = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) =>
      tx.insert(schema.customers).values({ tenantId: ctxA.tenantId, email: `del-hard-${Date.now()}@phase1.test`, name: "Hard Delete" }).returning(),
    );
    const id = row!.id;
    await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) => {
      await tx.insert(schema.customerAddresses).values({ tenantId: ctxA.tenantId, customerId: id, name: "A", phone: "1", line1: "L1", city: "C", stateCode: "KA", pincode: "1" });
      await tx.insert(schema.customerNotes).values({ tenantId: ctxA.tenantId, customerId: id, body: "note" });
      await tx.insert(schema.customerSessions).values({ id: `sess-hard-${Date.now()}`, tenantId: ctxA.tenantId, userId: id, token: `deadbeef-${Date.now()}`, expiresAt: new Date(Date.now() + 86_400_000) });
    });

    const result = await deleteAdminCustomer(rtWeb, ctxA, { id });
    expect(result.mode).toBe("deleted");

    const [gone] = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) => tx.select().from(schema.customers).where(eq(schema.customers.id, id)));
    expect(gone).toBeUndefined();
    const [addr] = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) => tx.select().from(schema.customerAddresses).where(eq(schema.customerAddresses.customerId, id)));
    expect(addr).toBeUndefined();

    const audits = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) =>
      tx.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.action, "customer.deleted"), eq(schema.auditLogs.targetId, id))),
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]?.diff).toMatchObject({ mode: "deleted" });
  });

  it("anonymises a customer with orders: identity replaced, sessions destroyed, orders kept and still linked", async () => {
    // acct1 has one collected order from the seed
    const before = await getAdminCustomerDetail(rtWeb, ctxA, { id: acct1 });
    expect(before.customer.ordersCount).toBe(1);
    const [order] = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) =>
      tx.select().from(schema.orders).where(eq(schema.orders.customerId, acct1)),
    );
    expect(order).toBeDefined();

    // A live session that must die with the account
    await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) => {
      await tx.insert(schema.customerSessions).values({ id: `sess-anon-${Date.now()}`, tenantId: ctxA.tenantId, userId: acct1, token: `tok-anon-${Date.now()}`, expiresAt: new Date(Date.now() + 86_400_000) });
    });

    const result = await deleteAdminCustomer(rtWeb, ctxA, { id: acct1 });
    expect(result.mode).toBe("anonymised");

    const [anon] = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) => tx.select().from(schema.customers).where(eq(schema.customers.id, acct1)));
    expect(anon?.email).toMatch(/^deleted-[0-9a-f]{8}@invalid$/);
    expect(anon?.name).toBe("Deleted customer");
    expect(anon?.phone).toBeNull();
    expect(anon?.passwordHash).toBeNull();
    expect(anon?.isGuest).toBe(true);
    expect(anon?.deletedAt).not.toBeNull();
    expect(anon?.marketingState).toBe("unsubscribed");
    expect(anon?.tags).toEqual([]);

    const [sessions] = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) =>
      tx.select({ n: sql<number>`count(*)::int` }).from(schema.customerSessions).where(eq(schema.customerSessions.userId, acct1)),
    );
    expect(sessions?.n).toBe(0);

    // Orders are untouched and still point at the (now anonymised) customer
    const [kept] = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) => tx.select().from(schema.orders).where(eq(schema.orders.id, order!.id)));
    expect(kept?.customerId).toBe(acct1);

    // The anonymised customer disappears from the list
    const list = await listAdminCustomers(rtWeb, ctxA, { limit: 100 });
    expect(list.items.find((c) => c.id === acct1)).toBeUndefined();

    // Consent history records the erasure
    const events = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) =>
      tx.select().from(schema.customerConsentEvents).where(eq(schema.customerConsentEvents.customerId, acct1)),
    );
    expect(events.some((e) => e.state === "unsubscribed" && e.source === "admin")).toBe(true);

    const audits = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) =>
      tx.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.action, "customer.deleted"), eq(schema.auditLogs.targetId, acct1))),
    );
    expect(audits[0]?.diff).toMatchObject({ mode: "anonymised" });
  });

  it("refuses a read-only staff member and cross-store deletes", async () => {
    const [row] = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) =>
      tx.insert(schema.customers).values({ tenantId: ctxA.tenantId, email: `del-guard-${Date.now()}@phase1.test`, name: "Guard" }).returning(),
    );
    await expect(deleteAdminCustomer(rtWeb, ctxLimited, { id: row!.id })).rejects.toThrow(/permission/i);
    await expect(deleteAdminCustomer(rtWeb, ctxB, { id: row!.id })).rejects.toThrow(/not found/i);
    await expect(deleteAdminCustomer(rtWeb, ctxA, { id: "0199a000-0000-7000-8000-beef00000dea" })).rejects.toThrow(/not found/i);
  });
});
