import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { STORE_PERMISSIONS } from "@bs/auth";
import {
  createRuntime,
  provisionTenant,
  placeOrder,
  transitionOrder,
  listAdminCustomers,
  getAdminCustomerStats,
  listAdminCustomerTags,
  setAdminCustomerStatus,
  setAdminCustomerTags,
  setMarketingConsent,
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
