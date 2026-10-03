import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { primaryCategory } from "./helpers/primary-category.ts";
import { schema } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import {
  adjustInventory,
  createCustomerAddress,
  createProduct,
  createRuntime,
  destroyCustomerSession,
  getAddressUpdateView,
  getCustomerAddresses,
  getCustomerBySession,
  getCustomerOrderDetail,
  getCustomerOrders,
  getCustomerProfile,
  getOrderByActionToken,
  getUnsubscribeView,
  listInventoryLevels,
  mintAddressUpdateToken,
  mintOrderViewTokenForCustomer,
  mintUnsubscribeToken,
  placeOrder,
  provisionTenant,
  requestCustomerOtp,
  unsubscribeByToken,
  updateCustomerAddress,
  updateCustomerProfile,
  updateOrderAddressByToken,
  verifyCustomerOtp,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";
import { addToCart, getOrCreateCart } from "../src/storefront/cart.ts";

let env: TestDb;
let rt: Runtime;
let rtWeb: Runtime;
let ctxA: TenantContext;
let ctxB: TenantContext;
let variantA: string;
let locationA: string;
let n = 0;

const errorOf = async (p: Promise<unknown>) => (await p.then(() => null, (e: Error) => e))?.message ?? null;
const ctxFor = (tenantId: string, ownerId: string): TenantContext => ({
  tenantId,
  storeStatus: "live",
  actor: { type: "staff", userId: ownerId },
  roles: ["store_owner"],
  permissions: ["products.read", "products.write", "orders.read", "orders.write"],
  requestId: "r",
});
const addr = { fullName: "Asha Rao", addressLine1: "12 MG Road", city: "Pune", state: "Maharashtra", pincode: "411001" };

async function place(phone = "9876543210") {
  const cart = await getOrCreateCart(rtWeb, ctxA, `tok-scp-${++n}`);
  await addToCart(rtWeb, ctxA, { token: cart.token, variantId: variantA, quantity: 1 });
  return placeOrder(rtWeb, ctxA, {
    cartToken: cart.token,
    idempotencyKey: `idem_scp_${n}`,
    email: `b${n}@scp.example`,
    phone,
    fullName: "Buyer",
    addressLine1: "1 St",
    city: "Pune",
    state: "Maharashtra",
    pincode: "411001",
    paymentMethod: "cod" as const,
  });
}

async function login(tenantId: string, phone: string) {
  const otp = await requestCustomerOtp(rtWeb._db.db, tenantId, phone);
  return verifyCustomerOtp(rtWeb._db.db, tenantId, phone, otp.devOtp!);
}

const tokenRow = async (tenantId: string, raw: string) => {
  const { createHash } = await import("node:crypto");
  const hash = createHash("sha256").update(raw).digest("hex");
  return (await rt._db.db.select().from(schema.actionTokens).where(and(eq(schema.actionTokens.tenantId, tenantId), eq(schema.actionTokens.tokenHash, hash))))[0]!;
};
const expireToken = async (tenantId: string, raw: string) => {
  const row = await tokenRow(tenantId, raw);
  await rt._db.db.update(schema.actionTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.actionTokens.id, row.id));
};

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  rtWeb = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5 });
  const a = await provisionTenant(rt, { storeName: "scp-a", slug: "scp-a", owner: { email: "o@scp-a.test", name: "A" }, planCode: "starter", source: "platform_admin" });
  const b = await provisionTenant(rt, { storeName: "scp-b", slug: "scp-b", owner: { email: "o@scp-b.test", name: "B" }, planCode: "starter", source: "platform_admin" });
  ctxA = ctxFor(a.tenantId, a.ownerId);
  ctxB = ctxFor(b.tenantId, b.ownerId);
  await createProduct(rtWeb, ctxA, { title: "Pickle", status: "active", primaryCategoryId: await primaryCategory(rtWeb, ctxA), variants: [{ sku: "SCP-1", title: "Default", price: 10000 }] });
  const row = (await listInventoryLevels(rtWeb, ctxA, {})).items[0]!;
  variantA = row.variantId;
  locationA = row.locationId;
  await adjustInventory(rtWeb, ctxA, { variantId: variantA, locationId: locationA, quantityDelta: 100, reason: "received" });
}, 180_000);

afterAll(async () => {
  await rt?.close();
  await rtWeb?.close();
  await env?.stop();
});

describe("unsubscribe link", () => {
  it("unsubscribes the customer from marketing, idempotently, and drops them from the newsletter", async () => {
    const { customer } = await login(ctxA.tenantId, "9000000001");
    await updateCustomerProfile(rtWeb._db.db, ctxA.tenantId, customer.id, { name: "Uma", email: "uma@scp.example", acceptsMarketing: true });
    await rt._db.db.insert(schema.newsletterSubscribers).values({ tenantId: ctxA.tenantId, email: "uma@scp.example" });

    const token = await mintUnsubscribeToken(rtWeb._db.db, ctxA.tenantId, customer.id);
    expect(token.startsWith("unsub_")).toBe(true);
    expect(await getUnsubscribeView(rtWeb._db.db, ctxA.tenantId, token)).toEqual({ state: "subscribed", maskedEmail: "u***@scp.example" });

    expect(await unsubscribeByToken(rtWeb._db.db, ctxA.tenantId, token)).toBe(true);
    expect(await unsubscribeByToken(rtWeb._db.db, ctxA.tenantId, token)).toBe(true); // reused: still fine
    const [c] = await rt._db.db.select().from(schema.customers).where(eq(schema.customers.id, customer.id));
    expect(c!.acceptsMarketing).toBe(false);
    const [sub] = await rt._db.db.select().from(schema.newsletterSubscribers).where(eq(schema.newsletterSubscribers.email, "uma@scp.example"));
    expect(sub!.status).toBe("unsubscribed");
    expect((await getUnsubscribeView(rtWeb._db.db, ctxA.tenantId, token)).state).toBe("unsubscribed");
    expect((await tokenRow(ctxA.tenantId, token)).usedAt).not.toBeNull();
  });

  it("stores only a hash of the token", async () => {
    const { customer } = await login(ctxA.tenantId, "9000000002");
    const token = await mintUnsubscribeToken(rtWeb._db.db, ctxA.tenantId, customer.id);
    const rows = await rt._db.db.select().from(schema.actionTokens).where(eq(schema.actionTokens.targetId, customer.id));
    expect(rows.some((r) => r.tokenHash === token)).toBe(false);
  });

  it("rejects an unknown, expired or other-store token and leaves the customer alone", async () => {
    const { customer } = await login(ctxA.tenantId, "9000000003");
    await updateCustomerProfile(rtWeb._db.db, ctxA.tenantId, customer.id, { name: "Vik", email: "vik@scp.example", acceptsMarketing: true });
    const token = await mintUnsubscribeToken(rtWeb._db.db, ctxA.tenantId, customer.id);

    // wrong store
    expect(await getUnsubscribeView(rtWeb._db.db, ctxB.tenantId, token)).toEqual({ state: "invalid" });
    expect(await unsubscribeByToken(rtWeb._db.db, ctxB.tenantId, token)).toBe(false);
    // unknown
    expect(await unsubscribeByToken(rtWeb._db.db, ctxA.tenantId, "unsub_nope")).toBe(false);
    // another purpose cannot be used as an unsubscribe token
    const placed = await place();
    const viewToken = (await rt._db.db.select().from(schema.actionTokens).where(and(eq(schema.actionTokens.targetId, placed.orderId), eq(schema.actionTokens.purpose, "order_view"))))[0]!;
    expect(viewToken.purpose).toBe("order_view");
    // expired
    await expireToken(ctxA.tenantId, token);
    expect((await getUnsubscribeView(rtWeb._db.db, ctxA.tenantId, token)).state).toBe("invalid");
    expect(await unsubscribeByToken(rtWeb._db.db, ctxA.tenantId, token)).toBe(false);

    const [c] = await rt._db.db.select().from(schema.customers).where(eq(schema.customers.id, customer.id));
    expect(c!.acceptsMarketing).toBe(true);
  });

  it("will not mint a token for another store's customer", async () => {
    const { customer } = await login(ctxB.tenantId, "9000000004");
    expect(await errorOf(mintUnsubscribeToken(rtWeb._db.db, ctxA.tenantId, customer.id))).toMatch(/Not Found/);
  });
});

describe("address correction link", () => {
  it("lets the shopper fix the address while the order is open and records an event", async () => {
    const placed = await place();
    const token = await mintAddressUpdateToken(rtWeb._db.db, ctxA.tenantId, placed.orderId);
    const view = await getAddressUpdateView(rtWeb._db.db, ctxA.tenantId, token);
    expect(view?.editable).toBe(true);
    expect(view?.address.city).toBe("Pune");

    await updateOrderAddressByToken(rtWeb._db.db, ctxA.tenantId, token, { ...addr, addressLine2: "Flat 4" });
    // the same link can correct it again until it expires
    await updateOrderAddressByToken(rtWeb._db.db, ctxA.tenantId, token, { ...addr, addressLine1: "99 FC Road" });

    const [o] = await rt._db.db.select().from(schema.orders).where(eq(schema.orders.id, placed.orderId));
    expect(o!.shippingAddress).toMatchObject({ fullName: "Asha Rao", addressLine1: "99 FC Road", pincode: "411001", country: "IN" });
    expect((o!.shippingAddress as Record<string, unknown>).addressLine2).toBeUndefined();
    const events = await rt._db.db.select().from(schema.orderEvents).where(and(eq(schema.orderEvents.orderId, placed.orderId), eq(schema.orderEvents.type, "order.address_updated")));
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ actorType: "customer", visibleToCustomer: true });
    expect((events[0]!.data as { previous: { addressLine1: string } }).previous.addressLine1).toBe("1 St");
  });

  it("validates the new address", async () => {
    const placed = await place();
    const token = await mintAddressUpdateToken(rtWeb._db.db, ctxA.tenantId, placed.orderId);
    expect(await errorOf(updateOrderAddressByToken(rtWeb._db.db, ctxA.tenantId, token, { ...addr, pincode: "12" }))).toMatch(/pincode/);
    expect(await errorOf(updateOrderAddressByToken(rtWeb._db.db, ctxA.tenantId, token, { ...addr, city: " " }))).toMatch(/Bad Request/);
  });

  it("locks once a fulfillment is past label_created or the order is closed", async () => {
    const placed = await place();
    const token = await mintAddressUpdateToken(rtWeb._db.db, ctxA.tenantId, placed.orderId);
    const [f] = await rt._db.db.insert(schema.fulfillments).values({ tenantId: ctxA.tenantId, orderId: placed.orderId, locationId: locationA, status: "label_created" }).returning();
    expect((await getAddressUpdateView(rtWeb._db.db, ctxA.tenantId, token))?.editable).toBe(true);

    await rt._db.db.update(schema.fulfillments).set({ status: "in_transit" }).where(eq(schema.fulfillments.id, f!.id));
    expect((await getAddressUpdateView(rtWeb._db.db, ctxA.tenantId, token))?.editable).toBe(false);
    expect(await errorOf(updateOrderAddressByToken(rtWeb._db.db, ctxA.tenantId, token, addr))).toMatch(/Precondition/);

    // a cancelled shipment does not block; a cancelled order does
    await rt._db.db.update(schema.fulfillments).set({ status: "cancelled" }).where(eq(schema.fulfillments.id, f!.id));
    expect((await getAddressUpdateView(rtWeb._db.db, ctxA.tenantId, token))?.editable).toBe(true);
    await rt._db.db.update(schema.orders).set({ status: "cancelled" }).where(eq(schema.orders.id, placed.orderId));
    expect(await errorOf(updateOrderAddressByToken(rtWeb._db.db, ctxA.tenantId, token, addr))).toMatch(/Precondition/);
  });

  it("rejects a token from another store, an expired token and a token of another purpose", async () => {
    const placed = await place();
    const token = await mintAddressUpdateToken(rtWeb._db.db, ctxA.tenantId, placed.orderId);
    const before = (await rt._db.db.select().from(schema.orders).where(eq(schema.orders.id, placed.orderId)))[0]!.shippingAddress;

    expect(await getAddressUpdateView(rtWeb._db.db, ctxB.tenantId, token)).toBeNull();
    expect(await errorOf(updateOrderAddressByToken(rtWeb._db.db, ctxB.tenantId, token, addr))).toMatch(/Not Found/);
    expect(await errorOf(mintAddressUpdateToken(rtWeb._db.db, ctxB.tenantId, placed.orderId))).toMatch(/Not Found/);

    // the order_view link must not open the address editor
    const viewRow = (await rt._db.db.select().from(schema.actionTokens).where(and(eq(schema.actionTokens.targetId, placed.orderId), eq(schema.actionTokens.purpose, "order_view"))))[0]!;
    expect(viewRow).toBeDefined();
    expect(await errorOf(updateOrderAddressByToken(rtWeb._db.db, ctxA.tenantId, "ord_guess", addr))).toMatch(/Not Found/);

    await expireToken(ctxA.tenantId, token);
    expect(await getAddressUpdateView(rtWeb._db.db, ctxA.tenantId, token)).toBeNull();
    expect(await errorOf(updateOrderAddressByToken(rtWeb._db.db, ctxA.tenantId, token, addr))).toMatch(/Not Found/);

    const after = (await rt._db.db.select().from(schema.orders).where(eq(schema.orders.id, placed.orderId)))[0]!.shippingAddress;
    expect(after).toEqual(before);
  });
});

describe("customer session", () => {
  it("signs in with an opaque session token that is stored hashed", async () => {
    const { customer, token } = await login(ctxA.tenantId, "9111111101");
    expect(token.startsWith("cs_")).toBe(true);
    const rows = await rt._db.db.select().from(schema.customerSessions).where(eq(schema.customerSessions.userId, customer.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token).not.toBe(token);

    expect(await getCustomerBySession(rtWeb._db.db, ctxA.tenantId, token)).toMatchObject({ id: customer.id, phone: "9111111101" });
  });

  it("rejects forged, other-store, expired, destroyed and suspended sessions", async () => {
    const { customer, token } = await login(ctxA.tenantId, "9111111102");
    // the old unsigned format must not work
    const forged = Buffer.from(JSON.stringify({ tenantId: ctxA.tenantId, customerId: customer.id, phone: "9111111102", ts: Date.now() })).toString("base64url");
    expect(await getCustomerBySession(rtWeb._db.db, ctxA.tenantId, forged)).toBeNull();
    expect(await getCustomerBySession(rtWeb._db.db, ctxA.tenantId, undefined)).toBeNull();
    // wrong store
    expect(await getCustomerBySession(rtWeb._db.db, ctxB.tenantId, token)).toBeNull();

    // suspended customer
    await rt._db.db.update(schema.customers).set({ status: "blocked" }).where(eq(schema.customers.id, customer.id));
    expect(await getCustomerBySession(rtWeb._db.db, ctxA.tenantId, token)).toBeNull();
    await rt._db.db.update(schema.customers).set({ status: "active" }).where(eq(schema.customers.id, customer.id));
    expect(await getCustomerBySession(rtWeb._db.db, ctxA.tenantId, token)).not.toBeNull();

    // expired
    await rt._db.db.update(schema.customerSessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.customerSessions.userId, customer.id));
    expect(await getCustomerBySession(rtWeb._db.db, ctxA.tenantId, token)).toBeNull();

    // signed out
    const second = await login(ctxA.tenantId, "9111111102");
    await destroyCustomerSession(rtWeb._db.db, ctxB.tenantId, second.token); // another store cannot end it
    expect(await getCustomerBySession(rtWeb._db.db, ctxA.tenantId, second.token)).not.toBeNull();
    await destroyCustomerSession(rtWeb._db.db, ctxA.tenantId, second.token);
    expect(await getCustomerBySession(rtWeb._db.db, ctxA.tenantId, second.token)).toBeNull();
  });

  it("keeps the same phone in two stores as two separate customers and sessions", async () => {
    const a = await login(ctxA.tenantId, "9111111103");
    const b = await login(ctxB.tenantId, "9111111103");
    expect(a.customer.id).not.toBe(b.customer.id);
    expect(await getCustomerBySession(rtWeb._db.db, ctxB.tenantId, a.token)).toBeNull();
    expect(await getCustomerBySession(rtWeb._db.db, ctxA.tenantId, b.token)).toBeNull();
  });
});

describe("account: profile, addresses, orders", () => {
  it("updates the profile and keeps the email unique within the store only", async () => {
    const a1 = await login(ctxA.tenantId, "9222222201");
    const a2 = await login(ctxA.tenantId, "9222222202");
    const b1 = await login(ctxB.tenantId, "9222222201");

    const p = await updateCustomerProfile(rtWeb._db.db, ctxA.tenantId, a1.customer.id, { name: " Dev ", email: "Dev@Scp.example", acceptsMarketing: true });
    expect(p).toMatchObject({ name: "Dev", email: "dev@scp.example", acceptsMarketing: true, emailIsPlaceholder: false });
    expect((await getCustomerProfile(rtWeb._db.db, ctxA.tenantId, a1.customer.id))?.emailIsPlaceholder).toBe(false);
    expect((await getCustomerProfile(rtWeb._db.db, ctxA.tenantId, a2.customer.id))?.emailIsPlaceholder).toBe(true);

    expect(await errorOf(updateCustomerProfile(rtWeb._db.db, ctxA.tenantId, a2.customer.id, { name: "X", email: "dev@scp.example", acceptsMarketing: false }))).toMatch(/Conflict/);
    expect(await errorOf(updateCustomerProfile(rtWeb._db.db, ctxA.tenantId, a2.customer.id, { name: "X", email: "nope", acceptsMarketing: false }))).toMatch(/Bad Request/);
    // same email in another store is fine
    await updateCustomerProfile(rtWeb._db.db, ctxB.tenantId, b1.customer.id, { name: "Dev B", email: "dev@scp.example", acceptsMarketing: false });

    // isolation: A's customer id under B's tenant gives nothing and changes nothing
    expect(await getCustomerProfile(rtWeb._db.db, ctxB.tenantId, a1.customer.id)).toBeNull();
    expect(await updateCustomerProfile(rtWeb._db.db, ctxB.tenantId, a1.customer.id, { name: "Hacked", email: "h@scp.example", acceptsMarketing: false })).toBeNull();
    expect((await getCustomerProfile(rtWeb._db.db, ctxA.tenantId, a1.customer.id))?.name).toBe("Dev");
  });

  it("edits a saved address and keeps one default; other customers and stores cannot touch it", async () => {
    const me = await login(ctxA.tenantId, "9222222203");
    const other = await login(ctxA.tenantId, "9222222204");
    const input = { name: "Me", phone: "9222222203", line1: "1 A St", city: "Pune", stateCode: "MH", pincode: "411001" };
    const first = await createCustomerAddress(rtWeb._db.db, ctxA.tenantId, me.customer.id, { ...input, isDefault: true });
    const second = await createCustomerAddress(rtWeb._db.db, ctxA.tenantId, me.customer.id, input);

    const edited = await updateCustomerAddress(rtWeb._db.db, ctxA.tenantId, me.customer.id, second.id, { ...input, line1: "2 B St", isDefault: true });
    expect(edited).toMatchObject({ line1: "2 B St", isDefault: true });
    const all = await getCustomerAddresses(rtWeb._db.db, ctxA.tenantId, me.customer.id);
    expect(all.filter((a) => a.isDefault).map((a) => a.id)).toEqual([second.id]);
    expect(all.find((a) => a.id === first.id)?.isDefault).toBe(false);

    expect(await updateCustomerAddress(rtWeb._db.db, ctxA.tenantId, other.customer.id, first.id, { ...input, line1: "stolen" })).toBeNull();
    expect(await updateCustomerAddress(rtWeb._db.db, ctxB.tenantId, me.customer.id, first.id, { ...input, line1: "stolen" })).toBeNull();
    expect((await getCustomerAddresses(rtWeb._db.db, ctxA.tenantId, me.customer.id)).find((a) => a.id === first.id)?.line1).toBe("1 A St");
  });

  it("lists orders by account or by the verified phone, and mints a tracking link only for owned orders", async () => {
    const phone = "9222222205";
    const placed = await place(phone);
    const stranger = await place("9222222299");
    const me = await login(ctxA.tenantId, phone);
    const otherStore = await login(ctxB.tenantId, phone);

    const list = await getCustomerOrders(rtWeb._db.db, ctxA.tenantId, me.customer.id);
    expect(list.map((o) => o.id)).toEqual([placed.orderId]);
    expect(await getCustomerOrders(rtWeb._db.db, ctxB.tenantId, otherStore.customer.id)).toEqual([]);
    expect((await getCustomerOrderDetail(rtWeb._db.db, ctxA.tenantId, me.customer.id, placed.orderId))?.items).toHaveLength(1);
    expect(await getCustomerOrderDetail(rtWeb._db.db, ctxA.tenantId, me.customer.id, stranger.orderId)).toBeNull();
    expect(await getCustomerOrderDetail(rtWeb._db.db, ctxB.tenantId, otherStore.customer.id, placed.orderId)).toBeNull();

    const token = await mintOrderViewTokenForCustomer(rtWeb._db.db, ctxA.tenantId, me.customer.id, placed.orderId);
    expect(token).toMatch(/^ord_/);
    expect((await getOrderByActionToken(rtWeb._db.db, ctxA.tenantId, token!))?.id).toBe(placed.orderId);
    expect(await mintOrderViewTokenForCustomer(rtWeb._db.db, ctxA.tenantId, me.customer.id, stranger.orderId)).toBeNull();
    expect(await mintOrderViewTokenForCustomer(rtWeb._db.db, ctxB.tenantId, otherStore.customer.id, placed.orderId)).toBeNull();
  });

  it("does not hand an unverified-phone customer another person's guest orders", async () => {
    const phone = "9222222206";
    const placed = await place(phone);
    // A customer row that never proved the phone (e.g. created by an admin) only sees orders linked to it.
    const [c] = await rt._db.db
      .insert(schema.customers)
      .values({ tenantId: ctxA.tenantId, phone, email: "unverified@scp.example", name: "U", phoneVerified: false })
      .returning();
    expect(await getCustomerOrders(rtWeb._db.db, ctxA.tenantId, c!.id)).toEqual([]);
    expect(placed.orderId).toBeDefined();
  });
});
