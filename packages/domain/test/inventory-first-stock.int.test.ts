import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { primaryCategory } from "./helpers/primary-category.ts";
import { schema } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import {
  adjustInventory,
  createProduct,
  createRuntime,
  getStorefrontFeaturedProducts,
  listInventoryLevels,
  provisionTenant,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";

let env: TestDb;
let rt: Runtime;
let rtWeb: Runtime;
let ctx: TenantContext;
let other: TenantContext;
let locationId: string;

const mk = (s: { tenantId: string; ownerId: string }): TenantContext => ({
  tenantId: s.tenantId,
  storeStatus: "live",
  actor: { type: "staff", userId: s.ownerId },
  roles: ["store_owner"],
  permissions: ["products.read", "products.write", "settings.write"],
  requestId: "req-test",
});

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  rtWeb = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5 });
  const a = await provisionTenant(rt, { storeName: "inv-a", slug: "inv-a", owner: { email: "owner@inv-a.test", name: "A" }, planCode: "starter", source: "platform_admin" });
  const b = await provisionTenant(rt, { storeName: "inv-b", slug: "inv-b", owner: { email: "owner@inv-b.test", name: "B" }, planCode: "starter", source: "platform_admin" });
  ctx = mk(a);
  other = mk(b);
  const [loc] = await rt._db.db.select({ id: schema.locations.id }).from(schema.locations).where(eq(schema.locations.tenantId, a.tenantId));
  locationId = loc!.id;
}, 180_000);

afterAll(async () => {
  await rt?.close();
  await rtWeb?.close();
  await env?.stop();
});

describe("a new product's first stock", () => {
  it("lists a variant that has never had stock (0 on hand) so the owner can add the first stock", async () => {
    await createProduct(rtWeb, ctx, { title: "Pickle", status: "active", primaryCategoryId: await primaryCategory(rtWeb, ctx), variants: [{ sku: "PICKLE-1", title: "Default", price: 10000 }] });
    const list = await listInventoryLevels(rtWeb, ctx, {});
    expect(list.total).toBe(1);
    expect(list.items[0]).toMatchObject({ variantSku: "PICKLE-1", productTitle: "Pickle", onHand: 0, reserved: 0, available: 0, locationId });
    expect(list.items[0]?.id).toContain(":"); // no stock row yet
  });

  it("adjusting creates the stock row, and the product becomes buyable with real stock", async () => {
    const first = (await listInventoryLevels(rtWeb, ctx, {})).items[0]!;
    const res = await adjustInventory(rtWeb, ctx, { variantId: first.variantId, locationId: first.locationId, quantityDelta: 5, reason: "received" });
    expect(res.newOnHand).toBe(5);
    const after = (await listInventoryLevels(rtWeb, ctx, {})).items[0]!;
    expect(after).toMatchObject({ onHand: 5, available: 5 });
    expect(after.id).not.toContain(":");
    expect((await getStorefrontFeaturedProducts(rtWeb, ctx, {})).map((p) => p.title)).toContain("Pickle");
  });

  it("search narrows the list, and one store never sees another store's variants", async () => {
    expect((await listInventoryLevels(rtWeb, ctx, { search: "PICKLE" })).total).toBe(1);
    expect((await listInventoryLevels(rtWeb, ctx, { search: "no-such-thing" })).total).toBe(0);
    expect((await listInventoryLevels(rtWeb, other, {})).total).toBe(0);
  });

  it("variants that do not track stock are not listed", async () => {
    await createProduct(rtWeb, ctx, { title: "Gift card", status: "active", primaryCategoryId: await primaryCategory(rtWeb, ctx), variants: [{ sku: "GIFT-1", title: "Card", price: 50000, trackInventory: false }] });
    const list = await listInventoryLevels(rtWeb, ctx, {});
    expect(list.items.map((i) => i.variantSku)).toEqual(["PICKLE-1"]);
  });
});
