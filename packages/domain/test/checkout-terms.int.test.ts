import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { SYSTEM_STORE_ROLES } from "@bs/auth";
import { schema, withTenant } from "@bs/db";
import {
  createRuntime,
  placeOrder,
  provisionTenant,
  publishPolicy,
  savePolicyDraft,
  updateCheckoutSettings,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";
import { addToCart, getOrCreateCart } from "../src/storefront/cart.ts";

// Terms agreement at checkout, against a real database: the server refuses an order without consent, an accepted
// order records the time and the exact Terms version, and a republished Terms does not rewrite older orders.
let env: TestDb;
let rtPlatform: Runtime;
let rtWeb: Runtime;
let tenantId: string;
let variantId: string;
let owner: TenantContext;
let shopper: TenantContext;
let cartCounter = 0;

async function publishTerms(text: string): Promise<string> {
  await savePolicyDraft(rtWeb, owner, { handle: "terms", title: "Terms and Conditions", content: { v: 1, blocks: [{ type: "paragraph", text }] } });
  const pub = await publishPolicy(rtWeb, owner, "terms");
  return pub.publishedVersion!.id;
}

async function order(termsConsent: boolean | undefined) {
  const token = `terms-cart-${Date.now()}-${cartCounter++}`;
  const cart = await getOrCreateCart(rtWeb, shopper, token);
  await addToCart(rtWeb, shopper, { token: cart.token, variantId, quantity: 1 });
  return placeOrder(rtWeb, shopper, {
    cartToken: cart.token,
    email: "terms-buyer@example.com",
    phone: "9876543210",
    fullName: "Terms Buyer",
    addressLine1: "1 Test Street",
    city: "Mumbai",
    state: "Maharashtra",
    pincode: "400001",
    paymentMethod: "cod" as const,
    termsConsent,
  });
}

async function termsOf(orderId: string) {
  const [row] = await withTenant(rtWeb._db.db, tenantId, (tx) =>
    tx
      .select({ at: schema.orders.termsAcceptedAt, version: schema.orders.termsPolicyVersionId })
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId)),
  );
  return row!;
}

beforeAll(async () => {
  env = await startTestDb();
  rtPlatform = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  rtWeb = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5 });
  const slug = `terms-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const t = await provisionTenant(rtPlatform, { storeName: slug, slug, owner: { email: `owner@${slug}.test`, name: "Owner" }, planCode: "starter", source: "platform_admin" });
  tenantId = t.tenantId;
  owner = {
    tenantId,
    storeStatus: "live",
    actor: { type: "staff", userId: t.ownerId },
    roles: ["store_owner"],
    permissions: [...SYSTEM_STORE_ROLES.store_owner],
    requestId: "req-terms",
  };
  shopper = { tenantId, storeStatus: "live", actor: { type: "system" }, roles: ["store_admin"], permissions: ["products.read"], requestId: "req-terms-shopper" };

  await withTenant(rtWeb._db.db, tenantId, async (tx) => {
    const [p] = await tx.insert(schema.products).values({ tenantId, title: "Terms Tee", slug: "terms-tee", status: "active" }).returning();
    const [v] = await tx.insert(schema.variants).values({ tenantId, productId: p!.id, title: "M", sku: "TERMS-1", price: 49900n }).returning();
    variantId = v!.id;
    const locs = await tx.select().from(schema.locations).where(eq(schema.locations.tenantId, tenantId));
    for (const loc of locs) await tx.insert(schema.inventoryLevels).values({ tenantId, variantId, locationId: loc.id, onHand: 50, reserved: 0 });
  });
}, 180_000);

afterAll(async () => {
  await rtWeb?.close();
  await rtPlatform?.close();
  await env?.stop();
});

describe("Terms agreement at checkout", () => {
  it("without the setting, an order needs no consent and records none", async () => {
    const res = await order(undefined);
    const row = await termsOf(res.orderId);
    expect(row.at).toBeNull();
    expect(row.version).toBeNull();
  });

  it("refuses to turn the setting on until a Terms policy is published", async () => {
    await expect(updateCheckoutSettings(rtWeb, owner, { termsConsent: { enabled: true } })).rejects.toThrow(/^Precondition: .*publish your Terms policy/i);
  });

  it("with the setting on, refuses an order without consent and creates no order", async () => {
    const v1 = await publishTerms("Terms version one.");
    await updateCheckoutSettings(rtWeb, owner, { termsConsent: { enabled: true } });

    const before = await withTenant(rtWeb._db.db, tenantId, (tx) => tx.select({ id: schema.orders.id }).from(schema.orders));
    await expect(order(undefined)).rejects.toThrow(/must agree to the Terms of Service/);
    await expect(order(false)).rejects.toThrow(/must agree to the Terms of Service/);
    const after = await withTenant(rtWeb._db.db, tenantId, (tx) => tx.select({ id: schema.orders.id }).from(schema.orders));
    expect(after.length).toBe(before.length);

    const accepted = await order(true);
    const row = await termsOf(accepted.orderId);
    expect(row.at).not.toBeNull();
    expect(row.version).toBe(v1);
  });

  it("a republished Terms applies to new orders only; older orders keep the version they accepted", async () => {
    const firstAccepted = await order(true);
    const firstVersion = (await termsOf(firstAccepted.orderId)).version;

    const v2 = await publishTerms("Terms version two, reworded.");
    expect(v2).not.toBe(firstVersion);
    const secondAccepted = await order(true);

    expect((await termsOf(secondAccepted.orderId)).version).toBe(v2);
    expect((await termsOf(firstAccepted.orderId)).version).toBe(firstVersion);
  });

  it("switching the setting off removes the requirement again", async () => {
    await updateCheckoutSettings(rtWeb, owner, { termsConsent: { enabled: false } });
    const res = await order(undefined);
    expect((await termsOf(res.orderId)).at).toBeNull();
  });
});
