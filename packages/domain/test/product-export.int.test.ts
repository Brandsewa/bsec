import { beforeAll, describe, expect, it } from "vitest";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { STORE_PERMISSIONS } from "@bs/auth";
import { createCategory, createProduct, createRuntime, exportProductRows, provisionTenant, type Runtime, type TenantContext } from "../src/index.ts";

let env: TestDb;
let rt: Runtime;
let ctxA: TenantContext;
let ctxB: TenantContext;
let ctxNoExport: TenantContext;

async function tenant(rtPlatform: Runtime, label: string): Promise<TenantContext> {
  const run = Math.random().toString(36).slice(2, 7);
  const t = await provisionTenant(rtPlatform, {
    storeName: `Export ${label} ${run}`,
    slug: `export-${label}-${run}`,
    owner: { email: `owner-${label}-${run}@export.test`, name: "Owner" },
    planCode: "starter",
    source: "platform_admin",
  });
  return { tenantId: t.tenantId, storeStatus: "live", actor: { type: "staff", userId: t.ownerId }, roles: ["store_owner"], permissions: [...STORE_PERMISSIONS], requestId: `req-export-${label}` };
}

let topsId: string;

beforeAll(async () => {
  env = await startTestDb();
  const rtPlatform = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  rt = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5 });
  ctxA = await tenant(rtPlatform, "a");
  ctxB = await tenant(rtPlatform, "b");
  ctxNoExport = { ...ctxA, permissions: ["products.read"] };

  const tops = await createCategory(rt, ctxA, { name: "Tops" });
  topsId = tops.id;
  await createProduct(rt, ctxA, {
    title: "Tee",
    slug: "tee",
    status: "active",
    shortDescription: "Soft tee",
    descriptionJson: { type: "text", text: "Line one\n\nLine two" },
    tags: ["summer", "cotton"],
    seo: { title: "Tee SEO", description: "Tee meta" },
    primaryCategoryId: topsId,
    options: [{ name: "Size", values: ["S", "M"] }],
    variants: [
      { sku: "TEE-S", title: "S", price: 49900, compareAtPrice: 59900, optionValues: { Size: "S" } },
      { sku: "TEE-M", title: "M", price: 49900, optionValues: { Size: "M" } },
    ],
  });
  await createProduct(rt, ctxA, { title: "Mug", slug: "mug", variants: [{ sku: "MUG-1", title: "Default", price: 1500 }] });
  await createProduct(rt, ctxB, { title: "Other store product", slug: "other", variants: [{ sku: "OTHER-1", title: "Default", price: 100 }] });
}, 180_000);

const col = (res: { header: string[] }, name: string) => res.header.indexOf(name);

describe("exportProductRows (real Postgres)", () => {
  it("exports a row per variant with product fields on the first row and formatted prices", async () => {
    const res = await exportProductRows(rt, ctxA, { fields: "all" });
    expect(res.products).toBe(2);
    const tee = res.rows.filter((r) => r[col(res, "URL handle")] === "tee");
    expect(tee).toHaveLength(2);
    expect(tee[0]?.[col(res, "Title")]).toBe("Tee");
    expect(tee[1]?.[col(res, "Title")]).toBe("");
    expect(tee.map((r) => r[col(res, "Variant SKU")])).toEqual(["TEE-S", "TEE-M"]);
    expect(tee[0]?.[col(res, "Variant price")]).toBe("499.00");
    expect(tee[0]?.[col(res, "Compare-at price")]).toBe("599.00");
    expect(tee[0]?.[col(res, "Primary collection")]).toBe("Tops");
    expect(tee[0]?.[col(res, "Tags")]).toBe("summer|cotton");
    expect(tee[0]?.[col(res, "SEO title")]).toBe("Tee SEO");
    expect(tee[0]?.[col(res, "Description")]).toBe("Line one\n\nLine two");
    expect(tee[0]?.[col(res, "Option 1 name")]).toBe("Size");
    expect(tee[1]?.[col(res, "Option 1 value")]).toBe("M");
  });

  it("never returns another store's products", async () => {
    const res = await exportProductRows(rt, ctxA, { fields: "all" });
    expect(res.rows.map((r) => r[col(res, "URL handle")])).not.toContain("other");
    const other = await exportProductRows(rt, ctxB, { fields: "all" });
    expect(other.rows.map((r) => r[col(other, "URL handle")])).toEqual(["other"]);
  });

  it("filters by category and honours a custom field list", async () => {
    const res = await exportProductRows(rt, ctxA, { fields: ["title", "sku"], categoryIds: [topsId] });
    expect(res.header).toEqual(["URL handle", "Title", "Variant SKU"]);
    expect(new Set(res.rows.map((r) => r[0]))).toEqual(new Set(["tee"]));
  });

  it("pages with a keyset cursor without repeating or skipping products", async () => {
    const first = await exportProductRows(rt, ctxA, { fields: ["title"], limit: 1 });
    expect(first.products).toBe(1);
    expect(first.nextCursor).not.toBeNull();
    const second = await exportProductRows(rt, ctxA, { fields: ["title"], limit: 1, cursor: first.nextCursor! });
    expect(second.products).toBe(1);
    expect(second.nextCursor).toBeNull();
    expect(new Set([first.rows[0]?.[0], second.rows[0]?.[0]]).size).toBe(2);
  });

  it("requires the export permission", async () => {
    await expect(exportProductRows(rt, ctxNoExport, { fields: "all" })).rejects.toThrow();
  });
});

describe("exportProductRows roles", () => {
  it("is refused for staff who are not store owner or store admin, even with the permission", async () => {
    const custom = { ...ctxA, roles: ["catalog_manager"] };
    await expect(exportProductRows(rt, custom, { fields: "all" })).rejects.toThrow(/store owner and store admin/);
  });
});
