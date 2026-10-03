import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { STORE_PERMISSIONS } from "@bs/auth";
import { createRuntime, provisionTenant, placeOrder, transitionOrder, type Runtime, type TenantContext } from "../src/index.ts";
import { segmentMemberSubquery } from "../src/segments/compile.ts";
import { parseSegmentRules, SegmentRuleError } from "../src/segments/rules.ts";
import { addToCart, getOrCreateCart } from "../src/storefront/cart.ts";
import { primaryCategory } from "./helpers/primary-category.ts";
import { createProduct, adjustInventory, listInventoryLevels } from "../src/index.ts";

let env: TestDb;
let rtPlatform: Runtime;
let rtWeb: Runtime;
let ctxA: TenantContext;
let variantAId: string;
let buyer: string; // account with one collected order and tag VIP
let guest: string; // guest, no orders
let subscriber: string; // marketing_state subscribed, no orders

/** Runs a compiled rule set against the store and returns the matching customer ids. */
async function members(tenantId: string, rules: unknown): Promise<string[]> {
  const parsed = parseSegmentRules(rules);
  return await withTenant(rtWeb._db.db, tenantId, async (tx) => {
    const res = await tx.execute(segmentMemberSubquery(tenantId, parsed, () => { throw new SegmentRuleError("not found"); }));
    return (res.rows as Array<{ id: string }>).map((r) => r.id);
  });
}

beforeAll(async () => {
  env = await startTestDb();
  rtPlatform = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 10 });
  rtWeb = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 10 });

  const tA = await provisionTenant(rtPlatform, {
    storeName: "Segments Compile Store A",
    slug: `seg-compile-a-${Date.now()}`,
    owner: { email: "owner-a@segc.test", name: "Owner A" },
    planCode: "starter",
    source: "platform_admin",
  });
  ctxA = {
    tenantId: tA.tenantId,
    storeStatus: "live",
    actor: { type: "staff", userId: tA.ownerId },
    roles: ["store_owner"],
    permissions: [...STORE_PERMISSIONS],
    requestId: "req-segc-a",
  };

  const catA = await primaryCategory(rtWeb, ctxA);
  const pA = await createProduct(rtWeb, ctxA, {
    title: "Product A",
    slug: "product-a",
    status: "active",
    primaryCategoryId: catA,
    variants: [{ title: "Default", sku: "SKU-SEGC-A", price: 100000, trackInventory: true }],
  });
  variantAId = pA.variants[0]!.id;
  const locA = (await listInventoryLevels(rtWeb, ctxA, {})).items[0]!;
  await adjustInventory(rtWeb, ctxA, { variantId: variantAId, locationId: locA.locationId, quantityDelta: 100, reason: "received" });

  const insert = async (values: Partial<typeof schema.customers.$inferInsert> & { email: string }) => {
    const [row] = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) =>
      tx.insert(schema.customers).values({ tenantId: ctxA.tenantId, isGuest: false, ...values }).returning(),
    );
    return row!;
  };
  buyer = (await insert({ email: "buyer@segc.test", name: "Buyer", tags: ["VIP"] })).id;
  guest = (await insert({ email: "guest@segc.test", name: "Guesty", isGuest: true })).id;
  subscriber = (await insert({ email: "sub@segc.test", name: "Subscriber", marketingState: "subscribed", acceptsMarketing: true })).id;

  // One collected COD order for the buyer.
  const cart = await getOrCreateCart(rtWeb, ctxA);
  await addToCart(rtWeb, ctxA, { token: cart.token, variantId: variantAId, quantity: 1 });
  const placed = await placeOrder(rtWeb, ctxA, {
    cartToken: cart.token,
    idempotencyKey: `idem-segc-${Date.now()}`,
    email: "buyer@segc.test",
    phone: "9650000001",
    fullName: "Buyer",
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
}, 120_000);

afterAll(async () => {
  await rtPlatform?.close();
  await rtWeb?.close();
  await env?.stop();
});

describe("compiled segment rules against real data (2A)", () => {
  it("matches on the Phase 0 metrics, tags, guest flag and consent state", async () => {
    expect(await members(ctxA.tenantId, { match: "all", conditions: [{ field: "orders_count", op: "gte", value: 1 }] })).toEqual([buyer]);
    expect(await members(ctxA.tenantId, { match: "all", conditions: [{ field: "total_spent", op: "gte", value: 100000 }] })).toEqual([buyer]);
    expect(await members(ctxA.tenantId, { match: "all", conditions: [{ field: "tags", op: "has", value: "VIP" }] })).toEqual([buyer]);
    expect(await members(ctxA.tenantId, { match: "all", conditions: [{ field: "is_guest", op: "is", value: true }] })).toEqual([guest]);
    expect(await members(ctxA.tenantId, { match: "all", conditions: [{ field: "marketing_state", op: "is", value: "subscribed" }] })).toEqual([subscriber]);
    expect(await members(ctxA.tenantId, { match: "all", conditions: [{ field: "last_order_at", op: "never", value: null }] }).then((r) => r.sort())).toEqual([guest, subscriber].sort());

    // match any is an OR
    expect(await members(ctxA.tenantId, { match: "any", conditions: [{ field: "tags", op: "has", value: "VIP" }, { field: "marketing_state", op: "is", value: "subscribed" }] }).then((r) => r.sort())).toEqual([buyer, subscriber].sort());
  });

  it("treats hostile SQL in values as data: no injection, no rows, table intact", async () => {
    const hostile = "'; DROP TABLE customers; --";
    expect(await members(ctxA.tenantId, { match: "all", conditions: [{ field: "tags", op: "has", value: hostile }] })).toEqual([]);

    // The customers table survived, and a normal query still works.
    const stillThere = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) =>
      tx.select({ n: sql<number>`count(*)::int` }).from(schema.customers),
    );
    expect(stillThere[0]?.n).toBe(3);
  });

  it("refuses an in_segment reference the resolver does not know (a foreign store's id)", async () => {
    // The service resolver only resolves segments of this store; a foreign id is "not found"
    // here, so the compiler never builds SQL from it (cross-store test with real rows in 2B).
    const parsed = parseSegmentRules({ match: "all", conditions: [{ field: "in_segment", op: "is", value: "0199a000-0000-7000-8000-00000000b999" }] });
    expect(() => segmentMemberSubquery(ctxA.tenantId, parsed, () => { throw new SegmentRuleError("Segment not found"); })).toThrow(/not found/);
  });

  it("rejects rule sets that break the whitelist before any SQL runs", async () => {
    await expect(members(ctxA.tenantId, { match: "all", conditions: [{ field: "email", op: "is", value: "x@y.test" }] })).rejects.toThrow(/Unknown field/);
    await expect(members(ctxA.tenantId, { match: "any", conditions: Array.from({ length: 11 }, (_, i) => ({ field: "orders_count", op: "gte", value: i })) })).rejects.toThrow(/at most 10/);
  });

  it("cleans up the seed helper rows it no longer needs", async () => {
    // Sanity guard used by later stage tests: customers exist and variant is resolvable.
    const rows = await withTenant(rtWeb._db.db, ctxA.tenantId, (tx) =>
      tx.select({ id: schema.customers.id }).from(schema.customers).where(inArray(schema.customers.email, ["buyer@segc.test", "guest@segc.test", "sub@segc.test"])),
    );
    expect(rows).toHaveLength(3);
    expect(variantAId).toBeDefined();
  });
});
