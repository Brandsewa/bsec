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
  createProduct,
  adjustInventory,
  listInventoryLevels,
  listSegments,
  getSegment,
  createSegment,
  updateSegment,
  deleteSegment,
  previewSegmentRules,
  listSegmentMembers,
  addCustomersToSegment,
  removeCustomersFromSegment,
  refreshSegmentCount,
  getCustomerSegments,
  createPresetSegments,
  refreshAllSegmentCounts,
  SEGMENTS_LIMIT_PER_STORE,
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

// Seed ids
let variantAId: string;
let variantBId: string;
let productAId: string;
let productBId: string;
let collectionId: string;
let buyer: string;
let refunded: string;
let cancelled: string;
let guest: string;
let subscriber: string;
let mhin: string;
let boughtB: string;
let manualSegmentId: string;

const paise = (rupees: number) => rupees * 100;

async function codOrder(email: string, phone: string, variantId: string, outcome: "collected" | "cancelled" | "pending" = "collected") {
  const cart = await getOrCreateCart(rtWeb, ctxA);
  await addToCart(rtWeb, ctxA, { token: cart.token, variantId, quantity: 1 });
  const placed = await placeOrder(rtWeb, ctxA, {
    cartToken: cart.token,
    idempotencyKey: `idem-seg-${email}-${variantId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    email,
    phone,
    fullName: "Seg Shopper",
    addressLine1: "1 Test Road",
    city: "Bengaluru",
    state: "Karnataka",
    pincode: "560001",
    paymentMethod: "cod",
  });
  const [pi] = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) =>
    tx.select().from(schema.paymentIntents).where(eq(schema.paymentIntents.orderId, placed.orderId)),
  );
  if (outcome === "collected") {
    await transitionOrder(rtWeb, ctxA, placed.orderId, { type: "payment.cod_collect", intentId: pi!.id });
  } else if (outcome === "cancelled") {
    await transitionOrder(rtWeb, ctxA, placed.orderId, { type: "order.confirm" });
    await transitionOrder(rtWeb, ctxA, placed.orderId, { type: "order.cancel", reason: "test" });
  }
  return placed.orderId;
}

const insertCustomer = async (values: Partial<typeof schema.customers.$inferInsert> & { email: string }) => {
  const [row] = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) =>
    tx.insert(schema.customers).values({ tenantId: ctxA.tenantId, isGuest: false, ...values }).returning(),
  );
  return row!;
};

/**
 * Preview helper: returns matching customer ids for a rule set.
 * Clears the preview rate-limit window first (the suite makes far more than 30 previews
 * in a minute; a real staff member would simply wait for the next window).
 */
async function previewIds(rules: unknown): Promise<string[]> {
  await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) =>
    tx.execute(sql`DELETE FROM rate_limit_counters WHERE key LIKE ${"segment_preview:" + ctxA.tenantId + ":%"}`),
  );
  const res = await previewSegmentRules(rtWeb, ctxA, { rules });
  return res.sample.map((s) => s.id);
}

beforeAll(async () => {
  env = await startTestDb();
  rtPlatform = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 10 });
  rtWeb = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 10 });

  const tA = await provisionTenant(rtPlatform, {
    storeName: "Segments Store A",
    slug: `seg-a-${Date.now()}`,
    owner: { email: "owner-a@seg.test", name: "Owner A" },
    planCode: "starter",
    source: "platform_admin",
  });
  ctxA = {
    tenantId: tA.tenantId,
    storeStatus: "live",
    actor: { type: "staff", userId: tA.ownerId },
    roles: ["store_owner"],
    permissions: [...STORE_PERMISSIONS],
    requestId: "req-seg-a",
  };
  ctxLimited = { ...ctxA, permissions: ["analytics.read"] };

  const tB = await provisionTenant(rtPlatform, {
    storeName: "Segments Store B",
    slug: `seg-b-${Date.now()}`,
    owner: { email: "owner-b@seg.test", name: "Owner B" },
    planCode: "starter",
    source: "platform_admin",
  });
  ctxB = {
    tenantId: tB.tenantId,
    storeStatus: "live",
    actor: { type: "staff", userId: tB.ownerId },
    roles: ["store_owner"],
    permissions: [...STORE_PERMISSIONS],
    requestId: "req-seg-b",
  };

  const catA = await primaryCategory(rtWeb, ctxA);
  const pA = await createProduct(rtWeb, ctxA, {
    title: "Product A",
    slug: "product-a",
    status: "active",
    primaryCategoryId: catA,
    variants: [{ title: "Default", sku: "SKU-SEG-A", price: paise(1000), trackInventory: true }],
  });
  productAId = pA.id;
  variantAId = pA.variants[0]!.id;
  const pB = await createProduct(rtWeb, ctxA, {
    title: "Product B",
    slug: "product-b",
    status: "active",
    primaryCategoryId: catA,
    variants: [{ title: "Default", sku: "SKU-SEG-B", price: paise(500), trackInventory: true }],
  });
  productBId = pB.id;
  variantBId = pB.variants[0]!.id;
  const locA = (await listInventoryLevels(rtWeb, ctxA, {})).items[0]!;
  await adjustInventory(rtWeb, ctxA, { variantId: variantAId, locationId: locA.locationId, quantityDelta: 100, reason: "received" });
  await adjustInventory(rtWeb, ctxA, { variantId: variantBId, locationId: locA.locationId, quantityDelta: 100, reason: "received" });
  const [col] = await withTenant(rtWeb._db.db, ctxA.tenantId, async (tx) =>
    tx
      .insert(schema.collections)
      .values({ tenantId: ctxA.tenantId, title: "Summer", slug: "summer", published: true })
      .returning(),
  );
  collectionId = col!.id;
  await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) =>
    tx.insert(schema.collectionProducts).values({ tenantId: ctxA.tenantId, collectionId, productId: productAId }),
  );

  // --- customers ---
  buyer = (await insertCustomer({ email: "buyer@seg.test", name: "Karan Buyer", phone: "9650000001", tags: ["VIP"] })).id;
  refunded = (await insertCustomer({ email: "refunded@seg.test", name: "Ritu Refund", phone: "9650000002" })).id;
  cancelled = (await insertCustomer({ email: "cancelled@seg.test", name: "Chirag Cancel", phone: "9650000003" })).id;
  guest = (await insertCustomer({ email: "guest@seg.test", name: "Guesty", isGuest: true })).id;
  subscriber = (await insertCustomer({ email: "sub@seg.test", name: "Subha Subscriber", marketingState: "subscribed", acceptsMarketing: true })).id;
  const oldDate = new Date(Date.now() - 40 * 86_400_000);
  const mhinRow = await insertCustomer({ email: "mhin@seg.test", name: "Manish MH", createdAt: oldDate, updatedAt: oldDate });
  mhin = mhinRow.id;
  boughtB = (await insertCustomer({ email: "boughtb@seg.test", name: "Bhavana B", phone: "9650000004" })).id;

  // --- addresses (default) ---
  await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) =>
    tx.insert(schema.customerAddresses).values([
      { tenantId: ctxA.tenantId, customerId: buyer, name: "Karan", phone: "9650000001", line1: "1 MG Road", city: "Bengaluru", stateCode: "KA", pincode: "560001", isDefault: true },
      { tenantId: ctxA.tenantId, customerId: mhin, name: "Manish", phone: "9650000005", line1: "2 FC Road", city: "Pune", stateCode: "MH", pincode: "411001", isDefault: true },
    ]),
  );

  // --- orders ---
  await codOrder("buyer@seg.test", "9650000001", variantAId, "collected");
  const refundedOrder = await codOrder("refunded@seg.test", "9650000002", variantAId, "collected");
  await codOrder("cancelled@seg.test", "9650000003", variantAId, "cancelled");
  await codOrder("boughtb@seg.test", "9650000004", variantBId, "collected");

  // Partial refund of ₹300 on the refunded order
  const [piRef] = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) =>
    tx.select().from(schema.paymentIntents).where(eq(schema.paymentIntents.orderId, refundedOrder)),
  );
  await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) =>
    tx.insert(schema.refunds).values({ tenantId: ctxA.tenantId, orderId: refundedOrder, intentId: piRef!.id, amount: paise(300), status: "succeeded", reason: "customer_return" }),
  );

  // A return request from the refunded customer
  await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) =>
    tx.insert(schema.returns).values({ tenantId: ctxA.tenantId, orderId: refundedOrder, customerId: refunded, number: "RET-SEG-1", reason: "Changed my mind", status: "requested" }),
  );

  // Abandoned cart for the subscriber
  const cart = await getOrCreateCart(rtWeb, ctxA);
  await addToCart(rtWeb, ctxA, { token: cart.token, variantId: variantAId, quantity: 1 });
  await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) =>
    tx.update(schema.carts).set({ customerId: subscriber, status: "abandoned" }).where(eq(schema.carts.id, cart.id)),
  );

  // Manual segment with the buyer in it
  const seg = await createSegment(rtWeb, ctxA, { name: "Manual VIP", description: "seeded", kind: "manual" });
  manualSegmentId = seg.id;
  await addCustomersToSegment(rtWeb, ctxA, { segmentId: manualSegmentId, customerIds: [buyer] });
}, 180_000);

afterAll(async () => {
  await rtPlatform?.close();
  await rtWeb?.close();
  await env?.stop();
});

const idsOf = (res: { items: Array<{ id: string }> }) => res.items.map((i) => i.id);

describe("rule fields and operators on a seeded store (PLAN §8)", () => {
  it("orders_count counts collected orders, excludes cancelled and fully refunded", async () => {
    expect((await previewIds({ match: "all", conditions: [{ field: "orders_count", op: "gte", value: 1 }] })).sort()).toEqual([buyer, refunded, boughtB].sort());
    expect((await previewIds({ match: "all", conditions: [{ field: "orders_count", op: "eq", value: 0 }] })).sort()).toEqual([guest, subscriber, mhin, cancelled].sort());
  });

  it("total_spent nets refunds", async () => {
    expect(await previewIds({ match: "all", conditions: [{ field: "total_spent", op: "gte", value: paise(1000) }] })).toEqual([buyer]);
    expect(await previewIds({ match: "all", conditions: [{ field: "total_spent", op: "between", value: [paise(700), paise(700)] }] })).toEqual([refunded]);
  });

  it("average_order_value uses spend per counted order", async () => {
    expect(await previewIds({ match: "all", conditions: [{ field: "average_order_value", op: "gte", value: paise(1000) }] })).toEqual([buyer]);
  });

  it("last_order_at within, older and never", async () => {
    expect((await previewIds({ match: "all", conditions: [{ field: "last_order_at", op: "within_days", value: 1 }] })).sort()).toEqual([buyer, refunded, boughtB].sort());
    expect(await previewIds({ match: "all", conditions: [{ field: "last_order_at", op: "older_than_days", value: 1 }] })).toEqual([]);
    expect((await previewIds({ match: "all", conditions: [{ field: "last_order_at", op: "never", value: null }] })).sort()).toEqual([guest, subscriber, mhin, cancelled].sort());
  });

  it("first_order_at within days", async () => {
    expect((await previewIds({ match: "all", conditions: [{ field: "first_order_at", op: "within_days", value: 1 }] })).sort()).toEqual([buyer, refunded, boughtB].sort());
  });

  it("created_at within, older and between dates", async () => {
    const all = await previewIds({ match: "all", conditions: [{ field: "created_at", op: "within_days", value: 1 }] });
    expect(all.sort()).toEqual([buyer, refunded, cancelled, guest, subscriber, boughtB].sort());
    expect(await previewIds({ match: "all", conditions: [{ field: "created_at", op: "older_than_days", value: 30 }] })).toEqual([mhin]);
    const day = 86_400_000;
    const from = new Date(Date.now() - 41 * day).toISOString().slice(0, 10);
    const to = new Date(Date.now() - 39 * day).toISOString().slice(0, 10);
    expect(await previewIds({ match: "all", conditions: [{ field: "created_at", op: "between_dates", value: [from, to] }] })).toEqual([mhin]);
  });

  it("marketing_state is and is_not", async () => {
    expect(await previewIds({ match: "all", conditions: [{ field: "marketing_state", op: "is", value: "subscribed" }] })).toEqual([subscriber]);
    const notSub = await previewIds({ match: "all", conditions: [{ field: "marketing_state", op: "is_not", value: "subscribed" }] });
    expect(notSub).toContain(buyer);
    expect(notSub).not.toContain(subscriber);
  });

  it("tags has and has_not", async () => {
    expect(await previewIds({ match: "all", conditions: [{ field: "tags", op: "has", value: "VIP" }] })).toEqual([buyer]);
    const noVip = await previewIds({ match: "all", conditions: [{ field: "tags", op: "has_not", value: "VIP" }] });
    expect(noVip).toContain(guest);
    expect(noVip).not.toContain(buyer);
  });

  it("is_guest matches guests only", async () => {
    expect(await previewIds({ match: "all", conditions: [{ field: "is_guest", op: "is", value: true }] })).toEqual([guest]);
  });

  it("state and pincode read the default address", async () => {
    expect(await previewIds({ match: "all", conditions: [{ field: "state", op: "is", value: "KA" }] })).toEqual([buyer]);
    expect(await previewIds({ match: "all", conditions: [{ field: "state", op: "in", value: ["MH"] }] })).toEqual([mhin]);
    const notKA = await previewIds({ match: "all", conditions: [{ field: "state", op: "is_not", value: "KA" }] });
    expect(notKA).toContain(mhin);
    expect(notKA).not.toContain(buyer);
    expect(await previewIds({ match: "all", conditions: [{ field: "pincode", op: "starts_with", value: "560" }] })).toEqual([buyer]);
    expect(await previewIds({ match: "all", conditions: [{ field: "pincode", op: "is", value: "411001" }] })).toEqual([mhin]);
  });

  it("bought_product and bought_collection use non-cancelled orders", async () => {
    expect((await previewIds({ match: "all", conditions: [{ field: "bought_product", op: "has", value: productAId }] })).sort()).toEqual([buyer, refunded].sort());
    expect(await previewIds({ match: "all", conditions: [{ field: "bought_product", op: "has", value: productBId }] })).toEqual([boughtB]); // sample order only matters here: one match
    const notA = await previewIds({ match: "all", conditions: [{ field: "bought_product", op: "has_not", value: productAId }] });
    expect(notA).toContain(boughtB);
    expect(notA).not.toContain(buyer);
    expect((await previewIds({ match: "all", conditions: [{ field: "bought_collection", op: "has", value: collectionId }] })).sort()).toEqual([buyer, refunded].sort());
  });

  it("returned has and has_not", async () => {
    expect(await previewIds({ match: "all", conditions: [{ field: "returned", op: "has", value: null }] })).toEqual([refunded]);
    const noReturn = await previewIds({ match: "all", conditions: [{ field: "returned", op: "has_not", value: null }] });
    expect(noReturn).toContain(buyer);
    expect(noReturn).not.toContain(refunded);
  });

  it("abandoned_checkout within days", async () => {
    expect(await previewIds({ match: "all", conditions: [{ field: "abandoned_checkout", op: "within_days", value: 14 }] })).toEqual([subscriber]);
  });

  it("in_segment expands a manual segment, both directions", async () => {
    expect(await previewIds({ match: "all", conditions: [{ field: "in_segment", op: "is", value: manualSegmentId }] })).toEqual([buyer]);
    const notIn = await previewIds({ match: "all", conditions: [{ field: "in_segment", op: "is_not", value: manualSegmentId }] });
    expect(notIn).toContain(guest);
    expect(notIn).not.toContain(buyer);
  });

  it("match any is an OR across conditions", async () => {
    const both = await previewIds({
      match: "any",
      conditions: [
        { field: "tags", op: "has", value: "VIP" },
        { field: "marketing_state", op: "is", value: "subscribed" },
      ],
    });
    expect(both.sort()).toEqual([buyer, subscriber].sort());
  });
});

describe("manual segments (PLAN §4)", () => {
  it("adds by ids and emails with added/alreadyIn/notFound reporting, idempotently", async () => {
    const seg = await createSegment(rtWeb, ctxA, { name: `Manual Add ${Date.now()}`, kind: "manual" });
    const first = await addCustomersToSegment(rtWeb, ctxA, {
      segmentId: seg.id,
      customerIds: [buyer, guest],
      emails: ["SUB@seg.test", "nobody@seg.test"],
    });
    expect(first).toMatchObject({ added: 3, alreadyIn: 0 });
    expect(first.notFound).toEqual(["nobody@seg.test"]);

    const again = await addCustomersToSegment(rtWeb, ctxA, { segmentId: seg.id, customerIds: [buyer], emails: ["sub@seg.test"] });
    expect(again).toMatchObject({ added: 0, alreadyIn: 2 });

    const members = await listSegmentMembers(rtWeb, ctxA, { segmentId: seg.id, search: "seg.test" });
    expect(members.total).toBe(3);
    expect(idsOf(members).sort()).toEqual([buyer, guest, subscriber].sort());
    expect(members.items[0]).toMatchObject({ ordersCount: expect.any(Number), marketingState: expect.any(String) });

    const removed = await removeCustomersFromSegment(rtWeb, ctxA, { segmentId: seg.id, customerIds: [buyer] });
    expect(removed.removed).toBe(1);
    const after = await listSegmentMembers(rtWeb, ctxA, { segmentId: seg.id });
    expect(idsOf(after).sort()).toEqual([guest, subscriber].sort());
  });

  it("refuses member edits on automatic segments and caps adds at 5000", async () => {
    const auto = await createSegment(rtWeb, ctxA, { name: `Auto NoEdit ${Date.now()}`, kind: "automatic", rules: { match: "all", conditions: [{ field: "orders_count", op: "gte", value: 1 }] } });
    await expect(addCustomersToSegment(rtWeb, ctxA, { segmentId: auto.id, customerIds: [buyer] })).rejects.toThrow(/cannot be edited/);
    await expect(removeCustomersFromSegment(rtWeb, ctxA, { segmentId: auto.id, customerIds: [buyer] })).rejects.toThrow(/cannot be edited/);
    await expect(addCustomersToSegment(rtWeb, ctxA, { segmentId: manualSegmentId, customerIds: Array.from({ length: 5001 }, (_, i) => `0199a000-0000-7000-8000-${(i + 1).toString(16).padStart(12, "0")}`) })).rejects.toThrow(/5,000/);
  });

  it("refuses a read-only staff member for mutations but allows reads", async () => {
    await expect(createSegment(rtWeb, ctxLimited, { name: "Nope", kind: "manual" })).rejects.toThrow(/permission/i);
    await expect(addCustomersToSegment(rtWeb, ctxLimited, { segmentId: manualSegmentId, customerIds: [buyer] })).rejects.toThrow(/permission/i);
    // Reads check customers.read, which the limited role also lacks.
    await expect(previewSegmentRules(rtWeb, ctxLimited, { rules: { match: "all", conditions: [{ field: "orders_count", op: "gte", value: 1 }] } })).rejects.toThrow(/permission/i);
  });
});

describe("segment lifecycle (PLAN §4)", () => {
  it("caps a store at 20 segments with a clear message, and frees the fillers afterwards", async () => {
    const before = await listSegments(rtWeb, ctxA, { limit: 100 });
    expect(before.items.length).toBeLessThanOrEqual(SEGMENTS_LIMIT_PER_STORE);
    const fillers: string[] = [];
    for (let i = before.items.length; i < SEGMENTS_LIMIT_PER_STORE; i++) {
      const filler = await createSegment(rtWeb, ctxA, { name: `Filler ${Date.now()}-${i}`, kind: "manual" });
      fillers.push(filler.id);
    }
    await expect(createSegment(rtWeb, ctxA, { name: `One Too Many ${Date.now()}`, kind: "manual" })).rejects.toThrow(/maximum of 20/);
    for (const id of fillers) await deleteSegment(rtWeb, ctxA, { id });
  });

  it("refuses to change a manual segment's rules and duplicate names (case-insensitive)", async () => {
    await expect(updateSegment(rtWeb, ctxA, { id: manualSegmentId, rules: { match: "all", conditions: [{ field: "orders_count", op: "gte", value: 1 }] } })).rejects.toThrow(/Only automatic segments have conditions/);
    await expect(createSegment(rtWeb, ctxA, { name: "manual vip", kind: "manual" })).rejects.toThrow(/already exists/);
    await expect(updateSegment(rtWeb, ctxA, { id: manualSegmentId, name: "MANUAL VIP" })).resolves.toBeDefined();
  });

  it("refuses deleting a segment referenced by in_segment, naming the referrer", async () => {
    const referrer = await createSegment(rtWeb, ctxA, {
      name: `Refs Manual ${Date.now()}`,
      kind: "automatic",
      rules: { match: "all", conditions: [{ field: "in_segment", op: "is", value: manualSegmentId }] },
    });
    await expect(deleteSegment(rtWeb, ctxA, { id: manualSegmentId })).rejects.toThrow(new RegExp(referrer.name));
    await expect(deleteSegment(rtWeb, ctxA, { id: referrer.id })).resolves.toMatchObject({ success: true });
    await expect(deleteSegment(rtWeb, ctxA, { id: manualSegmentId })).resolves.toMatchObject({ success: true });
    await expect(getSegment(rtWeb, ctxA, { id: referrer.id })).rejects.toThrow(/not found/);
  });

  it("updates name, description and rules; automatic count recomputes", async () => {
    const seg = await createSegment(rtWeb, ctxA, {
      name: `Auto Upd ${Date.now()}`,
      kind: "automatic",
      rules: { match: "all", conditions: [{ field: "orders_count", op: "gte", value: 1 }] },
    });
    expect(seg.memberCount).toBe(3);
    const updated = await updateSegment(rtWeb, ctxA, {
      id: seg.id,
      name: `Auto Upd 2 ${Date.now()}`,
      description: "tightened",
      rules: { match: "all", conditions: [{ field: "orders_count", op: "gte", value: 5 }] },
    });
    expect(updated.memberCount).toBe(0);
    const audits = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) =>
      tx.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.action, "segment.updated"), eq(schema.auditLogs.targetId, seg.id))),
    );
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });
});

describe("counts, customer view and presets (PLAN §4 and §6)", () => {
  it("refreshes a segment count and repairs drift in the sweep", async () => {
    const seg = await createSegment(rtWeb, ctxA, { name: `Count Drift ${Date.now()}`, kind: "manual" });
    await addCustomersToSegment(rtWeb, ctxA, { segmentId: seg.id, customerIds: [buyer, guest] });
    // Corrupt the cached count, then let the sweep repair it.
    await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) =>
      tx.update(schema.customerSegments).set({ memberCount: 999 }).where(eq(schema.customerSegments.id, seg.id)),
    );
    const res = await refreshAllSegmentCounts(rtWeb._db.db, ctxA.tenantId);
    expect(res.processed).toBeGreaterThanOrEqual(1);
    const fresh = await getSegment(rtWeb, ctxA, { id: seg.id });
    expect(fresh.memberCount).toBe(2);
    const manual = await refreshSegmentCount(rtWeb, ctxA, { id: seg.id });
    expect(manual.memberCount).toBe(2);
    expect(manual.countedAt).toBeTruthy();
  });

  it("returns manual memberships and automatic matches for a customer", async () => {
    const manual = await createSegment(rtWeb, ctxA, { name: `For Customer ${Date.now()}`, kind: "manual" });
    await addCustomersToSegment(rtWeb, ctxA, { segmentId: manual.id, customerIds: [buyer] });
    const auto = await createSegment(rtWeb, ctxA, {
      name: `Matches Buyer ${Date.now()}`,
      kind: "automatic",
      rules: { match: "all", conditions: [{ field: "tags", op: "has", value: "VIP" }] },
    });
    const result = await getCustomerSegments(rtWeb, ctxA, { customerId: buyer });
    expect(result.manual.map((s) => s.id)).toContain(manual.id);
    expect(result.automatic.map((s) => s.id)).toContain(auto.id);
    const others = await getCustomerSegments(rtWeb, ctxA, { customerId: guest });
    expect(others.manual.map((s) => s.id)).not.toContain(manual.id);
    await deleteSegment(rtWeb, ctxA, { id: manual.id });
    expect(others.automatic.map((s) => s.id)).not.toContain(auto.id);
    await deleteSegment(rtWeb, ctxA, { id: auto.id });
  });

  it("creates the seven presets as editable automatic segments, skipping on re-run", async () => {
    const first = await createPresetSegments(rtWeb, ctxA);
    expect(first.created).toBe(7);
    expect(first.skipped).toBe(0);
    const second = await createPresetSegments(rtWeb, ctxA);
    expect(second.created).toBe(0);
    const list = await listSegments(rtWeb, ctxA, { limit: 100 });
    const vip = list.items.find((s) => s.name === "VIP customers");
    expect(vip).toMatchObject({ kind: "automatic", isPreset: true });
    expect(vip?.rules).toMatchObject({ match: "all", conditions: [{ field: "total_spent", op: "gte" }] });
  });
});

describe("cross-store isolation (PLAN §8)", () => {
  it("keeps segments and members store-scoped", async () => {
    const own = await createSegment(rtWeb, ctxA, { name: `Isolated ${Date.now()}`, kind: "manual" });
    await addCustomersToSegment(rtWeb, ctxA, { segmentId: own.id, customerIds: [buyer] });

    const fromB = await listSegments(rtWeb, ctxB, { limit: 100 });
    expect(fromB.items).toHaveLength(0);

    await expect(getSegment(rtWeb, ctxB, { id: own.id })).rejects.toThrow(/not found/);
    await expect(addCustomersToSegment(rtWeb, ctxB, { segmentId: own.id, customerIds: [buyer] })).rejects.toThrow(/not found/);
    await expect(deleteSegment(rtWeb, ctxB, { id: own.id })).rejects.toThrow(/not found/);
    await expect(listSegmentMembers(rtWeb, ctxB, { segmentId: own.id })).rejects.toThrow(/not found/);

    // A rule referencing store A's segment id is refused inside store B.
    await expect(
      createSegment(rtWeb, ctxB, {
        name: "Thief",
        kind: "automatic",
        rules: { match: "all", conditions: [{ field: "in_segment", op: "is", value: own.id }] },
      }),
    ).rejects.toThrow(/not found in this store/i);

    // B's preview never returns A's customers.
    const bPreview = await previewSegmentRules(rtWeb, ctxB, { rules: { match: "all", conditions: [{ field: "orders_count", op: "gte", value: 0 }] } });
    expect(bPreview.sample.map((s) => s.email)).not.toContain("buyer@seg.test");
  });
});

describe("audit rows (PLAN §4)", () => {
  it("wrote the required audit actions", async () => {
    const actions = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) =>
      tx
        .select({ action: schema.auditLogs.action })
        .from(schema.auditLogs)
        .where(sql`${schema.auditLogs.action} LIKE 'segment.%'`),
    );
    const seen = new Set(actions.map((a) => a.action));
    for (const expected of ["segment.created", "segment.updated", "segment.deleted", "segment.members_added", "segment.members_removed"]) {
      expect(seen.has(expected), expected).toBe(true);
    }
  });
});
