import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { schema, withTenant } from "@bs/db";
import {
  createCustomFieldDefinition,
  createProduct,
  createRuntime,
  getResourceCustomFields,
  getStorefrontCustomFields,
  listCustomFieldDefinitions,
  provisionTenant,
  setCustomFieldArchived,
  setResourceCustomFields,
  updateCustomFieldDefinition,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";

let env: TestDb;
let rt: Runtime;
/** Connects as app_rw so Row Level Security applies as in production. */
let rtRls: Runtime;
let growth: TenantContext;
let other: TenantContext;
let starter: TenantContext;
let productId: string;
let mediaId: string;
let otherMediaId: string;

const ctxFor = (tenantId: string, ownerId: string): TenantContext => ({
  tenantId,
  storeStatus: "live",
  actor: { type: "staff", userId: ownerId },
  roles: ["store_owner"],
  permissions: ["products.read", "products.write"],
  requestId: "req_custom_fields_test",
});

async function makeStore(slug: string, planCode: "starter" | "growth") {
  const t = await provisionTenant(rt, { storeName: slug, slug, owner: { email: `owner-${slug}@test.com`, name: "Owner" }, planCode, source: "platform_admin" });
  return ctxFor(t.tenantId, t.ownerId);
}

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  rtRls = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 3 });
  growth = await makeStore("cf-growth", "growth");
  other = await makeStore("cf-other", "growth");
  starter = await makeStore("cf-starter", "starter");

  const p = await createProduct(rt, growth, { title: "Field Tea", variants: [{ sku: "FIELD-TEA-1", title: "Default", price: 10_000 }] });
  productId = p.id;

  await withTenant(rtRls._db.db, growth.tenantId, async (tx) => {
    const [m] = await tx.insert(schema.media).values({ tenantId: growth.tenantId, storageKey: "tenants/cf/leaf.png", mime: "image/png", bytes: 1000, width: 100, height: 100, folder: "products" }).returning();
    mediaId = m!.id;
  });
  await withTenant(rtRls._db.db, other.tenantId, async (tx) => {
    const [m] = await tx.insert(schema.media).values({ tenantId: other.tenantId, storageKey: "tenants/cf-other/x.png", mime: "image/png", bytes: 1000, width: 100, height: 100, folder: "products" }).returning();
    otherMediaId = m!.id;
  });
}, 180_000);

afterAll(async () => {
  await rtRls?.close();
  await rt?.close();
  await env?.stop();
});

describe("custom fields", () => {
  it("are available from the Growth plan: Starter stores are refused and see enabled=false", async () => {
    const listed = await listCustomFieldDefinitions(rt, starter, { resourceType: "product" });
    expect(listed).toEqual({ enabled: false, definitions: [] });
    await expect(createCustomFieldDefinition(rt, starter, { resourceType: "product", name: "Ingredients", type: "text" })).rejects.toThrow(/Growth plan/);
  });

  it("creates every field type, validates definitions, and keeps keys unique", async () => {
    const types = [
      { name: "Ingredients", type: "rich_text" as const },
      { name: "Origin", type: "text" as const },
      { name: "Leaf photo", type: "image" as const },
      { name: "Grade", type: "dropdown" as const, options: [{ label: "First flush" }, { label: "Second flush" }] },
      { name: "Best for", type: "multi_select" as const, options: [{ label: "Morning" }, { label: "Evening" }, { label: "Gifting" }] },
      { name: "Caffeine mg", type: "number" as const },
      { name: "Organic", type: "boolean" as const },
    ];
    for (const t of types) {
      const d = await createCustomFieldDefinition(rt, growth, { resourceType: "product", ...t });
      expect(d.key).toBe(t.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""));
    }
    const { definitions } = await listCustomFieldDefinitions(rt, growth, { resourceType: "product" });
    expect(definitions.map((d) => d.type)).toEqual(types.map((t) => t.type));
    expect(definitions.find((d) => d.key === "grade")!.options).toEqual([
      { value: "first-flush", label: "First flush" },
      { value: "second-flush", label: "Second flush" },
    ]);

    await expect(createCustomFieldDefinition(rt, growth, { resourceType: "product", name: "Origin", type: "text" })).rejects.toThrow(/already exists/);
    await expect(createCustomFieldDefinition(rt, growth, { resourceType: "product", name: "No options", type: "dropdown" })).rejects.toThrow(/at least one option/);
    await expect(createCustomFieldDefinition(rt, growth, { resourceType: "product", name: "Bad key", key: "1x", type: "text" })).rejects.toThrow(/start with a letter/);
    // the same key is fine on the other resource type
    await expect(createCustomFieldDefinition(rt, growth, { resourceType: "collection", name: "Origin", type: "text" })).resolves.toMatchObject({ key: "origin" });
  });

  it("saves typed values, sanitises rich text, and shows them on the storefront in order", async () => {
    const { definitions } = await listCustomFieldDefinitions(rt, growth, { resourceType: "product" });
    const by = (key: string) => definitions.find((d) => d.key === key)!.id;

    const saved = await setResourceCustomFields(rt, growth, {
      resourceType: "product",
      resourceId: productId,
      values: {
        [by("ingredients")]: '<p onclick="steal()">Tea leaves, <strong>jasmine</strong></p><script>alert(1)</script>',
        [by("origin")]: "  Darjeeling  ",
        [by("leaf_photo")]: mediaId,
        [by("grade")]: "first-flush",
        [by("best_for")]: ["gifting", "morning", "gifting"],
        [by("caffeine_mg")]: "35.5",
        [by("organic")]: true,
      },
    });
    expect(saved.enabled).toBe(true);
    const byKey = Object.fromEntries(saved.fields.map((f) => [f.definition.key, f]));
    expect(byKey["ingredients"]!.value).toBe("<p>Tea leaves, <strong>jasmine</strong></p>");
    expect(byKey["origin"]!.value).toBe("Darjeeling");
    expect(byKey["leaf_photo"]!.value).toEqual({ mediaId });
    expect(byKey["best_for"]!.value).toEqual(["morning", "gifting"]); // defined order, no duplicates
    expect(byKey["caffeine_mg"]!.value).toBe(35.5);
    expect(byKey["organic"]!.value).toBe(true);

    const shown = await getStorefrontCustomFields(rt, growth, { resourceType: "product", resourceId: productId });
    // The image field is left out here: it needs the store's public media URL, which a test database has none of.
    expect(shown.map((f) => f.key)).toEqual(["ingredients", "origin", "grade", "best_for", "caffeine_mg", "organic"]);
    expect(shown.find((f) => f.key === "grade")!.value).toBe("First flush"); // label, not the stored value
    expect(shown.find((f) => f.key === "best_for")!.value).toEqual(["Morning", "Gifting"]);
    expect(shown.find((f) => f.key === "ingredients")!.value).not.toContain("script");
  });

  it("refuses values that do not fit the field", async () => {
    const { definitions } = await listCustomFieldDefinitions(rt, growth, { resourceType: "product" });
    const by = (key: string) => definitions.find((d) => d.key === key)!.id;
    const set = (values: Record<string, unknown>) => setResourceCustomFields(rt, growth, { resourceType: "product", resourceId: productId, values });

    await expect(set({ [by("grade")]: "third-flush" })).rejects.toThrow(/not an option/);
    await expect(set({ [by("best_for")]: ["morning", "nope"] })).rejects.toThrow(/not an option/);
    await expect(set({ [by("caffeine_mg")]: "lots" })).rejects.toThrow(/must be a number/);
    await expect(set({ [by("organic")]: "yes" })).rejects.toThrow(/yes or no/);
    await expect(set({ [by("origin")]: "x".repeat(501) })).rejects.toThrow(/at most 500/);
    await expect(set({ [by("leaf_photo")]: "https://evil.example/a.png" })).rejects.toThrow(/media library/);
    await expect(set({ [by("leaf_photo")]: otherMediaId })).rejects.toThrow(/media library/); // another store's file
    await expect(set({ "00000000-0000-4000-8000-000000000000": "x" })).rejects.toThrow(/no longer exists/);
  });

  it("enforces required fields, clears values with null, and hides archived fields", async () => {
    const req = await createCustomFieldDefinition(rt, growth, { resourceType: "product", name: "Batch code", type: "text", required: true });
    await expect(setResourceCustomFields(rt, growth, { resourceType: "product", resourceId: productId, values: {} })).rejects.toThrow(/"Batch code" is required/);
    await setResourceCustomFields(rt, growth, { resourceType: "product", resourceId: productId, values: { [req.id]: "B-17" } });

    const { definitions } = await listCustomFieldDefinitions(rt, growth, { resourceType: "product" });
    const origin = definitions.find((d) => d.key === "origin")!;
    await setResourceCustomFields(rt, growth, { resourceType: "product", resourceId: productId, values: { [origin.id]: null } });
    expect((await getResourceCustomFields(rt, growth, { resourceType: "product", resourceId: productId })).fields.find((f) => f.definition.key === "origin")!.value).toBeNull();

    // renaming keeps key and values; the type cannot change (no such input exists), options can be edited
    const renamed = await updateCustomFieldDefinition(rt, growth, { id: origin.id, name: "Region", helpText: "Where the leaf grew", showOnStorefront: false });
    expect(renamed).toMatchObject({ name: "Region", key: "origin", helpText: "Where the leaf grew", showOnStorefront: false });
    await expect(updateCustomFieldDefinition(rt, growth, { id: origin.id, options: [{ label: "A" }] })).rejects.toThrow(/only dropdown and multi-select/);

    // archived: gone from the edit page and the storefront, values kept
    const archived = await setCustomFieldArchived(rt, growth, { id: req.id, archived: true });
    expect(archived.archived).toBe(true);
    expect((await getResourceCustomFields(rt, growth, { resourceType: "product", resourceId: productId })).fields.some((f) => f.definition.id === req.id)).toBe(false);
    expect((await getStorefrontCustomFields(rt, growth, { resourceType: "product", resourceId: productId })).some((f) => f.key === "batch_code")).toBe(false);
    expect((await listCustomFieldDefinitions(rt, growth, { resourceType: "product", includeArchived: true })).definitions.some((d) => d.id === req.id)).toBe(true);
    // the required rule no longer applies to an archived field
    await expect(setResourceCustomFields(rt, growth, { resourceType: "product", resourceId: productId, values: {} })).resolves.toBeDefined();
  });

  it("is tenant scoped: another store sees none of it and cannot write to this product", async () => {
    for (const runtime of [rt, rtRls]) {
      expect((await listCustomFieldDefinitions(runtime, other, { resourceType: "product" })).definitions).toEqual([]);
      expect(await getStorefrontCustomFields(runtime, other, { resourceType: "product", resourceId: productId })).toEqual([]);
      await expect(setResourceCustomFields(runtime, other, { resourceType: "product", resourceId: productId, values: {} })).rejects.toThrow(/not found/i);
    }
  });

  it("needs products.write for changes and products.read for reads", async () => {
    const readOnly = { ...growth, permissions: ["products.read"] };
    await expect(createCustomFieldDefinition(rt, readOnly, { resourceType: "product", name: "Nope", type: "text" })).rejects.toThrow(/permission|forbidden/i);
    const noAccess = { ...growth, permissions: [] as string[] };
    await expect(listCustomFieldDefinitions(rt, noAccess, { resourceType: "product" })).rejects.toThrow(/permission|forbidden/i);
  });
});
