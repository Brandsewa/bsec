import { beforeAll, describe, expect, it } from "vitest";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { STORE_PERMISSIONS } from "@bs/auth";
import {
  commitProductImportBatch,
  createCategory,
  createRuntime,
  getProduct,
  getProductImportRun,
  listProducts,
  parseProductRows,
  previewProductImport,
  provisionTenant,
  recordImportImageResult,
  startProductImportRun,
  type ConflictPolicy,
  type ImportMode,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";

let env: TestDb;
let rt: Runtime;
let ctxA: TenantContext;
let ctxB: TenantContext;

async function tenant(rtPlatform: Runtime, label: string): Promise<TenantContext> {
  const run = Math.random().toString(36).slice(2, 7);
  const t = await provisionTenant(rtPlatform, {
    storeName: `Import ${label} ${run}`,
    slug: `import-${label}-${run}`,
    owner: { email: `owner-${label}-${run}@import.test`, name: "Owner" },
    planCode: "starter",
    source: "platform_admin",
  });
  return { tenantId: t.tenantId, storeStatus: "live", actor: { type: "staff", userId: t.ownerId }, roles: ["store_owner"], permissions: [...STORE_PERMISSIONS], requestId: `req-import-${label}` };
}

const MAP = ["handle", "title", "shortDescription", "primaryCategory", "sku", "price", "imageUrl", "status"];
const csv = (rows: string[][]) => parseProductRows(rows, MAP, "INR");

async function run(rows: string[][], policy: ConflictPolicy = "update", mode: ImportMode = "create_and_update", ctx = ctxA) {
  const { products } = csv(rows);
  const started = await startProductImportRun(rt, ctx, { total: products.length, conflictPolicy: policy, mode, fileName: "t.csv" });
  const res = await commitProductImportBatch(rt, ctx, { runId: started.id, products });
  return res;
}

beforeAll(async () => {
  env = await startTestDb();
  const rtPlatform = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  rt = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5 });
  ctxA = await tenant(rtPlatform, "a");
  ctxB = await tenant(rtPlatform, "b");
  await createCategory(rt, ctxA, { name: "Tops" });
}, 180_000);

const find = async (handle: string, ctx = ctxA) => {
  const list = await listProducts(rt, ctx, { limit: 200 });
  const hit = list.items.find((p) => p.slug === handle);
  return hit ? getProduct(rt, ctx, { id: hit.id }) : null;
};

describe("product import (real Postgres)", () => {
  it("creates products with variants, category and image tasks, then reports a finished run", async () => {
    const res = await run([
      ["imp-tee", "Import Tee", "Soft", "tops", "IMP-TEE-1", "499", "https://cdn.example.com/a.jpg", "active"],
      ["imp-mug", "Import Mug", "", "", "IMP-MUG-1", "150", "", ""],
    ]);
    expect(res.run).toMatchObject({ created: 2, failed: 0, productsDone: 2, imagesTotal: 1 });
    expect(res.run.status).toBe("running"); // an image is still pending
    expect(res.imageTasks).toHaveLength(1);
    expect(res.imageTasks[0]?.urls).toEqual(["https://cdn.example.com/a.jpg"]);

    const tee = await find("imp-tee");
    expect(tee).toMatchObject({ title: "Import Tee", status: "active", shortDescription: "Soft", primaryCategoryName: "Tops" });
    expect(tee?.variants[0]).toMatchObject({ sku: "IMP-TEE-1", price: 49900 });

    await recordImportImageResult(rt, ctxA.tenantId, res.run.id, { ok: true });
    const done = await getProductImportRun(rt, ctxA, { id: res.run.id });
    expect(done.status).toBe("completed");
    expect(done.imagesDone).toBe(1);
  });

  it("rejects a product whose primary collection does not exist and imports nothing for it", async () => {
    const res = await run([["imp-ghost", "Ghost", "", "Nonexistent", "GHOST-1", "10", "", ""]]);
    expect(res.run).toMatchObject({ created: 0, failed: 1 });
    expect(res.run.errors[0]).toMatchObject({ handle: "imp-ghost", kind: "row" });
    expect(res.run.errors[0]?.message).toMatch(/Nonexistent/);
    expect(await find("imp-ghost")).toBeNull();
    expect(res.run.status).toBe("completed_with_errors");
  });

  it("skip policy leaves an existing product untouched and lists a conflict", async () => {
    const res = await run([["imp-tee", "Changed title", "", "", "IMP-TEE-1", "999", "", ""]], "skip");
    expect(res.run).toMatchObject({ skipped: 1, updated: 0 });
    expect(res.run.errors[0]?.kind).toBe("conflict");
    expect((await find("imp-tee"))?.title).toBe("Import Tee");
  });

  it("update policy changes only the filled columns and keeps blank cells", async () => {
    const res = await run([["imp-tee", "", "", "", "IMP-TEE-1", "599", "", ""]], "update");
    expect(res.run).toMatchObject({ updated: 1, failed: 0 });
    const tee = await find("imp-tee");
    expect(tee?.title).toBe("Import Tee");
    expect(tee?.shortDescription).toBe("Soft");
    expect(tee?.variants[0]?.price).toBe(59900);
  });

  it("replace policy clears mapped columns left blank and removes variants not in the file", async () => {
    await run([["imp-multi", "Multi", "Keep me", "", "MULTI-1", "10", "", ""], ["imp-multi", "", "", "", "MULTI-2", "20", "", ""]]);
    expect((await find("imp-multi"))?.variants).toHaveLength(2);
    const res = await run([["imp-multi", "Multi", "", "", "MULTI-1", "11", "", ""]], "replace");
    expect(res.run.updated).toBe(1);
    const after = await find("imp-multi");
    expect(after?.variants.map((v) => v.sku)).toEqual(["MULTI-1"]);
    expect(after?.variants[0]?.price).toBe(1100);
    expect(after?.shortDescription ?? "").toBe("");
  });

  it("never moves a SKU that belongs to a different product", async () => {
    const res = await run([["imp-other", "Other", "", "", "IMP-TEE-1", "5", "", ""]]);
    expect(res.run).toMatchObject({ created: 0, skipped: 1 });
    expect(res.run.errors[0]).toMatchObject({ kind: "conflict" });
    expect(res.run.errors[0]?.message).toMatch(/IMP-TEE-1/);
    expect(await find("imp-other")).toBeNull();
  });

  it("create-only skips existing products and update-only skips new ones", async () => {
    const a = await run([["imp-tee", "x", "", "", "IMP-TEE-1", "1", "", ""]], "update", "create_only");
    expect(a.run.skipped).toBe(1);
    const b = await run([["imp-brand-new", "New", "", "", "BN-1", "1", "", ""]], "update", "update_only");
    expect(b.run.skipped).toBe(1);
    expect(await find("imp-brand-new")).toBeNull();
  });

  it("previews without writing and classifies each product", async () => {
    const { products } = csv([
      ["imp-tee", "Import Tee", "", "", "IMP-TEE-1", "1", "https://cdn.example.com/x.jpg", ""],
      ["imp-fresh", "Fresh", "", "", "FRESH-1", "1", "", ""],
      ["imp-clash", "Clash", "", "", "IMP-MUG-1", "1", "", ""],
      ["imp-nocat", "No cat", "", "Missing", "NC-1", "1", "", ""],
    ]);
    const pv = await previewProductImport(rt, ctxA, { products });
    expect(pv).toMatchObject({ total: 4, toCreate: 1, existing: 1, skuConflicts: 1, unknownCategories: 1, images: 1 });
    expect(pv.items.map((i) => i.state)).toEqual(["exists", "new", "sku_conflict", "unknown_category"]);
    expect(await find("imp-fresh")).toBeNull();
  });

  it("keeps runs and products private to the store", async () => {
    const res = await run([["imp-b-only", "B only", "", "", "BONLY-1", "1", "", ""]], "update", "create_and_update", ctxB);
    expect(res.run.created).toBe(1);
    await expect(getProductImportRun(rt, ctxA, { id: res.run.id })).rejects.toThrow(/not found/i);
    expect(await find("imp-b-only", ctxA)).toBeNull();
  });

  it("is refused without the products.write permission", async () => {
    const readOnly = { ...ctxA, permissions: ["products.read"] as TenantContext["permissions"] };
    await expect(startProductImportRun(rt, readOnly, { total: 1, conflictPolicy: "update", mode: "create_and_update" })).rejects.toThrow(/Forbidden/);
  });
});

