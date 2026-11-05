import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { primaryCategory } from "./helpers/primary-category.ts";
import {
  bulkUpdateCategories,
  bulkUpdateCollections,
  bulkUpdateProducts,
  createCategory,
  createCollection,
  createProduct,
  createRuntime,
  getProductsForBulkEdit,
  provisionTenant,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";

let env: TestDb;
let rt: Runtime;
let ctx: TenantContext;
let other: TenantContext;
let readOnly: TenantContext;

const mk = (s: { tenantId: string; ownerId: string }, permissions: TenantContext["permissions"] = ["products.read", "products.write", "settings.write"]): TenantContext => ({
  tenantId: s.tenantId,
  storeStatus: "live",
  actor: { type: "staff", userId: s.ownerId },
  roles: ["store_owner"],
  permissions,
  requestId: "req-test",
});

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5 });
  const plat = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 3 });
  const a = await provisionTenant(plat, { storeName: "bulk-a", slug: "bulk-a", owner: { email: "o@bulk-a.test", name: "A" }, planCode: "starter", source: "platform_admin" });
  const b = await provisionTenant(plat, { storeName: "bulk-b", slug: "bulk-b", owner: { email: "o@bulk-b.test", name: "B" }, planCode: "starter", source: "platform_admin" });
  await plat.close();
  ctx = mk(a);
  other = mk(b);
  readOnly = mk(a, ["products.read"]);
}, 180_000);

afterAll(async () => {
  await rt?.close();
  await env?.stop();
});

describe("bulk editor", () => {
  it("saves product, variant and stock edits, one audit row per product", async () => {
    const p = await createProduct(rt, ctx, { title: "Tea", status: "active", primaryCategoryId: await primaryCategory(rt, ctx), variants: [{ sku: "TEA-1", title: "100g", price: 10000 }] });
    const v = p.variants[0]!;
    const { results } = await bulkUpdateProducts(rt, ctx, {
      items: [{ id: p.id, product: { title: "Green Tea", hsn: "0902" }, variants: [{ id: v.id, price: 12500, weightGrams: 100, stockOnHand: 7 }] }],
    });
    expect(results).toEqual([{ id: p.id, ok: true }]);
    const got = await getProductsForBulkEdit(rt, ctx, { ids: [p.id] });
    expect(got.items[0]).toMatchObject({ title: "Green Tea", hsn: "0902" });
    expect(got.items[0]?.variants[0]).toMatchObject({ price: 12500, weightGrams: 100 });
    expect(got.stock[v.id]).toBe(7);
    const logs = await rt._db.db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.tenantId, ctx.tenantId), eq(schema.auditLogs.targetId, p.id), eq(schema.auditLogs.action, "product.bulk_updated")));
    expect(logs).toHaveLength(1);
  });

  it("reports a duplicate SKU on that row only and still saves the others", async () => {
    const cat = await primaryCategory(rt, ctx);
    const a = await createProduct(rt, ctx, { title: "A", status: "active", primaryCategoryId: cat, variants: [{ sku: "DUP-A", title: "d", price: 100 }] });
    const b = await createProduct(rt, ctx, { title: "B", status: "active", primaryCategoryId: cat, variants: [{ sku: "DUP-B", title: "d", price: 100 }] });
    const { results } = await bulkUpdateProducts(rt, ctx, {
      items: [
        { id: a.id, variants: [{ id: a.variants[0]!.id, sku: "DUP-B" }] },
        { id: b.id, product: { title: "B2" } },
      ],
    });
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.error).toBeTruthy();
    expect(results[1]).toEqual({ id: b.id, ok: true });
  });

  it("never reads or writes another store's products", async () => {
    const p = await createProduct(rt, ctx, { title: "Mine", status: "active", primaryCategoryId: await primaryCategory(rt, ctx), variants: [{ sku: "MINE-1", title: "d", price: 100 }] });
    expect((await getProductsForBulkEdit(rt, other, { ids: [p.id] })).items).toHaveLength(0);
    const { results } = await bulkUpdateProducts(rt, other, { items: [{ id: p.id, product: { title: "Stolen" } }] });
    expect(results[0]?.ok).toBe(false);
    expect((await getProductsForBulkEdit(rt, ctx, { ids: [p.id] })).items[0]?.title).toBe("Mine");
  });

  it("needs products.write to save", async () => {
    await expect(bulkUpdateProducts(rt, readOnly, { items: [] })).rejects.toThrow(/Forbidden/);
  });

  it("bulk-edits categories and collections", async () => {
    const c = await createCategory(rt, ctx, { name: "Cat" });
    const col = await createCollection(rt, ctx, { title: "Col" });
    const cr = await bulkUpdateCategories(rt, ctx, { items: [{ id: c.id, name: "Cat 2", seo: { title: "T" } }] });
    const lr = await bulkUpdateCollections(rt, ctx, { items: [{ id: col.id, title: "Col 2", published: false }] });
    expect(cr.results[0]?.ok).toBe(true);
    expect(lr.results[0]?.ok).toBe(true);
  });
});
