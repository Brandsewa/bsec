import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { STORE_PERMISSIONS } from "@bs/auth";
import {
  createAdminDraftOrder,
  createRuntime,
  getStorefrontReviews,
  provisionTenant,
  publishAdminReview,
  submitProductReview,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";
import { createActiveProduct } from "./helpers/factories.ts";
import { RateLimitExceededError } from "../src/system/rate-limit.ts";

/** Real-database checks for reviews: tenant isolation, "verified purchase" proof, moderation, rate limit. */

let env: TestDb;
let rt: Runtime;
let ctxA: TenantContext;
let ctxB: TenantContext;
let productA: string;
let variantA: string;
let orderNumber: string;

const address = { fullName: "Rev Test", line1: "1 Road", city: "Pune", state: "Maharashtra", pincode: "411001" };

async function tenant(label: string) {
  const run = Math.random().toString(36).slice(2, 7);
  const t = await provisionTenant(rt, {
    storeName: `Reviews ${label} ${run}`,
    slug: `reviews-${label}-${run}`,
    owner: { email: `owner-${label}-${run}@reviews.test`, name: "Owner" },
    planCode: "starter",
    source: "platform_admin",
  });
  const ctx: TenantContext = {
    tenantId: t.tenantId,
    storeStatus: "live",
    actor: { type: "staff", userId: t.ownerId },
    roles: ["store_owner"],
    permissions: [...STORE_PERMISSIONS],
    requestId: `req-reviews-${label}`,
  };
  return ctx;
}

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 10 });
  ctxA = await tenant("a");
  ctxB = await tenant("b");
  const p = await createActiveProduct(rt, ctxA, { title: "Reviewed Thing", sku: "REV-1", price: 10000, stock: 20 });
  productA = p.productId;
  variantA = p.variantId;
  const o = await createAdminDraftOrder(rt, ctxA, {
    email: "buyer@reviews.test",
    phone: "9800000002",
    shippingAddress: address,
    items: [{ variantId: variantA, quantity: 1 }],
    paymentOutcome: "cod",
  });
  await withTenant(rt._db.db, ctxA.tenantId, (tx) => tx.update(schema.orders).set({ fulfillmentStatus: "delivered" }).where(eq(schema.orders.id, o.orderId)));
  const [row] = await withTenant(rt._db.db, ctxA.tenantId, (tx) => tx.select().from(schema.orders).where(eq(schema.orders.id, o.orderId)));
  orderNumber = row!.number;
  await withTenant(rt._db.db, ctxA.tenantId, (tx) => tx.update(schema.storeSettings).set({ autoPublishReviews: true }).where(eq(schema.storeSettings.tenantId, ctxA.tenantId)));
}, 180_000);

const base = () => ({ productId: productA, reviewerName: "Asha", rating: 5, body: "Lovely product, would buy again." });

describe("reviews", () => {
  it("an email alone does not earn the verified badge or auto-publish", async () => {
    const r = await submitProductReview(rt, ctxA.tenantId, { ...base(), email: "buyer@reviews.test" });
    expect(r.status).toBe("on_hold");
    const [row] = await withTenant(rt._db.db, ctxA.tenantId, (tx) => tx.select().from(schema.reviews).where(eq(schema.reviews.reviewerName, "Asha")));
    expect(row?.orderItemId).toBeNull();
  });

  it("email plus the order number of a delivered order is verified and auto-publishes", async () => {
    const r = await submitProductReview(rt, ctxA.tenantId, { ...base(), reviewerName: "Buyer", email: "buyer@reviews.test", orderNumber, rating: 4 });
    expect(r.status).toBe("published");
    const list = await getStorefrontReviews(rt, ctxA.tenantId, { productId: productA });
    expect(JSON.stringify(list)).toContain("Buyer");
  });

  it("moderation publishes a held review and keeps the product rating in step", async () => {
    const [held] = await withTenant(rt._db.db, ctxA.tenantId, (tx) => tx.select().from(schema.reviews).where(eq(schema.reviews.reviewerName, "Asha")));
    await publishAdminReview(rt, ctxA, held!.id);
    const [p] = await withTenant(rt._db.db, ctxA.tenantId, (tx) => tx.select().from(schema.products).where(eq(schema.products.id, productA)));
    expect(p?.ratingCount).toBe(2);
    expect(Number(p?.ratingAvg)).toBeCloseTo(4.5, 1);
  });

  it("another store cannot read or moderate this store's reviews", async () => {
    const [held] = await withTenant(rt._db.db, ctxA.tenantId, (tx) => tx.select().from(schema.reviews).where(eq(schema.reviews.reviewerName, "Asha")));
    const seen = await getStorefrontReviews(rt, ctxB.tenantId, { productId: productA });
    expect(JSON.stringify(seen)).not.toContain("Asha");
    await expect(publishAdminReview(rt, ctxB, held!.id)).rejects.toThrow(/not found/i);
  });

  it("a bot filling the honeypot stores nothing", async () => {
    const before = await withTenant(rt._db.db, ctxA.tenantId, (tx) => tx.select().from(schema.reviews));
    await submitProductReview(rt, ctxA.tenantId, { ...base(), reviewerName: "Bot", honeypot: "x" });
    const after = await withTenant(rt._db.db, ctxA.tenantId, (tx) => tx.select().from(schema.reviews));
    expect(after.length).toBe(before.length);
  });

  it("rate limits repeated submissions from one address", async () => {
    let blocked = false;
    for (let i = 0; i < 12; i++) {
      try {
        await submitProductReview(rt, ctxA.tenantId, { ...base(), reviewerName: `Flood${i}`, ip: "203.0.113.9" });
      } catch (e) {
        if (e instanceof RateLimitExceededError) blocked = true;
      }
    }
    expect(blocked).toBe(true);
  });
});
