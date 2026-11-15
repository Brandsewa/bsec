/**
 * Merchant-listing schema inputs on real Postgres (docs/SEO-GEO-AEO-PLAN.md Phase 2): return policy, shipping rules and
 * reviews come from this store's own settings, reading never creates a shipping zone, and nothing crosses stores.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { STORE_PERMISSIONS } from "@bs/auth";
import { createRuntime, getStorefrontOfferExtras, getStorefrontShippingRules, provisionTenant, type Runtime, type TenantContext } from "../src/index.ts";
import { createActiveProduct } from "./helpers/factories.ts";

let env: TestDb;
let rtPlatform: Runtime;
let rtWeb: Runtime;
let a: TenantContext;
let b: TenantContext;
const rand = Math.random().toString(36).slice(2, 7);

async function mk(name: string): Promise<TenantContext> {
  const slug = `${name}-${rand}`;
  const t = await provisionTenant(rtPlatform, { storeName: slug, slug, owner: { email: `owner@${slug}.test`, name: "Owner" }, planCode: "starter", source: "platform_admin" });
  return { tenantId: t.tenantId, storeStatus: "live", actor: { type: "staff", userId: t.ownerId }, roles: ["store_owner"], permissions: [...STORE_PERMISSIONS], requestId: `req-${name}` };
}

const zoneCount = (tenantId: string) => withTenant(rtWeb._db.db, tenantId, async (tx) => Number((await tx.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM shipping_zones WHERE tenant_id = ${tenantId}`)).rows[0]!.n));

beforeAll(async () => {
  env = await startTestDb();
  rtPlatform = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  rtWeb = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5 });
  a = await mk("offers-a");
  b = await mk("offers-b");
}, 240_000);

afterAll(async () => {
  await rtWeb?.close();
  await rtPlatform?.close();
  await env?.stop();
});

describe("getStorefrontShippingRules", () => {
  it("never creates a zone just because a product page was read", async () => {
    // Reading a store with no zones publishes nothing and creates nothing (checkout's loader would self-heal; this one must not).
    const before = await zoneCount(b.tenantId);
    const rules = await getStorefrontShippingRules(rtWeb, b.tenantId);
    expect(await zoneCount(b.tenantId)).toBe(before);
    if (before === 0) expect(rules).toBeUndefined();
  });

  it("reads the store's own default zone and its rates, and only that store's", async () => {
    // A new store is provisioned with a default India zone (its own standard rates).
    const rules = await getStorefrontShippingRules(rtWeb, a.tenantId);
    expect(rules?.countries).toEqual(["IN"]);
    expect(rules?.rates.length).toBeGreaterThanOrEqual(1);
    expect(rules?.rates.map((r) => r.method)).toContain("standard");
    // Changing store B's rates does not change store A's.
    await withTenant(rtWeb._db.db, b.tenantId, async (tx) => {
      await tx.update(schema.shippingRates).set({ pricePaise: 77700 }).where(sql`${schema.shippingRates.tenantId} = ${b.tenantId}`);
    });
    expect((await getStorefrontShippingRules(rtWeb, b.tenantId))?.rates.every((r) => r.pricePaise === 77700)).toBe(true);
    expect((await getStorefrontShippingRules(rtWeb, a.tenantId))?.rates.some((r) => r.pricePaise === 77700)).toBe(false);
  });

  it("leaves out a zone limited to some states", async () => {
    const c = await mk("offers-c");
    await withTenant(rtWeb._db.db, c.tenantId, async (tx) => {
      await tx.update(schema.shippingZones).set({ states: ["Kerala"] }).where(sql`${schema.shippingZones.tenantId} = ${c.tenantId}`);
    });
    expect(await getStorefrontShippingRules(rtWeb, c.tenantId)).toBeUndefined();
  });
});

describe("getStorefrontOfferExtras", () => {
  it("returns the return policy for the store's country and its newest published reviews only", async () => {
    const p = await createActiveProduct(rtWeb, a, { title: "Reviewed tea", sku: `OF-${rand}` });
    await withTenant(rtWeb._db.db, a.tenantId, async (tx) => {
      await tx.insert(schema.reviews).values([
        { tenantId: a.tenantId, productId: p.productId, reviewerName: "Asha", rating: 5, title: "Lovely", body: "Great tea", status: "published" },
        { tenantId: a.tenantId, productId: p.productId, reviewerName: "Held", rating: 1, body: "Not shown", status: "on_hold" },
      ]);
    });
    const extras = await getStorefrontOfferExtras(rtWeb, a.tenantId, { productId: p.productId });
    expect(extras.reviews?.map((r) => r.author)).toEqual(["Asha"]);
    expect(extras.returnPolicy).toMatchObject({ acceptReturns: true, returnWindowDays: 7 });
    expect(extras.returnPolicy?.country).toMatch(/^[A-Z]{2}$/);
    // Another store sees none of these reviews.
    const other = await getStorefrontOfferExtras(rtWeb, b.tenantId, { productId: p.productId });
    expect(other.reviews ?? []).toEqual([]);
  });
});
